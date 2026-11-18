// Loads the game's browser scripts into Node the way a page does: plain scripts that share one
// scope, in the order the page lists them. Returns the globals asked for.
//
//   const { norm, titleMatches } = load(["match.js", "rules.js"], ["norm", "titleMatches"]);

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function load(files, names) {
  const code = files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
  return new Function(`${code}\n;return { ${names.join(", ")} };`)();
}

module.exports = { load };
