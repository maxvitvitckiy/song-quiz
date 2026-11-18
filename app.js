// Guess the Song — plays short clips from Deezer's public 30-second previews.
// No build step, no server code: Deezer's API is called with JSONP because it
// doesn't send CORS headers, and preview MP3s play straight from Deezer's CDN.

const $ = (id) => document.getElementById(id);
const STORE_KEY = "guess-the-song-v1";

const state = {
  sources: [],     // [{ key, input, title, tracks }] one per added playlist or album
  tracks: [],      // all playable tracks from every source, merged by id (track.playlists = source titles)
  queue: [],       // shuffled tracks for this game
  players: [],     // players in the current game: party roster or online room
  partyPlayers: [], // [{ name, score }] typed in on the setup screen (party mode)
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

// Takes the chosen number of random songs from each playlist, then shuffles them together.
// A song that's in two playlists is only played once (the next playlist takes another song instead).
function buildQueue() {
  const byId = new Map(state.tracks.map((t) => [t.id, t]));
  const used = new Set(), picked = [];
  state.sources.forEach((s) => {
    let left = s.count || 0;
    for (const t of shuffle(s.tracks)) {
      if (left <= 0) break;
      if (used.has(t.id)) continue;
      used.add(t.id);
      picked.push(byId.get(t.id));
      left--;
    }
  });
  return shuffle(picked);
}

// Split the rounds as evenly as possible: 10 rounds over 3 playlists → 4, 3, 3.
// A playlist never gets more than it has; what it can't take goes to the others.
function distribute(total) {
  state.sources.forEach((s) => (s.count = 0));
  let left = total, room = true;
  while (left > 0 && room) {
    room = false;
    for (const s of state.sources) {
      if (left <= 0) break;
      if (s.count < s.tracks.length) { s.count++; left--; room = true; }
    }
  }
}

const totalCount = () => state.sources.reduce((n, s) => n + (s.count || 0), 0);

function roundsWanted() {
  const n = Math.floor(Number($("rounds").value));
  return n > 0 ? Math.min(n, 999) : 20;
}

// Rounds box changed: spread the new total evenly.
function onRoundsChange() {
  const n = roundsWanted();
  $("rounds").value = n;
  distribute(n);
  syncRounds();
  renderSources();
  save();
}

// A playlist's number changed: the rounds box shows the new total.
function setCount(i, value) {
  const s = state.sources[i];
  s.count = Math.max(0, Math.min(s.tracks.length, Math.floor(Number(value)) || 0));
  syncRounds();
  renderSources();
  save();
}

function useAllSongs() {
  state.sources.forEach((s) => (s.count = s.tracks.length));
  syncRounds();
  renderSources();
  save();
}

function syncRounds() {
  if (state.sources.length) $("rounds").value = totalCount();
  updateStartButton();
}

// "From: Party hits · 2000s" when more than one playlist is in the game.
function playlistLabel(track) {
  return state.sources.length > 1 && track.playlists && track.playlists.length ? track.playlists.join(" · ") : "";
}

function startGame() {
  state.steps = $("steps").value.split(",").map(Number);
  state.queue = buildQueue();
  state.mode = document.querySelector('input[name="mode"]:checked').value;
  state.players = isOnline() ? net.players : state.partyPlayers;
  if (isSolo()) state.solo = { title: 0, artist: 0, streak: 0, best: 0 };
  state.players.forEach((p) => (p.score = 0));
  state.soloPlayer = { name: "You", score: 0 };
  applyModeUI();
  state.round = 0;
  state.history = [];
  save();
  show("game");
  renderScores();
  if (isOnline()) netOnStart();
  nextRound();
}

// ---------------- Answer matching ----------------

// norm(), loose(), sameText() and searchOptions() live in match.js (shared with the phones).

// "Song (feat. X) [Remix] - Radio Edit" → "Song"
const baseTitle = (t) => (t || "").replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").replace(/\s+-\s+.*$/, "").trim();

const FEAT_RE = /[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^\)\]]+)[\)\]]/i;
const splitNames = (s) => (s || "").split(/\s*(?:,|&|\band\b|\bx\b|\+|\/)\s*/i).map((x) => x.trim()).filter(Boolean);

// Every artist name that counts for a track: main artist (whole and split), featured artists
// from the title, and contributors fetched from Deezer at the start of the round.
function artistNames(track) {
  const names = [track.artist, ...splitNames(track.artist)];
  const f = (track.fullTitle || "").match(FEAT_RE);
  if (f) names.push(...splitNames(f[1]));
  names.push(...(track.contributors || []));
  return names.filter((n) => norm(n));
}

// Matches ignore case, accents and punctuation, and also work across alphabets
// and spellings ("Zori" = "Зорі", "Okean Elzy" = "Океан Ельзи").
function titleMatches(guess, track) {
  if (!norm(baseTitle(guess)) && !loose(baseTitle(guess))) return false;
  return [track.title, track.fullTitle].some((t) => sameText(guess, t) || sameText(baseTitle(guess), baseTitle(t)));
}

function artistMatches(guess, track) {
  const names = artistNames(track);
  return [guess, ...splitNames(guess)].some((g) => names.some((n) => sameText(g, n)));
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
const LABEL = { title: "Title", artist: "Artist", song: "Guess" };

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
  $("input-song").value = "";
  $("field-song").classList.remove("hidden");
  hideSuggestions();
  $("moreBtn").disabled = true;
  $("playBtn").disabled = false;
  setStatus("");
  updateStepUI(false);

  loadAudio(state.current.preview).catch(() => {});
  loadContributors(state.current);
  if (isOnline()) netOnRound();
}

function updateStepUI(played) {
  const s = state.steps[state.step];
  const p = pointsForStep(state.step);
  $("pointsLabel").textContent = `${p} pts each`;
  FIELDS.forEach((f) => ($(`pts-${f}`).textContent = state.solved && state.solved[f] ? "" : `+${p}`));
  updateSongPts();
  $("playBtn").textContent = played ? `↺ Replay ${s}s` : `▶ Play ${s}s`;
  const next = state.steps[state.step + 1];
  $("moreBtn").textContent = next ? `Hear more (${next}s)` : "Hear more";
  $("moreBtn").disabled = !played || !next || someoneAnswering();
  $("skipBtn").textContent = next ? `Skip (+${next - s}s)` : "Give up";
}

async function play() {
  if (state.revealed) return;
  try {
    setStatus("");
    await playClip(state.offset, state.steps[state.step]);
    state.played = true;
    updateStepUI(true);
    if (isOnline()) netOnPlayed();
  } catch (e) {
    setStatus(e.message || "Couldn't play this song.", "error");
  }
}

async function hearMore() {
  if (state.revealed || state.step >= state.steps.length - 1 || someoneAnswering()) return;
  state.step++;
  if (isOnline()) netOnHearMore();
  await play();
}

// Solo's single box says what's still worth points: "+4 title · +4 artist".
function updateSongPts() {
  const p = pointsForStep(state.step);
  $("pts-song").textContent = unsolved().map((f) => `+${p} ${f}`).join(" · ");
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
  updateSongPts();
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
  if (f) $(isSolo() ? "input-song" : `input-${f}`).focus();
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
  const from = playlistLabel(t);
  $("songFrom").textContent = from ? "From: " + from : "";
  $("songFrom").classList.toggle("hidden", !from);
  $("cover").src = t.cover;
  $("answer").classList.remove("hidden");
  $("mystery").classList.add("hidden");
  $("guessControls").classList.add("hidden");
  $("awardControls").classList.add("hidden");
  $("soloBox").classList.remove("hidden");
  $("guessBtn").parentElement.classList.add("hidden");
  $("field-song").classList.add("hidden");
  $("soloResult").classList.remove("hidden");
  $("soloNextBtn").focus();
  playClip(0, 0).catch(() => {});
  if (isOnline()) netOnReveal();
}

function giveUp() {
  if (state.revealed || someoneAnswering()) return;
  if (state.pending) award(null);
  finishRound();
}

function endGame() {
  stopAudio();
  show("end");
  if (isOnline()) netOnEnd();
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
    const from = playlistLabel(h.track);
    li.textContent = `${h.track.fullTitle || h.track.title} — ${h.track.artist}${from ? `  [${from}]` : ""}  (${part("title")}, ${part("artist")})`;
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
  name.textContent = p.name + (p.online === false ? " · offline" : "");
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
  if (isOnline()) netBroadcast();
}

function renderPlayers() {
  const list = $("playerList");
  list.innerHTML = "";
  state.partyPlayers.forEach((p, i) => {
    const li = document.createElement("li");
    li.textContent = p.name;
    const x = document.createElement("button");
    x.textContent = "×";
    x.title = "Remove";
    x.onclick = () => { state.partyPlayers.splice(i, 1); renderPlayers(); save(); };
    li.appendChild(x);
    list.appendChild(li);
  });
  updateStartButton();
}

function updateStartButton() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const count = mode === "online" ? net.players.length : state.partyPlayers.length;
  $("startBtn").disabled = !(state.tracks.length && totalCount() > 0 && (mode === "solo" || count));
  $("playersSection").classList.toggle("hidden", mode !== "party");
  $("roomSection").classList.toggle("hidden", mode !== "online");
  $("startHint").textContent = mode === "online" && state.tracks.length && !count ? "Waiting for at least one player to join the room." : "";
  if (mode === "online") netOpen();
}

function addPlayer() {
  const name = $("playerName").value.trim();
  if (!name) return;
  if (state.partyPlayers.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
  state.partyPlayers.push({ name, score: 0 });
  $("playerName").value = "";
  renderPlayers();
  save();
}

// Add one playlist or album. Returns true if it was added.
async function addSource(input, quiet) {
  const status = $("loadStatus");
  let src;
  try { src = parseSource(input); }
  catch (e) { setStatus(e.message, "error", status); return false; }
  const key = `${src.type}:${src.id}`;
  if (state.sources.some((s) => s.key === key)) {
    setStatus("That playlist is already added.", "error", status);
    return false;
  }
  $("loadBtn").disabled = true;
  setStatus("Loading songs from Deezer…", "", status);
  try {
    const res = await loadSource(src);
    if (!res.tracks.length) { setStatus(`"${res.title}" has no songs with previews.`, "error", status); return false; }
    if (state.sources.some((s) => s.key === key)) return false; // added twice while loading
    state.sources.push({ key, input: input.trim(), title: res.title || `Deezer ${src.type} ${src.id}`, tracks: res.tracks, count: 0 });
    mergeTracks();
    if (!quiet) { distribute(roundsWanted()); syncRounds(); }
    if (!quiet) setStatus(`Added "${res.title}" (${res.tracks.length} songs).`, "ok", status);
    return true;
  } catch (e) {
    setStatus(e.message + " Make sure the playlist is public.", "error", status);
    return false;
  } finally {
    $("loadBtn").disabled = false;
    renderSources();
    updateStartButton();
  }
}

async function onLoad() {
  const input = $("source").value;
  if (!input.trim()) return;
  if (await addSource(input)) { $("source").value = ""; save(); }
}

function removeSource(i) {
  state.sources.splice(i, 1);
  mergeTracks();
  distribute(roundsWanted());
  syncRounds();
  renderSources();
  setStatus("", "", $("loadStatus"));
  updateStartButton();
  save();
}

// One entry per song; a song that's in several playlists remembers all their names.
function mergeTracks() {
  const byId = new Map();
  for (const s of state.sources) {
    for (const t of s.tracks) {
      const m = byId.get(t.id);
      if (m) { if (!m.playlists.includes(s.title)) m.playlists.push(s.title); }
      else byId.set(t.id, { ...t, playlists: [s.title] });
    }
  }
  state.tracks = [...byId.values()];
}

function renderSources() {
  const list = $("sourceList");
  list.innerHTML = "";
  state.sources.forEach((s, i) => {
    const li = document.createElement("li");
    const name = document.createElement("div");
    name.className = "src-name";
    name.textContent = s.title;
    const size = document.createElement("small");
    size.textContent = `${s.tracks.length} songs`;
    name.appendChild(size);

    const step = document.createElement("div");
    step.className = "stepper";
    const minus = document.createElement("button");
    minus.className = "btn ghost";
    minus.textContent = "−";
    minus.title = "One song fewer";
    minus.disabled = s.count <= 0;
    minus.onclick = () => setCount(i, s.count - 1);
    const num = document.createElement("input");
    num.type = "number";
    num.min = 0;
    num.max = s.tracks.length;
    num.value = s.count;
    num.setAttribute("aria-label", `Songs from ${s.title}`);
    num.onchange = () => setCount(i, num.value);
    num.onkeydown = (e) => { if (e.key === "Enter") num.blur(); };
    const plus = document.createElement("button");
    plus.className = "btn ghost";
    plus.textContent = "+";
    plus.title = "One song more";
    plus.disabled = s.count >= s.tracks.length;
    plus.onclick = () => setCount(i, s.count + 1);
    step.append(minus, num, plus);

    const x = document.createElement("button");
    x.className = "src-remove";
    x.textContent = "×";
    x.title = `Remove ${s.title}`;
    x.onclick = () => removeSource(i);
    li.append(name, step, x);
    list.appendChild(li);
  });
  const total = totalCount();
  $("sourceTotal").classList.toggle("hidden", !state.sources.length);
  $("sourceTotal").innerHTML = "";
  if (state.sources.length) {
    const t = document.createElement("span");
    t.textContent = `Total: ${total} ${total === 1 ? "song" : "songs"} = ${total} ${total === 1 ? "round" : "rounds"}`;
    const all = document.createElement("button");
    all.className = "btn ghost";
    all.textContent = `Use all ${state.tracks.length} songs`;
    all.onclick = useAllSongs;
    const even = document.createElement("button");
    even.className = "btn ghost";
    even.textContent = "Split evenly";
    even.onclick = onRoundsChange;
    $("sourceTotal").append(t, even, all);
  }
}

// ---------------- Persistence ----------------

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      sources: state.sources.map((s) => ({ input: s.input, count: s.count })),
      players: state.partyPlayers.map((p) => p.name),
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
    state.partyPlayers = (s.players || []).map((name) => ({ name, score: 0 }));
    if (s.steps) $("steps").value = s.steps;
    if (s.startPos) $("startPos").value = s.startPos;
    if (Number(s.rounds) > 0) $("rounds").value = s.rounds;   // old saves could have 0 = whole playlist
    if (s.mode) document.querySelector(`input[name="mode"][value="${s.mode}"]`).checked = true;
    renderPlayers();
    // Older saves had one "source", or a list of plain links without counts.
    const saved = (s.sources || (s.source ? [s.source] : [])).map((x) => (typeof x === "string" ? { input: x } : x));
    (async () => {
      for (const x of saved) await addSource(x.input, true);
      const counts = saved.every((x) => typeof x.count === "number");
      if (counts) state.sources.forEach((src) => {
        const x = saved.find((y) => y.input.trim() === src.input);
        src.count = x ? Math.min(x.count, src.tracks.length) : 0;
      });
      else distribute(roundsWanted());
      syncRounds();
      renderSources();
    })();
  } catch {}
}

// ---------------- Mode UI ----------------

function applyModeUI() {
  const solo = isSolo(), online = isOnline();
  $("buzzPanel").classList.toggle("hidden", !online);
  $("roomMini").classList.toggle("hidden", !online);
  $("soloBox").classList.toggle("single", solo);
  $("moreBtn").classList.toggle("hidden", solo);
  $("skipBtn").classList.toggle("hidden", !solo);
  $("revealBtn").textContent = "Give up";
  $("scoresTitle").textContent = solo ? "Your score" : "Scores";
  $("scoreboard").classList.toggle("hidden", solo);
  $("soloStats").classList.toggle("hidden", !solo);
  $("keysHint").innerHTML = solo
    ? "Type a song or artist · <b>↑ ↓</b> pick · <b>Enter</b> guess · title and artist score separately"
    : online
    ? "Players buzz and guess on their phones · <b>Space</b> play / hear more (unfreezes everyone) · <b>R</b> give up · <b>N</b> next"
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
//  title  — song titles, text only (an album cover would give the answer away)
//  artist — artist names, with the artist's photo when Deezer has one
//  song   — solo mode's single box: one row per song, title + artist + cover
let optionCache = { tracks: null, title: [], artist: [], song: [] };
function options(field) {
  if (optionCache.tracks !== state.tracks) {
    const titles = new Map(), artists = new Map(), songs = new Map();
    for (const t of state.tracks) {
      const tk = norm(t.fullTitle);
      if (!titles.has(tk)) titles.set(tk, prepOption({ label: t.fullTitle }, t.fullTitle));
      const sk = tk + "|" + norm(t.artist);
      if (!songs.has(sk)) songs.set(sk, prepOption({ label: t.fullTitle, sub: t.artist, img: t.coverSmall || t.cover, track: t }, t.fullTitle + " " + t.artist, t.fullTitle));
      const names = [t.artist];
      const f = (t.fullTitle || "").match(FEAT_RE);
      if (f) names.push(...splitNames(f[1]));
      for (const n of names) {
        const ak = norm(n);
        if (ak && !artists.has(ak)) artists.set(ak, prepOption({ label: n, img: n === t.artist ? t.artistPic || "" : "", round: true }, n));
      }
    }
    optionCache = { tracks: state.tracks, title: [...titles.values()], artist: [...artists.values()], song: [...songs.values()] };
  }
  return optionCache[field];
}

const sugg = { field: null, items: [], active: -1 };
const SUGG_FIELDS = ["title", "artist", "song"];
const EMPTY = { title: "No songs in this playlist match", artist: "No artists in this playlist match", song: "No songs or artists in this playlist match" };

function optionIcon(o) {
  if (o.img) return `<img src="${escapeHtml(o.img)}" alt="" loading="lazy" />`;
  if (o.round) return `<span class="initial">${escapeHtml((o.label.trim()[0] || "?").toUpperCase())}</span>`;
  return "";
}

function updateSuggestions(field) {
  const typed = $(`input-${field}`).value;
  hideSuggestions();
  if (!enoughTyped(typed)) return;
  const items = searchOptions(options(field), typed);
  Object.assign(sugg, { field, items, active: items.length ? 0 : -1 });
  const box = $(`sugg-${field}`);
  box.innerHTML = "";
  if (!items.length) box.innerHTML = `<li class="empty">${EMPTY[field]}</li>`;
  const hl = foldChars(typed.trim()).split(/\s+/).filter(Boolean);
  items.forEach((o) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    if (o.round) li.classList.add("round");
    li.innerHTML = optionIcon(o) +
      `<div><div class="s-title">${highlight(o.label, hl)}</div>` +
      (o.sub ? `<div class="s-artist">${highlight(o.sub, hl)}</div>` : "") + `</div>`;
    li.onmousedown = (e) => { e.preventDefault(); pickOption(field, o); };
    box.appendChild(li);
  });
  paintActive();
  box.classList.remove("hidden");
}

function pickOption(field, o) {
  if (field === "song") submitSong(o);
  else submitField(field, o.label);
}

function paintActive() {
  if (!sugg.field) return;
  const box = $(`sugg-${sugg.field}`);
  [...box.children].forEach((li, i) => li.classList.toggle("active", i === sugg.active));
  const el = box.children[sugg.active];
  if (el) el.scrollIntoView({ block: "nearest" });
}

function hideSuggestions() {
  SUGG_FIELDS.forEach((f) => $(`sugg-${f}`).classList.add("hidden"));
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

// Solo: one box for the whole song. Title and artist still score separately, so picking
// another song with the same name still counts the title, and picking any song by the
// right artist counts the artist. Only a guess with nothing new right unlocks a longer clip.
function submitSong(option) {
  hideSuggestions();
  const input = $("input-song");
  const typed = input.value.trim();
  if (state.revealed || (!option && !typed)) return;
  input.value = "";
  const cur = state.current;
  const right = unsolved().filter((f) => option
    ? (f === "title" ? titleMatches(option.track.fullTitle, cur) || titleMatches(option.track.title, cur) : artistMatches(option.track.artist, cur))
    : (f === "title" ? titleMatches(typed, cur) : artistMatches(typed, cur)));
  if (right.length) return right.forEach((f) => { if (!state.revealed) solveField(f); });
  addAttempt("song", option ? `${option.label} — ${option.sub}` : typed);
  advanceOrLose();
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
const songInput = $("input-song");
songInput.addEventListener("input", () => updateSuggestions("song"));
songInput.addEventListener("focus", () => updateSuggestions("song"));
songInput.addEventListener("blur", () => setTimeout(() => { if (sugg.field === "song") hideSuggestions(); }, 120));
songInput.addEventListener("keydown", (e) => {
  const n = sugg.field === "song" ? sugg.items.length : 0;
  if (e.key === "ArrowDown" && n) { e.preventDefault(); sugg.active = (sugg.active + 1) % n; paintActive(); }
  else if (e.key === "ArrowUp" && n) { e.preventDefault(); sugg.active = (sugg.active - 1 + n) % n; paintActive(); }
  else if (e.key === "Enter") { e.preventDefault(); submitSong(n && sugg.active >= 0 ? sugg.items[sugg.active] : null); }
  else if (e.key === "Escape") hideSuggestions();
});
$("guessBtn").onclick = () => {
  if (!isSolo()) return submitAll();
  const n = sugg.field === "song" ? sugg.items.length : 0;
  submitSong(n && sugg.active >= 0 ? sugg.items[sugg.active] : null);
};
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
["steps", "startPos"].forEach((id) => $(id).addEventListener("change", save));
$("rounds").addEventListener("change", onRoundsChange);
$("startBtn").onclick = startGame;
$("playBtn").onclick = play;
$("moreBtn").onclick = hearMore;
$("revealBtn").onclick = giveUp;
$("nobodyBtn").onclick = () => award(null);
$("endBtn").onclick = endGame;
$("againBtn").onclick = () => { show("setup"); updateStartButton(); if (isOnline()) netOnSetup(); };
document.querySelectorAll(".copy-link").forEach((b) => (b.onclick = copyLink));

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
