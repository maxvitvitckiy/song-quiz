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
};

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
        artist: t.artist ? t.artist.name : "",
        cover: (t.album && (t.album.cover_big || t.album.cover_medium)) || info.cover_big || info.cover_medium || "",
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
    if (retried) throw new Error("This song's preview won't play. Press N to skip it.");
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
  state.players.forEach((p) => (p.score = 0));
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

function reveal() {
  if (state.revealed) return;
  state.revealed = true;
  const t = state.current;
  $("songTitle").textContent = t.title;
  $("songArtist").textContent = t.artist;
  $("cover").src = t.cover;
  $("answer").classList.remove("hidden");
  $("mystery").classList.add("hidden");
  $("guessControls").classList.add("hidden");
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
  sortedPlayers().forEach((p) => board.appendChild(scoreItem(p)));
  const hist = $("history");
  hist.innerHTML = "";
  state.history.forEach((h) => {
    const li = document.createElement("li");
    li.textContent = `${h.track.title} — ${h.track.artist}` + (h.winner ? `  (${h.winner} +${h.pts})` : "  (nobody)");
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
  $("startBtn").disabled = !(state.tracks.length && state.players.length);
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
    renderPlayers();
    if (s.source) onLoad();
  } catch {}
}

// ---------------- Wiring ----------------

$("loadBtn").onclick = onLoad;
$("source").addEventListener("keydown", (e) => { if (e.key === "Enter") onLoad(); });
$("addPlayerBtn").onclick = addPlayer;
$("playerName").addEventListener("keydown", (e) => { if (e.key === "Enter") addPlayer(); });
["steps", "startPos", "rounds"].forEach((id) => $(id).addEventListener("change", save));
$("startBtn").onclick = startGame;
$("playBtn").onclick = play;
$("moreBtn").onclick = hearMore;
$("revealBtn").onclick = reveal;
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
    reveal();
  } else if (e.key === "n" || e.key === "N") {
    if (state.revealed) award(null);
    else { state.history.push({ track: state.current, winner: null, pts: 0 }); nextRound(); }
  }
});

restore();
