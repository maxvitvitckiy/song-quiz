// Online buzzer mode, host side.
// The host's browser is the referee: it owns the room, decides who buzzed first,
// checks guesses, gives points, freezes wrong guessers and unfreezes everyone on
// "Hear more". Players' phones (play.html) only send "hello", "buzz", "guess" and "vote".
// Votes: more than half the players asking for "Hear more" plays the longer clip,
// everyone pressing "Give up" reveals the song. The host's own buttons skip the vote.
// Audio plays on the host only (stream it to your friends, e.g. over Discord).

const ANSWER_SECONDS = 20;
const PING_MS = 4000, DROP_MS = 13000;   // a phone that's silent this long counts as offline
const CODE_KEY = "guess-the-song-room";

const net = {
  peer: null,
  code: null,
  opening: false,
  players: [],          // [{ name, score, online, conn }]
  phase: "lobby",       // lobby | waiting | open | reveal | end
  buzzer: null,         // name of the player who is answering
  deadline: 0,
  timer: null,
  ticker: null,
  frozen: new Set(),    // names that can't buzz until "Hear more"
  last: null,           // result of the latest guess, shown to everyone
  votes: { more: new Set(), giveup: new Set() }, // names voting for "Hear more" / "Give up"
};

const isOnline = () => state.mode === "online";
const onlinePicked = () => document.querySelector('input[name="mode"]:checked').value === "online";

// ---------------- Room ----------------

function netOpen() {
  if (net.peer || net.opening) return;
  net.opening = true;
  let saved = null;
  try { saved = sessionStorage.getItem(CODE_KEY); } catch {}
  tryOpen(saved || randomCode(), saved ? 4 : 0);
}

// After a page reload the old room id can stay taken for a few seconds,
// so a saved code is retried a few times before picking a new one.
function tryOpen(code, retries) {
  setStatus("Opening a room…", "", $("roomStatus"));
  let peer;
  try { peer = makePeer(NET_PREFIX + code); }
  catch (e) { net.opening = false; return setStatus(e.message, "error", $("roomStatus")); }

  peer.on("open", () => {
    net.peer = peer;
    net.code = code;
    net.opening = false;
    try { sessionStorage.setItem(CODE_KEY, code); } catch {}
    setStatus("Room is open. Send the link to your friends.", "ok", $("roomStatus"));
    renderRoom();
    setInterval(heartbeat, PING_MS);
  });
  peer.on("connection", acceptConnection);
  peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on("error", (err) => {
    if (err.type === "unavailable-id" && !net.peer) {
      peer.destroy();
      if (retries > 0) return setTimeout(() => tryOpen(code, retries - 1), 2500);
      return tryOpen(randomCode(), 0);
    }
    if (err.type === "peer-unavailable") return; // a player left; nothing to do
    if (!net.peer) {
      net.opening = false;
      peer.destroy();
      setStatus("Couldn't open a room: " + (err.message || err.type) + ". Reload to try again.", "error", $("roomStatus"));
    } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
      setStatus("Connection to the room server dropped. Players already in stay connected; reload if new players can't join.", "error", $("roomStatus"));
    }
  });
}

function joinLink() {
  if (!net.code) return "";
  const u = new URL("play.html", location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("room", net.code);
  const peer = new URLSearchParams(location.search).get("peer");
  if (peer) u.searchParams.set("peer", peer);
  return u.toString();
}

function acceptConnection(conn) {
  conn.on("data", (msg) => { try { onPlayerMessage(conn, msg); } catch (e) { console.error(e); } });
  conn.on("close", () => {
    const p = net.players.find((x) => x.conn === conn && x.online);
    if (!p) return;
    p.online = false;
    renderRoomPlayers();
    if (!$("game").classList.contains("hidden")) renderScores();
    netBroadcast();
    checkVotes();
  });
}

const playerOf = (conn) => net.players.find((p) => p.conn === conn && p.online);

// Closed phone tabs don't always close the WebRTC link, so ping everyone and drop the silent ones.
function heartbeat() {
  const now = Date.now();
  let changed = false;
  net.players.forEach((p) => {
    if (!p.online) return;
    if (now - (p.seen || now) > DROP_MS) {
      p.online = false;
      changed = true;
      try { p.conn.close(); } catch {}
    } else send(p.conn, { t: "ping" });
  });
  if (!changed) return;
  renderRoomPlayers();
  if (!$("game").classList.contains("hidden")) { renderScores(); renderBuzz(); }
  netBroadcast();
  checkVotes();
}

function send(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch {} }

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

function onHello(conn, msg) {
  const name = String(msg.name || "").replace(/\s+/g, " ").trim().slice(0, 20);
  if (!name) return send(conn, { t: "error", msg: "Type your name first." });
  const token = String(msg.token || "");
  let p = net.players.find((x) => x.name.toLowerCase() === name.toLowerCase());
  // Same phone coming back (reload, network switch) takes its seat back and keeps the score.
  // A different phone can only reuse a name once the old one has dropped out.
  if (p && p.online && p.token !== token) {
    return send(conn, { t: "error", msg: `"${name}" is already in this room. Pick another name.` });
  }
  if (p) {
    if (p.conn && p.conn !== conn) try { p.conn.close(); } catch {}
    Object.assign(p, { conn, online: true, token });
  } else {
    p = { name, score: 0, online: true, conn, token };
    net.players.push(p);
  }
  p.seen = Date.now();
  send(conn, { t: "welcome", name: p.name, code: net.code });
  if (net.phase !== "lobby") send(conn, optionsMessage());
  renderRoomPlayers();
  updateStartButton();
  if (!$("game").classList.contains("hidden")) renderScores();
  netBroadcast();
}

function kick(p) {
  send(p.conn, { t: "kicked" });
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

function onBuzz(p) {
  if (net.phase !== "open" || state.revealed || net.buzzer || net.frozen.has(p.name)) return netBroadcast();
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
    const ok = f === "title" ? titleMatches(value, state.current) : artistMatches(value, state.current);
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

const canHearMore = () => state.step < state.steps.length - 1;
const votingOpen = () => net.phase === "open" && !state.revealed;

// While a player is answering, "Hear more" and "Give up" are locked for everyone:
// the host's buttons and keys, and the players' vote buttons.
const someoneAnswering = () => isOnline() && !!net.buzzer;

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

// ---------------- Hooks called from app.js ----------------

function netOnStart() {
  net.frozen.clear();
  clearVotes();
  net.last = null;
  net.buzzer = null;
  netBroadcastAll(optionsMessage());
}

function netOnRound() {
  clearTimeout(net.timer);
  stopTicker();
  net.phase = "waiting";
  net.buzzer = null;
  net.frozen.clear();
  clearVotes();
  net.last = null;
  hostInputs(false);
  renderBuzz();
  netBroadcast();
}

function netOnPlayed() {
  if (net.phase === "waiting") net.phase = "open";
  renderBuzz();
  netBroadcast();
}

// "Hear more" (the host's button or a passed vote) unfreezes everyone and starts a
// new "Hear more" vote. Give-up votes stay. Anyone still answering keeps their turn.
function netOnHearMore() {
  net.frozen.clear();
  net.votes.more.clear();
  renderBuzz();
  netBroadcast();
}

function netOnReveal() {
  clearTimeout(net.timer);
  stopTicker();
  net.phase = "reveal";
  net.buzzer = null;
  renderBuzz();
  netBroadcast();
}

function netOnEnd() {
  clearTimeout(net.timer);
  stopTicker();
  net.phase = "end";
  net.buzzer = null;
  netBroadcast();
}

function netOnSetup() {
  net.phase = "lobby";
  net.buzzer = null;
  netBroadcast();
}

// ---------------- Messages to players ----------------

function optionsMessage() {
  const strip = (list) => list.map((o) => ({ label: o.label, img: o.img || "", round: !!o.round }));
  return { t: "options", title: strip(options("title")), artist: strip(options("artist")) };
}

function stateMessage() {
  const t = state.current;
  const inGame = net.phase !== "lobby";
  const solved = {};
  FIELDS.forEach((f) => {
    const s = inGame && state.solved ? state.solved[f] : null;
    solved[f] = s ? { by: s.by, pts: s.pts, text: f === "title" ? (t.fullTitle || t.title) : t.artist } : null;
  });
  const next = state.steps[state.step + 1];
  return {
    t: "state",
    code: net.code,
    phase: net.phase,
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
    answer: (net.phase === "reveal" || net.phase === "end") && t ? { title: t.fullTitle || t.title, artist: t.artist, cover: t.cover, from: playlistLabel(t) } : null,
  };
}

function netBroadcastAll(msg) { net.players.forEach((p) => p.online && send(p.conn, msg)); }

let broadcastQueued = false;
function netBroadcast() {
  if (!net.peer || broadcastQueued) return;
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
  $("moreBtn").disabled = !state.played || !canHearMore() || !!net.buzzer;
  $("revealBtn").disabled = !!net.buzzer;
  const now = $("buzzNow");
  now.className = "buzz-now";
  if (net.buzzer) {
    const secs = Math.max(0, Math.ceil((net.deadline - Date.now()) / 1000));
    now.textContent = `🔔 ${net.buzzer} is answering… ${secs}s`;
    now.classList.add("live");
  } else if (net.phase === "waiting") {
    now.textContent = "Press Play. Buzzers open when the clip starts.";
  } else if (net.phase === "open") {
    if (everyoneFrozen()) {
      const more = state.step < state.steps.length - 1;
      now.textContent = more ? "Everyone is frozen. Press Hear more to unfreeze." : "Everyone is frozen and this is the longest clip. Give up to reveal.";
      now.classList.add("warn");
    } else now.textContent = "Buzzers are open";
  } else now.textContent = "";

  const v = voteCount();
  const votes = $("buzzVotes");
  const showVotes = net.phase === "open" && v.players > 0 && (v.more || v.giveup);
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
    beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)();
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
  document.querySelectorAll(".copy-link").forEach((b) => {
    const old = b.dataset.label || (b.dataset.label = b.textContent);
    b.textContent = "Copied ✓";
    setTimeout(() => (b.textContent = old), 1500);
  });
}
