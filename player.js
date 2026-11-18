// @ts-check
// Player's phone: join a room, press "I know", type a guess.
// The host's browser decides everything; this page only shows what the host sends
// (every message is listed in net.js).

// $() and the suggestion lists come from ui.js.
const ME_KEY = "guess-the-song-player";

const me = { name: "", code: "", token: "" };
let lastHeard = 0, watchdog = null;
let conn = null;
let joined = false;        // the host accepted our name at least once
let leaving = false;
let retryTimer = null, connectTimer = null;
let options = { title: [], artist: [] };
/** @type {StateMsg | null} */
let view = null;           // latest state from the host
let guessing = false;      // our guess form is open
let deadline = 0;

// ---------------- Connection ----------------

function join() {
  const name = $("nameIn").value.replace(/\s+/g, " ").trim();
  const code = cleanCode($("codeIn").value);
  if (!name) return showStatus("Type your name.", "error");
  if (code.length < 4) return showStatus("Type the room code from the host.", "error");
  me.name = name;
  me.code = code;
  try { localStorage.setItem(ME_KEY, JSON.stringify({ name, token: me.token })); } catch {}
  const u = new URL(location.href);
  u.searchParams.set("room", code);
  history.replaceState(null, "", u);
  leaving = false;
  $("joinBtn").disabled = true;
  showStatus("Connecting…");
  connect();
}

function connect() {
  clearTimeout(retryTimer);
  clearTimeout(connectTimer);
  if (conn) { try { conn.close(); } catch {} conn = null; }
  const c = conn = joinRoom(me.code);
  c.on("open", () => {
    if (conn !== c || leaving) return;
    clearTimeout(connectTimer);
    lastHeard = Date.now();
    c.send(Msg.hello(me.name, me.token));
  });
  c.on("data", (msg) => { if (conn === c) onMessage(msg); });
  c.on("close", () => { if (conn === c && !leaving && joined) scheduleRetry("Connection lost. Reconnecting…"); });
  c.on("error", (err) => {
    if (conn !== c || leaving) return;
    if (err.type === "no-host") {
      if (joined) return scheduleRetry("The host's page is offline. Retrying…");
      return fail("No room with that code. Check it with the host.");
    }
    if (err.type === "full") return joined ? scheduleRetry("The room is full. Retrying…") : fail("This room is full.");
    if (joined) return scheduleRetry("Connection lost. Reconnecting…");
    fail(err.message || "Couldn't reach the room server. Check your internet and try again.");
  });

  connectTimer = setTimeout(() => {
    if (conn && conn.open) return;
    if (joined) scheduleRetry("Still reconnecting…");
    else fail("Couldn't connect. Check your internet and try again.");
  }, 15000);
}

function scheduleRetry(msg) {
  if (leaving) return;
  setMsg(msg, "bad");
  $("buzzBtn").disabled = true;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, 2500);
}

function fail(msg) {
  clearTimeout(connectTimer);
  showStatus(msg, "error");
  $("joinBtn").disabled = false;
  showJoin();
}

function leave() {
  leaving = true;
  joined = false;
  clearInterval(watchdog);
  clearTimeout(retryTimer);
  clearTimeout(connectTimer);
  try { conn && conn.close(); } catch {}
  conn = null;
  view = null;
  closeGuess();
  $("joinBtn").disabled = false;
  showStatus("");
  showJoin();
}

function send(msg) { if (conn && conn.open) conn.send(msg); }

// If the host goes quiet (their page reloaded or the link died), reconnect.
function startWatchdog() {
  clearInterval(watchdog);
  watchdog = setInterval(() => {
    if (!joined || leaving) return;
    if (Date.now() - lastHeard > 13000) { lastHeard = Date.now(); scheduleRetry("Lost the host. Reconnecting…"); }
  }, 3000);
}

/** @param {HostMsg} msg */
function onMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  lastHeard = Date.now();
  if (msg.t === "ping") return send(Msg.pong());
  if (msg.t === "welcome") {
    joined = true;
    me.name = msg.name;
    $("pName").textContent = "you are " + me.name;
    $("pCode").textContent = me.code;
    showGame();
    keepAwake();
    startWatchdog();
  } else if (msg.t === "error") {
    if (!joined) fail(msg.msg);
    else setMsg(msg.msg, "bad");
  } else if (msg.t === "kicked") {
    leave();
    showStatus("The host removed you from the room.", "error");
  } else if (msg.t === "options") {
    const prep = (list) => (list || []).map((o) => prepOption({ label: String(o.label || ""), img: o.img || "", round: !!o.round }, String(o.label || "")));
    options = { title: prep(msg.title), artist: prep(msg.artist) };
  } else if (msg.t === "state") {
    view = msg;
    render();
  }
}

// ---------------- Rendering ----------------

function render() {
  const s = view;
  if (!s) return;
  const frozen = s.frozen.includes(me.name);
  const mine = s.buzzer === me.name;

  $("pRound").textContent = s.phase === "lobby" ? "Waiting for the host to start…" : s.phase === "end" ? "Game over" : `Round ${s.round} / ${s.total}`;
  $("pPts").textContent = `${s.pts} pts`;
  $("pPts").classList.toggle("hidden", !["waiting", "open"].includes(s.phase));

  // Solved parts (visible to everyone so the rest can go for the other part).
  const solvedList = $("pSolved");
  solvedList.innerHTML = "";
  if (s.phase === "waiting" || s.phase === "open") {
    FIELDS.forEach((f) => {
      const x = s.solved[f];
      if (!x) return;
      const li = document.createElement("li");
      li.textContent = `✓ ${x.text}`;
      const sm = document.createElement("small");
      sm.textContent = `${x.by} +${x.pts}`;
      li.appendChild(sm);
      solvedList.appendChild(li);
    });
  }

  // The big button.
  const btn = $("buzzBtn"), sub = $("buzzSub");
  const showBtn = !mine && s.phase !== "reveal" && s.phase !== "end";
  btn.classList.toggle("hidden", !showBtn);
  btn.classList.toggle("frozen", frozen && s.phase === "open");
  btn.disabled = !(s.phase === "open" && !s.buzzer && !frozen);
  btn.firstChild.textContent = frozen && s.phase === "open" ? "❄ Frozen" : "I know!";
  sub.textContent =
    s.phase === "lobby" ? "the game hasn't started" :
    s.phase === "waiting" ? "wait for the music" :
    s.buzzer ? `${s.buzzer} is answering` :
    frozen ? "until the host plays more" : "tap if you know it";

  renderVotes(s, mine);

  // Our turn to answer.
  if (mine && !guessing) openGuess(s);
  if (!mine && guessing) closeGuess();
  if (mine) {
    deadline = Date.now() + s.remaining;
    FIELDS.forEach((f) => $(`pf-${f}`).classList.toggle("hidden", !!s.solved[f]));
  }

  // Message line.
  setMsg(...messageFor(s, frozen, mine));

  // Answer after the round.
  const ans = s.answer && s.phase === "reveal" ? s.answer : null;
  $("answerView").classList.toggle("hidden", !ans);
  if (ans) {
    $("pTitle").textContent = ans.title;
    $("pArtist").textContent = ans.artist;
    $("pFrom").textContent = ans.from ? "From: " + ans.from : "";
    $("pFrom").classList.toggle("hidden", !ans.from);
    $("pCover").src = ans.cover || "";
    $("pCover").classList.toggle("hidden", !ans.cover);
  }

  // Scores.
  $("boardTitle").textContent = s.phase === "end" ? "🏆 Final scores" : "Scores";
  const board = $("pBoard");
  board.innerHTML = "";
  s.players.slice().sort((a, b) => b.score - a.score).forEach((p) => {
    const li = document.createElement("li");
    if (p.name === me.name) li.className = "me";
    const n = document.createElement("span");
    n.textContent = p.name + (s.frozen.includes(p.name) ? " ❄" : "") + (p.online ? "" : " · offline");
    const b = document.createElement("b");
    b.textContent = String(p.score);
    li.append(n, b);
    board.appendChild(li);
  });
}

// "Hear more" needs more than half the players, "Give up" needs everyone.
// Tapping again takes the vote back.
/** @param {StateMsg} s @param {boolean} mine  we are the one answering */
function renderVotes(s, mine) {
  const v = s.votes || { more: [], giveup: [], players: 0, moreNeed: 1, giveupNeed: 1 };
  const show = (s.phase === "waiting" || s.phase === "open") && !mine;
  $("voteRow").classList.toggle("hidden", !show);
  if (!show) return;
  const open = s.phase === "open";
  const set = (id, kind, label, need, can) => {
    const b = $(id), on = v[kind].includes(me.name);
    // first node is the label text, last is the <small> count
    b.firstChild.textContent = label;
    b.lastChild.textContent = open && can ? `${v[kind].length} / ${need}` : "";
    b.disabled = !open || !can || !!s.buzzer;   // locked while someone answers
    b.classList.toggle("on", on && open);
    b.setAttribute("aria-pressed", String(on && open));
  };
  set("moreVote", "more", s.nextSeconds ? `🔊 Hear more (${s.nextSeconds}s)` : "🔊 Hear more", v.moreNeed, !!s.nextSeconds);
  set("giveupVote", "giveup", "🏳 Give up", v.giveupNeed, true);
}

function vote(kind) {
  if (!view || view.phase !== "open" || view.buzzer) return;
  const list = (view.votes && view.votes[kind]) || [];
  const on = !list.includes(me.name);
  // Show the tap right away; the host's next update has the real count.
  view.votes[kind] = on ? list.concat(me.name) : list.filter((n) => n !== me.name);
  send(Msg.vote(kind, on));
  if (navigator.vibrate) navigator.vibrate(20);
  render();
}

/** @param {StateMsg} s @param {boolean} frozen @param {boolean} mine  we are the one answering */
function messageFor(s, frozen, mine) {
  if (mine) return ["Your turn! Type your answer.", "ok"];
  if (s.phase === "lobby") return [`You're in, ${me.name}. Waiting for the game to start.`, ""];
  if (s.phase === "end") return ["Thanks for playing!", ""];
  if (s.phase === "reveal") {
    const got = FIELDS.filter((f) => s.solved[f]);
    if (!got.length) return ["Nobody got it", "bad"];
    const mineGot = got.filter((f) => s.solved[f].by === me.name);
    if (mineGot.length) return [`You got the ${mineGot.join(" and ")}! 🎉`, "ok"];
    const byWho = {};
    got.forEach((f) => (byWho[s.solved[f].by] = (byWho[s.solved[f].by] || []).concat(f)));
    return [Object.entries(byWho).map(([who, fs]) => `${who} got the ${fs.join(" and ")}`).join(", "), ""];
  }
  const last = s.last;
  if (last && last.name === me.name) {
    const right = last.parts.filter((p) => p.ok).map((p) => p.field);
    if (frozen && right.length) return [`✓ ${right.join(" and ")} +${last.pts * right.length}, but the rest was wrong. Frozen until the host plays more.`, "bad"];
    if (frozen) return [last.timedOut && !last.parts.length ? "⏱ Time's up. Frozen until the host plays more." : "✗ Wrong. Frozen until the host plays more.", "bad"];
    if (right.length) return [`✓ Correct ${right.join(" and ")}! +${last.pts * right.length}`, "ok"];
  }
  if (last && !frozen && s.phase === "open") {
    const right = last.parts.filter((p) => p.ok).map((p) => p.field);
    if (right.length) return [`${last.name} got the ${right.join(" and ")}. Know the rest?`, ""];
    return [`${last.name} was wrong. Your chance!`, ""];
  }
  if (s.phase === "waiting") return ["New song coming up…", ""];
  return ["", ""];
}

function setMsg(text, kind) {
  const el = $("pMsg");
  el.textContent = text;
  el.className = "p-msg" + (kind ? " " + kind : "");
}

function showStatus(msg, kind) {
  const el = $("joinStatus");
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

function showJoin() { $("joinView").classList.remove("hidden"); $("gameView").classList.add("hidden"); }
function showGame() { $("joinView").classList.add("hidden"); $("gameView").classList.remove("hidden"); }

// ---------------- Buzz and guess ----------------

function buzz() {
  if ($("buzzBtn").disabled) return;
  $("buzzBtn").disabled = true;           // the host's answer re-enables it if someone was faster
  send(Msg.buzz());
  if (navigator.vibrate) navigator.vibrate(40);
}

/** @param {StateMsg} s */
function openGuess(s) {
  guessing = true;
  FIELDS.forEach((f) => { $(`g-${f}`).value = ""; });
  $("guessView").classList.remove("hidden");
  $("sendBtn").disabled = false;
  const first = FIELDS.find((f) => !s.solved[f]);
  if (first) setTimeout(() => $(`g-${first}`).focus(), 30);
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  tick();
}

function closeGuess() {
  guessing = false;
  hideSuggestions();
  $("guessView").classList.add("hidden");
}

function tick() {
  if (!guessing) return;
  const left = Math.max(0, deadline - Date.now());
  $("timerFill").style.width = (left / (ANSWER_SECONDS * 10)) + "%";
  requestAnimationFrame(tick);
}

function sendGuess() {
  hideSuggestions();
  /** @type {{ title?: string, artist?: string }} */
  const parts = {};
  FIELDS.forEach((f) => { if (!$(`pf-${f}`).classList.contains("hidden")) parts[f] = $(`g-${f}`).value.trim(); });
  if (!FIELDS.some((f) => parts[f])) return $(`g-${FIELDS.find((f) => !$(`pf-${f}`).classList.contains("hidden"))}`).focus();
  $("sendBtn").disabled = true;
  send(Msg.guess(parts));
}

// ---------------- Suggestions ----------------

// Picking a suggestion only fills the box. Sending is always its own tap on Send.
let pickedAt = 0;   // when a suggestion was last picked

/** @param {Field} field @param {Option} o */
function pick(field, o) {
  $(`g-${field}`).value = o.label;
  pickedAt = Date.now();
  // Jump to the other open box if it's empty; otherwise close the keyboard so Send is in view.
  const other = FIELDS.find((f) => f !== field && !$(`pf-${f}`).classList.contains("hidden") && !$(`g-${f}`).value);
  if (other) $(`g-${other}`).focus();
  else $(`g-${field}`).blur();
}

const boxes = {
  title: suggestBox({ input: $("g-title"), list: $("s-title"), options: () => options.title, onPick: (o) => pick("title", o), onEnter: sendGuess }),
  artist: suggestBox({ input: $("g-artist"), list: $("s-artist"), options: () => options.artist, onPick: (o) => pick("artist", o), onEnter: sendGuess }),
};
function hideSuggestions() { Object.values(boxes).forEach((b) => b.hide()); }

// ---------------- Misc ----------------

let wakeLock = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request("screen"); wakeLock.onrelease = () => (wakeLock = null); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !joined) return;
  keepAwake();
  if (!conn || !conn.open) connect();
});

$("joinBtn").onclick = join;
["nameIn", "codeIn"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") join(); }));
$("buzzBtn").addEventListener("pointerdown", (e) => { e.preventDefault(); buzz(); });
$("buzzBtn").addEventListener("click", buzz);
// A tap that started on a suggestion can still end up here on some phones; ignore it.
$("sendBtn").onclick = () => { if (Date.now() - pickedAt > 400) sendGuess(); };
$("leaveBtn").onclick = leave;
$("moreVote").onclick = () => vote("more");
$("giveupVote").onclick = () => vote("giveup");
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && /** @type {HTMLElement} */ (e.target).tagName !== "INPUT" && !$("gameView").classList.contains("hidden")) { e.preventDefault(); buzz(); }
});

(function init() {
  const params = new URLSearchParams(location.search);
  const room = cleanCode(params.get("room"));
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(ME_KEY) || "{}"); } catch {}
  if (saved.name) $("nameIn").value = saved.name;
  me.token = saved.token || Math.random().toString(36).slice(2) + Date.now().toString(36);
  if (room) $("codeIn").value = room;
  (saved.name && room ? $("joinBtn") : saved.name ? $("codeIn") : $("nameIn")).focus();
})();
