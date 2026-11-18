// @ts-check
// Shared connection code for the online buzzer mode (host page and player page).
// Everyone connects to a small room server (Cloudflare Worker, see worker/) over a normal
// secure WebSocket, the same kind of connection as loading a website, so it works on any
// network that can open the site. The server only forwards messages; the host's browser
// still runs the game. No keys or tokens are involved.

// ---------------- Messages between the host and the phones ----------------
// Every message is a JSON object with its type in `t`. The room server forwards them without
// looking inside (its own wrapping is described in worker/src/index.js).
// Build messages with `Msg` below, and read them through the types here: with `// @ts-check`
// a field renamed on one side shows up as an error on the other (`npm run check`).
//
// Phone → host
//   hello   {name, token}       join, or rejoin under the same name (the token proves it's the same phone)
//   buzz                        "I know!"
//   guess   {title?, artist?}   the buzzing player's answer, only the parts that are still open
//   vote    {kind, on}          kind "more" (Hear more) or "giveup"; on: false takes the vote back
//   pong                        answer to a ping
//
// Host → phone
//   welcome {name, code}        the name was accepted
//   error   {msg}               for example the name is taken; the phone shows it
//   kicked                      the host removed this player
//   ping                        every few seconds; a phone that stops answering counts as offline
//   options {title, artist}     suggestion lists for the guess boxes, sent when a game starts
//   state   {…}                 everything the phones show, sent after every change (StateMsg)

/** @typedef {"title" | "artist"} Field */
/** @type {Field[]} */
const FIELDS = ["title", "artist"];

// The buzzing player has this long to answer.
const ANSWER_SECONDS = 20;

/** @typedef {"lobby" | "waiting" | "open" | "reveal" | "end"} Phase  waiting = round started, clip not played yet */
/** @typedef {"more" | "giveup"} VoteKind */

/**
 * @typedef {{ t: "hello", name: string, token: string }
 *   | { t: "buzz" }
 *   | { t: "guess", title?: string, artist?: string }
 *   | { t: "vote", kind: VoteKind, on: boolean }
 *   | { t: "pong" }} PlayerMsg
 */

/**
 * @typedef {{ t: "welcome", name: string, code: string }
 *   | { t: "error", msg: string }
 *   | { t: "kicked" }
 *   | { t: "ping" }
 *   | OptionsMsg
 *   | StateMsg} HostMsg
 */

/**
 * One suggestion in a guess box.
 * @typedef {object} WireOption
 * @property {string} label
 * @property {string} img     picture URL, or ""
 * @property {boolean} round  show it round, with the first letter when there's no picture (artists)
 */

/** @typedef {{ t: "options", title: WireOption[], artist: WireOption[] }} OptionsMsg */

/**
 * The latest guess, shown on every phone.
 * @typedef {object} GuessResult
 * @property {string} name
 * @property {number} pts
 * @property {{ field: Field, text: string, ok: boolean }[]} parts
 * @property {boolean} timedOut
 * @property {boolean} frozen   the player can't buzz again until "Hear more"
 */

/**
 * @typedef {object} Votes
 * @property {number} players     players online
 * @property {string[]} more      names voting "Hear more"
 * @property {string[]} giveup    names voting "Give up"
 * @property {number} moreNeed    votes that play the longer clip
 * @property {number} giveupNeed  votes that reveal the song
 */

/**
 * @typedef {object} StateMsg
 * @property {"state"} t
 * @property {string} code
 * @property {Phase} phase
 * @property {number} round        1-based
 * @property {number} total        rounds in the game
 * @property {number} pts          what a correct part is worth now
 * @property {number} seconds      length of the current clip
 * @property {number} nextSeconds  length of the next clip, 0 if this is the longest
 * @property {string | null} buzzer     name of the player answering
 * @property {number} remaining    ms they have left
 * @property {string[]} frozen
 * @property {Votes} votes
 * @property {Record<Field, { by: string, pts: number, text: string } | null>} solved
 * @property {GuessResult | null} last
 * @property {{ name: string, score: number, online: boolean }[]} players
 * @property {{ title: string, artist: string, cover: string, from: string } | null} answer  set on reveal and at the end
 */

const Msg = {
  // Phone → host
  /** @returns {PlayerMsg} */ hello: (/** @type {string} */ name, /** @type {string} */ token) => ({ t: "hello", name, token }),
  /** @returns {PlayerMsg} */ buzz: () => ({ t: "buzz" }),
  /** @returns {PlayerMsg} */ guess: (/** @type {{ title?: string, artist?: string }} */ parts) => ({ t: "guess", ...parts }),
  /** @returns {PlayerMsg} */ vote: (/** @type {VoteKind} */ kind, /** @type {boolean} */ on) => ({ t: "vote", kind, on }),
  /** @returns {PlayerMsg} */ pong: () => ({ t: "pong" }),
  // Host → phone (the state message is built by stateMessage() in online.js)
  /** @returns {HostMsg} */ welcome: (/** @type {string} */ name, /** @type {string} */ code) => ({ t: "welcome", name, code }),
  /** @returns {HostMsg} */ error: (/** @type {string} */ msg) => ({ t: "error", msg }),
  /** @returns {HostMsg} */ kicked: () => ({ t: "kicked" }),
  /** @returns {HostMsg} */ ping: () => ({ t: "ping" }),
  /** @returns {HostMsg} */ options: (/** @type {WireOption[]} */ title, /** @type {WireOption[]} */ artist) => ({ t: "options", title, artist }),
};

// ---------------- Room server ----------------

// Address of the deployed room server, e.g. "wss://song-quiz-rooms.YOUR-NAME.workers.dev".
const ROOM_SERVER = "wss://song-quiz-rooms.max-vitvitckiy.workers.dev";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

function randomCode(len = 5) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function randomToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function cleanCode(text) {
  return String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ?server=ws://host:port points at another room server. On localhost the page uses the
// local one from `npm run dev` in worker/.
function roomServer() {
  const custom = new URLSearchParams(location.search).get("server");
  if (custom) return custom.replace(/\/+$/, "");
  if (["localhost", "127.0.0.1"].includes(location.hostname)) return `ws://${location.hostname}:8787`;
  return ROOM_SERVER;
}

function roomUrl(code, params) {
  const server = roomServer();
  if (!server) throw new Error("The online room server isn't set up yet (ROOM_SERVER in net.js).");
  return `${server}/room/${encodeURIComponent(code)}?${new URLSearchParams(params)}`;
}

class Emitter {
  constructor() { this.handlers = {}; }
  on(event, fn) { (this.handlers[event] || (this.handlers[event] = [])).push(fn); return this; }
  emit(event, ...args) { (this.handlers[event] || []).forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } }); }
}

// ---------------- Host side ----------------
// openRoom(code, token) emits:
//   "open"         the room is ours
//   "connection"   (conn) a new phone; conn has .open, .send(msg), .close(), "data" and "close" events
//   "reconnected"  the link to the server dropped and came back (phones rejoin by themselves)
//   "error"        ({ type, message }) type "unavailable-id" = another host holds this code

class PlayerLink extends Emitter {
  constructor(room, id) { super(); this.room = room; this.id = id; this.open = true; }
  send(msg) { if (this.open) this.room.sendRaw({ to: this.id, data: msg }); }
  close() {
    if (!this.open) return;
    this.room.sendRaw({ kick: this.id });
    this.room.forget(this);
  }
}

class HostRoom extends Emitter {
  constructor(code, token) {
    super();
    this.code = code;
    this.token = token;
    this.links = new Map();
    this.ready = false;     // got "ready" at least once
    this.destroyed = false;
    this.connect();
  }

  connect() {
    let ws;
    try { ws = this.ws = new WebSocket(roomUrl(this.code, { role: "host", token: this.token })); }
    catch (e) { return setTimeout(() => this.emit("error", { type: "network", message: e.message })); }
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.sys === "ready") {
        const first = !this.ready;
        this.ready = true;
        return this.emit(first ? "open" : "reconnected");
      }
      if (msg.sys === "leave") {
        const link = this.links.get(msg.id);
        if (link) this.forget(link);
        return;
      }
      if (typeof msg.from !== "string") return;
      let link = this.links.get(msg.from);
      if (!link) {
        link = new PlayerLink(this, msg.from);
        this.links.set(msg.from, link);
        this.emit("connection", link);
      }
      link.emit("data", msg.data);
    };
    ws.onclose = (e) => {
      if (ws !== this.ws || this.destroyed) return;
      // The server closes every phone when the host's link drops; they rejoin on their own.
      [...this.links.values()].forEach((link) => this.forget(link));
      if (e.code === 4001) return this.emit("error", { type: "unavailable-id", message: "That room code is taken" });
      this.emit("error", { type: "network", message: "Couldn't reach the room server" });
      if (this.ready) setTimeout(() => { if (!this.destroyed) this.connect(); }, 2500);
    };
  }

  sendRaw(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  forget(link) {
    if (!link.open) return;
    link.open = false;
    this.links.delete(link.id);
    setTimeout(() => link.emit("close"));
  }

  destroy() {
    this.destroyed = true;
    try { this.ws && this.ws.close(); } catch {}
  }
}

function openRoom(code, token) { return new HostRoom(code, token); }

// ---------------- Player side ----------------
// joinRoom(code) returns a link with .open, .send(msg), .close() that emits:
//   "open", "data" (msg), "close" (dropped after it was open),
//   "error" ({ type }) with type "no-host" (no host), "full" or "network".

class RoomLink extends Emitter {
  constructor(code) {
    super();
    this.open = false;
    let ws;
    try { ws = this.ws = new WebSocket(roomUrl(code, { role: "player" })); }
    catch (e) { setTimeout(() => this.emit("error", { type: "network", message: e.message })); return; }
    let wasOpen = false;
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && msg.sys === "ready") { this.open = wasOpen = true; return this.emit("open"); }
      this.emit("data", msg);
    };
    ws.onclose = (e) => {
      this.open = false;
      if (this.closedByUs) return;
      if (e.code === 4004) return this.emit("error", { type: "no-host" });
      if (e.code === 4003) return this.emit("error", { type: "full" });
      if (!wasOpen) return this.emit("error", { type: "network" });
      this.emit("close");
    };
  }

  send(msg) { if (this.open) this.ws.send(JSON.stringify(msg)); }

  close() {
    this.closedByUs = true;
    this.open = false;
    try { this.ws && this.ws.close(); } catch {}
  }
}

function joinRoom(code) { return new RoomLink(code); }
