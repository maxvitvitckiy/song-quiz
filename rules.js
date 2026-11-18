// @ts-check
// Game rules for the host page: reading playlist links, choosing the songs for a game,
// and deciding whether a guess is right. Nothing in here touches the page, so the tests
// in tests/ can run it in Node. Uses norm(), loose() and sameText() from match.js.

/**
 * A song as the game keeps it (built from Deezer's track data in app.js).
 * @typedef {object} Track
 * @property {number} id
 * @property {string} title        short title, e.g. "Song"
 * @property {string} fullTitle    with versions and features, e.g. "Song (feat. X) [Remix]"
 * @property {string} artist
 * @property {string} [artistPic]
 * @property {string} [cover]
 * @property {string} [coverSmall]
 * @property {string} [preview]    30-second MP3
 * @property {string[]} [playlists]     titles of every added playlist the song is in
 * @property {string[]} [contributors]  every credited artist, fetched when its round starts
 */

/**
 * One added playlist or album.
 * @typedef {object} Source
 * @property {string} key       "playlist:123", to spot the same one added twice
 * @property {string} input     what was pasted
 * @property {string} title
 * @property {Track[]} tracks
 * @property {number} count     how many songs this game takes from it
 */

// ---------------- Playlists ----------------

/**
 * "https://www.deezer.com/en/playlist/123" → { type: "playlist", id: "123" }. A bare number is a playlist.
 * Throws an Error with a message for the player when the text isn't a Deezer link.
 * @param {string} text
 * @returns {{ type: string, id: string }}
 */
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

/**
 * Deezer's "next page" link repeats our JSONP params; strip them so deezer() can add fresh ones.
 * @param {string} next
 */
function cleanNext(next) {
  const u = new URL(next);
  u.searchParams.delete("output");
  u.searchParams.delete("callback");
  return u.pathname + u.search;
}

/**
 * One entry per song; a song that's in several playlists remembers all their names.
 * @param {Source[]} sources
 * @returns {Track[]}
 */
function mergeTracks(sources) {
  /** @type {Map<number, Track & { playlists: string[] }>} */
  const byId = new Map();
  for (const s of sources) {
    for (const t of s.tracks) {
      const m = byId.get(t.id);
      if (m) { if (!m.playlists.includes(s.title)) m.playlists.push(s.title); }
      else byId.set(t.id, { ...t, playlists: [s.title] });
    }
  }
  return [...byId.values()];
}

/**
 * Split the rounds as evenly as possible: 10 rounds over 3 playlists → 4, 3, 3.
 * A playlist never gets more than it has; what it can't take goes to the others.
 * Sets each source's `count`.
 * @param {Source[]} sources
 * @param {number} total
 */
function distribute(sources, total) {
  sources.forEach((s) => (s.count = 0));
  let left = total, room = true;
  while (left > 0 && room) {
    room = false;
    for (const s of sources) {
      if (left <= 0) break;
      if (s.count < s.tracks.length) { s.count++; left--; room = true; }
    }
  }
}

/**
 * @template T
 * @param {T[]} arr
 * @returns {T[]} a shuffled copy
 */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Takes each source's `count` of random songs, then shuffles them together.
 * A song that's in two playlists is only played once (the next playlist takes another song instead).
 * Returns the merged tracks (from mergeTracks), so each knows all its playlists.
 * @param {Source[]} sources
 * @param {Track[]} tracks  mergeTracks(sources)
 * @returns {Track[]}
 */
function buildQueue(sources, tracks) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const used = new Set(), picked = [];
  sources.forEach((s) => {
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

// ---------------- Answers ----------------

/**
 * "Song (feat. X) [Remix] - Radio Edit" → "Song"
 * @param {string} [t]
 */
const baseTitle = (t) => (t || "").replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").replace(/\s+-\s+.*$/, "").trim();

const FEAT_RE = /[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^\)\]]+)[\)\]]/i;

/**
 * "A, B & C" → ["A", "B", "C"]. Also splits on "and", "x", "+" and "/".
 * @param {string} [s]
 */
const splitNames = (s) => (s || "").split(/\s*(?:,|&|\band\b|\bx\b|\+|\/)\s*/i).map((x) => x.trim()).filter(Boolean);

/**
 * Artists named in the title: "Song (feat. A & B)" → ["A", "B"].
 * @param {string} [fullTitle]
 */
function featuredArtists(fullTitle) {
  const f = (fullTitle || "").match(FEAT_RE);
  return f ? splitNames(f[1]) : [];
}

/**
 * Every artist name that counts for a track: main artist (whole and split), featured artists
 * from the title, and contributors fetched from Deezer at the start of the round.
 * @param {Track} track
 */
function artistNames(track) {
  const names = [track.artist, ...splitNames(track.artist), ...featuredArtists(track.fullTitle), ...(track.contributors || [])];
  return names.filter((n) => norm(n));
}

// Matches ignore case, accents and punctuation, and also work across alphabets
// and spellings ("Zori" = "Зорі", "Okean Elzy" = "Океан Ельзи").

/**
 * @param {string} guess
 * @param {Track} track
 */
function titleMatches(guess, track) {
  if (!norm(baseTitle(guess)) && !loose(baseTitle(guess))) return false;
  return [track.title, track.fullTitle].some((t) => sameText(guess, t) || sameText(baseTitle(guess), baseTitle(t)));
}

/**
 * Any one of the track's artists counts, and so does a list that contains one ("A & Someone").
 * @param {string} guess
 * @param {Track} track
 */
function artistMatches(guess, track) {
  const names = artistNames(track);
  return [guess, ...splitNames(guess)].some((g) => names.some((n) => sameText(g, n)));
}

/**
 * @param {"title" | "artist"} field
 * @param {string} guess
 * @param {Track} track
 */
const fieldMatches = (field, guess, track) => (field === "title" ? titleMatches(guess, track) : artistMatches(guess, track));

/**
 * Solo mode's single box: which of `fields` a guess gets right. The guess is typed text, or a
 * song picked from the suggestions. A picked song scores the title and the artist separately,
 * so another song with the same name still gets the title, and any song by the right artist
 * gets the artist.
 * @param {string | Track} guess
 * @param {Track} track
 * @param {("title" | "artist")[]} fields  the parts still unsolved
 */
function soloGuessSolves(guess, track, fields) {
  return fields.filter((f) => {
    if (typeof guess === "string") return fieldMatches(f, guess, track);
    return f === "title"
      ? titleMatches(guess.fullTitle, track) || titleMatches(guess.title, track)
      : artistMatches(guess.artist, track);
  });
}
