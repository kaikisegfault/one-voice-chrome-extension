(() => {
  // One live copy per page. A copy orphaned by an extension reload doesn't answer, so a new one starts.
  const PING = 'one-voice-ping-' + chrome.runtime.id;
  const root = document.documentElement;
  root.removeAttribute('data-one-voice-alive');
  document.dispatchEvent(new Event(PING));
  const taken = root.hasAttribute('data-one-voice-alive');
  root.removeAttribute('data-one-voice-alive');
  if (taken) return;
  document.addEventListener(PING, () => {
    try { if (chrome.runtime.id) root.setAttribute('data-one-voice-alive', ''); } catch (e) {}
  });

  const LOG = '[ONE voice]';

  const S = {
    state: 'idle', // idle | starting | recording | processing
    run: 0,        // bumped on every start and cancel; steps of an older run stop
    mode: 'plain',
    preText: '',
    startedAt: 0,
    maxTimer: null,
    scope: null,        // composer area, kept from before recording (the input is swapped out while recording)
    idleSigs: new Set(), // buttons there before recording
    trailing: null,     // rect of the send / voice button at the far right, never the stop button
    cfg: { maxDuration: 600, mention: '@grammar' }
  };

  class Cancelled extends Error {}

  // ---------- Finding ChatGPT's controls ----------

  const MIC_POSITIVE = [
    'dictate', 'dictation', 'transcrib',
    'start voice message', 'start recording'
  ];
  const MIC_NEGATIVE = [
    'voice mode', 'voice chat', 'voice conversation',
    'end voice', 'advanced voice', 'live voice',
    'speech mode', 'headphones'
  ];
  // Recording bar: [✕ cancel] ~~~waveform~~~ [■ stop → text into the input] [↑ transcribe and send].
  const STOP_NEGATIVE = [
    'cancel', 'discard', 'delete', 'close', 'abort', 'trash', 'remove', 'dismiss',
    'send', 'voice mode', 'voice chat', 'stop streaming', 'stop generating',
    'add', 'attach', 'upload', 'model', 'tools'
  ];
  const STOP_POSITIVE = /\bstop\b|done|finish|confirm|submit|complete|check|tick/;
  const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    'div[contenteditable="true"][data-id="root"]',
    'form textarea',
    'div[contenteditable="true"]'
  ];
  const SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[aria-label*="end message" i]',
    'button[aria-label*="end prompt" i]',
    'form button[type="submit"]'
  ];
  const STOP_STREAMING = 'button[data-testid="stop-button"], button[aria-label*="stop streaming" i], button[aria-label*="stop generating" i]';
  const COPY_BUTTON = 'button[data-testid="copy-turn-action-button"], button[aria-label="Copy" i]';

  const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

  function first(selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  const findComposer = () => first(COMPOSER_SELECTORS);
  const findSend = () => first(SEND_SELECTORS);

  function buttonIdentifiers(btn) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const testid = (btn.getAttribute('data-testid') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
    return `${label} | ${testid} | ${title} | ${text}`;
  }

  // Identifiers plus the icon, so unlabeled icon buttons can be told apart.
  function buttonSig(btn) {
    const svg = btn.querySelector('svg');
    const icon = svg ? (svg.querySelector('use')?.getAttribute('href') || svg.querySelector('path')?.getAttribute('d') || '').slice(0, 60) : '';
    return `${buttonIdentifiers(btn)} | ${icon}`;
  }

  function describeButtons(scope) {
    return Array.from(scope.querySelectorAll('button')).filter(visible).map(b => {
      const r = b.getBoundingClientRect();
      return `${buttonSig(b)} @${Math.round(r.left)},${Math.round(r.top)}`;
    });
  }

  function composerScope() {
    const composer = findComposer();
    if (!composer) return document;
    return composer.closest('form') || composer.parentElement?.closest('div') || document;
  }

  function findMic() {
    const buttons = Array.from(composerScope().querySelectorAll('button')).filter(visible);
    let best = null;
    for (const btn of buttons) {
      const ident = buttonIdentifiers(btn);
      if (MIC_NEGATIVE.some(n => ident.includes(n))) continue;
      let score = 0;
      for (const p of MIC_POSITIVE) if (ident.includes(p)) score += 10;
      if (/\bmic\b|microphone|\brecord\b/.test(ident)) score += 5;
      if (score && (!best || score > best.score)) best = { btn, score };
    }
    return best ? best.btn : null;
  }

  // Remember the composer area before recording starts, to find the stop button later.
  function rememberIdleLayout() {
    S.scope = composerScope();
    const buttons = Array.from(S.scope.querySelectorAll('button')).filter(visible);
    S.idleSigs = new Set(buttons.map(buttonSig));
    let right = null;
    for (const b of buttons) {
      const r = b.getBoundingClientRect();
      if (!right || r.right > right.right) right = r;
    }
    S.trailing = right && right.width ? { x: right.left + right.width / 2, y: right.top + right.height / 2 } : null;
  }

  // The ■ button: not cancel, not send, not at the send button's spot; labelled stop/done or new since
  // recording started; the rightmost wins (✕ is at the left end).
  function findStop() {
    const inScope = S.scope && S.scope.isConnected && S.scope !== document;
    const scope = inScope ? S.scope : composerScope();
    const ranked = [];
    for (const btn of Array.from(scope.querySelectorAll('button')).filter(visible)) {
      const ident = buttonIdentifiers(btn);
      if (STOP_NEGATIVE.some(n => ident.includes(n))) continue;
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (S.trailing && Math.abs(cx - S.trailing.x) < 8 && Math.abs(cy - S.trailing.y) < 8) continue;
      let score = STOP_POSITIVE.test(ident) ? 10 : 0;
      if (inScope && !S.idleSigs.has(buttonSig(btn))) score += 5;
      if (score) ranked.push({ btn, score, right: r.right, sig: buttonSig(btn) });
    }
    ranked.sort((a, b) => b.score - a.score || b.right - a.right);
    if (!ranked.length) return null;
    console.log(LOG, 'stop →', ranked[0].sig);
    return ranked[0].btn;
  }

  // ---------- Small helpers ----------

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function check(run) {
    if (run !== S.run) throw new Cancelled();
  }

  async function waitFor(fn, ms, step, run) {
    const end = Date.now() + ms;
    for (;;) {
      check(run);
      const v = fn();
      if (v) return v;
      if (Date.now() >= end) return null;
      await sleep(step);
    }
  }

  // Last problem, shown in the extension popup so it can be copied without DevTools.
  function report(msg, details) {
    console.warn(LOG, msg, details || '');
    try {
      chrome.storage.local.set({ lastIssue: { at: Date.now(), msg, details: details || null, url: location.href } });
    } catch (e) {}
  }

  function fail(msg, details) {
    const e = new Error(msg);
    e.details = details;
    return e;
  }

  function send(type, payload = {}) {
    try { chrome.runtime.sendMessage({ type, ...payload }); } catch (e) {}
  }

  async function copy(text) {
    let ok = false;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'copy', text });
      ok = !!(res && res.ok);
    } catch (e) {}
    if (!ok) {
      try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {}
    }
    if (ok) console.log(LOG, 'copied', text.length, 'chars');
    else console.warn(LOG, 'clipboard write failed');
    return ok;
  }

  async function realisticClick(el, { focus = true } = {}) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = {
      bubbles: true, cancelable: true, composed: true,
      view: window, clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true
    };
    if (focus) { try { el.focus({ preventScroll: true }); } catch (e) {} }
    el.dispatchEvent(new PointerEvent('pointerover', { ...base, buttons: 0 }));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseover', { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mousemove', { ...base, buttons: 0 }));
    await sleep(20 + Math.random() * 30);
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    await sleep(30 + Math.random() * 40);
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0, detail: 1 }));
  }

  // ---------- Composer editing ----------

  const isTextarea = (el) => 'value' in el && typeof el.value === 'string';

  function composerText() {
    const el = findComposer();
    if (!el) return '';
    return isTextarea(el) ? el.value : (el.innerText || el.textContent || '');
  }

  function selectInside(el, toEnd) {
    el.focus({ preventScroll: true });
    if (isTextarea(el)) {
      const n = el.value.length;
      el.setSelectionRange(toEnd ? n : 0, n);
      return;
    }
    const r = document.createRange();
    r.selectNodeContents(el);
    if (toEnd) r.collapse(false);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function clearComposer(el) {
    selectInside(el, false);
    document.execCommand('delete');
  }

  function typeText(el, text) {
    selectInside(el, true);
    document.execCommand('insertText', false, text);
  }

  // ---------- Chat messages ----------

  const messageKey = (el) => el.getAttribute('data-message-id') || el;

  function snapshot(role) {
    return new Set(Array.from(document.querySelectorAll(`[data-message-author-role="${role}"]`), messageKey));
  }

  function newest(role, seen) {
    const list = document.querySelectorAll(`[data-message-author-role="${role}"]`);
    for (let i = list.length - 1; i >= 0; i--) {
      if (!seen.has(messageKey(list[i]))) return list[i];
    }
    return null;
  }

  function replyBody(msg) {
    const mds = msg.querySelectorAll('.markdown');
    return mds.length ? mds[mds.length - 1] : msg;
  }

  // ---------- Reading answer 1 / 2 out of the reply ----------

  // "1)", "1.", "1:", "(1)", "[1]", "#1", "1 -", "1️⃣", "Option 1:", "Version 2 —", optional "## " / "**".
  const NUM_RE = /^\s*(?:#{1,6}\s+)?[*_]*\s*(?:(?:option|version|variant|answer|alternative)\s*)?[(\[]?\s*#?\s*([1-9])\s*(?:️?⃣|[)\]:]|\.(?!\d)|\s[-–—])[*_]*\s*(?:[-–—:]\s*)?(.*)$/i;
  // "Grammar: …", "**Corrected version** — …", or a heading line "Fluent alternative".
  const LABEL_RE = /^\s*(?:#{1,6}\s+)?[*_]*\s*([a-z][a-z ]{1,38}[a-z])\s*[*_]*\s*(?:(?::|\s[-–—])\s*[*_]*\s*(.*)|$)/i;
  const LABELS = [
    [1, /^(?:grammar(?: check(?:ed)?| fix(?:ed)?| correct(?:ed|ion)?)?|grammatical(?:ly correct(?:ed)?)?(?: version)?|correct(?:ed|ion)?(?: version| text| sentence)?|proofread(?: version)?|fixed(?: version)?)$/],
    [2, /^(?:(?:more )?fluent(?: alternative| version| rewrite)?|natural(?: version| alternative)?|alternative(?: version)?|rewrite|rewritten(?: version)?|rephrased(?: version)?|polished(?: version)?|improved(?: version)?)$/]
  ];
  const QUOTES = { '"': '"', '“': '”', '„': '“', "'": "'", '‘': '’', '«': '»' };

  function labelOf(line) {
    const m = line.match(LABEL_RE);
    if (!m) return null;
    const name = m[1].toLowerCase().replace(/\s+/g, ' ');
    for (const [n, re] of LABELS) if (re.test(name)) return { n, rest: (m[2] || '').trim() };
    return null;
  }

  function clean(s) {
    let t = (s || '').trim();
    const firstLine = t.split('\n')[0];
    const l = labelOf(firstLine);
    if (l) t = (l.rest + t.slice(firstLine.length)).trim();
    t = t.replace(/^[*_]+|[*_]+$/g, '').trim();
    const close = QUOTES[t[0]];
    if (close && t.length > 1 && t[t.length - 1] === close) t = t.slice(1, -1).trim();
    return t;
  }

  // Answers by number: {1: '…', 2: '…'}.
  function parseAnswers(body) {
    const found = {};
    // Markdown "1." becomes an <ol>, and the numbers are then not part of the text.
    for (const ol of body.querySelectorAll('ol')) {
      if (ol.parentElement && ol.parentElement.closest('li')) continue;
      const start = parseInt(ol.getAttribute('start') || '1', 10) || 1;
      ol.querySelectorAll(':scope > li').forEach((li, i) => {
        if (!((start + i) in found)) found[start + i] = li.innerText;
      });
    }
    if (!(found[1] && found[2])) {
      // Numbered or labelled lines; "… end. 2) …" on one line is split first.
      const text = (body.innerText || '').replace(
        /([.!?]["”'’)]?)[ \t]+(?=[(\[]?#?[2-9](?:️?⃣|[)\]:]|\.(?!\d))\s)/g, '$1\n');
      const seg = {};
      let cur = null;
      for (const line of text.split('\n')) {
        const m = line.match(NUM_RE);
        const hit = m ? { n: +m[1], rest: m[2] } : labelOf(line);
        if (hit && !(hit.n in seg)) { cur = hit.n; seg[cur] = hit.rest; continue; }
        if (cur && line.trim()) seg[cur] += '\n' + line.trim();
      }
      for (const n in seg) if (!(n in found)) found[n] = seg[n];
    }
    if (!Object.keys(found).length) {
      // No numbers or labels at all: exactly two paragraphs are taken in order.
      const blocks = Array.from(body.children).map(el => el.innerText.trim()).filter(Boolean);
      if (blocks.length === 2) { found[1] = blocks[0]; found[2] = blocks[1]; }
    }
    for (const n in found) found[n] = clean(found[n]);
    return found;
  }

  // Answer n of the reply; '' if it can't be told apart.
  function pickVersion(body, n) {
    return parseAnswers(body)[n] || '';
  }

  // ---------- The @grammar GPT ----------

  function textNodes(pred) {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (pred(n.nodeValue)) out.push(n.parentElement);
    return out;
  }

  // Elements outside the composer and the chat history.
  function popupTexts(pred) {
    const composer = findComposer();
    return textNodes(pred).filter(el => visible(el)
      && !(composer && composer.contains(el))
      && !el.closest('[data-message-author-role]'));
  }

  // The GPT row listed under "Custom GPTs" (not the one under "Plugins").
  function findMentionOption(query) {
    const heading = popupTexts(t => t.trim().toLowerCase() === 'custom gpts')[0];
    if (!heading) return null;
    const hits = popupTexts(t => t.toLowerCase().includes(query))
      .filter(el => heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    // The closest one: the nearest ancestor of the heading that also holds a match is the list itself.
    let hit = null;
    for (let box = heading.parentElement; box && !hit; box = box.parentElement) {
      hit = hits.find(el => box.contains(el)) || null;
    }
    if (!hit) return null;
    const row = hit.closest('[role="option"], [role="menuitem"], button, a, li, [tabindex]');
    return { heading, row: row && !row.contains(heading) ? row : hit };
  }

  function mentionDetails(query) {
    const hits = popupTexts(t => t.toLowerCase().includes(query) || /custom gpts|plugins/i.test(t));
    let box = hits[0];
    for (let i = 0; box && i < 6; i++) box = box.parentElement;
    return {
      matches: hits.map(el => el.outerHTML.slice(0, 300)),
      popup: (box ? box.outerHTML : '(no popup found)').slice(0, 6000)
    };
  }

  async function selectMention(composer, run) {
    const mention = S.cfg.mention;
    const query = mention.replace(/^@/, '').trim().toLowerCase();
    clearComposer(composer);
    typeText(composer, '@');
    await sleep(60);
    typeText(composer, mention.slice(1));
    const found = await waitFor(() => findMentionOption(query), 5000, 100, run);
    if (!found) throw fail(`"${mention}" not found under Custom GPTs`, mentionDetails(query));
    await realisticClick(found.row, { focus: false });
    const closed = await waitFor(() => !visible(found.heading), 1500, 100, run);
    if (!closed || composerText().trim() === mention) {
      throw fail('clicking the GPT row did not select it', mentionDetails(query));
    }
  }

  async function waitForReply(seen, run) {
    const end = Date.now() + 180000;
    let last = '';
    let stable = 0;
    while (Date.now() < end) {
      await sleep(300);
      check(run);
      const msg = newest('assistant', seen);
      if (!msg) continue;
      const body = replyBody(msg);
      const text = (body.innerText || '').trim();
      if (!text || text !== last || visible(document.querySelector(STOP_STREAMING))) {
        last = text;
        stable = 0;
        continue;
      }
      stable++;
      const turn = msg.closest('article') || msg.parentElement;
      if ((turn && turn.querySelector(COPY_BUTTON)) || stable >= 4) return body;
    }
    throw new Error('no GPT answer within 3 min');
  }

  async function askGPT(text, run) {
    const composer = findComposer();
    if (!composer) throw new Error('composer not found');
    await selectMention(composer, run);
    const cur = composerText();
    typeText(findComposer() || composer, (cur.trim() && !/\s$/.test(cur) ? ' ' : '') + text);

    const sendBtn = await waitFor(() => { const b = findSend(); return b && !b.disabled ? b : null; }, 3000, 100, run);
    if (!sendBtn) throw fail('send button not ready', describeButtons(composerScope()));
    const seenUser = snapshot('user');
    const seenBot = snapshot('assistant');
    await realisticClick(sendBtn);
    if (!(await waitFor(() => newest('user', seenUser), 5000, 100, run))) {
      throw fail('message was not sent', describeButtons(composerScope()));
    }
    return waitForReply(seenBot, run);
  }

  // ---------- Recording ----------

  async function loadConfig() {
    try {
      const c = await chrome.storage.sync.get({ maxDuration: 600, mention: '@grammar' });
      S.cfg.maxDuration = Math.max(10, Math.min(3600, Number(c.maxDuration) || 600));
      const m = String(c.mention || '').trim() || '@grammar';
      S.cfg.mention = m.startsWith('@') ? m : '@' + m;
    } catch (e) {}
  }

  async function waitForTranscript(run, recordedSec) {
    const end = Date.now() + Math.min(90000, 20000 + recordedSec * 100);
    let last = null;
    let stable = 0;
    while (Date.now() < end) {
      await sleep(150);
      check(run);
      const now = composerText();
      if (!now || now === S.preText || now.length <= S.preText.length) continue;
      const cand = (now.startsWith(S.preText) ? now.slice(S.preText.length) : now).trim();
      if (cand && cand === last) {
        if (++stable >= 2) return cand;
      } else {
        last = cand;
        stable = 0;
      }
    }
    throw fail('no transcription arrived in the input', describeButtons(S.scope && S.scope.isConnected ? S.scope : document));
  }

  function finish(run, err) {
    if (err instanceof Cancelled || run !== S.run) return;
    if (err) report(err.message, err.details);
    clearTimeout(S.maxTimer);
    S.state = 'idle';
    send('done');
  }

  async function start(mode) {
    const run = ++S.run;
    S.state = 'starting';
    S.mode = mode;
    try {
      await loadConfig();
      const mic = await waitFor(findMic, 10000, 200, run);
      if (!mic) throw fail('mic button not found', describeButtons(composerScope()));
      S.preText = composerText();
      rememberIdleLayout();
      await realisticClick(mic);
      check(run);
      S.state = 'recording';
      S.startedAt = Date.now();
      S.maxTimer = setTimeout(() => {
        console.log(LOG, 'max duration reached, auto-stopping');
        stop(S.mode, run);
      }, S.cfg.maxDuration * 1000);
      return true;
    } catch (e) {
      finish(run, e);
      return false;
    }
  }

  async function stop(mode, run = S.run) {
    if (S.state !== 'recording' || run !== S.run) return;
    clearTimeout(S.maxTimer);
    S.state = 'processing';
    try {
      const stopBtn = await waitFor(findStop, 1500, 100, run);
      if (!stopBtn) {
        throw fail('stop button not found (or ChatGPT cancelled the recording)',
          describeButtons(S.scope && S.scope.isConnected ? S.scope : document));
      }
      await realisticClick(stopBtn);
      const text = await waitForTranscript(run, (Date.now() - S.startedAt) / 1000);

      // Raw text first, so a failed GPT step still leaves you the dictation.
      const copied = await copy(text);
      if (mode === 'plain') {
        const composer = findComposer();
        if (copied && composer) clearComposer(composer);
      } else {
        const body = await askGPT(text, run);
        const n = mode === 'grammar' ? 1 : 2;
        let result = pickVersion(body, n);
        if (!result) {
          report(`answer ${n} not found, copied the whole reply`, body.outerHTML.slice(0, 6000));
          result = (body.innerText || '').trim();
        }
        if (result) await copy(result);
      }
      finish(run);
    } catch (e) {
      finish(run, e);
    }
  }

  function cancel() {
    S.run++;
    clearTimeout(S.maxTimer);
    S.state = 'idle';
    console.log(LOG, 'cancelled');
    send('done');
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target === 'offscreen') return;
    switch (msg.type) {
      case 'status':
        sendResponse({ state: S.state });
        return;
      case 'start':
        start(msg.mode).then(ok => sendResponse({ ok }));
        return true;
      case 'stop':
        stop(msg.mode);
        sendResponse({ ok: true });
        return;
      case 'cancel':
        cancel();
        sendResponse({ ok: true });
        return;
    }
  });
})();
