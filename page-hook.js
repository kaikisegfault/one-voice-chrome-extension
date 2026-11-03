// Runs in the ChatGPT page itself: reports the text ChatGPT's own Copy button writes, so the
// extension can put exactly that in the clipboard even if the page's write fails (window not focused).
(() => {
  if (window.__oneVoiceHook) return;
  window.__oneVoiceHook = true;
  const post = (text) => { try { window.postMessage({ __oneVoice: 'copied', text: String(text) }, '*'); } catch (e) {} };
  const cb = navigator.clipboard;
  if (cb && cb.writeText) {
    const writeText = cb.writeText.bind(cb);
    cb.writeText = (text) => { post(text); return writeText(text); };
  }
  if (cb && cb.write) {
    const write = cb.write.bind(cb);
    cb.write = (items) => {
      const result = write(items);
      (async () => {
        for (const item of items || []) {
          if (item.types && item.types.includes('text/plain')) {
            post(await (await item.getType('text/plain')).text());
            return;
          }
        }
      })().catch(() => {});
      return result;
    };
  }
  window.addEventListener('copy', (e) => {
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text) post(text);
  });
})();
