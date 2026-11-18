// Room server for the online buzzer mode.
//
// Every game code gets one Durable Object ("room"). The host's browser and each player's
// phone open a WebSocket to wss://<worker>/room/<CODE>. The room only forwards messages:
//   player -> host:  the player's JSON, wrapped as {"from": "<player id>", "data": ...}
//   host -> player:  {"to": "<player id>", "data": ...}  (the room sends just `data`)
//   host -> room:    {"kick": "<player id>"} closes that player's socket
//   room -> host:    {"sys": "leave", "id": "<player id>"} when a phone disconnects
//   room -> anyone:  {"sys": "ready"} once the socket is accepted
// All game logic stays in the host's browser. Nothing here needs a secret.
//
// Close codes the pages understand:
//   4001 room code is held by another host     4002 the host left (players rejoin later)
//   4003 room is full                          4004 no host in this room yet
//   4005 the host dropped this player

import { DurableObject } from "cloudflare:workers";

const MAX_PLAYERS = 30;
const MAX_PLAYER_MSG = 4 * 1024;        // a guess or a vote is tiny
const MAX_HOST_MSG = 900 * 1024;        // song lists for autocomplete can be big
const PLAYER_MSGS_PER_SEC = 20;
const IDLE_MS = 10 * 60 * 1000;         // forget an empty room's host token after this
const CODE_RE = /^\/room\/([A-Z0-9]{4,8})$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(CODE_RE);
    if (!match) {
      return new Response(url.pathname === "/" ? "Guess the Song room server\n" : "Not found\n", { status: url.pathname === "/" ? 200 : 404 });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket\n", { status: 426 });
    if (!originAllowed(request.headers.get("Origin"), env)) return new Response("Forbidden\n", { status: 403 });
    const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
    return room.fetch(request);
  },
};

// Only pages from the game's own site may open rooms. Browsers set Origin themselves,
// so other websites can't use this server from their visitors' browsers.
function originAllowed(origin, env) {
  if (!origin) return false;
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  if (env.ALLOW_LOCALHOST === "true") {
    try { return ["localhost", "127.0.0.1"].includes(new URL(origin).hostname); } catch { return false; }
  }
  return false;
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new Map(); // player id -> { second, count }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    if (role !== "host" && role !== "player") return new Response("Bad role\n", { status: 400 });

    const [client, server] = Object.values(new WebSocketPair());

    if (role === "host") {
      const token = String(url.searchParams.get("token") || "").slice(0, 64);
      const saved = await this.ctx.storage.get("hostToken");
      if (!token || (saved && saved !== token)) return reject(server, client, 4001, "Room code taken");
      await this.ctx.storage.put("hostToken", token);
      await this.ctx.storage.deleteAlarm();
      // A reloaded host page replaces the old one. Players were talking to the old page,
      // so they reconnect and say hello again.
      this.ctx.acceptWebSocket(server, ["host"]);
      server.serializeAttachment({ role: "host" });
      for (const old of this.ctx.getWebSockets("host")) if (old !== server) safeClose(old, 4001, "Replaced");
      for (const p of this.players()) safeClose(p, 4002, "Host changed");
      server.send(JSON.stringify({ sys: "ready" }));
    } else {
      if (!this.host()) return reject(server, client, 4004, "No host");
      if (this.players().length >= MAX_PLAYERS) return reject(server, client, 4003, "Room is full");
      const id = crypto.randomUUID().slice(0, 8);
      this.ctx.acceptWebSocket(server, ["p:" + id]);
      server.serializeAttachment({ role: "player", id });
      server.send(JSON.stringify({ sys: "ready" }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return;
    const me = ws.deserializeAttachment() || {};

    if (me.role === "host") {
      if (message.length > MAX_HOST_MSG) return;
      let msg;
      try { msg = JSON.parse(message); } catch { return; }
      if (!msg || typeof msg !== "object") return;
      if (typeof msg.kick === "string") {
        for (const p of this.ctx.getWebSockets("p:" + msg.kick)) safeClose(p, 4005, "Removed");
        return;
      }
      if (typeof msg.to !== "string") return;
      const out = JSON.stringify(msg.data);
      for (const p of this.ctx.getWebSockets("p:" + msg.to)) safeSend(p, out);
      return;
    }

    if (me.role === "player") {
      if (message.length > MAX_PLAYER_MSG || this.tooFast(me.id)) return;
      let data;
      try { data = JSON.parse(message); } catch { return; }
      const host = this.host();
      if (host) safeSend(host, JSON.stringify({ from: me.id, data }));
    }
  }

  async webSocketClose(ws, code) {
    await this.gone(ws);
    safeClose(ws, code === 1005 || code === 1006 ? 1000 : code, "Bye");
  }

  async webSocketError(ws) {
    await this.gone(ws);
  }

  async gone(ws) {
    const me = ws.deserializeAttachment() || {};
    if (me.role === "host") {
      if (!this.host(ws)) for (const p of this.players()) safeClose(p, 4002, "Host left");
    } else if (me.role === "player") {
      this.rate.delete(me.id);
      const host = this.host();
      if (host) safeSend(host, JSON.stringify({ sys: "leave", id: me.id }));
    }
    if (!this.ctx.getWebSockets().some((s) => s !== ws && s.readyState === WebSocket.OPEN)) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    }
  }

  // Nobody came back: free the code so the room's storage is empty again.
  async alarm() {
    if (!this.ctx.getWebSockets().some((s) => s.readyState === WebSocket.OPEN)) await this.ctx.storage.deleteAll();
  }

  host(except) {
    return this.ctx.getWebSockets("host").find((s) => s !== except && s.readyState === WebSocket.OPEN);
  }

  players() {
    return this.ctx.getWebSockets().filter((s) => s.readyState === WebSocket.OPEN && (s.deserializeAttachment() || {}).role === "player");
  }

  tooFast(id) {
    const second = Math.floor(Date.now() / 1000);
    const r = this.rate.get(id);
    if (!r || r.second !== second) { this.rate.set(id, { second, count: 1 }); return false; }
    return ++r.count > PLAYER_MSGS_PER_SEC;
  }
}

// Accept, then close straight away, so the page sees our close code and reason
// (a refused upgrade only shows up as a generic network error in the browser).
function reject(server, client, code, reason) {
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

function safeSend(ws, text) { try { ws.send(text); } catch {} }
function safeClose(ws, code, reason) { try { ws.close(code, reason); } catch {} }
