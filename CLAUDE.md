# ONE voice (ChatGPT) — Chrome extension

MV3 extension, no build step. User-facing behaviour is in `README.md`.

## Files

- `background.js` — hotkeys (`1-plain`, `2-grammar`; the stop key picks the mode), finds the ChatGPT window (installed app > popup > tab), restores/raises it on every press, never minimizes; when none is open it shows a notification (an unpacked extension can't launch an installed web app: `management.installReplacementWebApp` requires a Web Store install). Media pause/resume, clipboard via the offscreen page.
- `content.js` — runs in ChatGPT: clicks mic, then ■ in the recording bar `✕ ~~~ ■ ↑` (see `findStop`), reads the transcript, for grammar types the `@mention`, picks the row under "Custom GPTs", sends, finds your message by its text and the answer's Copy button after it (row with 👍/👎-type labels, never the row with Edit), presses it.
- `page-hook.js` — MAIN-world script: reports the text ChatGPT's own Copy writes (`navigator.clipboard`), so the exact answer is copied even without focus.
- `offscreen.html/js` — clipboard writer (works without window focus).
- `options.html/js` — popup settings: mention, max duration, media pausing; lists current hotkeys; shows the last problem (`storage.local.lastIssue`) with Copy details.
- `sync-to-chromeos.sh` — copies the extension to ChromeOS My files › shared-with-linux (that folder is shared with Linux; `/mnt/chromeos/MyFiles/shared-with-linux`); Chrome loads it from there so it survives restarts.

## Rules

- ChatGPT controls are found by labels/text, never by CSS classes. When a step can't match, `report()` stores what it saw (buttons / HTML) as `lastIssue`; the owner sends **Copy details** from the popup.
- No `"global": true` on commands: ChromeOS hides and ignores global extension shortcuts, and a command marked global never fires there, not even inside Chrome.
- Raw transcript is always copied before any GPT step.
- ChatGPT's markup has no stable `data-testid` / message-role attributes (late 2026): find things by labels, text and document order only.
- No test suite; after changes run `node --check *.js`, then `./sync-to-chromeos.sh` and the owner reloads the extension.
