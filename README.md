# Guess the Song

A small party game: it plays short clips from Deezer's public 30-second song previews,
and you try to name the song before the others.

## Run it

Just open `index.html` in your browser (double-click it).

Or serve it locally, which also lets other devices on your Wi-Fi open it:

```bash
cd music-guess
python3 -m http.server 8000
# then open http://localhost:8000
```

## How to play

1. Paste a public Deezer playlist or album link, e.g. `https://www.deezer.com/playlist/1234567`, and press **Add**.
   Short share links (`link.deezer.com/...`) don't work. Open them in the browser first and copy the full address.
   Add as many playlists as you like. Each one shows how many songs the game takes from it. The **Rounds** box is
   split evenly (10 rounds over 3 playlists = 4, 3, 3); change any playlist's number with − / + or by typing, and
   the rounds total follows. **Split evenly** and **Use all songs** reset the numbers. A playlist never gives more
   songs than it has, and a song in two playlists is only played once. The chosen songs are shuffled together.
   When there's more than one playlist, the answer shows which playlist the song came from (on phones too, and in
   the end-of-game list).
2. Add players or teams.
3. Pick the difficulty, start position and number of rounds, then press **Start game**.
4. Each round: **Play** a short clip. If nobody gets it, press **Hear more** for a longer clip.
   Fewer seconds heard means more points.
5. Type what people shout into the **Song title** and **Artist** boxes. Each has its own suggestions
   (titles as plain text so no album cover gives the answer away, artists with photos).
   - Suggestions start after 3 letters, match the start of a word only ("hom" finds "Home", "ome" doesn't)
     and show at most 4, so they help with spelling without giving the answer away.
   - Spelling is forgiving across alphabets: `Zori` finds and counts for `Зорі`, `Okean Elzy` (or `Ocean Elzi`)
     for `Океан Ельзи`, and the other way round.
   - Title and artist score separately, both worth the current clip's points.
   - For songs with several artists (featured artists, duos), any one of them counts.
   - A wrong guess is listed and the round goes on.
   - A correct box locks in: tap whoever got it, or **No points**. The round ends when both are solved.
   - **Give up** reveals whatever is still unsolved.
   - Use the **−** / **+** buttons on the scoreboard to correct anyone's score.

Keyboard (outside the guess box): `Space` play / hear more · `R` give up · `N` skip / next.

Use the volume slider in the game header to set the level (remembered between games).
On iPhone and iPad, browsers don't let web pages change volume, so use the phone's buttons there.

## Online buzzer mode

Everyone plays from their own phone. Only the host's computer plays music: share its sound
with the group (for example, screen share with audio in a Discord call).

1. The host picks **Online buzzer**. A room opens with a code, a link and a QR code.
   Each host gets their own code, so several groups can play at once.
2. Friends open the link (or `play.html` and type the code), enter a name and join.
3. The host loads a playlist and presses **Start game**, then **Play** for each clip.
4. Once the clip has started, players press **I know!**. The first one to press gets
   20 seconds to type the title, the artist, or both (with suggestions from the playlist).
   - Each correct part scores the current clip's points. The other part stays open for everyone.
   - A wrong answer (or running out of time) **freezes** that player.
   - **Hear more** plays a longer clip and unfreezes everyone.
   - **Give up** reveals the song. The answer shows on every phone.
   - Players can vote from their phones too. Once more than half of them press **Hear more**,
     the longer clip plays by itself. Once everyone presses **Give up**, the song is revealed.
     Tap again to take a vote back. A vote that passes while someone is answering waits for their answer.
     The host's own buttons work straight away, without a vote.
5. A phone that reloads or loses signal rejoins under the same name and keeps its score.
   The host can remove players from the room list and fix scores with − / +.

How it works: the host's browser is the referee. The host and every phone connect to a small
room server (a free Cloudflare Worker in `worker/`) over an ordinary secure WebSocket, so any network
that can open the website can join. The server only forwards messages between the phones and the host,
one room per code, and only accepts pages from the game's own site. No keys or tokens are in the website.

### Room server

One-time setup:

1. Create a free [Cloudflare](https://dash.cloudflare.com/sign-up) account.
2. Deploy the Worker once from your computer (it opens a browser window to log in):
   ```bash
   cd worker
   npm install
   npx wrangler deploy
   ```
   It prints the Worker's address, like `https://song-quiz-rooms.YOUR-NAME.workers.dev`.
3. Put that address into `ROOM_SERVER` at the top of `net.js`, with `wss://` instead of `https://`.
4. If the site isn't on `https://maxvitvitckiy.github.io`, change `ALLOWED_ORIGINS` in `worker/wrangler.toml`.

After changing anything in `worker/`, run `npx wrangler deploy` there again.

Local testing: run `npm run dev` in `worker/` and serve the site on `localhost`; pages on localhost
use the local room server automatically.

## Solo mode

Pick **Solo** in setup (no players needed). Each round:

1. **Play** the clip, then type in the single box: a song title or an artist. Suggestions show each song
   with its cover and artist, and Latin / Cyrillic spellings find each other (`Zori` finds `Зорі`).
2. Title and artist score separately. Picking a song with the right title but another artist (two songs
   called "Home") still counts the title, and picking any song by the right artist counts the artist.
   Only a guess with nothing new right counts as wrong.
3. A wrong guess or **Skip** unlocks a longer clip. Run out of clips (or **Give up**) and the answer is revealed.

You score more points the fewer seconds you needed, and the sidebar tracks points, correct answers and your streak.

## Notes

- No account or login needed. Only public data and 30-second previews are used.
- Audio is never downloaded or stored. It plays straight from Deezer.
- Songs without a preview in your country are skipped automatically.
- Settings, players and the playlist link are remembered in your browser.
