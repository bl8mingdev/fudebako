import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './styles/app.css';
import './styles/content.css';
import contentCss from './styles/content.css?raw';
import sample from './sample.md?raw';
import { createMarkdown } from './markdown.js';
import { hydrate, resetMermaidTheme } from './hydrate.js';
import * as io from './fileio.js';
import { icon } from './icons.js';
import { APP_NAME, NAME_NOTE, TAGLINE } from './brand.js';
import { version as APP_VERSION } from '../package.json';
import { pickFolder, restoreFolder, forgetFolder, scan, readEntry, createEntry, buildTree } from './folder.js';
import { PALETTES, CATPPUCCIN, paletteColors, paletteVars, strip } from './palettes.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const md = createMarkdown();

const docEl = $('#doc'), stage = $('#stage'), sourceEl = $('#source'), fmtbar = $('#fmtbar');
const KEY_DRAFT = 'fudebako.draft', KEY_SET = 'fudebako.settings';

/* ============================== state ============================== */
const S = {
  src: '',
  saved: '',
  file: { name: 'Untitled.md', path: null, handle: null },
  eol: '\n',
  hist: [], fut: [], lastPush: 0,
  editing: null,      // {s,e,insert,el,card,ta,kind,topEnd}
  mode: 'rich',       // 'rich' | 'source'
  folder: null,       // open folder workspace
  entry: null,        // the folder entry of the current document
  settings: { theme: 'auto', accent: 'vermilion', font: 'serif', width: 'normal', size: 0, palette: 'none', paletteDir: 'normal', ctpFlavor: 'mocha', ctpTint: 'on', customDeep: '#1d3557', customLight: '#e76f51' },
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ============================== source helpers ============================== */
const lines = () => S.src.split('\n');
const isBlank = (l) => l === undefined || l.trim() === '';

function setSrc(next, { coalesce = false } = {}) {
  if (next === S.src) return;
  const now = Date.now();
  if (!coalesce || now - S.lastPush > 1200) {
    S.hist.push(S.src);
    if (S.hist.length > 300) S.hist.shift();
    S.lastPush = now;
  }
  S.fut = [];
  S.src = next;
  changed();
}
let draftT;
function changed() {
  updateDirty();
  clearTimeout(draftT);
  draftT = setTimeout(() => store.set(KEY_DRAFT, draftObj()), 350);
}
const draftObj = () => ({ src: S.src, saved: S.saved, name: S.file.name, path: S.file.path, rel: S.entry?.rel || null, ts: Date.now() });
function updateDirty() {
  const dirty = S.src !== S.saved;
  $('#dirty').classList.toggle('on', dirty);
  if (S.entry && updateDirty.was !== dirty) { updateDirty.was = dirty; renderTree(); }
  document.title = (dirty ? '• ' : '') + S.file.name + ' — Fudebako';
  if (io.isTauri()) window.__TAURI__.window?.getCurrentWindow().setTitle(document.title).catch(() => {});
}

/* ============================== render ============================== */
function render() {
  const sy = stage.scrollTop;
  if (S.src.trim()) {
    docEl.innerHTML = md.render(S.src);
  } else {
    docEl.innerHTML = '<p class="empty-hint">Start writing — click here. <span>Markdown, LaTeX & Mermaid welcome.</span></p>';
  }
  hydrate(docEl).then(refreshOutlineActive);
  stage.scrollTop = sy;
  buildOutline();
  updateStats();
}

/* ============================== block geometry ============================== */
function lnOf(el) {
  const [a, b] = el.dataset.ln.split('-').map(Number);
  return [a, b];
}
// Editable range of an element: trailing blank lines trimmed; a list item stops before its nested list
function rangeOf(el) {
  let [a, b] = lnOf(el);
  if (el.tagName === 'LI') {
    const nested = [...el.children].find((c) => (c.tagName === 'UL' || c.tagName === 'OL') && c.dataset.ln);
    if (nested) b = Math.min(b, lnOf(nested)[0]);
  }
  const L = lines();
  while (b > a + 1 && isBlank(L[b - 1])) b--;
  return [a, b];
}
const editables = () => $$('[data-ln]', docEl).filter((el) => !el.closest('.edit-card'));
function elementForLine(t) {
  let best = null;
  for (const el of editables()) {
    const [a, b] = rangeOf(el);
    if (t >= a && t < b) best = el; // document order => last match is deepest
  }
  return best;
}
function findEl(a, b, tag) {
  const c = editables().filter((el) => el.dataset.ln === `${a}-${b}`);
  return c.find((el) => el.tagName === tag) || c[c.length - 1] || elementForLine(a);
}
function topLevelOf(el) {
  let n = el;
  while (n && n.parentElement !== docEl) n = n.parentElement;
  return n;
}
function topRange(child) {
  const host = child.dataset?.ln ? child : child.querySelector?.('[data-ln]');
  return host ? rangeOf(host) : null;
}
function kindOf(el) {
  if (!el) return 'New block';
  const t = el.tagName, c = el.classList;
  if (/^H[1-6]$/.test(t)) return 'Heading ' + t[1];
  if (c.contains('mermaid-block')) return 'Mermaid';
  if (c.contains('math')) return 'LaTeX';
  if (c.contains('front-matter')) return 'Front matter';
  if (c.contains('html-block')) return 'HTML';
  if (t === 'PRE') return 'Code' + (el.querySelector('code')?.dataset.lang ? ' · ' + el.querySelector('code').dataset.lang : '');
  if (t === 'LI') return c.contains('task-item') ? 'Task' : 'List item';
  if (t === 'TR') return 'Table row';
  if (t === 'TABLE' || t === 'THEAD' || t === 'TBODY') return 'Table';
  if (t === 'BLOCKQUOTE') return el.dataset.alert ? el.dataset.alert : 'Quote';
  if (t === 'HR') return 'Divider';
  if (t === 'DL' || t === 'DT' || t === 'DD') return 'Definition';
  if (t === 'P' && el.parentElement?.tagName === 'LI' && !el.closest('.footnotes')) return kindOf(el.parentElement);
  if (t === 'P') return el.closest('.footnotes') ? 'Footnote' : el.closest('blockquote') ? (el.closest('blockquote').dataset.alert || 'Quote') : 'Paragraph';
  return 'Block';
}

/* ============================== caret mapping ============================== */
function caretFromPoint(el, x, y) {
  let node, off;
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; off = p.offset; } }
  else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; off = r.startOffset; } }
  if (!node || !el.contains(node)) return null;
  if (node.nodeType === 1) { node = node.childNodes[off] || node; off = 0; }
  let prefix = '';
  const walk = (n) => {
    if (n === node) { if (n.nodeType === 3) prefix += n.data.slice(0, off); return true; }
    if (n.nodeType === 3) { prefix += n.data; return false; }
    if (n.nodeType !== 1) return false;
    if (n.classList.contains('math')) { prefix += '$'; if (n.contains(node)) return true; prefix += n.dataset.tex + '$'; return false; }
    if (n.classList.contains('code-head') || n.tagName === 'svg' || n.tagName === 'INPUT') return n.contains(node);
    for (const c of n.childNodes) if (walk(c)) return true;
    return false;
  };
  walk(el);
  return prefix;
}
function mapPrefix(prefix, src) {
  if (prefix == null) return src.length;
  let j = 0;
  for (const ch of prefix) {
    if (/\s/.test(ch)) continue;
    const k = src.indexOf(ch, j);
    if (k === -1 || k - j > 48) continue;
    j = k + 1;
  }
  return j;
}

/* ============================== block editing ============================== */
const PREVIEW_KINDS = /^(LaTeX|Mermaid|Table|HTML)/; // 'Table row' included: previewed inside its table
const NEEDS_PREVIEW = /\$|```\s*mermaid|^\s*\|.*\|\s*$/m;

function startEdit(s, e, { el = null, insert = false, caret = 'end', anchorLine = null } = {}) {
  if (S.mode !== 'rich') return;
  const L = lines();
  const text = insert ? '' : L.slice(s, e).join('\n');
  const kind = insert ? 'New block' : kindOf(el);
  const isRow = el && el.tagName === 'TR', isLi = el && el.tagName === 'LI';
  const wrap = document.createElement(isRow ? 'tr' : isLi ? 'li' : 'div');
  wrap.className = 'edit-wrap';
  const card = document.createElement('div');
  card.className = 'edit-card';
  card.innerHTML = `<div class="edit-meta"><span class="edit-kind">${kind}</span><span class="edit-hint"><kbd>Esc</kbd> done <kbd>↑</kbd><kbd>↓</kbd> move</span></div><textarea class="edit-ta" rows="1" spellcheck="true" autocapitalize="sentences"></textarea><div class="edit-preview md" hidden></div>`;
  if (isRow) { const td = document.createElement('td'); td.colSpan = 99; td.appendChild(card); wrap.appendChild(td); }
  else wrap.appendChild(card);

  if (el) { el.before(wrap); el.classList.add('src-hidden'); }
  else {
    // insert position: after the last top-level block that starts before the anchor line
    const at = anchorLine ?? s;
    let after = null;
    for (const child of docEl.children) {
      if (child.classList.contains('empty-hint')) { child.remove(); break; }
      const r = topRange(child);
      if (r && r[0] < at) after = child;
    }
    if (after) after.after(wrap); else docEl.prepend(wrap);
  }
  const ta = $('.edit-ta', card);
  ta.value = text;
  // e0/len0/topEnd0 remember the geometry of the rendered DOM when editing began,
  // so stale line numbers can be mapped after the text has been synced live.
  let topEnd0 = e;
  if (el) { const top = topLevelOf(el); const r = top && topRange(top); if (r) topEnd0 = Math.max(r[1], e); }
  S.editing = { s, e, insert, el, wrap, card, ta, kind, e0: e, len0: L.length, topEnd0 };
  document.body.classList.add('editing');
  autosize(ta);
  ta.focus({ preventScroll: true });
  const pos = caret === 'end' ? text.length : caret === 'start' ? 0 : Math.max(0, Math.min(text.length, caret));
  ta.setSelectionRange(pos, pos);
  ta.addEventListener('input', onEditInput);
  ta.addEventListener('keydown', onEditKey);
  ta.addEventListener('blur', onEditBlur);
  updatePreview();
  ensureVisible(card);
  fmtbar.classList.add('on');
  positionBars();
}

function ensureVisible(card) {
  requestAnimationFrame(() => {
    const r = card.getBoundingClientRect();
    const vh = window.visualViewport ? window.visualViewport.height : innerHeight;
    if (r.top < 70) stage.scrollBy({ top: r.top - 90, behavior: 'smooth' });
    else if (r.bottom > vh - 90) stage.scrollBy({ top: Math.min(r.bottom - vh + 120, r.top - 90), behavior: 'smooth' });
  });
}
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }

let prevT;
function onEditInput() {
  autosize(S.editing.ta);
  syncEdit();
  clearTimeout(prevT);
  prevT = setTimeout(updatePreview, 220);
}
function updatePreview() {
  const ed = S.editing; if (!ed) return;
  const pv = $('.edit-preview', ed.card);
  const v = ed.ta.value;
  let src = v;
  if (ed.kind === 'Table row') {
    // render the row inside its table: header + delimiter row + this row
    const tbl = ed.el?.closest('table');
    const a = tbl ? lnOf(tbl)[0] : -1;
    src = a >= 0 && ed.s > a + 1 ? lines().slice(a, a + 2).join('\n') + '\n' + v : '';
  }
  const show = src.trim() && (PREVIEW_KINDS.test(ed.kind) || NEEDS_PREVIEW.test(src));
  pv.hidden = !show;
  if (show) { pv.innerHTML = md.render(src); hydrate(pv); }
}
function onEditBlur() {
  // Window switches also blur; only commit when focus really moved inside the app
  setTimeout(() => {
    const ed = S.editing;
    if (!ed || !document.hasFocus()) return;
    if (document.activeElement === ed.ta) return;
    if (ed.card.contains(document.activeElement)) return;
    if (document.activeElement?.closest?.('.fmtbar, .popover, .modal')) return;
    commit();
  }, 0);
}

/** Live write-through: every keystroke lands in the document source (and the autosaved draft),
 *  so an edit can never be lost, whatever way the block is left. */
function syncEdit() {
  const ed = S.editing; if (!ed) return;
  const text = ed.ta.value.replace(/\r\n?/g, '\n');
  const L = lines();
  const ins = text === '' ? [] : text.split('\n');
  if (ed.insert) {
    if (!text.trim()) return;
    const add = [...ins];
    let lead = 0;
    if (ed.s > 0 && !isBlank(L[ed.s - 1])) { add.unshift(''); lead = 1; }
    if (ed.s < L.length && !isBlank(L[ed.s])) add.push('');
    L.splice(ed.s, 0, ...add);
    ed.s += lead; ed.e = ed.s + ins.length; ed.insert = false;
  } else {
    if (L.slice(ed.s, ed.e).join('\n') === text) return;
    L.splice(ed.s, ed.e - ed.s, ...ins);
    ed.e = ed.s + ins.length;
  }
  setSrc(L.join('\n'), { coalesce: true });
  updateStats();
}

/** Write the edit back into the source. Returns geometry info for follow-up navigation. */
function commit({ rerender = true } = {}) {
  const ed = S.editing;
  if (!ed) return null;
  syncEdit();                       // make sure the very last keystrokes are in
  S.editing = null;
  document.body.classList.remove('editing');
  fmtbar.classList.remove('on');
  const text = ed.ta.value.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const L = lines();
  const { s } = ed;
  let changed = false;
  if (!ed.insert) {
    const ins = text === '' ? [] : text.split('\n');
    // tidy: drop trailing empty lines typed at the end of the block
    if (L.slice(s, ed.e).join('\n') !== text) { L.splice(s, ed.e - s, ...ins); ed.e = s + ins.length; changed = true; }
    // block emptied: also remove one of the two blank lines around it
    if (ins.length === 0 && s < L.length && isBlank(L[s]) && (s === 0 || isBlank(L[s - 1]))) { L.splice(s, 1); changed = true; }
    if (changed) {
      if (!L.some((l) => l.trim())) L.length = 0;
      setSrc(L.join('\n'), { coalesce: true });
    }
  }
  if (rerender) render();
  const delta = lines().length - ed.len0;          // total line shift since editing began
  const contentStart = s;
  const contentEnd = ed.insert ? s : s + (text ? text.split('\n').length : 0);
  return { s, e: ed.e0, delta, contentStart, contentEnd, topEnd: Math.max(ed.topEnd0 + delta, contentEnd), adj: (x) => (x >= ed.e0 ? x + delta : x) };
}

function editElement(el, caret) {
  const [a, b] = rangeOf(el);
  const src = lines().slice(a, b).join('\n');
  const pos = typeof caret === 'string' || caret == null ? (caret || 'end') : caret;
  startEdit(a, b, { el, caret: pos });
  return src;
}
function editLineNeighbour(fromLine, dir, caret) {
  const L = lines();
  for (let t = fromLine; t >= 0 && t < L.length; t += dir) {
    if (isBlank(L[t])) continue;
    const el = elementForLine(t);
    if (el) { editElement(el, caret); return true; }
  }
  return false;
}
function newBlockAt(line, anchorLine = line) {
  const L = lines();
  let s = Math.min(line, L.length);
  startEdit(s, s, { insert: true, anchorLine });
}
function newBlockAtEnd() {
  if (S.editing) commit();
  if (!S.src.trim()) { S.src = ''; render(); startEdit(0, 0, { insert: true }); return; }
  const L = lines();
  let s = L.length;
  while (s > 0 && isBlank(L[s - 1])) s--;
  newBlockAt(s);
}

/* ---------- keyboard inside the block editor ---------- */
let charW = 0;
function cols(ta) {
  if (!charW) {
    const c = document.createElement('canvas').getContext('2d');
    const cs = getComputedStyle(ta);
    c.font = `${cs.fontSize} ${cs.fontFamily}`;
    charW = c.measureText('MMMMMMMMMM').width / 10 || 8.6;
  }
  const cs = getComputedStyle(ta);
  return Math.max(10, Math.floor((ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / charW));
}

function onEditKey(e) {
  const ed = S.editing; if (!ed) return;
  const ta = ed.ta, v = ta.value, p = ta.selectionStart, collapsed = p === ta.selectionEnd;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape' || (e.key === 'Enter' && mod)) { e.preventDefault(); commit(); return; }
  if (mod && !e.shiftKey && !e.altKey) {
    const k = e.key.toLowerCase();
    const map = { b: 'bold', i: 'italic', k: 'link', e: 'code' };
    if (map[k]) { e.preventDefault(); FMT[map[k]].run(); return; }
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); FMT.strike.run(); return; }
  const lineStart = v.lastIndexOf('\n', p - 1) + 1;
  const lineEndIdx = v.indexOf('\n', p) === -1 ? v.length : v.indexOf('\n', p);
  const col = p - lineStart;
  if (e.key === 'ArrowUp' && collapsed && !e.shiftKey && !e.altKey && !mod && lineStart === 0) {
    if (p === 0 || Math.floor(col / cols(ta)) === 0) {
      e.preventDefault();
      const info = commit();
      if (!editLineNeighbour(info.s - 1, -1, 'end')) render();
      return;
    }
  }
  if (e.key === 'ArrowDown' && collapsed && !e.shiftKey && !e.altKey && !mod && lineEndIdx === v.length) {
    const c = cols(ta);
    if (p === v.length || Math.floor(col / c) === Math.floor((lineEndIdx - lineStart) / c)) {
      e.preventDefault();
      const info = commit();
      if (!editLineNeighbour(info.contentEnd, 1, 'start')) render();
      return;
    }
  }
  if (e.key === 'Backspace' && v === '' && !ed.insert) {
    e.preventDefault();
    const info = commit();
    editLineNeighbour(info.s - 1, -1, 'end');
    return;
  }
  if (e.key === 'Backspace' && v === '' && ed.insert) {
    e.preventDefault(); const info = commit(); editLineNeighbour(info.s - 1, -1, 'end'); return;
  }
  if (e.key === 'Tab') { e.preventDefault(); indentLines(e.shiftKey ? -1 : 1); return; }
  if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && collapsed && !e.isComposing) handleEnter(e, v, p, lineStart, lineEndIdx);
}

function inFence(v, p) {
  const before = v.slice(0, p).split('\n');
  let open = false, math = false;
  for (const l of before) { if (/^\s*(```|~~~)/.test(l)) open = !open; else if (!open && /^\s*\$\$/.test(l) && !/\$\$.*\$\$/.test(l)) math = !math; }
  return open || math;
}

function handleEnter(e, v, p, lineStart, lineEndIdx) {
  const ed = S.editing;
  if (/^(Code|Mermaid|LaTeX|HTML|Front)/.test(ed.kind) || inFence(v, p)) return;
  const line = v.slice(lineStart, p);
  const rest = v.slice(p, lineEndIdx);
  // Headings are single-line: Enter at the end makes a new block
  if ((/^Heading/.test(ed.kind) || (/^#{1,6}\s/.test(line) && lineStart === 0)) && p === v.length) { e.preventDefault(); exitToNewBlock(); return; }
  // Table rows: Enter adds a fresh row with the same number of cells
  if (ed.kind === 'Table row' && p === lineEndIdx && /^\s*\|/.test(line)) {
    e.preventDefault();
    const n = Math.max(1, (line.match(/\|/g) || []).length - 1);
    insertText('\n|' + '   |'.repeat(n));
    ta().setSelectionRange(ta().selectionStart - 3 * n + 1, ta().selectionStart - 3 * n + 1);
    return;
  }
  // List continuation
  const m = line.match(/^((?:\s*>)*\s*)([-+*]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/);
  if (m && rest.trim() === '') {
    e.preventDefault();
    if (m[5].trim() === '') {
      // empty item: drop the marker; at the end of the block, leave the list
      const t = ta();
      t.setSelectionRange(lineStart, lineEndIdx);
      insertText('');
      if (t.value.slice(lineStart).trim() === '') { t.value = t.value.replace(/\n+$/, ''); exitToNewBlock(); }
      return;
    }
    let marker = m[2];
    if (/^\d/.test(marker)) marker = parseInt(marker, 10) + 1 + marker.slice(-1);
    insertText('\n' + m[1] + marker + m[3] + (m[4] ? '[ ] ' : ''));
    return;
  }
  // Blockquote continuation
  const q = line.match(/^(\s*(?:>\s?)+)(.*)$/);
  if (q && rest.trim() === '') {
    e.preventDefault();
    if (q[2].trim() === '') {
      const t = ta(); t.setSelectionRange(lineStart, lineEndIdx); insertText('');
      if (t.value.slice(lineStart).trim() === '') { t.value = t.value.replace(/\n+$/, ''); exitToNewBlock(); }
      return;
    }
    insertText('\n' + q[1]);
    return;
  }
  // Second Enter on an empty last line → new block below
  if (p === v.length && line.trim() === '' && v.trim() !== '') { e.preventDefault(); ta().value = v.replace(/\n+$/, ''); exitToNewBlock(); }
}
function exitToNewBlock() {
  const info = commit();
  if (!info) return;
  const at = Math.max(info.contentEnd, info.topEnd);
  const L = lines();
  let s = Math.min(at, L.length);
  while (s > 0 && isBlank(L[s - 1])) s--;
  newBlockAt(s);
}

const ta = () => S.editing?.ta;
function insertText(str) {
  const t = ta(); if (!t) return;
  t.focus();
  if (!document.execCommand('insertText', false, str)) t.setRangeText(str, t.selectionStart, t.selectionEnd, 'end');
  if (str === '' && t.selectionStart !== t.selectionEnd) t.setRangeText('', t.selectionStart, t.selectionEnd, 'end');
  onEditInput();
}
function wrapSel(before, after = before, placeholder = 'text') {
  const t = ta(); if (!t) return;
  const a = t.selectionStart, b = t.selectionEnd, v = t.value;
  const sel = v.slice(a, b);
  if (sel && v.slice(a - before.length, a) === before && v.slice(b, b + after.length) === after) {
    t.setSelectionRange(a - before.length, b + after.length); insertText(sel); t.setSelectionRange(a - before.length, b - before.length); return;
  }
  const inner = sel || placeholder;
  insertText(before + inner + after);
  t.setSelectionRange(a + before.length, a + before.length + inner.length);
}
function selectedLines() {
  const t = ta(), v = t.value;
  const a = v.lastIndexOf('\n', t.selectionStart - 1) + 1;
  let b = v.indexOf('\n', t.selectionEnd); if (b === -1) b = v.length;
  return { a, b, text: v.slice(a, b) };
}
function mapLines(fn) {
  const t = ta(); if (!t) return;
  const { a, b, text } = selectedLines();
  const out = text.split('\n').map(fn).join('\n');
  t.setSelectionRange(a, b); insertText(out);
  t.setSelectionRange(a + out.length, a + out.length);
}
function indentLines(dir) {
  mapLines((l) => (dir > 0 ? '  ' + l : l.replace(/^ {1,2}|^\t/, '')));
}
function togglePrefix(re, prefix) {
  const t = ta(); if (!t) return;
  const ls = selectedLines().text.split('\n');
  const all = ls.every((l) => re.test(l) || !l.trim());
  mapLines((l, i) => {
    if (!l.trim() && ls.length > 1) return l;
    const clean = l.replace(/^(\s*)(?:[-+*]\s+\[[ xX]\]\s+|[-+*]\s+|\d+[.)]\s+|>\s?)/, '$1');
    return all ? clean : (typeof prefix === 'function' ? prefix(i) : prefix) + clean.trimStart();
  });
}
function insertBlockSnippet(snippet) {
  const t = ta(); if (!t) return;
  const v = t.value, p = t.selectionStart;
  const before = v.slice(0, p);
  const pre = !before.trim() ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  insertText(pre + snippet);
}

const FMT = {
  heading: { icon: 'heading', label: 'Heading', run() { const t = ta(); if (!t) return; mapLines((l) => { const m = l.match(/^(#{1,6})\s+/); const n = m ? m[1].length : 0; const body = l.replace(/^#{1,6}\s+/, ''); return n >= 3 ? body : '#'.repeat(n + 1) + ' ' + body; }); } },
  bold: { icon: 'bold', label: 'Bold (Ctrl+B)', run: () => wrapSel('**') },
  italic: { icon: 'italic', label: 'Italic (Ctrl+I)', run: () => wrapSel('*') },
  strike: { icon: 'strike', label: 'Strikethrough', run: () => wrapSel('~~') },
  code: { icon: 'code', label: 'Inline code (Ctrl+E)', run: () => wrapSel('`', '`', 'code') },
  link: { icon: 'link', label: 'Link (Ctrl+K)', run() { const t = ta(); if (!t) return; const a = t.selectionStart, sel = t.value.slice(a, t.selectionEnd) || 'link'; insertText(`[${sel}](https://)`); t.setSelectionRange(a + sel.length + 3, a + sel.length + 11); } },
  sep1: null,
  list: { icon: 'list', label: 'Bullet list', run: () => togglePrefix(/^\s*[-+*]\s+(?!\[[ xX]\])/, '- ') },
  task: { icon: 'task', label: 'Task list', run: () => togglePrefix(/^\s*[-+*]\s+\[[ xX]\]/, '- [ ] ') },
  quote: { icon: 'quote', label: 'Quote', run: () => togglePrefix(/^\s*>/, '> ') },
  sep2: null,
  math: { icon: 'sigma', label: 'LaTeX', run() { const t = ta(); if (!t) return; if (t.selectionStart !== t.selectionEnd || /\S/.test(selectedLines().text)) wrapSel('$', '$', 'e^{i\\pi}+1=0'); else insertBlockSnippet('$$\n\\int_0^1 x^2\\,dx = \\tfrac13\n$$'); } },
  table: { icon: 'table', label: 'Table', run: () => insertBlockSnippet('| Column | Column |\n| ------ | ------ |\n| Cell   | Cell   |') },
  mermaid: { icon: 'diagram', label: 'Mermaid diagram', run: () => insertBlockSnippet('```mermaid\nflowchart LR\n  A[Idea] --> B{Ready?}\n  B -->|Yes| C[Ship it]\n  B -->|No| D[Iterate] --> B\n```') },
  sep3: null,
  done: { icon: 'check', label: 'Done (Esc)', run: () => commit(), cls: 'done' },
};
function buildFmtbar() {
  fmtbar.innerHTML = Object.entries(FMT).map(([k, f]) =>
    f ? `<button type="button" class="fb ${f.cls || ''}" data-fmt="${k}" title="${f.label}" aria-label="${f.label}">${icon(f.icon, 18)}</button>` : '<span class="fb-sep"></span>').join('');
  fmtbar.addEventListener('mousedown', (e) => e.preventDefault());
  fmtbar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fmt]'); if (!b) return;
    FMT[b.dataset.fmt].run();
  });
}

/* ---------- task checkboxes ---------- */
function toggleTask(line) {
  const L = lines();
  if (line < 0 || line >= L.length) return;
  const m = L[line].match(/^((?:\s*>)*\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]/);
  if (!m) return;
  L[line] = m[1] + (m[2] === ' ' ? '[x]' : '[ ]') + L[line].slice(m[0].length);
  setSrc(L.join('\n'));
  render();
}

/* ---------- pointer handling ---------- */
function targetInfo(t, x, y) {
  if (t.matches?.('.task-cb')) return { task: +t.dataset.taskLine };
  const el = t.closest?.('[data-ln]');
  if (!el || !docEl.contains(el) || el.closest('.edit-card')) return null;
  const [a, b] = rangeOf(el);
  const src = lines().slice(a, b).join('\n');
  return { a, b, ln: lnOf(el), tag: el.tagName, caret: mapPrefix(caretFromPoint(el, x, y), src) };
}

// While a block is open, a press elsewhere commits it and opens the new target in one move
document.addEventListener('mousedown', (e) => {
  const ed = S.editing;
  if (!ed || e.button !== 0) return;
  if (ed.card.contains(e.target) || e.target.closest('.fmtbar, .popover, .modal, .topbar')) return;
  if (!stage.contains(e.target)) return;
  const info = targetInfo(e.target, e.clientX, e.clientY);
  const onTail = e.target.closest('#tail');
  e.preventDefault();
  const c = commit();
  if (onTail) { newBlockAtEnd(); return; }
  if (!info) return;
  if (info.task != null) { toggleTask(c.adj(info.task)); return; }
  const a = c.adj(info.a), b = c.adj(info.b);
  const el = findEl(c.adj(info.ln[0]), c.adj(info.ln[1]), info.tag);
  if (el) { const [ra, rb] = rangeOf(el); startEdit(ra, rb, { el, caret: ra === a && rb === b ? info.caret : 'end' }); }
}, true);

docEl.addEventListener('click', (e) => {
  if (S.editing) return;
  const t = e.target;
  if (t.closest('.edit-card')) return;
  if (t.matches('.task-cb')) { e.preventDefault(); toggleTask(+t.dataset.taskLine); return; }
  const copyBtn = t.closest('.code-copy');
  if (copyBtn) {
    navigator.clipboard?.writeText(copyBtn.closest('pre').querySelector('code').innerText).then(() => toast('Copied to clipboard'));
    return;
  }
  const a = t.closest('a[href]');
  if (a) {
    const href = a.getAttribute('href');
    e.preventDefault();
    if (href.startsWith('#')) { const target = document.getElementById(decodeURIComponent(href.slice(1))); target?.scrollIntoView({ behavior: 'smooth', block: 'center' }); flash(target); return; }
    if (e.ctrlKey || e.metaKey) { io.openExternal(a.href); return; }
  }
  const sel = getSelection();
  if (sel && !sel.isCollapsed && docEl.contains(sel.anchorNode)) return;
  if (t.closest('.empty-hint')) { newBlockAtEnd(); return; }
  const info = targetInfo(t, e.clientX, e.clientY);
  if (!info) return;
  const el = t.closest('[data-ln]');
  startEdit(info.a, info.b, { el, caret: info.caret });
});
$('#tail').addEventListener('click', () => { if (!S.editing) newBlockAtEnd(); });

// hover highlight of the block that a click would edit
let hot = null;
docEl.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[data-ln]');
  const next = el && !el.closest('.edit-card') ? el : null;
  if (hot === next) return;
  hot?.classList.remove('hot');
  hot = next;
  hot?.classList.add('hot');
});
docEl.addEventListener('pointerleave', () => { hot?.classList.remove('hot'); hot = null; });

function flash(el) { if (!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

/* ============================== outline & stats ============================== */
function buildOutline() {
  const hs = $$('h1,h2,h3,h4', docEl).filter((h) => !h.closest('.edit-card'));
  $('#outline').classList.toggle('has', hs.length > 0);
  $('#outline-list').innerHTML = hs.map((h) =>
    `<a href="#${h.id}" class="ol-${h.tagName[1]}" data-id="${h.id}">${h.textContent.replace(/</g, '&lt;')}</a>`).join('');
  refreshOutlineActive();
}
function refreshOutlineActive() {
  const hs = $$('h1,h2,h3,h4', docEl);
  let cur = hs[0];
  for (const h of hs) if (h.getBoundingClientRect().top < 140) cur = h;
  $$('#outline-list a').forEach((a) => a.classList.toggle('active', cur && a.dataset.id === cur.id));
}
$('#outline-list').addEventListener('click', (e) => {
  const a = e.target.closest('a'); if (!a) return;
  e.preventDefault();
  const h = document.getElementById(a.dataset.id);
  if (h) { stage.scrollTo({ top: stage.scrollTop + h.getBoundingClientRect().top - 84, behavior: 'smooth' }); flash(h); }
  if (innerWidth < 1100) toggleOutline(false);
});
let rafScroll = 0;
stage.addEventListener('scroll', () => {
  $('#topbar').classList.toggle('scrolled', stage.scrollTop > 4);
  if (!rafScroll) rafScroll = requestAnimationFrame(() => { rafScroll = 0; refreshOutlineActive(); });
}, { passive: true });

function countWords(src) {
  const text = src.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_~`|\-[\]()!]/g, ' ');
  const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length;
  const words = (text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).length;
  return { words: words + cjk, chars: src.length };
}
function updateStats() {
  const { words, chars } = countWords(S.src);
  const min = Math.max(1, Math.round(words / 230));
  $('#status').innerHTML = `<span>${words.toLocaleString()} words</span><i></i><span>${chars.toLocaleString()} chars</span><i></i><span>${min} min read</span>${S.mode === 'source' ? '<i></i><span class="st-mode">Source</span>' : ''}`;
}

/* ============================== panels & menus ============================== */
function toggleOutline(force) {
  const on = force ?? !document.body.classList.contains('outline-on');
  document.body.classList.toggle('outline-on', on);
  store.set('fudebako.outline', on);
}
$('#scrim').addEventListener('click', () => { toggleOutline(false); });

function setMode(mode) {
  if (mode === S.mode) return;
  if (S.editing) commit();
  S.mode = mode;
  document.body.classList.toggle('source-mode', mode === 'source');
  sourceEl.hidden = mode !== 'source';
  $('#btn-source').classList.toggle('active', mode === 'source');
  if (mode === 'source') {
    sourceEl.value = S.src;
    autosize(sourceEl);
    sourceEl.focus({ preventScroll: true });
  } else render();
  updateStats();
}
sourceEl.addEventListener('input', () => {
  autosize(sourceEl);
  setSrc(sourceEl.value.replace(/\r\n?/g, '\n'), { coalesce: true });
  updateStats();
});
sourceEl.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
});

const popover = $('#popover');
function openPopover(anchor, html, onClick) {
  popover.innerHTML = html;
  popover.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = popover.offsetWidth;
  popover.style.top = r.bottom + 8 + 'px';
  // buttons on the left of the bar open their menu to the right, and vice versa
  const leftSide = r.left + r.width / 2 < innerWidth / 2;
  popover.style.left = Math.max(12, Math.min(innerWidth - w - 12, leftSide ? r.left : r.right - w)) + 'px';
  popover.style.transformOrigin = leftSide ? 'top left' : 'top right';
  popover.onclick = (e) => { const b = e.target.closest('[data-act]'); if (b) onClick(b.dataset.act, b); };
  requestAnimationFrame(() => popover.classList.add('show'));
}
function closePopover() { popover.classList.remove('show'); popover.hidden = true; }
document.addEventListener('pointerdown', (e) => {
  if (!popover.hidden && !popover.contains(e.target) && !e.target.closest('#btn-more,#btn-appearance')) closePopover();
});

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const K = (s) => s.replace('Mod', isMac ? '⌘' : 'Ctrl');
function moreMenu(btn) {
  const item = (act, ic, label, kbd = '') => `<button class="mi" data-act="${act}">${icon(ic, 17)}<span>${label}</span>${kbd ? `<kbd>${K(kbd)}</kbd>` : ''}</button>`;
  openPopover(btn, `<div class="menu">
    ${item('new', 'file', 'New document', 'Mod+Alt+N')}
    ${item('open', 'open', 'Open…', 'Mod+O')}
    ${item('save', 'save', 'Save', 'Mod+S')}
    ${item('saveas', 'saveas', 'Save as…', 'Mod+Shift+S')}
    ${item('openFolder', 'folder', 'Open folder…', 'Mod+Shift+O')}
    <hr>
    ${item('undo', 'undo', 'Undo', 'Mod+Z')}
    ${item('redo', 'redo', 'Redo', 'Mod+Y')}
    <hr>
    ${item('export', 'html', 'Export HTML')}
    ${item('print', 'print', 'Print / PDF', 'Mod+P')}
    <hr>
    ${item('sample', 'diagram', 'Feature tour')}
    ${item('keys', 'keyboard', 'Shortcuts')}
    ${item('about', 'info', 'About ' + APP_NAME)}
  </div>`, (act) => { closePopover(); ACTIONS[act](); });
}
const ACCENTS = ['vermilion', 'violet', 'cobalt', 'teal', 'rose', 'amber'];
function appearanceMenu(btn) {
  const st = S.settings;
  const dark = document.documentElement.dataset.resolvedTheme === 'dark';
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="${key}:${v}" class="${st[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  openPopover(btn, `<div class="appear">
    <div class="ap-label">Theme</div>${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}
    <div class="ap-label">Accent</div><div class="swatches">${ACCENTS.map((a) => `<button data-act="accent:${a}" class="sw sw-${a} ${st.accent === a ? 'on' : ''}" title="${a}" aria-label="${a}"></button>`).join('')}</div>
    <div class="ap-label">Colour palette</div><div class="pal-grid">${PALETTES.map((p) => `<button data-act="palette:${p.id}" class="pal ${st.palette === p.id ? 'on' : ''}">${strip(paletteColors({ ...st, palette: p.id }, dark))}<span>${p.name}</span></button>`).join('')}</div>
    ${st.palette === 'custom' ? `<div class="pal-custom"><label><input type="color" data-c="customDeep" value="${st.customDeep}">Deep</label><label><input type="color" data-c="customLight" value="${st.customLight}">Light</label></div>` : ''}
    ${st.palette === 'catppuccin' ? `<div class="ap-sub">Dark-mode flavour <span class="ap-note">(light mode uses Latte)</span></div>${seg('ctpFlavor', [['frappe', 'Frappé'], ['macchiato', 'Macchiato'], ['mocha', 'Mocha']])}<div class="ap-sub">Interface colours</div>${seg('ctpTint', [['on', 'Catppuccin'], ['off', 'Fudebako']])}` : ''}
    ${st.palette !== 'none' ? `<div class="ap-sub">Gradient</div>${seg('paletteDir', [['normal', 'Deep → Light'], ['reverse', 'Light → Deep']])}` : ''}
    <div class="ap-label">Typeface</div>${seg('font', [['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono']])}
    <div class="ap-label">Measure</div>${seg('width', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']])}
    <div class="ap-label">Text size</div><div class="seg"><button data-act="size:-1">A−</button><button data-act="size:0">Reset</button><button data-act="size:1">A+</button></div>
  </div>`, (act) => {
    const [k, v] = act.split(':');
    if (k === 'size') st.size = v === '0' ? 0 : Math.max(-3, Math.min(5, st.size + +v));
    else st[k] = v;
    applySettings(); appearanceMenu(btn);
  });
  popover.querySelectorAll('input[type="color"]').forEach((inp) => {
    inp.addEventListener('input', () => { st[inp.dataset.c] = inp.value; applySettings(); });
  });
}
function applySettings() {
  const st = S.settings, d = document.documentElement;
  d.dataset.theme = st.theme; d.dataset.accent = st.accent; d.dataset.font = st.font; d.dataset.width = st.width;
  d.style.setProperty('--size-step', st.size);
  d.dataset.palette = st.palette || 'none';
  const dark = st.theme === 'dark' || (st.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const prev = d.dataset.resolvedTheme;
  d.dataset.resolvedTheme = dark ? 'dark' : 'light';
  $('#btn-theme').innerHTML = icon(st.theme === 'auto' ? 'auto' : dark ? 'moon' : 'sun');
  // palette variables are applied inline on <html>; clear the previous set first
  const vars = paletteVars({ ...st, ctpTint: st.ctpTint !== 'off' }, dark);
  (applySettings.vars || []).forEach((k) => { if (!(k in vars)) d.style.removeProperty(k); });
  Object.entries(vars).forEach(([k, val]) => d.style.setProperty(k, val));
  applySettings.vars = Object.keys(vars);
  d.dataset.ctp = st.palette === 'catppuccin' && st.ctpTint !== 'off' ? (dark ? st.ctpFlavor : 'latte') : '';
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }));
  meta.content = getComputedStyle(d).getPropertyValue('--bg').trim();
  store.set(KEY_SET, st);
  const sig = [d.dataset.resolvedTheme, st.accent, st.palette, st.ctpFlavor, st.ctpTint].join('|');
  if (prev !== d.dataset.resolvedTheme || applySettings.sig !== sig) {
    applySettings.sig = sig;
    resetMermaidTheme();
    if (S.mode === 'rich' && !S.editing) render();
  }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 2200);
}

function modal(html) {
  const m = $('#modal');
  m.innerHTML = `<button class="ib modal-x" aria-label="Close">${icon('x')}</button>${html}`;
  m.querySelector('.modal-x').onclick = () => m.close();
  m.onclick = (e) => {
    const a = e.target.closest('a[href]');
    if (a && /^https?:/.test(a.getAttribute('href'))) { e.preventDefault(); io.openExternal(a.href); }
  };
  m.addEventListener('click', (e) => { if (e.target === m) m.close(); }, { once: true });
  m.showModal();
}

/* ============================== file actions ============================== */
function loadDoc(text, file, { saved = true } = {}) {
  if (S.editing) commit({ rerender: false });
  S.eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const norm = text.replace(/\r\n?/g, '\n');
  S.src = norm; S.saved = saved ? norm : '';
  S.file = { name: file.name || 'Untitled.md', path: file.path || null, handle: file.handle || null };
  S.hist = []; S.fut = [];
  S.entry = S.folder?.files.find((f) => (f.path && f.path === S.file.path) || (f.handle && f.handle === S.file.handle)) || null;
  $('#file-name').textContent = S.file.name;
  renderTree();
  if (S.mode === 'source') { sourceEl.value = S.src; autosize(sourceEl); }
  stage.scrollTop = 0;
  render(); changed();
}
async function confirmDiscard() {
  if (S.src === S.saved || !S.src.trim()) return true;
  return confirm(`Discard unsaved changes to “${S.file.name}”?`);
}
const ACTIONS = {
  async new() { if (!(await confirmDiscard())) return; loadDoc('', { name: 'Untitled.md' }); newBlockAtEnd(); },
  async open() {
    if (!(await confirmDiscard())) return;
    try { const f = await io.openFile(); if (f) { loadDoc(f.text, f); toast('Opened ' + f.name); } }
    catch (e) { toast('Could not open file: ' + e.message, 'err'); }
  },
  async save(as = false) {
    if (S.editing) commit();
    if (S.mode === 'source') S.src = sourceEl.value.replace(/\r\n?/g, '\n');
    try {
      const out = S.eol === '\r\n' ? S.src.replace(/\n/g, '\r\n') : S.src;
      const res = await io.saveFile(S.file, out.endsWith(S.eol) || !out ? out : out + S.eol, as);
      if (!res) return;
      S.file = res; S.saved = S.src;
      S.entry = S.folder?.files.find((f) => (f.path && f.path === S.file.path) || (f.handle && f.handle === S.file.handle)) || S.entry;
      $('#file-name').textContent = S.file.name;
      renderTree();
      changed(); toast(io.isTauri() || res.handle ? 'Saved' : 'Downloaded ' + res.name);
    } catch (e) { toast('Save failed: ' + e.message, 'err'); }
  },
  saveas() { return ACTIONS.save(true); },
  async openFolder() {
    try {
      const F = await pickFolder();
      if (!F) return;
      await useFolder(F, true);
    } catch (e) { toast('Could not open folder: ' + e.message, 'err'); }
  },
  undo() {
    if (S.editing) commit();
    if (!S.hist.length) return toast('Nothing to undo');
    S.fut.push(S.src); S.src = S.hist.pop(); afterHistory();
  },
  redo() {
    if (S.editing) commit();
    if (!S.fut.length) return toast('Nothing to redo');
    S.hist.push(S.src); S.src = S.fut.pop(); afterHistory();
  },
  async export() {
    if (S.editing) commit();
    await hydrate(docEl);
    const clone = docEl.cloneNode(true);
    clone.querySelectorAll('[data-ln]').forEach((n) => n.removeAttribute('data-ln'));
    clone.querySelectorAll('.hot,.flash,.src-hidden').forEach((n) => n.classList.remove('hot', 'flash', 'src-hidden'));
    clone.querySelectorAll('.code-copy').forEach((n) => n.remove());
    const title = S.file.name.replace(/\.[^.]+$/, '');
    const dark = document.documentElement.dataset.resolvedTheme;
    const html = `<!doctype html><html lang="en" data-theme="${dark}" data-resolved-theme="${dark}" data-accent="${S.settings.accent}" data-font="${S.settings.font}" data-palette="${S.settings.palette || 'none'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, '&lt;')}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.0/dist/katex.min.css">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800&family=JetBrains+Mono:wght@400;600&display=swap">
<style>${exportVars()}\n${contentCss}\nbody{margin:0;background:var(--bg);color:var(--ink)}.md{max-width:var(--measure);margin:0 auto;padding:64px 24px 96px}</style></head>
<body><article class="md">${clone.innerHTML}</article></body></html>`;
    if (await io.exportFile(title + '.html', html, 'text/html', 'html')) toast('Exported ' + title + '.html');
  },
  print() { if (S.editing) commit(); window.print(); },
  sample() { if (S.src === sample) return; confirmDiscard().then((ok) => ok && loadDoc(sample, { name: 'Welcome.md' })); },
  about() {
    const credit = (name, role, lic) => `<li><b>${name}</b><span>${role}</span><em>${lic}</em></li>`;
    const logo = document.querySelector('.brand svg').outerHTML.replace(/width="22" height="22"/, 'width="64" height="64"');
    modal(`<div class="about">
      <div class="about-hero">${logo}<div><h2>${APP_NAME}</h2><div class="about-jp">${NAME_NOTE}</div><div class="about-ver">Version ${APP_VERSION} · ${io.isTauri() ? 'Desktop app' : 'Web app'}</div></div></div>
      <p class="about-tag">${TAGLINE}</p>
      <p class="about-small">${APP_NAME} is free and open-source software: you may use, copy, modify and distribute it under the terms of the MIT License. It is provided “as is”, without warranty of any kind.</p>
      <h3>Built with</h3>
      <ul class="about-credits">
        ${credit('markdown-it', 'Markdown parsing &amp; extensions', 'MIT')}
        ${credit('KaTeX', 'LaTeX rendering', 'MIT')}
        ${credit('Mermaid', 'Diagrams', 'MIT')}
        ${credit('highlight.js', 'Code highlighting', 'BSD-3-Clause')}
        ${credit('Tauri', 'Desktop &amp; Android shell', 'MIT / Apache-2.0')}
        ${credit('Catppuccin', 'Colour palette', 'MIT')}
        ${credit('Newsreader · JetBrains Mono', 'Typefaces', 'SIL OFL 1.1')}
      </ul>
      <p class="about-small">These projects and their own dependencies keep their respective licences and copyrights, reproduced in full in the third-party notices.</p>
      <div class="about-actions">
        <button class="btn-ghost" data-about="license">View licence</button>
        <button class="btn-ghost" data-about="notices">Third-party notices</button>
      </div>
      <div class="about-doc" hidden></div>
    </div>`);
    const box = $('#modal .about-doc');
    $$('#modal [data-about]').forEach((b) => (b.onclick = async () => {
      $$('#modal [data-about]').forEach((x) => x.classList.toggle('on', x === b));
      box.hidden = false;
      box.innerHTML = '<p class="about-small">Loading…</p>';
      if (b.dataset.about === 'license') {
        const { default: txt } = await import('../LICENSE?raw');
        box.innerHTML = `<pre class="about-pre">${esc(txt)}</pre>`;
      } else {
        const { default: txt } = await import('../THIRD-PARTY-NOTICES.md?raw');
        const [head, rest = ''] = txt.split('\n## Licence texts');
        const sections = rest.split('\n### ').slice(1).map((sec) => {
          const nl = sec.indexOf('\n');
          const body = sec.slice(nl).trim().replace(/^```\n?|\n?```$/g, '');
          return `<details><summary>${esc(sec.slice(0, nl))}</summary><pre class="about-pre">${esc(body)}</pre></details>`;
        }).join('');
        box.innerHTML = `<div class="md about-md">${md.render(head.replace(/^# .*\n/, ''))}</div><h3>Licence texts</h3>${sections}`;
      }
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  },
  keys() {
    const row = (k, d) => `<tr><td>${k.split(' ').map((x) => `<kbd>${K(x)}</kbd>`).join(' ')}</td><td>${d}</td></tr>`;
    modal(`<h2>Shortcuts</h2><table class="keys">
      ${row('Click', 'Edit the block under the pointer')}
      ${row('Esc', 'Finish editing (or click anywhere else)')}
      ${row('↑ ↓', 'At the edge of a block: move to the previous / next block')}
      ${row('Enter Enter', 'Start a new block below')}
      ${row('Tab Shift+Tab', 'Indent / outdent lines')}
      ${row('Mod+B Mod+I Mod+E', 'Bold, italic, inline code')}
      ${row('Mod+K', 'Insert link')}
      ${row('Mod+Click', 'Follow a link')}
      ${row('Mod+/', 'Toggle source mode')}
      ${row('Mod+\\', 'Toggle the sidebar (files & contents)')}
      ${row('Mod+S Mod+Shift+S', 'Save / Save as')}
      ${row('Mod+O', 'Open a file')}
      ${row('Mod+Shift+O', 'Open a folder')}
      ${row('Mod+Z Mod+Y', 'Undo / Redo (outside a block)')}
    </table>`);
  },
};
function afterHistory() {
  if (S.mode === 'source') { sourceEl.value = S.src; autosize(sourceEl); }
  render(); changed();
}
function exportVars() {
  const cs = getComputedStyle(document.documentElement);
  const names = ['--bg', '--surface', '--ink', '--ink-2', '--ink-3', '--line', '--accent', '--accent-soft', '--code-bg', '--measure', '--font-read', '--font-mono', '--read-size', '--hot',
    '--alert-note', '--alert-tip', '--alert-important', '--alert-warning', '--alert-caution',
    '--hl-kw', '--hl-str', '--hl-num', '--hl-com', '--hl-fn', '--hl-type', '--hl-attr', '--hl-var', '--p-deep', '--p-light', '--p-soft'];
  names.push(...(applySettings.vars || []).filter((n) => !names.includes(n)));
  return ':root{' + names.filter((n) => cs.getPropertyValue(n).trim()).map((n) => `${n}:${cs.getPropertyValue(n)}`).join(';') + '}';
}

/* ============================== folder workspace ============================== */
const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const MD_EXT = /\.(md|markdown|mdown|mkd|mdx)$/i;
const collapsedDirs = new Set(store.get('fudebako.collapsed', []));

function setTab(tab) {
  $('#outline').dataset.tab = tab;
  $$('.side-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  store.set('fudebako.tab', tab);
}
function updateCrumb() {
  const c = $('#crumb');
  if (S.folder && S.entry) {
    const sub = dirOf(S.entry.rel);
    c.textContent = S.folder.name + (sub ? ' / ' + sub.split('/').join(' / ') : '');
    c.hidden = false;
  } else c.hidden = true;
}
function renderTree() {
  const F = S.folder, pane = $('#pane-files');
  pane.classList.toggle('has-folder', !!F && !F.pending);
  const re = $('#fold-reopen');
  re.hidden = !(F && F.pending);
  if (F?.pending) re.textContent = `Reopen “${F.name}”`;
  updateCrumb();
  if (!F || F.pending) return;
  $('#fold-name').innerHTML = icon('folder', 13) + `<span>${esc(F.name)}</span>`;
  $('#fold-name').title = typeof F.root === 'string' ? F.root : F.name;
  const q = $('#fold-filter').value.trim().toLowerCase();
  const active = S.entry?.rel, dirty = S.src !== S.saved;
  const row = (f, d, showDir) =>
    `<button class="t-row t-file${f.rel === active ? ' active' : ''}" data-rel="${esc(f.rel)}" style="--d:${d}" title="${esc(f.rel)}">${icon('doc', 15)}<span>${esc(f.name.replace(MD_EXT, ''))}</span>` +
    (showDir && dirOf(f.rel) ? `<span class="t-path">${esc(dirOf(f.rel))}</span>` : '') +
    (f.rel === active && dirty ? '<i class="t-dot" title="Unsaved changes"></i>' : '') + '</button>';
  if (q) {
    const hits = F.files.filter((f) => f.rel.toLowerCase().includes(q));
    $('#tree').innerHTML = hits.length ? hits.map((f) => row(f, 0, true)).join('') : '<div class="t-none">No matching files</div>';
    return;
  }
  const walk = (node, d) => {
    let h = '';
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const dir of dirs) {
      h += `<details${collapsedDirs.has(dir.rel) ? '' : ' open'} data-dir="${esc(dir.rel)}"><summary class="t-row t-dir" style="--d:${d}">${icon('chev', 13).replace('class="ic"', 'class="ic chev"')}<span>${esc(dir.name)}</span></summary>${walk(dir, d + 1)}</details>`;
    }
    for (const f of node.files) h += row(f, d);
    return h;
  };
  $('#tree').innerHTML = F.files.length ? walk(buildTree(F.files), 0) : '<div class="t-none">No Markdown files here yet — create one with ＋.</div>';
}

async function openEntry(f) {
  if (S.entry && S.entry.rel === f.rel && S.file.name === f.name) return;
  if (S.editing) commit();
  if (S.src !== S.saved && S.src.trim()) {
    if (S.file.path || S.file.handle) { await ACTIONS.save(); if (S.src !== S.saved) return; }
    else if (!confirm(`Discard unsaved changes to “${S.file.name}”?`)) return;
  }
  try {
    const text = await readEntry(f);
    loadDoc(text, { name: f.name, path: f.path, handle: f.handle });
    S.entry = f;
    renderTree();
    store.set('fudebako.lastRel', f.rel);
    if (innerWidth < 1100) toggleOutline(false);
  } catch (e) { toast('Could not open ' + f.name + ': ' + e.message, 'err'); }
}

async function useFolder(F, openFirst) {
  S.folder = F;
  setTab('files');
  toggleOutline(true);
  renderTree();
  if (F.pending) return;
  // keep the current document attached if it lives in this folder
  S.entry = F.files.find((f) => (f.path && f.path === S.file.path) || (f.handle && f.handle === S.file.handle)) || null;
  renderTree();
  if (openFirst && !S.entry && F.files.length) {
    const pick = F.files.find((f) => /^(readme|index)\.md$/i.test(f.rel)) || F.files[0];
    await openEntry(pick);
  }
  toast(`${F.name} · ${F.files.length} file${F.files.length === 1 ? '' : 's'}`);
}

$('#tree').addEventListener('click', (e) => {
  const b = e.target.closest('.t-file'); if (!b) return;
  const f = S.folder?.files.find((x) => x.rel === b.dataset.rel);
  if (f) openEntry(f);
});
$('#tree').addEventListener('toggle', (e) => {
  const d = e.target.closest?.('details[data-dir]'); if (!d) return;
  if (d.open) collapsedDirs.delete(d.dataset.dir); else collapsedDirs.add(d.dataset.dir);
  store.set('fudebako.collapsed', [...collapsedDirs]);
}, true);
$('#fold-filter').addEventListener('input', renderTree);
$('#fold-filter').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const first = $('#tree .t-file'); first?.click(); }
  if (e.key === 'Escape') { e.target.value = ''; renderTree(); }
});
$$('.side-tab').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
$('#fold-pick').onclick = () => ACTIONS.openFolder();
$('#fold-open').onclick = () => ACTIONS.openFolder();
$('#fold-reopen').onclick = async () => {
  const F = await restoreFolder(true);
  if (F && !F.pending) { await useFolder(F, false); reattachLast(); }
};
$('#fold-refresh').onclick = async () => {
  if (!S.folder) return;
  S.folder = await scan(S.folder);
  S.entry = S.folder.files.find((f) => f.rel === S.entry?.rel) || null;
  renderTree(); toast('Refreshed');
};
$('#fold-close').onclick = () => {
  S.folder = null; S.entry = null; forgetFolder(); renderTree();
};
$('#crumb').onclick = () => { setTab('files'); toggleOutline(true); };
$('#fold-new').onclick = () => {
  const form = $('#fold-create'), input = $('#fold-create-name');
  const dir = S.entry ? dirOf(S.entry.rel) : '';
  form.hidden = !form.hidden;
  input.placeholder = (dir ? dir + '/' : '') + 'new-note.md';
  if (!form.hidden) input.focus();
};
$('#fold-create-name').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; $('#fold-create').hidden = true; } });
$('#fold-create').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#fold-create-name');
  let name = input.value.trim().replace(/[\\:*?"<>|]/g, '');
  if (!name) return;
  let dir = S.entry ? dirOf(S.entry.rel) : '';
  if (name.includes('/')) { dir = dirOf(name); name = name.slice(name.lastIndexOf('/') + 1); }
  const title = name.replace(MD_EXT, '').replace(/[-_]+/g, ' ');
  try {
    const f = await createEntry(S.folder, dir, name, `# ${title.charAt(0).toUpperCase() + title.slice(1)}\n\n`);
    S.folder.files.push(f);
    S.folder = { ...S.folder, files: (await scan(S.folder)).files };
    input.value = ''; $('#fold-create').hidden = true;
    await openEntry(S.folder.files.find((x) => x.rel === f.rel) || f);
  } catch (err) { toast(err.message, 'err'); }
});
// After a folder is restored at start-up, re-attach the document that was open last time
async function reattachLast() {
  const F = S.folder; if (!F || F.pending) return;
  const d = store.get(KEY_DRAFT, null);
  const rel = d?.rel || store.get('fudebako.lastRel', null);
  const f = rel && F.files.find((x) => x.rel === rel);
  if (!f) return;
  if (d && d.rel === rel && d.src !== d.saved) {
    // unsaved draft of this file: keep the draft, but point it at the real file again
    S.file = { name: f.name, path: f.path || null, handle: f.handle || null };
    S.entry = f; renderTree();
  } else await openEntry(f);
}

/* ============================== rename ============================== */
const nameEl = $('#file-name');
nameEl.addEventListener('click', () => {
  if (nameEl.isContentEditable) return;
  nameEl.contentEditable = 'plaintext-only';
  nameEl.focus();
  const r = document.createRange(); r.selectNodeContents(nameEl.firstChild || nameEl);
  const dot = nameEl.textContent.lastIndexOf('.');
  if (dot > 0 && nameEl.firstChild) r.setEnd(nameEl.firstChild, dot);
  getSelection().removeAllRanges(); getSelection().addRange(r);
});
nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); nameEl.blur(); } });
nameEl.addEventListener('blur', () => {
  nameEl.contentEditable = 'false';
  let n = nameEl.textContent.trim().replace(/[\\/:*?"<>|]/g, '') || 'Untitled.md';
  if (!/\.\w+$/.test(n)) n += '.md';
  if (n !== S.file.name) { S.file = { ...S.file, name: n, path: null, handle: null }; }
  nameEl.textContent = S.file.name;
  changed();
});

/* ============================== global keys ============================== */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) { if (e.key === 'Escape') closePopover(); return; }
  const k = e.key.toLowerCase();
  const inField = e.target.matches('textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"]');
  if (k === 's') { e.preventDefault(); ACTIONS.save(e.shiftKey); }
  else if (k === 'o') { e.preventDefault(); e.shiftKey ? ACTIONS.openFolder() : ACTIONS.open(); }
  else if (k === 'n' && e.altKey) { e.preventDefault(); ACTIONS.new(); }
  else if (k === '/') { e.preventDefault(); setMode(S.mode === 'rich' ? 'source' : 'rich'); }
  else if (k === '\\') { e.preventDefault(); toggleOutline(); }
  else if (k === 'p') { e.preventDefault(); ACTIONS.print(); }
  else if (!inField && k === 'z' && !e.shiftKey) { e.preventDefault(); ACTIONS.undo(); }
  else if (!inField && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); ACTIONS.redo(); }
});
window.addEventListener('beforeunload', (e) => {
  if (S.editing) commit({ rerender: false });
  store.set(KEY_DRAFT, draftObj());
  if (!io.isTauri() && S.src !== S.saved && S.src.trim() && S.file.handle) { e.preventDefault(); e.returnValue = ''; }
});

/* ============================== drag & drop / file handling ============================== */
let dragDepth = 0;
const dropEl = $('#drop');
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; dropEl.classList.add('on'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropEl.classList.remove('on'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; dropEl.classList.remove('on');
  const f = e.dataTransfer.files[0]; if (!f) return;
  if (!(await confirmDiscard())) return;
  const item = [...e.dataTransfer.items].find((i) => i.kind === 'file');
  const handle = item?.getAsFileSystemHandle ? await item.getAsFileSystemHandle().catch(() => null) : null;
  loadDoc(await f.text(), { name: f.name, handle: handle?.kind === 'file' ? handle : null });
  toast('Opened ' + f.name);
});
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (p) => {
    const h = p.files?.[0]; if (!h) return;
    const f = await h.getFile();
    loadDoc(await f.text(), { name: f.name, handle: h });
  });
}

/* ============================== mobile: keep the format bar above the keyboard ============================== */
function positionBars() {
  const vv = window.visualViewport;
  const off = vv ? Math.max(0, innerHeight - vv.height - vv.offsetTop) : 0;
  document.documentElement.style.setProperty('--kb', off + 'px');
}
window.visualViewport?.addEventListener('resize', positionBars);
window.visualViewport?.addEventListener('scroll', positionBars);

/* ============================== boot ============================== */
function boot() {
  $('#btn-outline').innerHTML = icon('outline');
  $('#btn-open').innerHTML = icon('open');
  $('#btn-save').innerHTML = icon('save');
  $('#btn-source').innerHTML = icon('source');
  $('#btn-appearance').innerHTML = icon('palette');
  $('#btn-more').innerHTML = icon('filemenu');
  $('#btn-outline').onclick = () => toggleOutline();
  $('#btn-open').onclick = () => ACTIONS.open();
  $('#btn-save').onclick = () => ACTIONS.save();
  $('#btn-source').onclick = () => setMode(S.mode === 'rich' ? 'source' : 'rich');
  $('#btn-theme').onclick = () => {
    const order = ['auto', 'light', 'dark'];
    S.settings.theme = order[(order.indexOf(S.settings.theme) + 1) % 3];
    applySettings(); toast('Theme: ' + S.settings.theme);
  };
  $('#btn-appearance').onclick = (e) => (popover.hidden ? appearanceMenu(e.currentTarget) : closePopover());
  $('#btn-more').onclick = (e) => (popover.hidden ? moreMenu(e.currentTarget) : closePopover());
  buildFmtbar();
  $('#fold-new').innerHTML = icon('plus');
  $('#fold-refresh').innerHTML = icon('refresh');
  $('#fold-open').innerHTML = icon('folder');
  $('#fold-close').innerHTML = icon('x');
  setTab(store.get('fudebako.tab', 'toc'));

  S.settings = { ...S.settings, ...store.get(KEY_SET, {}) };
  applySettings();
  if (store.get('fudebako.outline', innerWidth >= 1100) && innerWidth >= 1100) toggleOutline(true);

  const d = store.get(KEY_DRAFT, null);
  if (d && typeof d.src === 'string') {
    S.src = d.src; S.saved = d.saved ?? ''; S.file = { name: d.name || 'Untitled.md', path: d.path || null, handle: null };
    $('#file-name').textContent = S.file.name;
    render(); updateDirty();
  } else loadDoc(sample, { name: 'Welcome.md' });

  (async () => {
    // 1) a file passed on the command line (Explorer "Edit with Fudebako" / Open with)
    let initial = null;
    if (io.isTauri()) {
      try { initial = await window.__TAURI__.core.invoke('initial_file'); } catch {}
      if (initial) {
        try { loadDoc(await window.__TAURI__.fs.readTextFile(initial), { name: io.baseName(initial), path: initial }); }
        catch { toast('Could not open ' + initial, 'err'); initial = null; }
      }
    }
    // 2) the folder workspace from last time
    const F = await restoreFolder(false).catch(() => null);
    if (F) {
      S.folder = F;
      if (!F.pending) {
        if (initial) S.entry = F.files.find((f) => f.path === initial) || null;
        else await reattachLast();
      }
    }
    renderTree();
  })();
  if ('serviceWorker' in navigator && !io.isTauri() && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  document.body.classList.add('ready');
}
boot();

// exposed for debugging / tests
window.fudebako = { S, render, commit, startEdit, ACTIONS };
