// Game rules (rules.js): playlist links, choosing songs, and whether a guess is right.
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.js");

const {
  parseSource, cleanNext, mergeTracks, distribute, buildQueue,
  baseTitle, splitNames, featuredArtists, titleMatches, artistMatches, soloGuessSolves,
} = load(["match.js", "rules.js"], [
  "parseSource", "cleanNext", "mergeTracks", "distribute", "buildQueue",
  "baseTitle", "splitNames", "featuredArtists", "titleMatches", "artistMatches", "soloGuessSolves",
]);

let nextId = 1;
const track = (fields) => ({ id: nextId++, title: fields.fullTitle, fullTitle: fields.title, artist: "", ...fields });
const songs = (n) => Array.from({ length: n }, () => track({ title: "x", fullTitle: "x" }));
const source = (title, tracks) => ({ key: title, input: title, title, tracks, count: 0 });

// ---------------- Playlists ----------------

test("parseSource reads Deezer links and bare numbers", () => {
  assert.deepEqual(parseSource("1234567"), { type: "playlist", id: "1234567" });
  assert.deepEqual(parseSource(" https://www.deezer.com/playlist/1234567 "), { type: "playlist", id: "1234567" });
  assert.deepEqual(parseSource("https://www.deezer.com/en/playlist/42?utm=x"), { type: "playlist", id: "42" });
  assert.deepEqual(parseSource("deezer.com/uk/ALBUM/9"), { type: "album", id: "9" });
});

test("parseSource explains short links and other text", () => {
  assert.throws(() => parseSource("https://link.deezer.com/s/abc"), /short share link/);
  assert.throws(() => parseSource("https://deezer.page.link/xyz"), /short share link/);
  assert.throws(() => parseSource("https://open.spotify.com/playlist/1"), /Paste a Deezer playlist/);
  assert.throws(() => parseSource(""), /Paste a Deezer playlist/);
});

test("cleanNext drops our JSONP params from Deezer's next-page link", () => {
  assert.equal(
    cleanNext("https://api.deezer.com/playlist/1/tracks?limit=100&index=100&output=jsonp&callback=dz_abc"),
    "/playlist/1/tracks?limit=100&index=100",
  );
});

test("mergeTracks lists a song once, with every playlist it's in", () => {
  const shared = track({ title: "Shared" });
  const a = source("A", [shared, track({ title: "Only A" })]);
  const b = source("B", [{ ...shared }, track({ title: "Only B" })]);
  const merged = mergeTracks([a, b]);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.find((t) => t.id === shared.id).playlists, ["A", "B"]);
  assert.deepEqual(mergeTracks([a, a]).find((t) => t.id === shared.id).playlists, ["A"]);
  assert.equal(shared.playlists, undefined, "the playlist's own tracks are left alone");
});

test("distribute splits rounds evenly", () => {
  const list = [source("A", songs(50)), source("B", songs(50)), source("C", songs(50))];
  distribute(list, 10);
  assert.deepEqual(list.map((s) => s.count), [4, 3, 3]);
  distribute(list, 0);
  assert.deepEqual(list.map((s) => s.count), [0, 0, 0]);
});

test("distribute never takes more than a playlist has", () => {
  const list = [source("Small", songs(2)), source("B", songs(50)), source("C", songs(50))];
  distribute(list, 10);
  assert.deepEqual(list.map((s) => s.count), [2, 4, 4]);
  distribute(list, 500);
  assert.deepEqual(list.map((s) => s.count), [2, 50, 50]);
});

test("buildQueue takes each playlist's count and plays a shared song once", () => {
  const shared = track({ title: "Shared" });
  const a = source("A", [shared]);
  const b = source("B", [shared, ...songs(5)]);
  a.count = 1;
  b.count = 3;
  const tracks = mergeTracks([a, b]);
  for (let i = 0; i < 20; i++) {
    const queue = buildQueue([a, b], tracks);
    assert.equal(queue.length, 4);
    assert.equal(new Set(queue.map((t) => t.id)).size, 4, "no song twice");
    assert.ok(queue.every((t) => tracks.includes(t)), "queue holds the merged tracks");
  }
});

// ---------------- Answers ----------------

test("baseTitle drops versions and features", () => {
  assert.equal(baseTitle("Song (feat. X) [Remix] - Radio Edit"), "Song");
  assert.equal(baseTitle("Home (Remastered 2011)"), "Home");
  assert.equal(baseTitle(undefined), "");
});

test("splitNames and featuredArtists", () => {
  assert.deepEqual(splitNames("A, B & C and D x E + F / G"), ["A", "B", "C", "D", "E", "F", "G"]);
  assert.deepEqual(featuredArtists("Song (feat. A & B)"), ["A", "B"]);
  assert.deepEqual(featuredArtists("Song [ft A]"), ["A"]);
  assert.deepEqual(featuredArtists("Song (with A)"), ["A"]);
  assert.deepEqual(featuredArtists("Song (Remix)"), []);
});

test("titleMatches ignores case, accents, versions and alphabets", () => {
  const home = track({ title: "Home", fullTitle: "Home (Remastered 2011)" });
  assert.ok(titleMatches("home", home));
  assert.ok(titleMatches("HOME!", home));
  assert.ok(titleMatches("Home (Remastered 2011)", home));
  assert.ok(titleMatches("Home (Live)", home), "another version of the same song counts");
  assert.ok(titleMatches("Zori", track({ title: "Зорі", fullTitle: "Зорі" })));
  assert.ok(titleMatches("Café", track({ title: "Cafe", fullTitle: "Cafe" })));
});

test("titleMatches rejects wrong and empty guesses", () => {
  const home = track({ title: "Home", fullTitle: "Home" });
  assert.ok(!titleMatches("Homes", home));
  assert.ok(!titleMatches("Hom", home));
  assert.ok(!titleMatches("", home));
  assert.ok(!titleMatches("(Remix)", home), "a guess that's only a version tag is empty");
});

test("artistMatches counts any one of the artists", () => {
  const duo = track({ title: "Song", fullTitle: "Song (feat. Pharrell Williams)", artist: "Simon & Garfunkel" });
  assert.ok(artistMatches("Simon & Garfunkel", duo));
  assert.ok(artistMatches("simon and garfunkel", duo));
  assert.ok(artistMatches("Garfunkel", duo));
  assert.ok(artistMatches("pharrell williams", duo), "featured in the title");
  assert.ok(artistMatches("Garfunkel & someone else", duo), "a list containing one of them");
  assert.ok(!artistMatches("Pharrell", duo));
  assert.ok(!artistMatches("", duo));
});

test("artistMatches uses contributors from Deezer and works across alphabets", () => {
  assert.ok(artistMatches("Guest", track({ title: "S", artist: "Main", contributors: ["Main", "Guest"] })));
  assert.ok(artistMatches("Okean Elzy", track({ title: "S", artist: "Океан Ельзи" })));
  assert.ok(artistMatches("Океан Ельзи", track({ title: "S", artist: "Okean Elzy" })));
});

test("solo: typed text scores whichever part it matches", () => {
  const cur = track({ title: "Home", artist: "Michael Bublé" });
  assert.deepEqual(soloGuessSolves("home", cur, ["title", "artist"]), ["title"]);
  assert.deepEqual(soloGuessSolves("michael buble", cur, ["title", "artist"]), ["artist"]);
  assert.deepEqual(soloGuessSolves("Halo", cur, ["title", "artist"]), []);
  assert.deepEqual(soloGuessSolves("home", cur, ["artist"]), [], "a part already solved isn't counted again");
});

test("solo: a picked song scores its title and artist separately", () => {
  const cur = track({ title: "Home", artist: "Michael Bublé" });
  assert.deepEqual(soloGuessSolves(cur, cur, ["title", "artist"]), ["title", "artist"]);
  assert.deepEqual(soloGuessSolves(track({ title: "Home", artist: "Daughtry" }), cur, ["title", "artist"]), ["title"]);
  assert.deepEqual(soloGuessSolves(track({ title: "Haven't Met You Yet", artist: "Michael Bublé" }), cur, ["title", "artist"]), ["artist"]);
  assert.deepEqual(soloGuessSolves(track({ title: "Halo", artist: "Beyoncé" }), cur, ["title", "artist"]), []);
});
