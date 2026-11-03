(() => {
  // Every injection takes over; an older copy (e.g. left behind by an extension reload) goes quiet.
  const GEN = (window.__oneVoiceGen = (window.__oneVoiceGen || 0) + 1);
  const live = () => window.__oneVoiceGen === GEN;
  const LOG = '[ONE voice]';

  const S = {
    state: 'idle', // idle | starting | recording | processing
    run: 0,        // bumped on every start and cancel; steps of an older run stop
    mode: 'plain',
    preText: '',
    startedAt: 0,
    maxTimer: null,
    cfg: { maxDuration: 600, mention: '@grammar' }
  };

  class Cancelled extends Error {}

  // ---------- Finding ChatGPT's controls ----------

  const MIC_POSITIVE = [
    'dictate', 'dictation', 'transcrib',
    'start voice message', 'stop voice message',
    'start recording', 'stop recording'
  ];
  const MIC_NEGATIVE = [
    'voice mode', 'voice chat', 'voice conversation',
    'end voice', 'advanced voice', 'live voice',
    'speech mode', 'headphones'
  ];
  const CONFIRM_POSITIVE = [
    'send voice', 'submit voice',
    'confirm voice', 'confirm recording',
    'finish recording', 'done recording', 'send recording',
    'submit', 'confirm', 'done', 'finish'
  ];
  const CONFIRM_NEGATIVE = [
    'cancel', 'discard', 'delete', 'close',
    'stop recording', 'abort', 'trash', 'remove'
  ];
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
    const text = (btn.innerText || btn.textContent || '').toLowerCase();
    return `${label} | ${testid} | ${title} | ${text}`;
  }

  function composerScope() {
    const composer = findComposer();
    if (!composer) return document;
    return composer.closest('form') || composer.parentElement?.closest('div') || document;
  }

  function rankButtons(positives, negatives, bonus) {
    const buttons = Array.from(composerScope().querySelectorAll('button'));
    const ranked = [];
    for (const btn of buttons) {
      const ident = buttonIdentifiers(btn);
      if (!ident.trim() || negatives.some(n => ident.includes(n))) continue;
      let score = 0;
      for (const p of positives) if (ident.includes(p)) score += 10;
      score += bonus(btn, ident);
      if (score > 0) ranked.push({ btn, score, ident });
    }
    ranked.sort((a, b) => b.score - a.score);
    return { best: ranked[0], buttons };
  }

  function findMic(quiet) {
    const { best, buttons } = rankButtons(MIC_POSITIVE, MIC_NEGATIVE,
      (btn, ident) => (/\bmic\b|microphone|\brecord\b/.test(ident) ? 5 : 0));
    if (best) return best.btn;
    if (!quiet) console.warn(LOG, 'mic not matched. Buttons:', buttons.map(buttonIdentifiers).filter(x => x.trim()));
    return null;
  }

  function findConfirm() {
    const { best, buttons } = rankButtons(CONFIRM_POSITIVE, CONFIRM_NEGATIVE, (btn, ident) => {
      let s = /check|tick/.test(ident) ? 5 : 0;
      for (const svg of btn.querySelectorAll('svg')) {
        const n = (svg.getAttribute('aria-label') || svg.getAttribute('data-icon') || '').toLowerCase();
        if (n.includes('check') || n.includes('tick')) s += 3;
      }
      return s;
    });
    if (best) return best.btn;
    console.warn(LOG, 'confirm not matched. Buttons:', buttons.map(buttonIdentifiers).filter(x => x.trim()));
    return null;
  }

  // ---------- Small helpers ----------

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function check(run) {
    if (run !== S.run || !live()) throw new Cancelled();
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

  // Answer n of a "1) … 2) …" reply; '' if the reply isn't shaped like that.
  function pickVersion(body, n) {
    const ol = body.querySelector('ol');
    const items = ol ? ol.querySelectorAll(':scope > li') : [];
    if (items.length >= 2) return (items[n - 1]?.innerText || '').trim();
    const parts = {};
    let cur = null;
    for (const line of (body.innerText || '').split('\n')) {
      const m = line.match(/^\s*(?:\*\*)?(\d)\s*[).:](?:\*\*)?\s*(.*)$/);
      if (m && !(m[1] in parts)) { cur = m[1]; parts[cur] = m[2]; continue; }
      if (cur && line.trim()) parts[cur] += '\n' + line.trim();
    }
    return (parts[n] || '').trim();
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
    const hit = popupTexts(t => t.toLowerCase().includes(query))
      .find(el => heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!hit) return null;
    const row = hit.closest('[role="option"], [role="menuitem"], button, a, li, [tabindex]');
    return { heading, row: row && !row.contains(heading) ? row : hit };
  }

  function dumpMentionPopup(query, why) {
    const hits = popupTexts(t => t.toLowerCase().includes(query) || /custom gpts|plugins/i.test(t));
    let box = hits[0];
    for (let i = 0; box && i < 6; i++) box = box.parentElement;
    console.warn(LOG, `${why} — send this line to fix it. Matches:`, hits.map(el => el.outerHTML.slice(0, 300)),
      'Popup:', (box ? box.outerHTML : '(no popup found)').slice(0, 6000));
  }

  async function selectMention(composer, run) {
    const mention = S.cfg.mention;
    const query = mention.replace(/^@/, '').trim().toLowerCase();
    clearComposer(composer);
    typeText(composer, '@');
    await sleep(60);
    typeText(composer, mention.slice(1));
    const found = await waitFor(() => findMentionOption(query), 5000, 100, run);
    if (!found) {
      dumpMentionPopup(query, `"${mention}" not found under Custom GPTs`);
      throw new Error('GPT not found in the @ list');
    }
    await realisticClick(found.row, { focus: false });
    const closed = await waitFor(() => !visible(found.heading), 1500, 100, run);
    if (!closed || composerText().trim() === mention) {
      dumpMentionPopup(query, 'clicking the GPT row did not select it');
      throw new Error('could not select the GPT');
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
    if (!sendBtn) throw new Error('send button not ready');
    const seenUser = snapshot('user');
    const seenBot = snapshot('assistant');
    await realisticClick(sendBtn);
    if (!(await waitFor(() => newest('user', seenUser), 5000, 100, run))) throw new Error('message was not sent');
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
    throw new Error('no transcription captured');
  }

  function finish(run, err) {
    if (err instanceof Cancelled || run !== S.run) return;
    if (err) console.warn(LOG, err.message);
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
      const mic = await waitFor(() => findMic(true), 10000, 200, run);
      if (!mic) {
        findMic(false);
        throw new Error('start aborted: no mic button');
      }
      S.preText = composerText();
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
      const confirm = findConfirm();
      if (!confirm) throw new Error('recording was cancelled by ChatGPT (no ✓ button)');
      await realisticClick(confirm);
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
          console.warn(LOG, `answer ${n} not found, copying the whole reply`);
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
    if (!live() || !msg || msg.target === 'offscreen') return;
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
