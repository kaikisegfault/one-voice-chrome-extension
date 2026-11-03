const $ = (id) => document.getElementById(id);
const MEDIA_ORIGINS = ['*://*.youtube.com/*', '*://*.spotify.com/*'];
const DEFAULTS = { maxDuration: 600, pauseMedia: false, mention: '@grammar' };

async function refreshPauseMediaStatus() {
  const hasPerm = await chrome.permissions.contains({ origins: MEDIA_ORIGINS });
  const el = $('pauseMediaStatus');
  if ($('pauseMedia').checked && !hasPerm) {
    el.textContent = 'Permission not granted — feature inactive. Re-check the box to request it.';
    el.style.color = '#cf222e';
  } else if ($('pauseMedia').checked) {
    el.textContent = 'Active: YouTube + Spotify tabs pause while recording.';
    el.style.color = '#1f883d';
  } else {
    el.textContent = '';
  }
}

async function showKeys() {
  const table = $('keys');
  table.textContent = '';
  for (const c of (await chrome.commands.getAll()).filter(c => c.description)) {
    const tr = table.insertRow();
    const key = document.createElement('kbd');
    key.textContent = c.shortcut || 'not set';
    tr.insertCell().append(key);
    tr.insertCell().textContent = c.description;
  }
}

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  $('maxDuration').value = cfg.maxDuration;
  $('mention').value = cfg.mention;
  $('pauseMedia').checked = !!cfg.pauseMedia;
  refreshPauseMediaStatus();
  showKeys();
  showIssue();
}

async function save() {
  const maxDuration = Math.max(10, Math.min(3600, parseInt($('maxDuration').value, 10) || 600));
  let mention = $('mention').value.trim() || DEFAULTS.mention;
  if (!mention.startsWith('@')) mention = '@' + mention;
  let pauseMedia = $('pauseMedia').checked;

  if (pauseMedia) {
    if (!(await chrome.permissions.contains({ origins: MEDIA_ORIGINS }))) {
      if (!(await chrome.permissions.request({ origins: MEDIA_ORIGINS }))) {
        pauseMedia = false;
        $('pauseMedia').checked = false;
      }
    }
  } else {
    try { await chrome.permissions.remove({ origins: MEDIA_ORIGINS }); } catch (e) {}
  }

  await chrome.storage.sync.set({ maxDuration, mention, pauseMedia });
  $('maxDuration').value = maxDuration;
  $('mention').value = mention;
  $('status').textContent = 'Saved';
  setTimeout(() => { $('status').textContent = ''; }, 1500);
  refreshPauseMediaStatus();
}

async function showIssue() {
  const { lastIssue } = await chrome.storage.local.get('lastIssue');
  $('issueButtons').hidden = !lastIssue;
  $('issueText').textContent = lastIssue
    ? `${new Date(lastIssue.at).toLocaleString()}: ${lastIssue.msg}`
    : 'None so far.';
}

$('copyIssue').addEventListener('click', async () => {
  const { lastIssue } = await chrome.storage.local.get('lastIssue');
  await navigator.clipboard.writeText(JSON.stringify(lastIssue, null, 1));
  $('copyIssue').textContent = 'Copied';
});
$('clearIssue').addEventListener('click', async () => {
  await chrome.storage.local.remove('lastIssue');
  showIssue();
});
$('save').addEventListener('click', save);
$('pauseMedia').addEventListener('change', refreshPauseMediaStatus);
$('shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

load();
