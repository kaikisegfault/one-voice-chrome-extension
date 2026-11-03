# ONE voice (ChatGPT) — Chrome extension

MV3 extension, no build step. User-facing behaviour is in `README.md`.

## Files

- `background.js` — hotkeys (`1-plain`, `2-grammar`, `3-fluent`), finds the ChatGPT window (app/popup window over normal tabs), restores/raises it on every press or reopens it at the saved bounds, media pause/resume, clipboard via the offscreen page. Never minimizes.
- `content.js` — runs in ChatGPT: clicks mic, then ■ in the recording bar `✕ ~~~ ■ ↑` (see `findStop`), reads the transcript, for grammar/fluent types the `@mention`, picks the row under "Custom GPTs", sends, waits for the reply, picks answer 1 or 2.
- `offscreen.html/js` — clipboard writer (works without window focus).
- `options.html/js` — popup settings: mention, max duration, media pausing; lists current hotkeys; shows the last problem (`storage.local.lastIssue`) with Copy details.
- `sync-to-chromeos.sh` — copies the extension to ChromeOS My files › shared-with-linux (that folder is shared with Linux; `/mnt/chromeos/MyFiles/shared-with-linux`); Chrome loads it from there so it survives restarts.

## Rules

- ChatGPT controls are found by labels/text, never by CSS classes. When a step can't match, `report()` stores what it saw (buttons / HTML) as `lastIssue`; the owner sends **Copy details** from the popup.
- No `"global": true` on commands: ChromeOS hides and ignores global extension shortcuts, and a command marked global never fires there, not even inside Chrome.
- Raw transcript is always copied before any GPT step.
- `parseAnswers` (content.js) splits the reply into answer 1 / 2; when the GPT uses a new shape, add it there.
- No test suite; after changes run `node --check *.js`, then `./sync-to-chromeos.sh` and the owner reloads the extension.
