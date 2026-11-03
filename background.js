const CHATGPT_URL_RE = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//;
const MEDIA_URL_PATTERNS = ['*://*.youtube.com/*', '*://*.spotify.com/*'];
const MODE_BY_COMMAND = { '1-plain': 'plain', '2-grammar': 'grammar' };
const DEFAULTS = { maxDuration: 600, pauseMedia: false, mention: '@grammar', notify: true };
const PAUSED_IDS_KEY = 'pausedTabIds';
const SAFETY_RESUME_MS = 15 * 60 * 1000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- ChatGPT tab ----------

function report(msg, details) {
  console.warn('[ONE voice]', msg, details || '');
  chrome.storage.local.set({ lastIssue: { at: Date.now(), msg, details: details || null } });
}

// The installed ChatGPT app window wins over a popup window, which wins over a ChatGPT tab.
async function findChatGPTTab() {
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['app', 'popup', 'normal'] });
  let best = null;
  for (const w of wins) {
    for (const t of w.tabs || []) {
      if (!CHATGPT_URL_RE.test(t.url || t.pendingUrl || '')) continue;
      const rank = ({ app: 4, popup: 2 }[w.type] || 0) + (t.active ? 1 : 0);
      if (!best || rank > best.rank || (rank === best.rank && (t.lastAccessed || 0) > (best.tab.lastAccessed || 0))) {
        best = { tab: t, rank };
      }
    }
  }
  return best && best.tab;
}

// Minimized: restore. Behind other windows: raise. Size and position stay as they are.
async function bringToFront(tab) {
  try {
    const w = await chrome.windows.get(tab.windowId);
    await chrome.windows.update(tab.windowId, w.state === 'minimized' ? { state: 'normal', focused: true } : { focused: true });
    if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
  } catch (e) {}
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

const NOTE = 'one-voice';
let tick = null;
let closeTimer = null;

function stopTick() {
  clearInterval(tick);
  tick = null;
}

async function notify(title, message, { sticky = false, autoClose = 0, force = false } = {}) {
  if (!force && !(await chrome.storage.sync.get({ notify: true })).notify) return false;
  clearTimeout(closeTimer);
  await chrome.notifications.create(NOTE, {
    type: 'basic', iconUrl: 'icons/icon-128.png', title, message: message || ' ',
    silent: true, requireInteraction: sticky, priority: 1
  });
  if (autoClose) closeTimer = setTimeout(() => chrome.notifications.clear(NOTE), autoClose);
  return true;
}

async function noteRecording() {
  const keys = Object.fromEntries((await chrome.commands.getAll()).map(c => [c.name, c.shortcut || 'its key']));
  const t0 = Date.now();
  const title = () => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    return `● Recording ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };
  stopTick();
  const shown = await notify(title(), `Stop: ${keys['1-plain']} your words · ${keys['2-grammar']} GPT answer`, { sticky: true });
  if (shown) tick = setInterval(() => chrome.notifications.update(NOTE, { title: title() }), 1000);
}

function noteDone(msg) {
  stopTick();
  const r = msg.result;
  if (msg.cancelled) return notify('Cancelled', 'Nothing more will be copied.', { autoClose: 3000 });
  if (r && r.kind === 'answer') return notify('✓ Copied: GPT answer', `${r.chars} characters · paste with Ctrl+V`, { autoClose: 5000 });
  if (r && !msg.error) return notify('✓ Copied: your words', `${r.chars} characters · paste with Ctrl+V`, { autoClose: 5000 });
  if (r) return notify('Copied your words only', `${msg.error}. Details: extension popup.`, { autoClose: 8000 });
  return notify('Nothing copied', `${msg.error || 'Something went wrong'}. Details: extension popup.`, { autoClose: 8000 });
}

chrome.notifications.onClicked.addListener(async (id) => {
  if (id !== NOTE) return;
  const tab = await findChatGPTTab();
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
  const tab = await findChatGPTTab();
  if (!tab) {
    // Chrome lets only Web Store extensions launch an installed web app, so say so instead of
    // opening a separate window.
    notify('ChatGPT app is closed', 'Open it (its shelf icon, or Alt + its shelf number), then press the key again.',
      { autoClose: 8000, force: true });
    report('ChatGPT app is closed');
    return;
  }
  await bringToFront(tab);

  const status = await ask(tab.id, { type: 'status' }, 3000);
  if (!status) {
    report('ChatGPT page did not answer', tab.url || tab.pendingUrl || '');
    return;
  }

  if (status.state === 'idle') {
    const [, res] = await Promise.all([pauseMediaTabs(), ask(tab.id, { type: 'start', mode })]);
    if (res && res.ok) noteRecording();
    else await resumeMediaTabs();
  } else if (status.state === 'recording') {
    stopTick();
    resumeMediaTabs();
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
    if (msg.step === 'transcribing') notify('Transcribing…', 'Your words go to the clipboard first.', { sticky: true });
    if (msg.step === 'answer') notify('Waiting for the GPT answer…', 'Your words are already in the clipboard.', { sticky: true });
  }
  if (msg.type === 'done') {
    resumeMediaTabs();
    noteDone(msg);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set(await chrome.storage.sync.get(DEFAULTS));
  await chrome.storage.sync.remove('autoSend');
});
