const CHATGPT_URL_PATTERNS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
const CHATGPT_URL_RE = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//;
const MEDIA_URL_PATTERNS = ['*://*.youtube.com/*', '*://*.spotify.com/*'];
const MODE_BY_COMMAND = { '1-plain': 'plain', '2-grammar': 'grammar', '3-fluent': 'fluent' };
const DEFAULTS = { maxDuration: 600, pauseMedia: false, mention: '@grammar' };
const PAUSED_IDS_KEY = 'pausedTabIds';
const SAFETY_RESUME_MS = 15 * 60 * 1000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- ChatGPT tab ----------

async function findChatGPTTab() {
  const tabs = await chrome.tabs.query({ url: CHATGPT_URL_PATTERNS });
  if (!tabs.length) return null;
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0];
}

async function openChatGPT() {
  const win = await chrome.windows.create({ url: 'https://chatgpt.com/', focused: true });
  return win.tabs[0];
}

async function focusChatGPT(tab) {
  try {
    await chrome.windows.update(tab.windowId, { focused: true, state: 'normal' });
    await chrome.tabs.update(tab.id, { active: true });
  } catch (e) {}
}

async function minimizeWindow(windowId) {
  try { await chrome.windows.update(windowId, { state: 'minimized' }); } catch (e) {}
}

// Wait until the page is loaded and its manifest content script answers.
async function waitForTabReady(tabId, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return false;
    if (t.status === 'complete' && CHATGPT_URL_RE.test(t.url || '')) {
      try { await chrome.tabs.sendMessage(tabId, { type: 'status' }); return true; } catch (e) {}
    }
    await sleep(250);
  }
  return false;
}

// Message the content script; inject it if nobody answers (tab open from before an extension reload).
async function ask(tabId, msg) {
  try { return await chrome.tabs.sendMessage(tabId, msg); } catch (e) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    console.warn('[ONE voice] content script unreachable:', e.message);
    return null;
  }
}

// ---------- Hotkeys ----------

let queue = Promise.resolve();

chrome.commands.onCommand.addListener((command) => {
  const mode = MODE_BY_COMMAND[command];
  if (!mode) return;
  queue = queue.then(() => onHotkey(mode)).catch(e => console.warn('[ONE voice]', e));
});

async function onHotkey(mode) {
  let tab = await findChatGPTTab();
  const fresh = !tab;
  if (fresh) tab = await openChatGPT();
  else await focusChatGPT(tab);

  if ((fresh || tab.status !== 'complete') && !(await waitForTabReady(tab.id))) {
    console.warn('[ONE voice] ChatGPT tab did not load');
    return;
  }

  const status = await ask(tab.id, { type: 'status' });
  if (!status) return;

  if (status.state === 'idle') {
    const [, res] = await Promise.all([pauseMediaTabs(), ask(tab.id, { type: 'start', mode })]);
    if (!res || !res.ok) await resumeMediaTabs();
  } else if (status.state === 'recording') {
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
  if (msg.type === 'done' && sender.tab) {
    resumeMediaTabs();
    minimizeWindow(sender.tab.windowId);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.sync.set(await chrome.storage.sync.get(DEFAULTS));
  await chrome.storage.sync.remove('autoSend');
});
