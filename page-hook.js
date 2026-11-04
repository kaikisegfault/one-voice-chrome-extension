// Runs in the ChatGPT page itself. Reports the text ChatGPT's own Copy button writes, so the extension
// can put exactly that in the clipboard. When the extension presses Copy it first arms this hook:
// that one write is then reported and skipped, since the page can't write without focus and would
// show "couldn't copy"; the extension writes the clipboard itself.
(() => {
  if (window.__oneVoiceHook === 2) return;
  window.__oneVoiceHook = 2;
  let armedUntil = 0;
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__oneVoice === 'arm') armedUntil = Date.now() + 2000;
  });
  const takeArm = () => {
    const armed = Date.now() < armedUntil;
    armedUntil = 0;
    return armed;
  };
  const post = (text) => { try { window.postMessage({ __oneVoice: 'copied', text: String(text) }, '*'); } catch (e) {} };
  const plainText = async (items) => {
    for (const item of items || []) {
      if (item.types && item.types.includes('text/plain')) return (await item.getType('text/plain')).text();
    }
    return null;
  };
  const cb = navigator.clipboard;
  if (cb && cb.writeText) {
    const writeText = cb.writeText.bind(cb);
    cb.writeText = (text) => {
      post(text);
      return takeArm() ? Promise.resolve() : writeText(text);
    };
  }
  if (cb && cb.write) {
    const write = cb.write.bind(cb);
    cb.write = (items) => {
      const armed = takeArm();
      const text = plainText(items).then(t => { if (t !== null) post(t); }).catch(() => {});
      return armed ? text.then(() => undefined) : write(items);
    };
  }
  window.addEventListener('copy', (e) => {
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text) post(text);
  });
})();
