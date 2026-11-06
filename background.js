const CHATGPT_URL_RE = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//;
const MEDIA_URL_PATTERNS = ['*://*.youtube.com/*', '*://*.spotify.com/*'];
const MODE_BY_COMMAND = { '1-plain': 'plain', '2-grammar': 'grammar' };
const DEFAULTS = { maxDuration: 600, pauseMedia: false, mention: '@grammar', notify: true, raiseWindow: false };
const PAUSED_IDS_KEY = 'pausedTabIds';
const SAFETY_RESUME_MS = 15 * 60 * 1000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- ChatGPT tab ----------

function report(msg, details) {
  console.warn('[ONE voice]', msg, details || '');
  chrome.storage.local.set({ lastIssue: { at: Date.now(), msg, details: details || null } });
}

// The extension's own ChatGPT window: opened minimized when missing, then reused. Your own
// ChatGPT windows and tabs are never touched.
async function ownChatGPTTab() {
  const { ownTabId } = await chrome.storage.session.get('ownTabId');
  if (ownTabId) {
    const t = await chrome.tabs.get(ownTabId).catch(() => null);
    if (t && CHATGPT_URL_RE.test(t.url || t.pendingUrl || '')) return { tab: t, fresh: false };
  }
  const win = await chrome.windows.create({ url: 'https://chatgpt.com/', type: 'popup', state: 'minimized' });
  const tab = win.tabs[0];
  await chrome.storage.session.set({ ownTabId: tab.id });
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});  // Memory Saver keeps it loaded
  return { tab, fresh: true };
}

// Minimized: restore. Behind other windows: raise. Size and position stay as they are.
async function bringToFront(tab) {
  try {
    const w = await chrome.windows.get(tab.windowId);
    await chrome.windows.update(tab.windowId, w.state === 'minimized' ? { state: 'normal', focused: true } : { focused: true });
    if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
  } catch (e) {}
}

// A minimized ChatGPT page gets its timers slowed to once a second, and to once a minute after
// 5 minutes. While a step runs, wake it 4x a second; messages aren't slowed.
let pacer = null;
let pacerEnd = 0;

function startPacer(tabId) {
  stopPacer();
  pacerEnd = Date.now() + 5 * 60 * 1000;
  pacer = setInterval(() => {
    if (Date.now() > pacerEnd) return stopPacer();
    chrome.tabs.sendMessage(tabId, { type: 'tick' }).catch(() => {});
  }, 250);
}

function stopPacer() {
  clearInterval(pacer);
  pacer = null;
}

// While recording, ask the page every 2 s whether ChatGPT's recording is still on (it ends long
// ones by itself); the page then saves the words and records on. Messages, so it runs minimized too.
let watcher = null;

function startWatch(tabId) {
  stopWatch();
  watcher = setInterval(() => chrome.tabs.sendMessage(tabId, { type: 'watch' }).catch(() => {}), 2000);
}

function stopWatch() {
  clearInterval(watcher);
  watcher = null;
}

// Message the content script; inject it when nobody answers (tab open from before install or reload).
// A fresh window gets a few seconds to load first.
async function ask(tabId, msg, waitMs = 0) {
  const end = Date.now() + waitMs;
  for (;;) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (res) return res;
    } catch (e) {}
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['page-hook.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      const res = await chrome.tabs.sendMessage(tabId, msg);
      if (res) return res;
    } catch (e) {}
    if (Date.now() >= end) return null;
    await sleep(300);
  }
}

// ---------- Notifications: recording time, working, copied (visible over every window) ----------

// Each step gets a new notification, so it pops up again even if ChromeOS has already tucked the
// previous one into the tray. Only Recording has a timer, updated in place.
let noteId = null;
let noteSeq = 0;
let tick = null;
let closeTimer = null;

function stopTick() {
  clearInterval(tick);
  tick = null;
}

const clock = (ms) => {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

// One at a time, in order: two steps arriving together must not leave a stale notification behind.
let noteQueue = Promise.resolve();

function notify(...args) {
  noteQueue = noteQueue.then(() => showNote(...args)).catch(e => console.warn('[ONE voice]', e));
  return noteQueue;
}

async function showNote(title, message, { timer = false, since = 0, autoClose = 0, force = false } = {}) {
  stopTick();
  clearTimeout(closeTimer);
  if (!force && !(await chrome.storage.sync.get({ notify: true })).notify) return;
  if (noteId) chrome.notifications.clear(noteId);
  const id = noteId = `one-voice-${++noteSeq}`;
  const t0 = since || Date.now();
  const titleNow = () => (timer ? `${title} ${clock(Date.now() - t0)}` : title);
  await chrome.notifications.create(id, {
    type: 'basic', iconUrl: 'icons/icon-128.png', title: titleNow(), message: message || ' ',
    silent: true, requireInteraction: true, priority: 2
  });
  if (timer) tick = setInterval(() => chrome.notifications.update(id, { title: titleNow() }), 1000);
  if (autoClose) closeTimer = setTimeout(() => chrome.notifications.clear(id), autoClose);
}

let recordingSince = 0;

// The timer counts from the first start, also after ChatGPT ended a long recording and it resumed.
async function noteRecording(extra) {
  const keys = Object.fromEntries((await chrome.commands.getAll()).map(c => [c.name, c.shortcut || 'its key']));
  const stopKeys = `Stop: ${keys['1-plain']} your words · ${keys['2-grammar']} GPT answer`;
  notify('● Recording', extra ? `${extra} ${stopKeys}` : stopKeys, { timer: true, since: recordingSince });
}

function noteDone(msg) {
  const r = msg.result;
  if (msg.cancelled) return notify('Cancelled', 'Nothing more will be copied.', { autoClose: 4000 });
  if (r && r.kind === 'answer') return notify('✓ Copied: GPT answer', `${r.chars} characters · paste with Ctrl+V`, { autoClose: 8000 });
  if (r && !msg.error) return notify('✓ Copied: your words', `${r.chars} characters · paste with Ctrl+V`, { autoClose: 8000 });
  if (r) return notify('Copied your words only', `${msg.error}. Details: extension popup.`, { autoClose: 12000 });
  return notify('Nothing copied', `${msg.error || 'Something went wrong'}. Details: extension popup.`, { autoClose: 12000 });
}

// Clicking a notification shows the extension's ChatGPT window.
chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith('one-voice-')) return;
  const { ownTabId } = await chrome.storage.session.get('ownTabId');
  const tab = ownTabId && await chrome.tabs.get(ownTabId).catch(() => null);
  if (tab) bringToFront(tab);
});

// ---------- Hotkeys ----------

let queue = Promise.resolve();

chrome.commands.onCommand.addListener((command) => {
  const mode = MODE_BY_COMMAND[command];
  if (!mode) return;
  queue = queue.then(() => onHotkey(mode)).catch(e => console.warn('[ONE voice]', e));
});

async function onHotkey(mode) {
  const { tab, fresh } = await ownChatGPTTab();
  if (fresh) notify('Opening ChatGPT…', 'In a minimized window of its own; recording starts when it has loaded.');
  // Left as it is (minimized works); brought forward only if the setting says so.
  if ((await chrome.storage.sync.get({ raiseWindow: false })).raiseWindow) await bringToFront(tab);

  const status = await ask(tab.id, { type: 'status' }, fresh ? 30000 : 3000);
  if (!status) {
    report('ChatGPT page did not answer');
    notify('Nothing happened', 'The ChatGPT page did not load or answer. Press again.', { autoClose: 12000 });
    return;
  }

  if (status.state === 'idle') {
    startPacer(tab.id);
    const [, res] = await Promise.all([pauseMediaTabs(), ask(tab.id, { type: 'start', mode })]);
    stopPacer();
    if (res && res.ok) {
      recordingSince = Date.now();
      noteRecording();
      startWatch(tab.id);
    } else {
      await resumeMediaTabs();  // the content script's 'done' message tells what failed
    }
  } else if (status.state === 'recording' || status.state === 'rolling') {
    stopWatch();
    resumeMediaTabs();
    startPacer(tab.id);
    await ask(tab.id, { type: 'stop', mode });
  } else {
    // Still starting, or waiting for the transcription / GPT answer: a press cancels.
    await ask(tab.id, { type: 'cancel' });
  }
}

// ---------- Clipboard (offscreen document: works even when ChatGPT's window has no focus) ----------

let creatingOffscreen = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Copy dictation results to the clipboard'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function writeClipboard(text) {
  try {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'copy', text });
    return !!(res && res.ok);
  } catch (e) {
    console.warn('[ONE voice] offscreen copy failed:', e.message);
    return false;
  }
}

// ---------- Pause / resume YouTube + Spotify ----------

function pauseMediaInPage() {
  const was = [];
  for (const el of document.querySelectorAll('video, audio')) {
    if (!el.paused) {
      was.push(el);
      try { el.pause(); } catch (e) {}
    }
  }
  window.__oneVoicePausedMedia = (window.__oneVoicePausedMedia || []).concat(was);
  return was.length;
}

function resumeMediaInPage() {
  const list = window.__oneVoicePausedMedia || [];
  window.__oneVoicePausedMedia = [];
  let count = 0;
  for (const el of list) {
    try { el.play(); count++; } catch (e) {}
  }
  return count;
}

async function getPausedIds() {
  const data = await chrome.storage.session.get({ [PAUSED_IDS_KEY]: [] });
  return data[PAUSED_IDS_KEY] || [];
}

async function pauseMediaTabs() {
  const { pauseMedia } = await chrome.storage.sync.get({ pauseMedia: false });
  if (!pauseMedia) return;
  if (!(await chrome.permissions.contains({ origins: MEDIA_URL_PATTERNS }))) {
    console.warn('[ONE voice] pauseMedia enabled but host permission missing — skipping');
    return;
  }
  const tabs = await chrome.tabs.query({ url: MEDIA_URL_PATTERNS, audible: true });
  const results = await Promise.all(tabs.map(t =>
    chrome.scripting.executeScript({ target: { tabId: t.id }, func: pauseMediaInPage })
      .then(res => (res && res[0] && res[0].result > 0 ? t.id : null))
      .catch(() => null)
  ));
  const paused = results.filter(id => id !== null);
  if (!paused.length) return;
  const ids = [...new Set([...(await getPausedIds()), ...paused])];
  await chrome.storage.session.set({ [PAUSED_IDS_KEY]: ids });
  chrome.alarms.create('one-voice-safety-resume', { when: Date.now() + SAFETY_RESUME_MS });
}

async function resumeMediaTabs() {
  const ids = await getPausedIds();
  if (!ids.length) return;
  await chrome.storage.session.set({ [PAUSED_IDS_KEY]: [] });
  chrome.alarms.clear('one-voice-safety-resume');
  await Promise.all(ids.map(tabId =>
    chrome.scripting.executeScript({ target: { tabId }, func: resumeMediaInPage }).catch(() => null)
  ));
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'one-voice-safety-resume') resumeMediaTabs();
});

chrome.permissions.onRemoved.addListener(async (perms) => {
  if ((perms.origins || []).some(o => MEDIA_URL_PATTERNS.includes(o))) {
    await chrome.storage.sync.set({ pauseMedia: false });
  }
});

// ---------- Messages from the content script ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen' || typeof msg.type !== 'string') return;
  if (msg.type === 'copy') {
    writeClipboard(String(msg.text || '')).then(ok => sendResponse({ ok }));
    return true;
  }
  if (msg.type === 'progress') {
    stopTick();
    if (msg.step === 'resumed') {
      stopPacer();
      if (sender.tab) startWatch(sender.tab.id);
      noteRecording(`Go on. ${msg.parts} piece(s) saved and copied (${msg.chars} characters).`);
      return;
    }
    stopWatch();
    if (sender.tab && !pacer) startPacer(sender.tab.id);  // auto-stop at max duration, or ChatGPT ended it
    if (msg.step === 'ended') notify('⏸ Hold on a moment', `ChatGPT ended its recording at ${clock(msg.at || 0)}. Saving your words; recording resumes in a few seconds.`);
    if (msg.step === 'transcribing') notify('Transcribing…', 'Your words go to the clipboard first.');
    if (msg.step === 'answer') notify('GPT is writing the answer…', 'Your words are already in the clipboard.');
  }
  if (msg.type === 'done') {
    stopPacer();
    stopWatch();
    resumeMediaTabs();
    noteDone(msg);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set(await chrome.storage.sync.get(DEFAULTS));
  await chrome.storage.sync.remove('autoSend');
});
