// Clipboard writer: an offscreen page can copy without any window having focus.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'copy') return;
  const buf = document.getElementById('buf');
  buf.value = String(msg.text || '');
  buf.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  buf.value = '';
  sendResponse({ ok });
});
