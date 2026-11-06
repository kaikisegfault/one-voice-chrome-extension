# ONE voice (ChatGPT) — Chrome extension

MV3 extension, no build step. User-facing behaviour is in `README.md`.

## Files

- `background.js` — hotkeys (`1-plain`, `2-grammar`; the stop key picks the mode). Uses its own ChatGPT popup window (`storage.session.ownTabId`), created minimized when missing, never touches the owner's ChatGPT app/tabs; leaves the window alone (setting `raiseWindow` restores/raises it); `autoDiscardable: false`. While a step runs, a pacer sends `tick` 4x/s because a minimized page's timers are throttled (1/s, 1/min after 5 min); content.js `sleep()` wakes on them. Notifications (`notify()`, serialized): a new id per step so it pops again even after ChromeOS tucked the last one away, timer only on Recording, updated in place; steps come from content `progress` / `done`. Media pause/resume, clipboard via the offscreen page.
- `content.js` — runs in ChatGPT: clicks mic, then ■ in the recording bar `✕ ~~~ ■ ↑` (see `findStop`), reads the transcript, for grammar types the `@mention`, picks the row under "Custom GPTs", sends, waits until a new answer is complete (more answer rows than before, or a different last answer, stable, no stop button), presses the Copy of the last answer (row with 👍/👎-type labels, never the row with Edit). `lastRun` records button names and counts only.
- `page-hook.js` — MAIN-world script: reports the text ChatGPT's own Copy writes (`navigator.clipboard`), so the exact answer is copied even without focus. content.js posts `arm` before pressing Copy; that one page write is then skipped, so ChatGPT shows no "couldn't copy" error.
- `offscreen.html/js` — clipboard writer (works without window focus).
- `options.html/js` — popup settings: mention, max duration, media pausing; lists current hotkeys; shows the last problem (`storage.local.lastIssue`) with Copy details.
- `sync-to-chromeos.sh` — copies the extension to ChromeOS My files › shared-with-linux (that folder is shared with Linux; `/mnt/chromeos/MyFiles/shared-with-linux`); Chrome loads it from there so it survives restarts.

## Rules

- ChatGPT controls are found by labels/text, never by CSS classes. When a step can't match, `report()` stores what it saw (buttons / HTML) as `lastIssue`; the owner sends **Copy details** from the popup.
- No `"global": true` on commands: ChromeOS hides and ignores global extension shortcuts, and a command marked global never fires there, not even inside Chrome.
- Recording: `startSegment` clicks the mic and must see ■ within 6 s (learned as `S.stopRef`) before the start counts. Stop clicks that ■ (`presentStop`), retries once if it stays. A background `watch` every 2 s detects ChatGPT ending the recording itself → `rollOver` saves/copies the piece and starts a new segment; `S.parts` are joined at the end. A stop with no ■ still waits for the words in the input.
- Raw transcript is always copied before any GPT step.
- Never store the owner's words or answers (storage, logs, `lastIssue`); copy text only in memory on its way to the clipboard.
- ChatGPT's markup has no stable `data-testid` / message-role attributes (late 2026): find things by labels, text and document order only.
- No test suite; after changes run `node --check *.js`, then `./sync-to-chromeos.sh` and the owner reloads the extension.
