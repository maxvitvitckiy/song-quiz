// Text matching and suggestions (match.js), shared by the host page and the phones.
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.js");

const { norm, loose, sameText, prepOption, searchOptions } = load(["match.js"],
  ["norm", "loose", "sameText", "prepOption", "searchOptions"]);

test("norm ignores case, accents and punctuation", () => {
  assert.equal(norm("Café del Mar!"), "cafe del mar");
  assert.equal(norm("  Don't   Stop—Me Now "), "don t stop me now");
  assert.equal(norm("Rock & Roll"), "rock and roll");
  assert.equal(norm(undefined), "");
});

test("loose spells Cyrillic and Latin the same way", () => {
  assert.equal(loose("Зорі"), loose("Zori"));
  assert.equal(loose("Океан Ельзи"), loose("Okean Elzy"));
  assert.equal(loose("Okean Elzy"), loose("Ocean Elzi"));
  assert.equal(loose("Київ"), loose("Kyiv"));
  assert.equal(loose("El'zy"), loose("Elzy"));
});

test("sameText", () => {
  assert.ok(sameText("zori", "Зорі"));
  assert.ok(sameText("HOME", "home!"));
  assert.ok(!sameText("Home", "Homes"));
  assert.ok(!sameText("", ""), "two empty answers are not a match");
  assert.ok(!sameText("!!!", "???"), "punctuation alone is not an answer");
});

const opts = (...labels) => labels.map((l) => prepOption({ label: l }, l));
const labels = (list) => list.map((o) => o.label);

test("suggestions start after 3 letters", () => {
  const list = opts("Home", "Hotel California");
  assert.deepEqual(searchOptions(list, "ho"), []);
  assert.deepEqual(searchOptions(list, "h o"), [], "spaces don't count as letters");
  assert.deepEqual(labels(searchOptions(list, "hom")), ["Home"]);
});

test("suggestions match the start of a word only", () => {
  const list = opts("Home", "Welcome Home", "Chrome Hearts");
  assert.deepEqual(labels(searchOptions(list, "ome")), []);
  assert.deepEqual(labels(searchOptions(list, "hom")), ["Home", "Welcome Home"]);
  assert.deepEqual(labels(searchOptions(list, "wel hom")), ["Welcome Home"], "every typed word must start a word");
});

test("suggestions rank the start of the title first and show at most 4", () => {
  const list = opts("Welcome Home", "Homeward", "Home", "Hometown", "Home Again", "Homesick");
  const found = labels(searchOptions(list, "home"));
  assert.equal(found.length, 4);
  assert.ok(!found.includes("Welcome Home"), "a match later in the title ranks below the 5 that start with it");
});

test("suggestions find the other alphabet, after plain matches", () => {
  assert.deepEqual(labels(searchOptions(opts("Зорі", "Home"), "zori")), ["Зорі"]);
  assert.deepEqual(labels(searchOptions(opts("Зорі", "Home"), "зорі")), ["Зорі"]);
  assert.deepEqual(labels(searchOptions(opts("Zoriana", "Зорі"), "zori")), ["Zoriana", "Зорі"]);
});
