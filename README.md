# ONE voice (ChatGPT)

Global-hotkey voice-to-text through ChatGPT's own browser dictation. Press a hotkey, speak, press again — the result lands in your clipboard. No API keys, no OpenAI bill: it drives the ChatGPT page you're already logged in to.

Companion to [`kaikisegfault/one-voice`](https://github.com/kaikisegfault/one-voice) (the VS Code / Whisper-API edition).

## Three modes

| Default key | Mode | Clipboard gets |
|---|---|---|
| `Ctrl+Shift+1` | **Plain** | Your words exactly as ChatGPT transcribed them. Nothing is sent. |
| `Ctrl+Shift+2` | **Grammar** | Answer **1)** of your `@grammar` GPT — the corrected text. |
| `Ctrl+Shift+3` | **Fluent** | Answer **2)** of your `@grammar` GPT — the fluent rewrite. |

- Press any mode key to start; the key you **stop** with decides the mode. So you can start talking and decide at the end.
- Grammar / Fluent: after you stop, the extension types `@grammar` in ChatGPT, picks the GPT listed under **Custom GPTs** (not Plugins), adds your words, sends, waits for the answer, and copies the part you asked for. The raw text is copied first, so if anything fails you still have your dictation.
- Pressing a key while it's waiting for the answer cancels.
- Change keys at `chrome://extensions/shortcuts`; keep the scope **Global** so they work from any window, Linux apps included.

The GPT must answer in the shape `1) corrected … 2) fluent …` — e.g. [Grammar Check + Fluent Alternative](https://chatgpt.com/g/g-aizdZTwve-grammar-check-fluent-alternative). If the answer isn't shaped like that, the whole answer is copied.

## Install (unpacked)

1. `git clone https://github.com/kaikisegfault/one-voice-chrome-extension.git`
2. `chrome://extensions/` → switch on **Developer mode** (the switch on that page, top right).
3. **Load unpacked** → pick the folder that holds `manifest.json`.
4. Check the keys at `chrome://extensions/shortcuts`. Chrome leaves a default key unset if another extension already uses it.

### ChromeOS: keep it after restarts

Chrome drops an unpacked extension loaded from **Linux files** on every restart, because the Linux container isn't running yet when Chrome starts. Load it from **My files** instead:

1. Files app → right-click **Downloads** → **Share with Linux** (once).
2. In the repo: `./sync-to-chromeos.sh` — copies the extension to **My files › Downloads › one-voice-chrome-extension**.
3. **Load unpacked** that folder. After each update, run the script again and press ⟳ on the extension.

## First run

- Open `https://chatgpt.com`, click its mic once by hand and allow microphone access (one-time, per site).
- Leave a normal chat open (not a custom-GPT chat page); minimize it. Installing ChatGPT as an app window (⋮ → **Install ChatGPT…**) keeps it out of your tabs.
- No ChatGPT tab open? The hotkey opens a new one.

Microphone choice is Chrome's default input: ChromeOS Settings → Device → Audio → Input, or `chrome://settings/content/microphone`.

## Settings

Extension icon → popup:

- **GPT to mention** *(default `@grammar`)* — what Grammar / Fluent type in ChatGPT.
- **Max recording duration** *(default 600 s, 10–3600)* — auto-stops at this limit, in the mode you started with.
- **Pause YouTube / Spotify during recording** *(default off)* — pauses playing YouTube, YouTube Music and Spotify web tabs on start, resumes on the stop press. Asks for access to those two sites only. Can't reach native Android apps or Bluetooth audio.

## Troubleshooting

Open DevTools on the ChatGPT tab (F12 → Console); all lines from this extension start with `[ONE voice]`. Other red/yellow lines (`SES_UNCAUGHT_EXCEPTION`, `ScriptProcessorNode deprecated`, …) come from ChatGPT itself.

| Symptom | Fix |
|---|---|
| Hotkey does nothing | Key unset or taken: re-bind at `chrome://extensions/shortcuts`, scope Global. |
| `mic not matched` | Open a normal chat page; if it persists, send the logged button list. |
| `not found under Custom GPTs` / `did not select it` | ChatGPT changed its @ list. The line includes the popup HTML — send it so the matcher can be fixed. Your raw text is already in the clipboard. |
| `recording was cancelled by ChatGPT` | ChatGPT's backend refused (a 403); press again. Signing out and in helps if it repeats. |
| Music didn't resume | It auto-resumes after 15 min as a safety net. |

## Security

- Makes no network requests of its own; your audio goes to OpenAI exactly as when you click the mic yourself.
- Host access: `chatgpt.com` and `chat.openai.com` only, plus `*.youtube.com` / `*.spotify.com` only if you switch on media pausing (switching it off removes them).
- Permissions: `storage` (settings), `scripting` + `tabs` (find, focus and minimize the ChatGPT window), `alarms` (media safety-resume), `offscreen` + `clipboardWrite` (copy even when the ChatGPT window has no focus).

## License

MIT — see [LICENSE](LICENSE). Part of the [ONE Ecosystem](https://expl.one).
