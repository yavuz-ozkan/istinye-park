# İstinye Park

A game by Baba and Noah. It is closing time at the mall, Baba says it is time to go home, and Noah still has seven things to get. Every one costs a short conversation in Turkish, and every wrong answer makes Baba faster.

Play it: https://yavuz-ozkan.github.io/istinye-park/

On an iPad, open the link, then Share, then Add to Home Screen. It opens fullscreen and works offline after the first visit.

## What is in here

- `index.html` is the game.
- `phrases.md` is the phrase list in plain words. `audio/lines.json` is the same list as the game and the voice script read it.
- `audio/` holds the recorded voice clips. `tools/make-audio.ps1` makes missing clips with ElevenLabs, and `tools/pack-audio.ps1` packs them into `audio-pack.js`.
- `build-home-screen.mjs` turns all of it into `docs/`, the installable version that GitHub Pages serves.

## Adding phrases

1. Add a row to `audio/lines.json`.
2. `pwsh -File tools/make-audio.ps1` (needs an ElevenLabs key in `elevenlabs-key.txt` in the folder above this one).
3. `pwsh -File tools/pack-audio.ps1`
4. `node build-home-screen.mjs`

## Notes

This is a family game. It is not affiliated with or endorsed by the real İstinye Park shopping centre, and it uses none of its logos or shop names.

three.js is MIT licensed. Baloo 2 and Josefin Sans are under the SIL Open Font License. The voices were generated with ElevenLabs.
