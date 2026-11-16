// Guess the Song — plays short clips from Deezer's public 30-second previews.
// No build step, no server code: Deezer's API is called with JSONP because it
// doesn't send CORS headers, and preview MP3s play straight from Deezer's CDN.

const $ = (id) => document.getElementById(id);
const STORE_KEY = "guess-the-song-v1";

const state = {
  sourceTitle: "",
  tracks: [],      // all playable tracks from the playlist
  queue: [],       // shuffled tracks for this game
  players: [],     // [{ name, score }]
  round: 0,
  current: null,
  step: 0,         // index into steps (how much has been heard)
  steps: [2, 5, 10, 20],
  offset: 0,       // where in the 30s preview the clip starts
  revealed: false,
  history: [],     // [{ track, winner }]
  mode: "party",   // "party" | "solo"
  played: false,
  solo: { correct: 0, streak: 0, best: 0 },
};

const isSolo = () => state.mode === "solo";

// ---------------- Deezer (JSONP) ----------------

function deezer(path) {
  return new Promise((resolve, reject) => {
    const cb = "dz_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const sep = path.includes("?") ? "&" : "?";
    script.src = `https://api.deezer.com${path}${sep}output=jsonp&callback=${cb}`;
    const timer = setTimeout(() => { cleanup(); reject(new Error("Deezer didn't respond. Check your connection.")); }, 15000);
    function cleanup() { clearTimeout(timer); delete window[cb]; script.remove(); }
    window[cb] = (data) => {
      cleanup();
      if (data && data.error) reject(new Error(data.error.message || "Deezer returned an error."));
      else resolve(data);
    };
    script.onerror = () => { cleanup(); reject(new Error("Couldn't reach Deezer.")); };
    document.head.appendChild(script);
  });
}

function parseSource(text) {
  text = text.trim();
  if (/^\d+$/.test(text)) return { type: "playlist", id: text };
  const m = text.match(/deezer\.com\/(?:[a-z]{2}\/)?(playlist|album)\/(\d+)/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  if (/link\.deezer\.com|deezer\.page\.link/i.test(text)) {
    throw new Error("That's a short share link. Open it in your browser, then copy the full address (it contains /playlist/ and a number).");
  }
  throw new Error("Paste a Deezer playlist or album link, e.g. https://www.deezer.com/playlist/1234567");
}

async function loadSource(src) {
  const info = await deezer(`/${src.type}/${src.id}`);
  const tracks = [];
  let path = `/${src.type}/${src.id}/tracks?limit=100&index=0`;
  for (let page = 0; page < 50 && path; page++) {
    const res = await deezer(path);
    for (const t of res.data || []) {
      if (!t.preview || t.readable === false) continue;
      tracks.push({
        id: t.id,
        title: t.title_short || t.title,
        fullTitle: t.title || t.title_short,
        artist: t.artist ? t.artist.name : "",
        cover: (t.album && (t.album.cover_big || t.album.cover_medium)) || info.cover_big || info.cover_medium || "",
        coverSmall: (t.album && (t.album.cover_small || t.album.cover_medium)) || info.cover_small || info.cover_medium || "",
        preview: t.preview,
      });
    }
    path = res.next ? cleanNext(res.next) : null;
  }
  return { title: info.title, tracks };
}

// Deezer's "next page" link repeats our JSONP params; strip them so deezer() can add fresh ones.
function cleanNext(next) {
  const u = new URL(next);
  u.searchParams.delete("output");
  u.searchParams.delete("callback");
  return u.pathname + u.search;
}

async function refreshPreview(track) {
  const t = await deezer(`/track/${track.id}`);
  if (t.preview) track.preview = t.preview;
  return track.preview;
}

// ---------------- Audio ----------------

const audio = $("audio");
let stopTimer = null;
let retried = false;

function setPlaying(on) {
  $("disc").classList.toggle("spin", on);
  $("bars").classList.toggle("on", on);
}

function stopAudio() {
  clearTimeout(stopTimer);
  audio.pause();
  setPlaying(false);
}

function loadAudio(url) {
  return new Promise((resolve, reject) => {
    if (audio.src === url && audio.readyState >= 1) return resolve();
    const ok = () => { off(); resolve(); };
    const bad = () => { off(); reject(new Error("audio")); };
    const off = () => { audio.removeEventListener("loadedmetadata", ok); audio.removeEventListener("error", bad); };
    audio.addEventListener("loadedmetadata", ok);
    audio.addEventListener("error", bad);
    audio.src = url;
    audio.load();
  });
}

async function playClip(from, seconds) {
  stopAudio();
  const track = state.current;
  try {
    await loadAudio(track.preview);
  } catch {
    if (retried) throw new Error("This song's preview won't play. Skip it to move on.");
    retried = true;
    // Preview links expire after a while; ask Deezer for a fresh one.
    await refreshPreview(track);
    await loadAudio(track.preview);
  }
  audio.currentTime = from;
  await audio.play();
  setPlaying(true);
  if (seconds) stopTimer = setTimeout(stopAudio, seconds * 1000);
}

audio.addEventListener("ended", () => setPlaying(false));

// ---------------- Game ----------------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pointsForStep(step) { return state.steps.length - step; }

function startGame() {
  state.steps = $("steps").value.split(",").map(Number);
  const rounds = Number($("rounds").value);
  state.queue = shuffle(state.tracks);
  if (rounds > 0) state.queue = state.queue.slice(0, rounds);
  state.mode = document.querySelector('input[name="mode"]:checked').value;
  if (isSolo()) state.solo = { correct: 0, streak: 0, best: 0 };
  state.players.forEach((p) => (p.score = 0));
  state.soloPlayer = { name: "You", score: 0 };
  applyModeUI();
  state.round = 0;
  state.history = [];
  save();
  show("game");
  renderScores();
  nextRound();
}

function nextRound() {
  stopAudio();
  if (state.round >= state.queue.length) return endGame();
  state.current = state.queue[state.round];
  state.round++;
  state.step = 0;
  state.revealed = false;
  state.played = false;
  retried = false;
  const maxClip = state.steps[state.steps.length - 1];
  const room = Math.max(0, 29 - maxClip);
  state.offset = $("startPos").value === "random" ? Math.random() * room : 0;

  $("roundLabel").textContent = `Round ${state.round} / ${state.queue.length}`;
  $("answer").classList.add("hidden");
  $("mystery").classList.remove("hidden");
  $("guessControls").classList.remove("hidden");
  $("awardControls").classList.add("hidden");
  $("soloResult").classList.add("hidden");
  $("soloBox").classList.remove("hidden");
  $("attempts").innerHTML = "";
  $("guessInput").value = "";
  hideSuggestions();
  $("moreBtn").disabled = true;
  $("playBtn").disabled = false;
  setStatus("");
  updateStepUI(false);

  // Warm up the audio so the first clip starts instantly.
  loadAudio(state.current.preview).catch(() => {});
}

function updateStepUI(played) {
  const s = state.steps[state.step];
  $("pointsLabel").textContent = `${pointsForStep(state.step)} pts`;
  $("playBtn").textContent = played ? `↺ Replay ${s}s` : `▶ Play ${s}s`;
  const next = state.steps[state.step + 1];
  $("moreBtn").textContent = next ? `Hear more (${next}s)` : "Hear more";
  $("moreBtn").disabled = !played || !next;
  $("skipBtn").textContent = next ? `Skip (+${next - s}s)` : "Give up";
}

async function play() {
  if (state.revealed) return;
  try {
    setStatus("");
    await playClip(state.offset, state.steps[state.step]);
    state.played = true;
    updateStepUI(true);
  } catch (e) {
    setStatus(e.message || "Couldn't play this song.", "error");
  }
}

async function hearMore() {
  if (state.revealed || state.step >= state.steps.length - 1) return;
  state.step++;
  await play();
}

// view: "award" (party, correct guess → pick the winner) or "result" (solo, or nobody got it)
function reveal(view) {
  if (state.revealed) return;
  state.revealed = true;
  setStatus("");
  hideSuggestions();
  const t = state.current;
  $("songTitle").textContent = t.fullTitle || t.title;
  $("songArtist").textContent = t.artist;
  $("cover").src = t.cover;
  $("answer").classList.remove("hidden");
  $("mystery").classList.add("hidden");
  $("guessControls").classList.add("hidden");
  $("soloBox").classList.add("hidden");
  if (view !== "award") {
    $("soloResult").classList.remove("hidden");
    $("soloNextBtn").focus();
    playClip(0, 0).catch(() => {});
    return;
  }
  $("awardControls").classList.remove("hidden");
  const pts = pointsForStep(state.step);
  $("awardPts").textContent = `(+${pts} pts)`;
  const box = $("awardButtons");
  box.innerHTML = "";
  state.players.forEach((p, i) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = p.name;
    b.onclick = () => award(i);
    box.appendChild(b);
  });
  // Let everyone hear the song properly once it's revealed.
  playClip(0, 0).catch(() => {});
}

function award(playerIndex) {
  const pts = pointsForStep(state.step);
  let winner = null;
  if (playerIndex != null) {
    state.players[playerIndex].score += pts;
    winner = state.players[playerIndex].name;
  }
  state.history.push({ track: state.current, winner, pts: winner ? pts : 0 });
  renderScores();
  save();
  nextRound();
}

function endGame() {
  stopAudio();
  show("end");
  const board = $("finalBoard");
  board.innerHTML = "";
  if (isSolo()) {
    const played = state.history.length;
    [["Score", state.soloPlayer.score], ["Correct", `${state.solo.correct} / ${played}`], ["Best streak", state.solo.best]]
      .forEach(([k, v]) => board.appendChild(scoreItem({ name: k, score: v })));
  } else {
    sortedPlayers().forEach((p) => board.appendChild(scoreItem(p)));
  }
  const hist = $("history");
  hist.innerHTML = "";
  state.history.forEach((h) => {
    const li = document.createElement("li");
    const result = isSolo() ? (h.winner ? `  ✓ +${h.pts}` : "  ✗") : (h.winner ? `  (${h.winner} +${h.pts})` : "  (nobody)");
    li.textContent = `${h.track.fullTitle || h.track.title} — ${h.track.artist}` + result;
    hist.appendChild(li);
  });
}

// ---------------- UI helpers ----------------

function show(screen) {
  ["setup", "game", "end"].forEach((s) => $(s).classList.toggle("hidden", s !== screen));
}

function setStatus(msg, kind, el = $("gameStatus")) {
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

function sortedPlayers() { return state.players.slice().sort((a, b) => b.score - a.score); }

function scoreItem(p) {
  const li = document.createElement("li");
  const name = document.createElement("span");
  name.textContent = p.name;
  const score = document.createElement("b");
  score.textContent = p.score;
  li.append(name, score);
  return li;
}

function renderScores() {
  const board = $("scoreboard");
  board.innerHTML = "";
  if (isSolo()) {
    $("soloStats").innerHTML =
      `<div><b>${state.soloPlayer.score}</b><small>points</small></div>` +
      `<div><b>${state.solo.correct}/${state.history.length}</b><small>correct</small></div>` +
      `<div><b>${state.solo.streak}</b><small>streak</small></div>`;
    return;
  }
  sortedPlayers().forEach((p) => board.appendChild(scoreItem(p)));
}

function renderPlayers() {
  const list = $("playerList");
  list.innerHTML = "";
  state.players.forEach((p, i) => {
    const li = document.createElement("li");
    li.textContent = p.name;
    const x = document.createElement("button");
    x.textContent = "×";
    x.title = "Remove";
    x.onclick = () => { state.players.splice(i, 1); renderPlayers(); save(); };
    li.appendChild(x);
    list.appendChild(li);
  });
  updateStartButton();
}

function updateStartButton() {
  const solo = document.querySelector('input[name="mode"]:checked').value === "solo";
  $("startBtn").disabled = !(state.tracks.length && (solo || state.players.length));
  $("playersSection").classList.toggle("hidden", solo);
}

function addPlayer() {
  const name = $("playerName").value.trim();
  if (!name) return;
  if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
  state.players.push({ name, score: 0 });
  $("playerName").value = "";
  renderPlayers();
  save();
}

async function onLoad() {
  const status = $("loadStatus");
  let src;
  try { src = parseSource($("source").value); }
  catch (e) { return setStatus(e.message, "error", status); }
  $("loadBtn").disabled = true;
  setStatus("Loading songs from Deezer…", "", status);
  try {
    const res = await loadSource(src);
    state.tracks = res.tracks;
    state.sourceTitle = res.title;
    if (!res.tracks.length) setStatus(`"${res.title}" has no songs with previews.`, "error", status);
    else setStatus(`Loaded "${res.title}": ${res.tracks.length} songs ready.`, "ok", status);
    save();
  } catch (e) {
    state.tracks = [];
    setStatus(e.message + " Make sure the playlist is public.", "error", status);
  } finally {
    $("loadBtn").disabled = false;
    updateStartButton();
  }
}

// ---------------- Persistence ----------------

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      source: $("source").value,
      players: state.players.map((p) => p.name),
      steps: $("steps").value,
      startPos: $("startPos").value,
      rounds: $("rounds").value,
      mode: document.querySelector('input[name="mode"]:checked').value,
    }));
  } catch {}
}

function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!s) return;
    $("source").value = s.source || "";
    state.players = (s.players || []).map((name) => ({ name, score: 0 }));
    if (s.steps) $("steps").value = s.steps;
    if (s.startPos) $("startPos").value = s.startPos;
    if (s.rounds) $("rounds").value = s.rounds;
    if (s.mode) document.querySelector(`input[name="mode"][value="${s.mode}"]`).checked = true;
    renderPlayers();
    if (s.source) onLoad();
  } catch {}
}

// ---------------- Solo mode ----------------

function applyModeUI() {
  const solo = isSolo();
  $("moreBtn").classList.toggle("hidden", solo);
  $("skipBtn").classList.toggle("hidden", !solo);
  $("revealBtn").textContent = "Give up";
  $("scoresTitle").textContent = solo ? "Your score" : "Scores";
  $("scoreboard").classList.toggle("hidden", solo);
  $("soloStats").classList.toggle("hidden", !solo);
  $("keysHint").innerHTML = solo
    ? "Type to search · <b>↑ ↓</b> pick · <b>Enter</b> guess"
    : "Type what people shout · <b>Enter</b> check · outside the box: <b>Space</b> play / hear more";
  $("guessInput").placeholder = solo ? "Type a song or artist…" : "Type a guess from the room…";
}

const norm = (str) =>
  (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const escapeHtml = (str) => str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function highlight(text, words) {
  // Highlight typed words inside a suggestion, ignoring case and accents.
  let html = "";
  const n = norm(text);
  if (n.length !== text.length || !words.length) return escapeHtml(text);
  const marks = new Array(text.length).fill(false);
  for (const w of words) {
    let i = n.indexOf(w);
    while (i !== -1) { for (let k = i; k < i + w.length; k++) marks[k] = true; i = n.indexOf(w, i + 1); }
  }
  let open = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] && !open) { html += "<mark>"; open = true; }
    if (!marks[i] && open) { html += "</mark>"; open = false; }
    html += escapeHtml(text[i]);
  }
  return html + (open ? "</mark>" : "");
}

let suggestionItems = [];
let activeSuggestion = -1;

function uniqueSongs() {
  const seen = new Set();
  return state.tracks.filter((t) => {
    const key = norm(t.fullTitle) + "|" + norm(t.artist);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function updateSuggestions() {
  const q = norm($("guessInput").value);
  const box = $("suggestions");
  if (!q) return hideSuggestions();
  const words = q.split(" ");
  suggestionItems = uniqueSongs()
    .map((t) => {
      const title = norm(t.fullTitle), hay = title + " " + norm(t.artist);
      if (!words.every((w) => hay.includes(w))) return null;
      const rank = title.startsWith(q) ? 0 : title.includes(q) ? 1 : 2;
      return { t, rank };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.t.fullTitle.localeCompare(b.t.fullTitle))
    .slice(0, 8)
    .map((x) => x.t);

  activeSuggestion = suggestionItems.length ? 0 : -1;
  box.innerHTML = "";
  if (!suggestionItems.length) {
    box.innerHTML = '<li class="empty">No songs in this playlist match</li>';
  }
  suggestionItems.forEach((t, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.innerHTML =
      `<img src="${escapeHtml(t.coverSmall || t.cover)}" alt="" loading="lazy" />` +
      `<div><div class="s-title">${highlight(t.fullTitle, words)}</div>` +
      `<div class="s-artist">${highlight(t.artist, words)}</div></div>`;
    li.onmousedown = (e) => { e.preventDefault(); submitGuess(t); };
    box.appendChild(li);
  });
  paintActive();
  box.classList.remove("hidden");
}

function paintActive() {
  [...$("suggestions").children].forEach((li, i) => li.classList.toggle("active", i === activeSuggestion));
  const el = $("suggestions").children[activeSuggestion];
  if (el) el.scrollIntoView({ block: "nearest" });
}

function hideSuggestions() {
  $("suggestions").classList.add("hidden");
  suggestionItems = [];
  activeSuggestion = -1;
}

function addAttempt(text, cls) {
  const li = document.createElement("li");
  li.className = cls;
  li.textContent = text;
  $("attempts").appendChild(li);
}

async function advanceOrLose() {
  if (state.step < state.steps.length - 1) {
    state.step++;
    await play();
  } else {
    finishSolo(false);
  }
}

function submitGuess(track) {
  if (state.revealed) return;
  const typed = $("guessInput").value.trim();
  if (!track && !typed) return;
  const cur = state.current;
  const correct = track
    ? track.id === cur.id || (norm(track.fullTitle) === norm(cur.fullTitle) && norm(track.artist) === norm(cur.artist))
    : [cur.title, cur.fullTitle].some((x) => norm(x) === norm(typed));
  hideSuggestions();
  $("guessInput").value = "";
  if (correct) return isSolo() ? finishSolo(true) : reveal("award");
  addAttempt(track ? `${track.fullTitle} — ${track.artist}` : typed, "wrong");
  // Solo: a wrong guess unlocks more of the song. Party: the host decides with "Hear more".
  if (isSolo()) advanceOrLose();
  else $("guessInput").focus();
}

function skip() {
  if (state.revealed) return;
  if (state.step >= state.steps.length - 1) return finishSolo(false);
  addAttempt(`Skipped`, "skip");
  advanceOrLose();
}

function finishSolo(won) {
  if (state.revealed) return;
  const pts = pointsForStep(state.step);
  if (won) {
    state.soloPlayer.score += pts;
    state.solo.correct++;
    state.solo.streak++;
    state.solo.best = Math.max(state.solo.best, state.solo.streak);
  } else {
    state.solo.streak = 0;
  }
  state.history.push({ track: state.current, winner: won ? "You" : null, pts: won ? pts : 0 });
  const msg = $("soloMsg");
  msg.textContent = won ? `✓ Correct! +${pts} pts` : "✗ Not this time. It was:";
  msg.className = "solo-msg " + (won ? "win" : "lose");
  renderScores();
  reveal("result");
}

// Party: nobody got it (or the host gave up) → show the answer, no points.
function giveUp() {
  if (state.revealed) return;
  if (isSolo()) return finishSolo(false);
  state.history.push({ track: state.current, winner: null, pts: 0 });
  const msg = $("soloMsg");
  msg.textContent = "Nobody got it. It was:";
  msg.className = "solo-msg lose";
  reveal("result");
}

$("guessInput").addEventListener("input", updateSuggestions);
$("guessInput").addEventListener("focus", updateSuggestions);
$("guessInput").addEventListener("blur", () => setTimeout(hideSuggestions, 120));
$("guessInput").addEventListener("keydown", (e) => {
  const n = suggestionItems.length;
  if (e.key === "ArrowDown" && n) { e.preventDefault(); activeSuggestion = (activeSuggestion + 1) % n; paintActive(); }
  else if (e.key === "ArrowUp" && n) { e.preventDefault(); activeSuggestion = (activeSuggestion - 1 + n) % n; paintActive(); }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (activeSuggestion >= 0 && n) submitGuess(suggestionItems[activeSuggestion]);
    else submitGuess(null);
  } else if (e.key === "Escape") hideSuggestions();
});
$("guessBtn").onclick = () => submitGuess(activeSuggestion >= 0 ? suggestionItems[activeSuggestion] : null);
$("skipBtn").onclick = skip;
$("soloNextBtn").onclick = nextRound;
$("soloReplayBtn").onclick = () => playClip(0, 0).catch(() => {});
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", () => { updateStartButton(); save(); }));

// ---------------- Volume ----------------

const VOL_KEY = "guess-the-song-volume";
let lastVolume = 80;

function setVolume(v, persist = true) {
  v = Math.max(0, Math.min(100, Math.round(v)));
  audio.volume = v / 100;
  $("volume").value = v;
  $("volIcon").textContent = v === 0 ? "🔇" : v < 40 ? "🔈" : v < 75 ? "🔉" : "🔊";
  if (v > 0) lastVolume = v;
  if (persist) try { localStorage.setItem(VOL_KEY, String(v)); } catch {}
}

(function initVolume() {
  // iPhones and iPads ignore volume set from a web page; there the phone's buttons are the control.
  const probe = new Audio();
  probe.volume = 0.5;
  if (probe.volume !== 0.5) {
    $("volume").classList.add("hidden");
    $("volIcon").classList.add("hidden");
    $("volNote").classList.remove("hidden");
    return;
  }
  let saved = 80;
  try { const s = localStorage.getItem(VOL_KEY); if (s !== null) saved = Number(s); } catch {}
  setVolume(saved, false);
  $("volume").addEventListener("input", (e) => setVolume(Number(e.target.value)));
  $("volIcon").onclick = () => setVolume(Number($("volume").value) === 0 ? lastVolume : 0);
})();

// ---------------- Wiring ----------------

$("loadBtn").onclick = onLoad;
$("source").addEventListener("keydown", (e) => { if (e.key === "Enter") onLoad(); });
$("addPlayerBtn").onclick = addPlayer;
$("playerName").addEventListener("keydown", (e) => { if (e.key === "Enter") addPlayer(); });
["steps", "startPos", "rounds"].forEach((id) => $(id).addEventListener("change", save));
$("startBtn").onclick = startGame;
$("playBtn").onclick = play;
$("moreBtn").onclick = hearMore;
$("revealBtn").onclick = giveUp;
$("nobodyBtn").onclick = () => award(null);
$("replayFullBtn").onclick = () => playClip(0, 0).catch(() => {});
$("endBtn").onclick = endGame;
$("againBtn").onclick = () => { show("setup"); updateStartButton(); };

document.addEventListener("keydown", (e) => {
  if ($("game").classList.contains("hidden")) return;
  if (e.target.tagName === "INPUT") return;
  if (e.code === "Space") {
    e.preventDefault();
    if (state.revealed) return;
    if (!state.played) play();
    else if (state.step < state.steps.length - 1) hearMore();
    else play();
  } else if (e.key === "r" || e.key === "R") {
    giveUp();
  } else if (e.key === "n" || e.key === "N") {
    if (!state.revealed) giveUp();
    else if (!$("awardControls").classList.contains("hidden")) award(null);
    else nextRound();
  }
});

restore();
