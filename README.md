# ONE voice (ChatGPT)

Global-hotkey voice-to-text through ChatGPT's own browser dictation. Press a hotkey, speak, press again — the result lands in your clipboard. No API keys, no OpenAI bill: it drives the ChatGPT page you're already logged in to.

Companion to [`kaikisegfault/one-voice`](https://github.com/kaikisegfault/one-voice) (the VS Code / Whisper-API edition).

## Two modes

| Default key | Mode | Clipboard gets |
|---|---|---|
| `Ctrl+Shift+1` | **Plain** | Your words exactly as ChatGPT transcribed them. Nothing is sent. |
| `Ctrl+Shift+2` | **Grammar** | The whole answer of your `@grammar` GPT, as its Copy button gives it. |

- Press either key to start; the key you **stop** with decides the mode. So you can start talking and decide at the end.
- Grammar: after you stop, the extension types `@grammar` in ChatGPT, picks the GPT listed under **Custom GPTs** (not Plugins), adds your words, sends, waits for the answer and presses the answer's Copy button (the one next to 👍 👎, never the one next to Edit on your message). The raw text is copied first, so if anything fails you still have your dictation.
- Pressing a key while it's waiting for the answer cancels.
- Every press brings the ChatGPT app window into view: restored if minimized, raised if behind. Its size and position stay; nothing minimizes it. If it's closed, a notification asks you to open it (Chrome lets only Web Store extensions launch an installed app), so keep it open or minimized.
- In the recording bar `✕ ~~~ ■ ↑` the stop press clicks **■** (text into the input, nothing sent yet), never ✕ or ↑.
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
- Install ChatGPT as an app (⋮ → **Install ChatGPT…**) and keep its window open or minimized. It's preferred over ChatGPT tabs in normal windows, which are used only when the app is closed.

Microphone choice is Chrome's default input: ChromeOS Settings → Device → Audio → Input, or `chrome://settings/content/microphone`.

## Settings

Extension icon → popup:

- **GPT to mention** *(default `@grammar`)* — what Grammar types in ChatGPT.
- **Max recording duration** *(default 600 s, 10–3600)* — auto-stops at this limit, in the mode you started with.
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

- Makes no network requests of its own; your audio goes to OpenAI exactly as when you click the mic yourself.
- Host access: `chatgpt.com` and `chat.openai.com` only, plus `*.youtube.com` / `*.spotify.com` only if you switch on media pausing (switching it off removes them).
- Permissions: `storage` (settings), `scripting` + `tabs` (find and raise the ChatGPT window), `notifications` (tell you when the ChatGPT app is closed), `alarms` (media safety-resume), `offscreen` + `clipboardWrite` (copy even when the ChatGPT window has no focus). A small page script (`page-hook.js`) only reports the text ChatGPT's Copy button writes.

## License

MIT — see [LICENSE](LICENSE). Part of the [ONE Ecosystem](https://expl.one).
