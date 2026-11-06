# ONE voice (ChatGPT)

Global-hotkey voice-to-text through ChatGPT's own browser dictation. Press a hotkey, speak, press again — the result lands in your clipboard. No API keys, no OpenAI bill: it drives the ChatGPT page you're already logged in to.

Companion to [`kaikisegfault/one-voice`](https://github.com/kaikisegfault/one-voice) (the VS Code / Whisper-API edition).

## Two modes

| Default key | Mode | Clipboard gets |
|---|---|---|
| `Ctrl+Shift+1` | **Plain** | Your words exactly as ChatGPT transcribed them. Nothing is sent. |
| `Ctrl+Shift+2` | **Grammar** | The whole answer of your `@grammar` GPT, as its Copy button gives it. |

- Press either key to start; the key you **stop** with decides the mode. So you can start talking and decide at the end.
- Grammar: after you stop, the extension types `@grammar` in ChatGPT, picks the GPT listed under **Custom GPTs** (not Plugins), adds your words, sends, waits until the new answer is complete and presses the Copy of the last answer in the chat (the one next to 👍 👎, never the one next to Edit on your message). The raw text is copied first, so if anything fails you still have your dictation.
- Pressing a key while it's waiting for the answer cancels.
- A notification stays up through the whole run, one per step: **● Recording** (with its timer), **Transcribing…**, **GPT is writing the answer…**, then **✓ Copied** (or what failed). It's visible over every window. Clicking it shows the extension's ChatGPT window.
- The extension uses a ChatGPT window of its own: opened minimized on the first press (and again if you close it), then left alone. Your own ChatGPT app or tabs are never touched. (Setting **Bring ChatGPT to the front on each press** restores / raises it.)
- **● Recording** appears only once ChatGPT's recording is confirmed and its **■** button (in the bar `✕ ~~~ ■ ↑`) is known. No ● Recording, no recording: don't talk yet. The stop press clicks that same ■ and checks that it took.
- ChatGPT ends long recordings by itself. The extension checks every 2 s; when that happens it saves and copies the words so far (**⏸ Hold on a moment**), starts recording again within a few seconds, and at the end you get all pieces as one text. If ChatGPT had already ended it when you press stop, the words are still taken from its input.
- The keys only reach Chrome while a Chrome window has focus (ChromeOS has no global extension shortcuts). Closing other windows never affects the extension's window or a recording; a press made in a Linux app is just ignored — click a Chrome window and press again.
- The keys work while any Chrome window has focus: browser tabs, the ChatGPT app window, other installed web apps. ChromeOS doesn't offer **Global** extension shortcuts (Chrome hides that scope and ignores it there), so Linux apps such as VS Code can't trigger them. From a Linux app: pin ChatGPT to the shelf and press `Alt+<its shelf position>` to bring it forward, then the mode key.
- Change keys at `chrome://extensions/shortcuts`.

The GPT used: [Grammar Check + Fluent Alternative](https://chatgpt.com/g/g-aizdZTwve-grammar-check-fluent-alternative). The answer reaches the clipboard even if you click into another window while it's being written.

## Install (unpacked)

1. `git clone https://github.com/kaikisegfault/one-voice-chrome-extension.git`
2. `chrome://extensions/` → switch on **Developer mode** (the switch on that page, top right).
3. **Load unpacked** → pick the folder that holds `manifest.json`.
4. Check the keys at `chrome://extensions/shortcuts`. Chrome leaves a default key unset if another extension or Chrome itself already uses it.

### ChromeOS: keep it after restarts

Chrome drops an unpacked extension loaded from **Linux files** on every restart, because the Linux container isn't running yet when Chrome starts. Load it from **My files** instead:

1. Files app → create **My files › shared-with-linux** → right-click it → **Share with Linux** (once).
2. In the repo: `./sync-to-chromeos.sh` — copies the extension to **My files › shared-with-linux › one-voice-chrome-extension**.
3. **Load unpacked** that folder. After each update, run the script again and press ⟳ on the extension.

Chrome reads the extension straight from My files, so the share is only needed for the copy step: unshare the folder when you're done updating, share it again before the next update. Idle, the share costs next to nothing.

## First run

- Open `https://chatgpt.com`, click its mic once by hand and allow microphone access (one-time, per site).

Microphone choice is Chrome's default input: ChromeOS Settings → Device → Audio → Input, or `chrome://settings/content/microphone`.

## Settings

Extension icon → popup:

- **GPT to mention** *(default `@grammar`)* — what Grammar types in ChatGPT.
- **Max recording duration** *(default 600 s, 10–3600)* — auto-stops at this limit, in the mode you started with.
- **Bring ChatGPT to the front on each press** *(default off)* — off leaves the window alone, minimized or not.
- **Notifications** *(default on)* — the steps above.
- **Pause YouTube / Spotify during recording** *(default off)* — pauses playing YouTube, YouTube Music and Spotify web tabs on start, resumes on the stop press. Asks for access to those two sites only. Can't reach native Android apps or Bluetooth audio.
- **Last problem** — when a step fails, the popup shows what went wrong; **Copy details** copies the buttons / HTML it saw, which is what's needed to fix a matcher.

## Troubleshooting

Start with **Last problem** in the extension popup. The same lines appear in DevTools on the ChatGPT page (Ctrl+Shift+I → Console, prefixed `[ONE voice]`); other red/yellow lines there come from ChatGPT itself.

| Symptom | Fix |
|---|---|
| Hotkey does nothing in a Linux app | Expected on ChromeOS: focus a Chrome window first (e.g. `Alt+<shelf position>` of the ChatGPT app). |
| Hotkey does nothing anywhere | Key unset or taken: re-bind it at `chrome://extensions/shortcuts`. After an update that changed the keys, remove the extension and load it again. |
| `mic button not found` / `stop button not found` | ChatGPT changed its buttons: send **Copy details**. |
| `not found under Custom GPTs` / `did not select it` | ChatGPT changed its @ list: send **Copy details**. Your raw text is already in the clipboard. |
| `no transcription arrived` | ChatGPT's transcription failed (often a 403); press again. Signing out and in helps if it repeats. |
| Music didn't resume | It auto-resumes after 15 min as a safety net. |

## Security

What the extension keeps: your settings (synced with your Google account), and in **Last problem** only button labels / the HTML around a step that failed, never your words or answers (**Clear** deletes it). Your words and the answer pass through memory on their way to the clipboard and aren't stored. The chat itself stays in ChatGPT, as when you type there yourself.

- Makes no network requests of its own; your audio goes to OpenAI exactly as when you click the mic yourself.
- Host access: `chatgpt.com` and `chat.openai.com` only, plus `*.youtube.com` / `*.spotify.com` only if you switch on media pausing (switching it off removes them).
- Permissions: `storage` (settings, Last problem), `notifications` (recording / copied), `scripting` + `tabs` (find and raise the ChatGPT window), `alarms` (media safety-resume), `offscreen` + `clipboardWrite` (copy even when the ChatGPT window has no focus). A small page script (`page-hook.js`) reports the text ChatGPT's Copy button writes; when the extension presses Copy it skips the page's own write (which would fail without focus and show "couldn't copy").

## License

MIT — see [LICENSE](LICENSE). Part of the [ONE Ecosystem](https://expl.one).
