# ONE voice (ChatGPT) — Chrome extension

MV3 extension, no build step. User-facing behaviour is in `README.md`.

## Files

- `background.js` — hotkeys (`1-plain`, `2-grammar`, `3-fluent`), finds/opens/focuses/minimizes the ChatGPT window, media pause/resume, clipboard via the offscreen page.
- `content.js` — runs in ChatGPT: clicks mic / ✓, reads the transcript, for grammar/fluent types the `@mention`, picks the row under "Custom GPTs", sends, waits for the reply, picks answer 1 or 2.
- `offscreen.html/js` — clipboard writer (works without window focus).
- `options.html/js` — popup settings: mention, max duration, media pausing; lists current hotkeys.
- `sync-to-chromeos.sh` — copies the extension to ChromeOS My files › Downloads (needs Downloads shared with Linux); Chrome loads it from there so it survives restarts.

## Rules

- ChatGPT controls are found by labels/text, never by CSS classes. When a step can't match, it logs the HTML it saw (`[ONE voice] …`) so a fix can be made from that line.
- Raw transcript is always copied before any GPT step.
- No test suite; after changes run `node --check *.js`, then `./sync-to-chromeos.sh` and the owner reloads the extension.
