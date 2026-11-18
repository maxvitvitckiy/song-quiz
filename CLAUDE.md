# Guess the Song

A party game that plays Deezer's 30-second previews. Plain HTML, CSS and JavaScript with **no build step**:
the files in this folder are the website (GitHub Pages serves `main`, so a push to `main` goes live).
`README.md` is written for players and hosts; keep it in plain language and update it when a feature changes.
`FEATURES.md` lists every feature, for players and technical; add or change its entry with every feature change.

## Files

Host page, `index.html`, loads in this order (one shared scope, no modules):
`match.js` → `rules.js` → `net.js` → `state.js` → `ui.js` → `online.js` → `app.js`

Phone page, `play.html` (online buzzer mode): `match.js` → `net.js` → `ui.js` → `player.js`

| File | What it does |
|---|---|
| `match.js` | Text matching: `norm()`, `loose()` (Cyrillic ↔ Latin, sound-alike spellings), suggestion search |
| `rules.js` | Playlist links, choosing songs, and whether a guess is right. No page code |
| `net.js` | Every host ↔ phone message (list, types, `Msg.*` builders), the room server connection |
| `state.js` | The host's one `state` object, its phases, `setPhase()` and the `game` events. No page code |
| `ui.js` | Shared page helpers: `$()`, `escapeHtml()`, `suggestBox()` (the suggestion list under a guess box) |
| `online.js` | Host side of buzzer mode: the room, buzzes, guesses, votes. Follows the game through `game` events |
| `app.js` | The host page: setup, Deezer loading, audio, rounds, scoring, party and solo modes |
| `player.js` | The phone page |
| `worker/` | Cloudflare Worker room server; it only forwards messages. Deploy with `npx wrangler deploy` there |

## Rules of the codebase

- **Change the phase only with `setPhase()`** (`state.js` lists the phases). Never add flags like `revealed` or `played`.
  Read it with `state.phase`, `roundOver()` or `onGameScreen()`.
- **app.js doesn't call online.js for game events.** It emits on `game` (`"phase"`, `"start"`, `"hearMore"`, `"scores"`),
  and online.js listens. A new thing the phones must hear about is a new event, documented at the top of `state.js`.
- **Messages go through `Msg.*` in `net.js`.** Add or change a message there (the list in the comment and the type),
  then `npm run check` shows every place on both pages that has to follow. Anything from a phone is untrusted: check each field.
- **Game rules go in `rules.js` or `match.js` with a test**, not in app.js. When a guess is judged wrong, write the failing
  case in `tests/rules.test.js` first.
- A new script goes into its page's `<script>` tags **and** into `jsconfig.json` / `jsconfig.play.json`, in the same order.
- No frameworks, bundlers or runtime dependencies. Dev-only tools in `package.json` are fine.

## Checking a change

```bash
npm test         # unit tests (node --test, tests/)
npm run check    # type check both pages (TypeScript on the JS files, no build)
```

Then try it in the browser: `.claude/launch.json` serves the site (`music-guess`, port 8765, or `music-guess-2`, port 8766)
and runs the local room server (`room-server`, port 8787). Pages on localhost use the local room server automatically.
For buzzer mode, open the host page, pick **Online buzzer**, and join from `play.html?room=CODE` in a second tab.
Check every mode the change touches: party, solo and online.

## Git

Pull before starting. Commit and push only when the user asks. Commit messages name the mode or area first,
like the history does ("Buzzer mode: …", "Solo: …").
