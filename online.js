// @ts-check
// Online buzzer mode, host side.
// The host's browser is the referee: it owns the room, decides who buzzed first,
// checks guesses, gives points, freezes wrong guessers and unfreezes everyone on
// "Hear more". Players' phones (play.html) only send "hello", "buzz", "guess" and "vote"
// (every message is listed in net.js).
// Votes: more than half the players asking for "Hear more" plays the longer clip,
// everyone pressing "Give up" reveals the song. The host's own buttons skip the vote.
// Audio plays on the host only (stream it to your friends, e.g. over Discord).
// The game itself runs in app.js; this file follows it through the events on `game` (state.js).

const PING_MS = 4000, DROP_MS = 13000;   // a phone that's silent this long counts as offline
const CODE_KEY = "guess-the-song-room";

/**
 * Someone who joined the room. In an online game this list is also state.players, so it holds the scores.
 * @typedef {object} RoomPlayer
 * @property {string} name
 * @property {number} score
 * @property {boolean} online
 * @property {PlayerLink} conn
 * @property {string} token   proves a reconnecting phone is the same one (see onHello)
 * @property {number} [seen]  when we last heard from the phone
 */

const net = {
  room: /** @type {HostRoom | null} */ (null),   // connection to the room server (net.js)
  code: /** @type {string | null} */ (null),
  opening: false,
  players: /** @type {RoomPlayer[]} */ ([]),
  buzzer: /** @type {string | null} */ (null),   // name of the player who is answering
  deadline: 0,
  timer: null,
  ticker: null,
  frozen: /** @type {Set<string>} */ (new Set()),   // names that can't buzz until "Hear more"
  last: /** @type {GuessResult | null} */ (null),  // result of the latest guess, shown to everyone
  votes: { more: /** @type {Set<string>} */ (new Set()), giveup: /** @type {Set<string>} */ (new Set()) }, // names voting for "Hear more" / "Give up"
};

const onlinePicked = () => pickedMode() === "online";

// What the phones see. A room can stay open during a party or solo game; its phones wait in the lobby.
/** @returns {Phase} */
const roomPhase = () => (isOnline() ? state.phase : "lobby");

// ---------------- Room ----------------

function netOpen() {
  if (net.room || net.opening) return;
  net.opening = true;
  // A reloaded page gets its room back: the saved token proves it's the same host.
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(CODE_KEY) || "null"); } catch {}
  if (saved && saved.code && saved.token) tryOpen(saved.code, saved.token);
  else tryOpen(randomCode(), randomToken());
}

function tryOpen(code, token) {
  setStatus("Opening a room…", "", $("roomStatus"));
  const room = openRoom(code, token);
  room.on("open", () => {
    net.room = room;
    net.code = code;
    net.opening = false;
    try { sessionStorage.setItem(CODE_KEY, JSON.stringify({ code, token })); } catch {}
    setStatus("Room is open. Send the link to your friends.", "ok", $("roomStatus"));
    renderRoom();
    setInterval(heartbeat, PING_MS);
  });
  room.on("connection", acceptConnection);
  room.on("reconnected", () => setStatus("Room is open again. Players rejoin by themselves.", "ok", $("roomStatus")));
  room.on("error", (err) => {
    if (!net.room) {
      room.destroy();
      if (err.type === "unavailable-id") return tryOpen(randomCode(), randomToken());
      net.opening = false;
      return setStatus("Couldn't open a room: " + (err.message || err.type) + ". Reload to try again.", "error", $("roomStatus"));
    }
    if (err.type === "unavailable-id") {
      room.destroy();
      return setStatus("This room was opened in another tab. Reload to open a new one.", "error", $("roomStatus"));
    }
    setStatus("Lost the connection to the room server. Reconnecting…", "error", $("roomStatus"));
  });
}

function joinLink() {
  if (!net.code) return "";
  const u = new URL("play.html", location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("room", net.code);
  const server = new URLSearchParams(location.search).get("server");
  if (server) u.searchParams.set("server", server);
  return u.toString();
}

function acceptConnection(conn) {
  conn.on("data", (msg) => { try { onPlayerMessage(conn, msg); } catch (e) { console.error(e); } });
  conn.on("close", () => {
    const p = net.players.find((x) => x.conn === conn && x.online);
    if (!p) return;
    p.online = false;
    renderRoomPlayers();
    if (onGameScreen()) renderScores();
    netBroadcast();
    checkVotes();
  });
}

const playerOf = (conn) => net.players.find((p) => p.conn === conn && p.online);

// A phone that loses signal doesn't always close its link right away, so ping everyone and drop the silent ones.
function heartbeat() {
  const now = Date.now();
  let changed = false;
  net.players.forEach((p) => {
    if (!p.online) return;
    if (now - (p.seen || now) > DROP_MS) {
      p.online = false;
      changed = true;
      try { p.conn.close(); } catch {}
    } else send(p.conn, Msg.ping());
  });
  if (!changed) return;
  renderRoomPlayers();
  if (onGameScreen()) { renderScores(); renderBuzz(); }
  netBroadcast();
  checkVotes();
}

function send(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch {} }

// `msg` comes from a phone, so every field is checked before it is used.
/** @param {PlayerLink} conn @param {PlayerMsg} msg */
function onPlayerMessage(conn, msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.t === "hello") return onHello(conn, msg);
  const p = playerOf(conn);
  if (!p) return;
  p.seen = Date.now();
  if (msg.t === "buzz") onBuzz(p);
  else if (msg.t === "guess") onGuess(p, msg);
  else if (msg.t === "vote") onVote(p, msg);
}

/** @param {PlayerLink} conn @param {Extract<PlayerMsg, { t: "hello" }>} msg */
function onHello(conn, msg) {
  const name = String(msg.name || "").replace(/\s+/g, " ").trim().slice(0, 20);
  if (!name) return send(conn, Msg.error("Type your name first."));
  const token = String(msg.token || "");
  let p = net.players.find((x) => x.name.toLowerCase() === name.toLowerCase());
  // Same phone coming back (reload, network switch) takes its seat back and keeps the score.
  // A different phone can only reuse a name once the old one has dropped out.
  if (p && p.online && p.token !== token) {
    return send(conn, Msg.error(`"${name}" is already in this room. Pick another name.`));
  }
  if (p) {
    if (p.conn && p.conn !== conn) try { p.conn.close(); } catch {}
    Object.assign(p, { conn, online: true, token });
  } else {
    p = { name, score: 0, online: true, conn, token };
    net.players.push(p);
  }
  p.seen = Date.now();
  send(conn, Msg.welcome(p.name, net.code));
  if (roomPhase() !== "lobby") send(conn, optionsMessage());
  renderRoomPlayers();
  updateStartButton();
  if (onGameScreen()) renderScores();
  netBroadcast();
}

function kick(p) {
  send(p.conn, Msg.kicked());
  setTimeout(() => { try { p.conn.close(); } catch {} }, 200);
  net.players.splice(net.players.indexOf(p), 1);
  net.votes.more.delete(p.name);
  net.votes.giveup.delete(p.name);
  renderRoomPlayers();
  updateStartButton();
  renderBuzz();
  netBroadcast();
  checkVotes();
}

// ---------------- Buzzing and guessing ----------------

/** @param {RoomPlayer} p */
function onBuzz(p) {
  if (roomPhase() !== "open" || net.buzzer || net.frozen.has(p.name)) return netBroadcast();
  net.buzzer = p.name;
  net.deadline = Date.now() + ANSWER_SECONDS * 1000;
  stopAudio();
  buzzSound();
  clearTimeout(net.timer);
  net.timer = setTimeout(() => onGuess(p, { timeout: true }), ANSWER_SECONDS * 1000 + 500);
  startTicker();
  renderBuzz();
  netBroadcast();
}

/** @param {RoomPlayer} p @param {{ title?: string, artist?: string, timeout?: boolean }} msg  a guess message, or a timeout */
function onGuess(p, msg) {
  if (net.buzzer !== p.name) return;
  clearTimeout(net.timer);
  stopTicker();
  net.buzzer = null;
  const pts = pointsForStep(state.step);
  const result = { name: p.name, pts, parts: [], timedOut: !!msg.timeout, frozen: false };
  let wrong = false;
  FIELDS.forEach((f) => {
    const value = String((!msg.timeout && msg[f]) || "").trim().slice(0, 120);
    if (!value || state.solved[f]) return;
    const ok = fieldMatches(f, value, state.current);
    result.parts.push({ field: f, text: value, ok });
    if (ok) {
      p.score += pts;
      state.solved[f] = { by: p.name, pts };
      showSolved(f);
    } else {
      wrong = true;
      addAttempt(f, `${p.name}: ${value}`);
    }
  });
  if (wrong || !result.parts.length) {
    net.frozen.add(p.name);
    result.frozen = true;
    if (!result.parts.length) {
      const li = document.createElement("li");
      li.className = "wrong";
      li.textContent = `${p.name}: ${result.timedOut ? "ran out of time" : "no answer"}`;
      $("attempts").prepend(li);
    }
  }
  net.last = result;
  renderScores();
  if (!unsolved().length) return finishRound();
  renderBuzz();
  netBroadcast();
  checkVotes();   // a vote that passed while this player was answering goes through now
}

// ---------------- Voting: "Hear more" and "Give up" ----------------

const votingOpen = () => roomPhase() === "open";

// While a player is answering, "Hear more" and "Give up" are locked for everyone:
// the host's buttons and keys, and the players' vote buttons.
const someoneAnswering = () => isOnline() && !!net.buzzer;

/** @param {RoomPlayer} p @param {Extract<PlayerMsg, { t: "vote" }>} msg */
function onVote(p, msg) {
  const kind = msg.kind === "more" ? "more" : msg.kind === "giveup" ? "giveup" : null;
  if (!kind || !votingOpen() || net.buzzer || (kind === "more" && !canHearMore())) return netBroadcast();
  if (msg.on) net.votes[kind].add(p.name);
  else net.votes[kind].delete(p.name);
  renderBuzz();
  netBroadcast();
  checkVotes();
}

// Only players who are still connected count, both for the votes and for the total.
function voteCount() {
  const v = votesMessage();
  return { ...v, more: v.more.length, giveup: v.giveup.length };
}

function votesMessage() {
  const here = net.players.filter((p) => p.online).map((p) => p.name);
  return {
    players: here.length,
    more: here.filter((name) => net.votes.more.has(name)),
    giveup: here.filter((name) => net.votes.giveup.has(name)),
    moreNeed: Math.floor(here.length / 2) + 1,   // more than half
    giveupNeed: here.length,                     // everyone
  };
}

// Votes wait while someone is answering, so the music doesn't start (or the answer
// show) in the middle of their turn.
function checkVotes() {
  if (!votingOpen() || net.buzzer) return;
  const v = voteCount();
  if (!v.players) return;
  if (v.giveup >= v.giveupNeed) return giveUp();
  if (v.more >= v.moreNeed && canHearMore()) hearMore();
}

function clearVotes() {
  net.votes.more.clear();
  net.votes.giveup.clear();
}

function everyoneFrozen() {
  const here = net.players.filter((p) => p.online);
  return here.length > 0 && here.every((p) => net.frozen.has(p.name));
}

// ---------------- Following the game (events from app.js, see state.js) ----------------

// The phones get the suggestion lists for the new game.
game.on("start", () => { if (isOnline()) netBroadcastAll(optionsMessage()); });

game.on("phase", (phase) => {
  if (!isOnline()) return;
  // Outside an open clip nobody can be answering.
  if (phase !== "open") {
    clearTimeout(net.timer);
    stopTicker();
    net.buzzer = null;
  }
  // A new round: everyone can buzz again, votes and the last guess are cleared.
  if (phase === "waiting") {
    net.frozen.clear();
    clearVotes();
    net.last = null;
    hostInputs(false);
  }
  renderBuzz();
  netBroadcast();
});

// "Hear more" (the host's button or a passed vote) unfreezes everyone and starts a
// new "Hear more" vote. Give-up votes stay. Anyone still answering keeps their turn.
game.on("hearMore", () => {
  if (!isOnline()) return;
  net.frozen.clear();
  net.votes.more.clear();
  renderBuzz();
  netBroadcast();
});

game.on("scores", () => { if (isOnline()) netBroadcast(); });

// ---------------- Messages to players ----------------

function optionsMessage() {
  const strip = (list) => list.map((o) => ({ label: o.label, img: o.img || "", round: !!o.round }));
  return Msg.options(strip(options("title")), strip(options("artist")));
}

/** @returns {StateMsg} */
function stateMessage() {
  const t = state.current;
  const phase = roomPhase();
  const inGame = phase !== "lobby";
  /** @type {StateMsg["solved"]} */
  const solved = { title: null, artist: null };
  FIELDS.forEach((f) => {
    const s = inGame && state.solved ? state.solved[f] : null;
    solved[f] = s ? { by: s.by, pts: s.pts, text: f === "title" ? (t.fullTitle || t.title) : t.artist } : null;
  });
  const next = state.steps[state.step + 1];
  return {
    t: "state",
    code: net.code,
    phase,
    round: state.round,
    total: state.queue.length,
    pts: inGame ? pointsForStep(state.step) : 0,
    seconds: inGame ? state.steps[state.step] : 0,
    nextSeconds: next || 0,
    buzzer: net.buzzer,
    remaining: net.buzzer ? Math.max(0, net.deadline - Date.now()) : 0,
    frozen: [...net.frozen],
    votes: votesMessage(),
    solved,
    last: net.last,
    players: net.players.map((p) => ({ name: p.name, score: p.score, online: p.online })),
    answer: (phase === "reveal" || phase === "end") && t ? { title: t.fullTitle || t.title, artist: t.artist, cover: t.cover, from: playlistLabel(t) } : null,
  };
}

function netBroadcastAll(msg) { net.players.forEach((p) => p.online && send(p.conn, msg)); }

let broadcastQueued = false;
function netBroadcast() {
  if (!net.room || broadcastQueued) return;
  broadcastQueued = true;
  queueMicrotask(() => { broadcastQueued = false; netBroadcastAll(stateMessage()); });
}

// ---------------- Host UI ----------------

function renderRoom() {
  const link = joinLink();
  $("roomCode").textContent = net.code || "…";
  $("roomLink").value = link;
  $("miniCode").textContent = net.code || "";
  const qr = $("roomQr");
  qr.innerHTML = "";
  if (link && typeof qrcode === "function") {
    const q = qrcode(0, "M");
    q.addData(link);
    q.make();
    qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  qr.classList.toggle("hidden", !qr.innerHTML);
  renderRoomPlayers();
}

function renderRoomPlayers() {
  const list = $("roomPlayers");
  list.innerHTML = "";
  net.players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = (p.online ? "" : "⚠ ") + p.name;
    if (!p.online) li.title = "Disconnected";
    const x = document.createElement("button");
    x.textContent = "×";
    x.title = `Remove ${p.name}`;
    x.onclick = () => kick(p);
    li.appendChild(x);
    list.appendChild(li);
  });
  $("roomEmpty").classList.toggle("hidden", net.players.length > 0);
}

// The host doesn't type in online mode: phones do. Solved answers and wrong guesses still show.
function hostInputs(show) {
  FIELDS.forEach((f) => $(`input-${f}`).parentElement.classList.toggle("hidden", !show || !!(state.solved && state.solved[f])));
  $("guessBtn").parentElement.classList.toggle("hidden", !show);
}

function renderBuzz() {
  if (!isOnline()) return;
  $("moreBtn").disabled = state.phase !== "open" || !canHearMore() || !!net.buzzer;
  $("revealBtn").disabled = !!net.buzzer;
  const now = $("buzzNow");
  now.className = "buzz-now";
  if (net.buzzer) {
    const secs = Math.max(0, Math.ceil((net.deadline - Date.now()) / 1000));
    now.textContent = `🔔 ${net.buzzer} is answering… ${secs}s`;
    now.classList.add("live");
  } else if (state.phase === "waiting") {
    now.textContent = "Press Play. Buzzers open when the clip starts.";
  } else if (state.phase === "open") {
    if (everyoneFrozen()) {
      now.textContent = canHearMore() ? "Everyone is frozen. Press Hear more to unfreeze." : "Everyone is frozen and this is the longest clip. Give up to reveal.";
      now.classList.add("warn");
    } else now.textContent = "Buzzers are open";
  } else now.textContent = "";

  const v = voteCount();
  const votes = $("buzzVotes");
  const showVotes = state.phase === "open" && v.players > 0 && (v.more || v.giveup);
  votes.textContent = !showVotes ? "" : [
    canHearMore() ? `🔊 Hear more ${v.more}/${v.moreNeed}` : "",
    `🏳 Give up ${v.giveup}/${v.giveupNeed}`,
  ].filter(Boolean).join(" · ") + (net.buzzer ? " (waits for the answer)" : "");

  const last = net.last;
  const box = $("buzzLast");
  box.textContent = last ? describeResult(last) : "";
  box.className = "buzz-last" + (last ? (last.parts.some((x) => x.ok) ? " ok" : " bad") : "");

  const fl = $("frozenList");
  fl.innerHTML = "";
  [...net.frozen].forEach((n) => {
    const li = document.createElement("li");
    li.textContent = "❄ " + n;
    fl.appendChild(li);
  });
}

function describeResult(r) {
  if (r.timedOut && !r.parts.length) return `${r.name} ran out of time ❄`;
  if (!r.parts.length) return `${r.name} didn't answer ❄`;
  const bits = r.parts.map((x) => `${LABEL[x.field].toLowerCase()} "${x.text}" ${x.ok ? "✓ +" + r.pts : "✗"}`);
  return `${r.name}: ${bits.join(", ")}${r.frozen ? " · frozen ❄" : ""}`;
}

function startTicker() { stopTicker(); net.ticker = setInterval(renderBuzz, 250); }
function stopTicker() { clearInterval(net.ticker); net.ticker = null; }

// Short "ding" on the host so everyone on the stream hears that someone buzzed.
let beepCtx = null;
function buzzSound() {
  try {
    beepCtx = beepCtx || new (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)();
    const o = beepCtx.createOscillator(), g = beepCtx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(880, beepCtx.currentTime);
    o.frequency.setValueAtTime(1320, beepCtx.currentTime + 0.09);
    g.gain.setValueAtTime(0.25 * audio.volume, beepCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, beepCtx.currentTime + 0.35);
    o.connect(g).connect(beepCtx.destination);
    o.start();
    o.stop(beepCtx.currentTime + 0.36);
  } catch {}
}

async function copyLink() {
  const link = joinLink();
  if (!link) return;
  try { await navigator.clipboard.writeText(link); }
  catch { $("roomLink").select(); document.execCommand("copy"); }
  document.querySelectorAll(".copy-link").forEach((/** @type {HTMLElement} */ b) => {
    const old = b.dataset.label || (b.dataset.label = b.textContent);
    b.textContent = "Copied ✓";
    setTimeout(() => (b.textContent = old), 1500);
  });
}
