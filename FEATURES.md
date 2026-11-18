# What Guess the Song can do

Guess the Song is a music quiz in the browser. It plays a few seconds of a song, and players try to name the
title and the artist. The fewer seconds they needed, the more points they get. Songs come from any public
Deezer playlist or album, using Deezer's free 30-second previews.

This page lists every feature: first what players and hosts can do, then how it works underneath.
For setup steps, see [README.md](README.md). For working on the code, see [CLAUDE.md](CLAUDE.md).

## How it works, in short

```
 Setup                          Each round                                  End
 ─────                          ──────────                                  ───
 add playlists      ─┐          play a short clip ──► guesses ──► answer    final scores
 pick a mode         ├─► start  (2s, then 5s, 10s, 20s if nobody gets it)   every song, who got what
 add players, rules ─┘          shorter clip = more points
```

Three ways to play:

| Mode | Who plays | Where guesses are typed |
|---|---|---|
| **Party** | A group in one room, listening to one speaker | The host types what people shout, then picks who got it |
| **Online buzzer** | Friends on their own phones, anywhere | Each player presses **I know!** on their phone and types the answer |
| **Solo** | One person | One box with suggestions |

---

## Player features

### Choosing the music
- **Any public Deezer playlist or album.** Paste its link, or just its number.
- **Several playlists in one game.** Their songs are shuffled together.
- **Choose how many songs come from each playlist.** The number of rounds is split evenly by default
  (10 rounds over 3 playlists = 4, 3, 3). Change any playlist's number with − / + or by typing, and the total follows.
- **Split evenly** and **Use all songs** buttons.
- **A song that's in two playlists plays only once.**
- **Shows which playlist a song came from** when the answer is revealed and on the end screen, when there's more than one playlist.
- **Clear messages for links that don't work**, like Deezer's short share links (it explains how to get the full link)
  or a private playlist.
- **Songs without a preview are skipped**, for example songs that can't play in your country.

### Settings
- **Difficulty**, set by the clip lengths:
  - **Hard:** 1s → 3s → 7s → 15s
  - **Normal:** 2s → 5s → 10s → 20s
  - **Easy:** 5s → 10s → 20s
- **Start position:** a random point in the preview (default), or the beginning.
- **Rounds:** 1 to 999.
- **Remembered between visits:** playlists and their song counts, players, difficulty, start position, rounds and mode.

### Playing a round
- **Play** the clip, **Replay** it, or **Hear more** for the next longer clip.
- **Points depend on how much was heard.** With Normal difficulty: 4 points after 2s, 3 after 5s, 2 after 10s, 1 after 20s.
- **Title and artist score separately**, each worth the current points.
- **Give up** reveals the song.
- **The answer shows with its album cover**, and the whole preview plays from the start.
- **A spinning disc and sound bars** show when music is playing.
- **Volume slider**, remembered between games. iPhones and iPads don't let web pages change the volume,
  so there the page says to use the phone's buttons.

### Guessing and autocomplete
- **Suggestions while typing**, taken from the songs in the game's playlists:
  - **Song titles as plain text**, so an album cover can't give the answer away.
  - **Artists with their photo**, or a round initial when Deezer has no photo.
  - **Solo:** one row per song, with its cover and artist.
- **Suggestions help with spelling without giving the answer away:**
  - They start after 3 letters.
  - They match the start of a word only ("hom" finds "Home", "ome" doesn't).
  - They show at most 4.
- **The typed letters are highlighted** in each suggestion.
- **Keyboard and touch:** ↑ ↓ to move, Enter or a tap to pick, Esc to close. On phones, a tap on a suggestion
  never "falls through" onto the button underneath.
- **Forgiving answers.** These all count:
  - Any capitals, accents or punctuation: "cafe del mar" = "Café del Mar!", "and" = "&".
  - **Either alphabet:** `Zori` = `Зорі`, `Okean Elzy` = `Ocean Elzi` = `Океан Ельзи`, in both directions.
  - **Without the version:** "Home" counts for "Home (Remastered 2011)" or "Song - Radio Edit".
  - **Any one artist** of a song with several: featured artists ("feat."), duos ("A & B"), and every artist Deezer credits.
- **Wrong guesses are listed**, so nobody repeats them.

### Party mode
- **Players or teams** typed in on the setup screen.
- **Separate Song title and Artist boxes.** Enter checks one box; **Guess** checks both.
- **A correct box asks "Who got it?"**: tap the player, or **No points**. If both boxes were right at once, it asks for each.
- **A wrong guess is listed** and the round goes on.
- **−** / **+** next to every score to correct it.
- **Keyboard shortcuts** (outside the guess boxes): **Space** play / hear more, **R** give up, **N** no points / next song.

### Solo mode
- **One box for title or artist.** Picking a song with the right title but a different artist (two songs called
  "Home") still counts the title; any song by the right artist counts the artist.
- **A wrong guess or Skip unlocks the next longer clip.** After the longest clip, the answer is revealed.
- **Sidebar stats:** points, current streak, titles and artists guessed.
- **End screen:** score, titles and artists out of the total, and best streak (both parts right in a row).

### Online buzzer mode: the host
- **A room opens with its own code**, so several groups can play at once. The code has no look-alike characters
  (no 0/O or 1/I).
- **Join link, QR code** and a **Copy link** button, on the setup screen and during the game.
- **List of players who joined**, with a warning sign for anyone disconnected, and **×** to remove a player.
- **Only the host plays the music.** Share it with the group, for example with screen sharing and audio in a Discord call.
- **A "ding" sound when someone buzzes**, so everyone on the stream hears it.
- **Live status:** who is answering and their seconds left, who is frozen, the last guess and its result,
  and the vote counts.
- **The host's Hear more and Give up work straight away**, without a vote.
- **Reloading the host page keeps the room and its code**, and the phones rejoin by themselves.
  (Scores live in the host page, so a reload in the middle of a game starts them again.)
- **−** / **+** to fix any player's score.

### Online buzzer mode: the players' phones
- **Join with the link, the QR code, or by typing the code**, then a name (up to 20 characters).
- **A big I know! button.** It opens once the clip has started. The first player to press gets **20 seconds** to answer,
  with a countdown bar.
- **Title, artist, or both**, with suggestions from the game's playlists. Picking a suggestion only fills the box;
  sending is always its own tap on **Send**.
- **Each correct part scores the current points.** A part someone already got is closed for everyone, and the rest
  stays open.
- **A wrong answer, or running out of time, freezes that player** until the next longer clip.
- **Votes from the phones:**
  - **Hear more** plays the longer clip once more than half of the players vote for it, and unfreezes everyone.
  - **Give up** reveals the song once everyone votes for it.
  - Tap again to take a vote back.
  - A vote that passes while someone is answering waits for their answer.
- **Hear more and Give up are locked while someone is answering**, on the phones and on the host.
- **Every phone shows** the round, the points it's worth, what's already solved and by whom, its own result
  ("✓ Correct title! +4"), the answer with cover and playlist, and the live scoreboard.
- **Reconnects by itself.** A phone that switches network or loses signal rejoins under the same name and keeps
  its score. After a reload, the name and code are filled in: one tap on **Join** brings the player back with
  their score. Nobody else can take a name while its phone is still connected.
- **The screen stays on** during the game, and the phone **vibrates** on a buzz and when it's your turn.
- **Space** buzzes on a phone or laptop with a keyboard.
- **Leave** button.

### End of the game
- **Final scores**, best first.
- **Every song played**, with its playlist and who got the title and the artist, and how many points.
- **Play again** returns to setup with everything kept. In buzzer mode the players stay in the room.

### Privacy
- **No account or login.** Only public Deezer data and 30-second previews.
- **Audio is never downloaded or stored.** It plays straight from Deezer.
- **No keys or tokens in the website.**

---

## Technical features

### A website with no build step
- **Plain HTML, CSS and JavaScript.** The files in the repository are the website, served by GitHub Pages.
  Opening `index.html` from disk works too.
- **No frameworks and no runtime packages.** The only outside script is the QR code generator, loaded from a CDN
  at a fixed version.
- Each page loads its scripts in order into one shared scope.
  - **Host page:** `match.js` → `rules.js` → `net.js` → `state.js` → `ui.js` → `online.js` → `app.js`
  - **Phone page:** `match.js` → `net.js` → `ui.js` → `player.js`

### Deezer integration
- **JSONP calls to Deezer's public API**, since Deezer doesn't allow normal browser requests from other sites (no CORS).
  Each call has a 15-second timeout and a clear error message.
- **Pages through big playlists**, 100 songs at a time, up to 5,000 songs.
- **Preview links expire**, so if a clip won't load, the game asks Deezer for a fresh link once before giving up.
- **Fetches each song's credited artists** when its round starts, so every featured artist counts as a right answer.

### Answer matching (`match.js`, `rules.js`)
- **Two levels of matching.** Plain: ignores case, accents and punctuation. Loose: also transliterates Cyrillic
  (Ukrainian national system, plus Russian and Belarusian letters) and folds spellings that sound alike
  (kh/h, zh/z, y/i/j, w/v, c/k, doubled letters…). A plain match always ranks above a loose one.
- **Strips versions and features** from titles: anything in brackets, and anything after " - ".
- **Splits artist lists** on `,` `&` `and` `x` `+` `/`.
- **Search keys are computed once per playlist** and cached, so suggestions stay fast on big playlists.
- **Covered by unit tests.**

### Game state (`state.js`)
- **One `state` object** for the host's game, with documented, typed fields.
- **Five phases:** lobby → waiting (round started, clip not played yet) → open → reveal → end.
  Only `setPhase()` changes the phase, and each phase has its own screen.
- **Events instead of direct calls:** `app.js` announces `phase`, `start`, `hearMore` and `scores` on one `game`
  emitter. `online.js` listens and keeps the phones in step, so the game code doesn't need to know about the
  online mode. A listener that fails can't stop the game.

### Online buzzer architecture
- **The host's browser is the referee.** It decides who buzzed first, checks answers, gives points, freezes players
  and counts votes. Phones only send buzzes, guesses and votes, and show what the host sends.
- **Room server: a Cloudflare Worker** (`worker/`) on the free plan. Each room code gets its own **Durable Object**,
  which only forwards messages between the host and the phones. No game logic and no secrets.
- **Ordinary secure WebSockets (`wss://`)**, the same kind of connection as loading a website, so it works on
  any network that can open the site (no peer-to-peer, no special ports).
- **One list of every message** (`net.js`): hello, buzz, guess, vote and pong from phones; welcome, error, kicked,
  ping, options and state from the host. Each has a type and a `Msg.*` builder used by both pages.
- **The host sends the whole state after every change.** Changes made at the same moment are combined into one
  message, so a phone that missed something catches up on the next one.
- **Staying connected:**
  - The host pings every 4 seconds, and a phone that's silent for 13 seconds counts as offline.
  - Phones reconnect by themselves after 2.5 seconds, and watch for a silent host.
  - The host reconnects to the room server by itself.
- **Room ownership:** a random token, kept in the host tab, proves a reloaded host page is the same host.
  A second host can't take over a code that's in use, and an empty room is forgotten after 10 minutes.
- **Protection on the room server:**
  - Only pages from the game's own site may connect (an `Origin` check; `npm run dev` also allows localhost).
  - At most 30 players per room.
  - Each phone can send at most 20 messages a second, and messages have size limits (4 KB from a phone,
    900 KB from the host for the song lists).
- **Protection on the host:** it checks every message from a phone, and trims names to 20 characters and guesses to 120.
- **Close codes** tell a phone exactly what happened: no such room, room full, host left, or removed by the host.
- **Local testing:** on localhost, the pages use a local room server from `npm run dev` in `worker/` automatically.
  `?server=` points a page at any other room server.

### Shared page code (`ui.js`)
- **One suggestion list component** used by both pages: search, highlighting, keyboard, and a touch fix so a tap
  can't land on the button underneath.
- Shared helpers: `$()` for page elements, and `escapeHtml()` so song names can never inject HTML.

### Remembering things
- **Settings, playlists and party players:** browser storage on the host computer.
- **The host's room:** the browser tab's storage, so a reload keeps the same room.
- **A phone's name and identity:** browser storage on the phone, so it can rejoin and keep its score.
- **Volume:** browser storage.

### Checks
- **Unit tests** (`npm test`, Node's built-in test runner) for matching, playlists, choosing songs, scoring and
  game phases. The tests load the browser files exactly the way the pages do.
- **Type checking** (`npm run check`, TypeScript reading the plain JavaScript files). It catches misspelt names, and
  any message field that one page changes and the other doesn't. Each page is checked in its own scope.
- **Development tools only.** `package.json` holds the test and check tools; the website itself needs none of them.
