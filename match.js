// Text matching shared by the host page and the players' phones.
//
// norm()  — lowercase, no accents, punctuation turned into spaces. "Café del Mar!" → "cafe del mar"
// loose() — also transliterates Cyrillic and folds spellings that sound alike, so
//           "Зорі" = "Zori", and "Океан Ельзи" = "Okean Elzy" = "Ocean Elzi".
// Plain matches always rank above loose ones, so normal typing behaves as before.

const norm = (str) =>
  (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Ukrainian national transliteration, plus the Russian/Belarusian-only letters.
const CYR = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ё: "yo", ж: "zh", з: "z",
  и: "y", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ў: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

// Spellings people use interchangeably when writing a name they've only heard.
const FOLDS = [
  [/shch|sch/g, "sh"], [/tch/g, "ch"], [/zh/g, "z"], [/kh/g, "h"], [/tz/g, "ts"], [/ph/g, "f"],
  [/ck/g, "k"], [/c(?!h)/g, "k"], [/q/g, "k"], [/x/g, "ks"], [/w/g, "v"],
  [/[yj]/g, "i"],     // Elzy / Elzi, Kyiv / Kiev, ya / ja
  [/g/g, "h"],        // Ukrainian Г is h, Russian Г is g
  [/(\p{L})\1+/gu, "$1"], // doubled letters
];

const looseCache = new Map();
function loose(str) {
  str = str || "";
  let s = looseCache.get(str);
  if (s !== undefined) return s;
  s = str.normalize("NFC").toLowerCase()
    .replace(/['’ʼ`´]/g, "")                       // El'zy → Elzy, don't → dont
    .replace(/[Ѐ-ӿ]/g, (c) => CYR[c] ?? c);
  s = norm(s);
  for (const [re, to] of FOLDS) s = s.replace(re, to);
  if (looseCache.size > 20000) looseCache.clear();
  looseCache.set(str, s);
  return s;
}

// Same answer, written either way.
const sameText = (a, b) => {
  const na = norm(a);
  return (na !== "" && na === norm(b)) || (loose(a) !== "" && loose(a) === loose(b));
};

// Precompute search keys. `text` is everything searchable, `head` is what ranks first (usually the title).
function prepOption(o, text, head = text) {
  o._n = norm(text).split(" "); o._l = loose(text).split(" ");
  o._hn = norm(head); o._hl = loose(head);
  return o;
}

// Suggestions only start after this many letters/digits, and show at most this many,
// so they help with spelling without becoming a list to browse for the answer.
const MIN_CHARS = 3;
const MAX_SUGGESTIONS = 4;
const enoughTyped = (typed) => norm(typed).replace(/ /g, "").length >= MIN_CHARS;

// Every typed word has to be the start of a word in the option: "hom" finds "Home", "ome" doesn't.
const wordStarts = (typedWords, words) => typedWords.every((t) => words.some((w) => w.startsWith(t)));
const phraseRank = (head, q) => (head.startsWith(q) ? 0 : (" " + head).includes(" " + q) ? 1 : 2);

// Options matching what was typed, best first. Plain matches rank above transliterated ones.
function searchOptions(list, typed) {
  if (!enoughTyped(typed)) return [];
  const q = norm(typed), ql = loose(typed);
  const w = q.split(" "), wl = ql.split(" ");
  return list
    .map((o) => {
      let r = -1;
      if (q && wordStarts(w, o._n)) r = phraseRank(o._hn, q);
      else if (ql && wordStarts(wl, o._l)) r = 3 + phraseRank(o._hl, ql);
      return r < 0 ? null : { o, r };
    })
    .filter(Boolean)
    .sort((a, b) => a.r - b.r || a.o.label.localeCompare(b.o.label))
    .slice(0, MAX_SUGGESTIONS)
    .map((x) => x.o);
}
