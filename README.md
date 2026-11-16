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

1. Paste a public Deezer playlist or album link, e.g. `https://www.deezer.com/playlist/1234567`.
   Short share links (`link.deezer.com/...`) don't work. Open them in the browser first and copy the full address.
2. Add players or teams.
3. Pick the difficulty, start position and number of rounds, then press **Start game**.
4. Each round: **Play** a short clip. If nobody gets it, press **Hear more** for a longer clip.
   Fewer seconds heard means more points.
5. Type what people shout into the guess box. Suggestions show the full title, artist and album cover.
   - A wrong guess is listed and the round goes on.
   - A correct guess reveals the song: tap whoever got it, or **Skip song** to give no points.
   - **Give up** shows the answer with no points.

Keyboard (outside the guess box): `Space` play / hear more · `R` give up · `N` skip / next.

Use the volume slider in the game header to set the level (remembered between games).
On iPhone and iPad, browsers don't let web pages change volume, so use the phone's buttons there.

## Solo mode

Pick **Solo** in setup (no players needed). Each round:

1. **Play** the clip, then start typing a song or artist name.
2. Suggestions from the playlist appear with the full title, artist and album cover.
   Use the arrow keys and Enter, or tap one.
3. A wrong guess or **Skip** unlocks a longer clip. Run out of clips (or **Give up**) and the answer is revealed.

You score more points the fewer seconds you needed, and the sidebar tracks points, correct answers and your streak.

## Notes

- No account or login needed. Only public data and 30-second previews are used.
- Audio is never downloaded or stored. It plays straight from Deezer.
- Songs without a preview in your country are skipped automatically.
- Settings, players and the playlist link are remembered in your browser.
