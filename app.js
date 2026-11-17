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
  history: [],     // [{ track, title: {by, pts}|null, artist: {by, pts}|null }]
  mode: "party",   // "party" | "solo"
  played: false,
  solo: { title: 0, artist: 0, streak: 0, best: 0 },
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
        artistPic: t.artist ? t.artist.picture_small || t.artist.picture_medium || "" : "",
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
  if (isSolo()) state.solo = { title: 0, artist: 0, streak: 0, best: 0 };
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

// ---------------- Answer matching ----------------

const norm = (str) =>
  (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// "Song (feat. X) [Remix] - Radio Edit" → "Song"
const baseTitle = (t) => (t || "").replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").replace(/\s+-\s+.*$/, "").trim();

const FEAT_RE = /[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^\)\]]+)[\)\]]/i;
const splitNames = (s) => (s || "").split(/\s*(?:,|&|\band\b|\bx\b|\+|\/)\s*/i).map((x) => x.trim()).filter(Boolean);

// Every artist name that counts for a track: main artist (whole and split), featured artists
// from the title, and contributors fetched from Deezer at the start of the round.
function artistNames(track) {
  const names = new Set();
  const add = (n) => { const k = norm(n); if (k) names.add(k); };
  add(track.artist);
  splitNames(track.artist).forEach(add);
  const f = (track.fullTitle || "").match(FEAT_RE);
  if (f) splitNames(f[1]).forEach(add);
  (track.contributors || []).forEach(add);
  return names;
}

function titleMatches(guess, track) {
  const g = norm(guess), gb = norm(baseTitle(guess));
  return [track.title, track.fullTitle].some((t) => norm(t) === g || norm(baseTitle(t)) === gb) && gb !== "";
}

function artistMatches(guess, track) {
  const names = artistNames(track);
  const g = norm(guess);
  return names.has(g) || splitNames(guess).some((p) => names.has(norm(p)));
}

async function loadContributors(track) {
  if (track.contributors) return;
  try {
    const t = await deezer(`/track/${track.id}`);
    track.contributors = (t.contributors || []).map((c) => c.name);
    if (t.preview) track.preview = t.preview;
  } catch { track.contributors = []; }
}

// ---------------- Rounds ----------------

const FIELDS = ["title", "artist"];
const LABEL = { title: "Title", artist: "Artist" };

function nextRound() {
  stopAudio();
  if (state.round >= state.queue.length) return endGame();
  state.current = state.queue[state.round];
  state.round++;
  state.step = 0;
  state.revealed = false;
  state.played = false;
  state.solved = { title: null, artist: null }; // { by: name|null, pts }
  state.pending = null;                          // field waiting for "who got it?"
  state.queuedAward = null;                      // second box guessed right at the same time
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
  $("guessBtn").parentElement.classList.remove("hidden");
  FIELDS.forEach((f) => {
    $(`input-${f}`).value = "";
    $(`input-${f}`).parentElement.classList.remove("hidden");
    $(`solved-${f}`).classList.add("hidden");
  });
  hideSuggestions();
  $("moreBtn").disabled = true;
  $("playBtn").disabled = false;
  setStatus("");
  updateStepUI(false);

  loadAudio(state.current.preview).catch(() => {});
  loadContributors(state.current);
}

function updateStepUI(played) {
  const s = state.steps[state.step];
  const p = pointsForStep(state.step);
  $("pointsLabel").textContent = `${p} pts each`;
  FIELDS.forEach((f) => ($(`pts-${f}`).textContent = state.solved && state.solved[f] ? "" : `+${p}`));
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

function showSolved(field, missed) {
  const t = state.current, s = state.solved[field];
  const box = $(`solved-${field}`);
  const answer = field === "title" ? (t.fullTitle || t.title) : t.artist;
  box.textContent = (missed ? "✗ " : "✓ ") + answer;
  if (!missed && s) {
    const who = isSolo() ? "" : s.by ? `${s.by} ` : "no one ";
    const small = document.createElement("small");
    small.textContent = s.by || isSolo() ? `${who}+${s.pts}` : "no points";
    box.appendChild(small);
  }
  box.classList.toggle("missed", !!missed);
  box.classList.remove("hidden");
  $(`input-${field}`).parentElement.classList.add("hidden");
  $(`pts-${field}`).textContent = "";
}

const unsolved = () => FIELDS.filter((f) => !state.solved[f]);

// A field was guessed correctly.
function solveField(field) {
  const pts = pointsForStep(state.step);
  if (isSolo()) {
    state.solved[field] = { by: "You", pts };
    state.soloPlayer.score += pts;
    state.solo[field]++;
    showSolved(field);
    renderScores();
    if (!unsolved().length) finishRound();
    else focusNextField();
    return;
  }
  // Party: ask who got it.
  state.pending = field;
  $("awardMsg").textContent = `✓ ${LABEL[field]} correct!`;
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
  hideSuggestions();
  $("soloBox").classList.add("hidden");
  $("guessControls").classList.add("hidden");
  $("awardControls").classList.remove("hidden");
}

function award(playerIndex) {
  const field = state.pending;
  if (!field) return;
  const pts = pointsForStep(state.step);
  const p = playerIndex != null ? state.players[playerIndex] : null;
  if (p) p.score += pts;
  state.solved[field] = { by: p ? p.name : null, pts: p ? pts : 0 };
  state.pending = null;
  renderScores();
  save();
  showSolved(field);
  $("awardControls").classList.add("hidden");
  if (!unsolved().length) return finishRound();
  const q = state.queuedAward;
  state.queuedAward = null;
  if (q && !state.solved[q]) return solveField(q);
  $("soloBox").classList.remove("hidden");
  $("guessControls").classList.remove("hidden");
  focusNextField();
}

function focusNextField() {
  const f = unsolved()[0];
  if (f) $(`input-${f}`).focus();
}

// End of a round: everything solved, gave up, or (solo) out of clips.
function finishRound() {
  if (state.revealed) return;
  state.revealed = true;
  state.pending = null;
  setStatus("");
  hideSuggestions();
  const t = state.current, s = state.solved;
  FIELDS.forEach((f) => { if (!s[f]) showSolved(f, true); });

  const rec = { track: t };
  FIELDS.forEach((f) => { rec[f] = s[f] && (s[f].by || isSolo()) ? s[f] : null; });
  state.history.push(rec);

  const got = FIELDS.filter((f) => rec[f]);
  if (isSolo()) {
    if (got.length === 2) { state.solo.streak++; state.solo.best = Math.max(state.solo.best, state.solo.streak); }
    else state.solo.streak = 0;
  }
  const msg = $("soloMsg");
  msg.textContent = got.length === 2 ? "✓ Both correct!" : got.length ? `Half right: ${LABEL[got[0]].toLowerCase()} ✓` : isSolo() ? "✗ Not this time" : "Nobody got it";
  msg.className = "solo-msg " + (got.length === 2 ? "win" : got.length ? "" : "lose");
  renderScores();

  $("songTitle").textContent = t.fullTitle || t.title;
  $("songArtist").textContent = t.artist;
  $("cover").src = t.cover;
  $("answer").classList.remove("hidden");
  $("mystery").classList.add("hidden");
  $("guessControls").classList.add("hidden");
  $("awardControls").classList.add("hidden");
  $("soloBox").classList.remove("hidden");
  $("guessBtn").parentElement.classList.add("hidden");
  $("soloResult").classList.remove("hidden");
  $("soloNextBtn").focus();
  playClip(0, 0).catch(() => {});
}

function giveUp() {
  if (state.revealed) return;
  if (state.pending) award(null);
  finishRound();
}

function endGame() {
  stopAudio();
  show("end");
  const board = $("finalBoard");
  board.innerHTML = "";
  const n = state.history.length;
  if (isSolo()) {
    [["Score", state.soloPlayer.score], ["Titles", `${state.solo.title} / ${n}`], ["Artists", `${state.solo.artist} / ${n}`], ["Best streak", state.solo.best]]
      .forEach(([k, v]) => board.appendChild(scoreItem({ name: k, score: v })));
  } else {
    sortedPlayers().forEach((p) => board.appendChild(scoreItem(p)));
  }
  const hist = $("history");
  hist.innerHTML = "";
  state.history.forEach((h) => {
    const li = document.createElement("li");
    const part = (f) => {
      const r = h[f];
      if (!r) return `${LABEL[f].toLowerCase()} ✗`;
      return isSolo() ? `${LABEL[f].toLowerCase()} +${r.pts}` : `${LABEL[f].toLowerCase()}: ${r.by} +${r.pts}`;
    };
    li.textContent = `${h.track.fullTitle || h.track.title} — ${h.track.artist}  (${part("title")}, ${part("artist")})`;
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

function scoreItem(p, adjustable) {
  const li = document.createElement("li");
  const name = document.createElement("span");
  name.textContent = p.name;
  const score = document.createElement("b");
  score.textContent = p.score;
  li.append(name, score);
  if (adjustable) {
    const adj = document.createElement("div");
    adj.className = "adj";
    [["−", -1, "Remove a point"], ["+", 1, "Add a point"]].forEach(([label, d, title]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = `${title} for ${p.name}`;
      b.setAttribute("aria-label", b.title);
      b.onclick = () => { p.score += d; renderScores(); };
      adj.appendChild(b);
    });
    li.appendChild(adj);
  }
  return li;
}

function renderScores() {
  const board = $("scoreboard");
  board.innerHTML = "";
  if (isSolo()) {
    $("soloStats").innerHTML =
      `<div><b>${state.soloPlayer.score}</b><small>points</small></div>` +
      `<div><b>${state.solo.streak}</b><small>streak</small></div>` +
      `<div><b>${state.solo.title}</b><small>titles</small></div>` +
      `<div><b>${state.solo.artist}</b><small>artists</small></div>`;
    return;
  }
  sortedPlayers().forEach((p) => board.appendChild(scoreItem(p, true)));
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

// ---------------- Mode UI ----------------

function applyModeUI() {
  const solo = isSolo();
  $("moreBtn").classList.toggle("hidden", solo);
  $("skipBtn").classList.toggle("hidden", !solo);
  $("revealBtn").textContent = "Give up";
  $("scoresTitle").textContent = solo ? "Your score" : "Scores";
  $("scoreboard").classList.toggle("hidden", solo);
  $("soloStats").classList.toggle("hidden", !solo);
  $("keysHint").innerHTML = solo
    ? "Fill in either box · <b>↑ ↓</b> pick · <b>Enter</b> guess · <b>Tab</b> switch box"
    : "Type what people shout · <b>Enter</b> check · outside the boxes: <b>Space</b> play / hear more";
}

// ---------------- Autocomplete ----------------

const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const foldChars = (str) => str.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function highlight(text, words) {
  // Highlight typed words inside a suggestion, ignoring case and accents.
  const n = foldChars(text);
  if (n.length !== text.length || !words.length) return escapeHtml(text);
  const marks = new Array(text.length).fill(false);
  for (const w of words) {
    let i = n.indexOf(w);
    while (i !== -1) { for (let k = i; k < i + w.length; k++) marks[k] = true; i = n.indexOf(w, i + 1); }
  }
  let html = "", open = false;
  for (let i = 0; i < text.length; i++) {
    if (marks[i] && !open) { html += "<mark>"; open = true; }
    if (!marks[i] && open) { html += "</mark>"; open = false; }
    html += escapeHtml(text[i]);
  }
  return html + (open ? "</mark>" : "");
}

// Options for each box, built once per playlist.
let optionCache = { tracks: null, title: [], artist: [] };
function options(field) {
  if (optionCache.tracks !== state.tracks) {
    const titles = new Map(), artists = new Map();
    for (const t of state.tracks) {
      const tk = norm(t.fullTitle);
      if (!titles.has(tk)) titles.set(tk, { label: t.fullTitle, img: t.coverSmall || t.cover });
      const names = [t.artist];
      const f = (t.fullTitle || "").match(FEAT_RE);
      if (f) names.push(...splitNames(f[1]));
      for (const n of names) {
        const ak = norm(n);
        if (ak && !artists.has(ak)) artists.set(ak, { label: n, img: n === t.artist ? (t.artistPic || t.coverSmall) : "", round: true });
      }
    }
    optionCache = { tracks: state.tracks, title: [...titles.values()], artist: [...artists.values()] };
  }
  return optionCache[field];
}

const sugg = { field: null, items: [], active: -1 };

function updateSuggestions(field) {
  const q = norm($(`input-${field}`).value);
  if (!q) return hideSuggestions();
  hideSuggestions();
  const words = q.split(" ");
  const qf = foldChars($(`input-${field}`).value.trim());
  const items = options(field)
    .map((o) => {
      const hay = norm(o.label);
      if (!words.every((w) => hay.includes(w))) return null;
      return { o, rank: hay.startsWith(q) ? 0 : hay.includes(q) ? 1 : 2 };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.o.label.localeCompare(b.o.label))
    .slice(0, 8)
    .map((x) => x.o);

  Object.assign(sugg, { field, items, active: items.length ? 0 : -1 });
  const box = $(`sugg-${field}`);
  box.innerHTML = "";
  if (!items.length) box.innerHTML = `<li class="empty">No ${field === "title" ? "songs" : "artists"} in this playlist match</li>`;
  const hl = qf.split(/\s+/).filter(Boolean);
  items.forEach((o) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    if (o.round) li.classList.add("round");
    li.innerHTML = (o.img ? `<img src="${escapeHtml(o.img)}" alt="" loading="lazy" />` : `<span class="initial">${escapeHtml(o.label.trim()[0] || "?").toUpperCase()}</span>`) +
      `<div class="s-title">${highlight(o.label, hl)}</div>`;
    li.onmousedown = (e) => { e.preventDefault(); submitField(field, o.label); };
    box.appendChild(li);
  });
  paintActive();
  box.classList.remove("hidden");
}

function paintActive() {
  if (!sugg.field) return;
  const box = $(`sugg-${sugg.field}`);
  [...box.children].forEach((li, i) => li.classList.toggle("active", i === sugg.active));
  const el = box.children[sugg.active];
  if (el) el.scrollIntoView({ block: "nearest" });
}

function hideSuggestions() {
  FIELDS.forEach((f) => $(`sugg-${f}`).classList.add("hidden"));
  Object.assign(sugg, { field: null, items: [], active: -1 });
}

// ---------------- Guessing ----------------

function addAttempt(field, text) {
  const li = document.createElement("li");
  li.className = "wrong";
  const b = document.createElement("b");
  b.textContent = LABEL[field] + ":";
  li.append(b, document.createTextNode(text));
  $("attempts").prepend(li);
}

async function advanceOrLose() {
  if (state.step < state.steps.length - 1) {
    state.step++;
    await play();
  } else {
    finishRound();
  }
}

// Check one box. Returns true if it was correct.
function checkField(field, value) {
  value = (value || "").trim();
  if (!value || state.revealed || state.pending || state.solved[field]) return null;
  const ok = field === "title" ? titleMatches(value, state.current) : artistMatches(value, state.current);
  $(`input-${field}`).value = "";
  if (!ok) addAttempt(field, value);
  return ok;
}

function submitField(field, value) {
  hideSuggestions();
  const ok = checkField(field, value ?? $(`input-${field}`).value);
  if (ok === null) return;
  if (ok) return solveField(field);
  if (isSolo()) advanceOrLose();
  else $(`input-${field}`).focus();
}

// "Guess" button: check every filled box at once.
function submitAll() {
  hideSuggestions();
  const results = FIELDS.map((f) => [f, checkField(f, $(`input-${f}`).value)]).filter(([, r]) => r !== null);
  if (!results.length) return;
  const wrong = results.some(([, r]) => !r);
  const right = results.filter(([, r]) => r).map(([f]) => f);
  if (isSolo()) {
    right.forEach((f) => solveField(f));
    if (wrong && !state.revealed) advanceOrLose();
  } else if (right.length) {
    // Party: award one box at a time; the other is re-checked after.
    if (right[1]) state.queuedAward = right[1];
    solveField(right[0]);
  }
}

function skip() {
  if (state.revealed) return;
  advanceOrLose();
}

FIELDS.forEach((f) => {
  const input = $(`input-${f}`);
  input.addEventListener("input", () => updateSuggestions(f));
  input.addEventListener("focus", () => updateSuggestions(f));
  input.addEventListener("blur", () => setTimeout(() => { if (sugg.field === f) hideSuggestions(); }, 120));
  input.addEventListener("keydown", (e) => {
    const n = sugg.field === f ? sugg.items.length : 0;
    if (e.key === "ArrowDown" && n) { e.preventDefault(); sugg.active = (sugg.active + 1) % n; paintActive(); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); sugg.active = (sugg.active - 1 + n) % n; paintActive(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      submitField(f, n && sugg.active >= 0 ? sugg.items[sugg.active].label : input.value);
    } else if (e.key === "Escape") hideSuggestions();
  });
});
$("guessBtn").onclick = submitAll;
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
    if (state.pending) award(null);
    else if (!state.revealed) giveUp();
    else nextRound();
  }
});

restore();
