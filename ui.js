// @ts-check
// Page helpers shared by the host page and the phones: the suggestion list under a guess box,
// and small things both pages need.

// Typed as `any` so .value, .disabled and so on need no casts; the checks that matter are elsewhere.
/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id);

const escapeHtml = (/** @type {any} */ str) => String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const foldChars = (/** @type {string} */ str) => str.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Marks the typed words inside a suggestion, ignoring case and accents. Returns safe HTML.
 * @param {string} text
 * @param {string[]} words  already folded with foldChars()
 */
function highlight(text, words) {
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

/**
 * One suggestion, made with prepOption() (match.js).
 * @typedef {{ label: string, sub?: string, img?: string, round?: boolean, [key: string]: any }} Option
 */

/** @param {Option} o  picture, or a round initial for artists without one */
function optionIcon(o) {
  if (o.img) return `<img src="${escapeHtml(o.img)}" alt="" loading="lazy" />`;
  if (o.round) return `<span class="initial">${escapeHtml((o.label.trim()[0] || "?").toUpperCase())}</span>`;
  return "";
}

// A finger is down on a suggestion. The box loses focus then, but the list has to stay
// until the tap ends, or the rest of the tap lands on whatever was under the list.
let pressingSuggestion = false;
document.addEventListener("pointerup", (e) => {
  const t = /** @type {any} */ (e.target);
  if (!t.closest || !t.closest(".suggestions")) pressingSuggestion = false;
});
document.addEventListener("pointercancel", () => (pressingSuggestion = false));

/**
 * The suggestion list under a guess box. Suggestions show once enough is typed (match.js);
 * ↑ ↓ move, Enter or a tap picks, Escape closes.
 * @param {object} opts
 * @param {HTMLInputElement} opts.input
 * @param {HTMLElement} opts.list            the <ul class="suggestions"> under the box
 * @param {() => Option[]} opts.options      what can be suggested
 * @param {(o: Option) => void} opts.onPick  a suggestion was picked
 * @param {() => void} opts.onEnter          Enter with no suggestion showing
 * @param {string} [opts.empty]              shown when nothing matches (otherwise the list just closes)
 */
function suggestBox({ input, list, options, onPick, onEnter, empty }) {
  /** @type {Option[]} */
  let items = [];
  let active = -1;

  function hide() {
    list.classList.add("hidden");
    items = [];
    active = -1;
  }

  function paint() {
    [...list.children].forEach((li, i) => li.classList.toggle("active", i === active));
    const el = list.children[active];
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  function pick(/** @type {Option} */ o) {
    hide();
    onPick(o);
  }

  function update() {
    const typed = input.value;
    hide();
    if (!enoughTyped(typed)) return;
    items = searchOptions(options(), typed);
    active = items.length ? 0 : -1;
    if (!items.length && !empty) return;
    list.innerHTML = items.length ? "" : `<li class="empty">${escapeHtml(empty)}</li>`;
    const words = foldChars(typed.trim()).split(/\s+/).filter(Boolean);
    items.forEach((o) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      if (o.round) li.classList.add("round");
      li.innerHTML = optionIcon(o) +
        `<div><div class="s-title">${highlight(o.label, words)}</div>` +
        (o.sub ? `<div class="s-artist">${highlight(o.sub, words)}</div>` : "") + `</div>`;
      // Pick on click, not on touch-down: the list would close under the finger and the
      // rest of the tap would land on whatever is underneath (often the Send button).
      li.addEventListener("pointerdown", (e) => { e.preventDefault(); pressingSuggestion = true; });
      li.addEventListener("mousedown", (e) => e.preventDefault());   // keeps the focus in the box
      li.addEventListener("click", (e) => { e.preventDefault(); pressingSuggestion = false; pick(o); });
      list.appendChild(li);
    });
    paint();
    list.classList.remove("hidden");
  }

  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", () => setTimeout(() => { if (!pressingSuggestion && document.activeElement !== input) hide(); }, 150));
  input.addEventListener("keydown", (e) => {
    const n = items.length;
    if (e.key === "ArrowDown" && n) { e.preventDefault(); active = (active + 1) % n; paint(); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); active = (active - 1 + n) % n; paint(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (n && active >= 0) pick(items[active]);
      else onEnter();
    } else if (e.key === "Escape") hide();
  });

  return {
    hide,
    /** The highlighted suggestion, if the list is showing. */
    active: () => (items.length && active >= 0 ? items[active] : null),
  };
}
