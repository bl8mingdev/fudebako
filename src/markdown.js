// Markdown engine: markdown-it + popular extensions.
// Every block-level token that knows its source lines gets a `data-ln="start-end"`
// attribute, which is what makes click-to-edit possible.
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import deflist from 'markdown-it-deflist';
import { full as emoji } from 'markdown-it-emoji';

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- LaTeX: $inline$, $$display$$, ```math ---------- */
function mathPlugin(md) {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const src = state.src;
    let pos = state.pos;
    if (src.charCodeAt(pos) !== 0x24 /* $ */) return false;
    const display = src.charCodeAt(pos + 1) === 0x24;
    const open = display ? 2 : 1;
    const start = pos + open;
    if (!display) {
      const next = src.charCodeAt(start);
      if (!next || next === 0x20 || next === 0x09 || next === 0x0a) return false;
    }
    let end = start;
    while ((end = src.indexOf(display ? '$$' : '$', end)) !== -1) {
      let bs = 0;
      for (let i = end - 1; src.charCodeAt(i) === 0x5c; i--) bs++;
      if (bs % 2 === 0) break;
      end++;
    }
    if (end === -1 || end === start) return false;
    if (!display) {
      const prev = src.charCodeAt(end - 1);
      const after = src.charCodeAt(end + 1);
      if (prev === 0x20 || prev === 0x09) return false;
      if (after >= 0x30 && after <= 0x39) return false; // "$5 and $6" is money, not math
    }
    if (!silent) {
      const t = state.push('math_inline', 'math', 0);
      t.content = src.slice(start, end);
      t.markup = display ? '$$' : '$';
    }
    state.pos = end + open;
    return true;
  });

  md.block.ruler.after('blockquote', 'math_block', (state, startLine, endLine, silent) => {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    if (state.src.slice(pos, pos + 2) !== '$$') return false;
    const firstLine = state.src.slice(pos + 2, max);
    if (silent) return true;
    let content = '';
    let next = startLine;
    let found = false;
    if (firstLine.trim().endsWith('$$')) {
      content = firstLine.trim().slice(0, -2);
      found = true;
    } else {
      content = firstLine.trim() ? firstLine + '\n' : '';
      for (next = startLine + 1; next < endLine; next++) {
        pos = state.bMarks[next] + state.tShift[next];
        max = state.eMarks[next];
        if (pos < max && state.sCount[next] < state.blkIndent) break;
        const line = state.src.slice(pos, max);
        if (line.trim().endsWith('$$')) {
          content += line.trim().slice(0, -2);
          found = true;
          break;
        }
        content += state.src.slice(state.bMarks[next], max) + '\n';
      }
    }
    state.line = next + 1;
    const t = state.push('math_block', 'math', 0);
    t.block = true;
    t.content = content.trim();
    t.map = [startLine, state.line];
    t.markup = '$$';
    if (!found) t.meta = { unclosed: true };
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  md.renderer.rules.math_inline = (tokens, i) =>
    `<span class="math math-inline" data-tex="${esc(tokens[i].content)}">${esc(tokens[i].content)}</span>`;
  md.renderer.rules.math_block = (tokens, i, o, env, slf) =>
    `<div class="math math-block"${slf.renderAttrs(tokens[i])} data-tex="${esc(tokens[i].content)}">${esc(tokens[i].content)}</div>\n`;
}

/* ---------- YAML front matter ---------- */
function frontMatter(md) {
  md.block.ruler.before('table', 'front_matter', (state, startLine, endLine, silent) => {
    if (startLine !== 0 || state.blkIndent !== 0) return false;
    const line = (n) => state.src.slice(state.bMarks[n], state.eMarks[n]);
    if (line(0).trim() !== '---') return false;
    let next = 1;
    for (; next < endLine; next++) if (/^(---|\.\.\.)\s*$/.test(line(next))) break;
    if (next >= endLine) return false;
    if (silent) return true;
    const t = state.push('front_matter', '', 0);
    t.block = true;
    t.map = [0, next + 1];
    t.content = state.getLines(1, next, 0, false);
    state.line = next + 1;
    return true;
  });
  md.renderer.rules.front_matter = (tokens, i, o, env, slf) => {
    const rows = tokens[i].content.split('\n').filter(Boolean).map((l) => {
      const m = l.match(/^([\w-]+)\s*:\s*(.*)$/);
      return m
        ? `<div class="fm-row"><span class="fm-k">${esc(m[1])}</span><span class="fm-v">${esc(m[2])}</span></div>`
        : `<div class="fm-row"><span class="fm-v">${esc(l)}</span></div>`;
    }).join('');
    return `<div class="front-matter"${slf.renderAttrs(tokens[i])}>${rows}</div>\n`;
  };
}

/* ---------- GitHub alerts: > [!NOTE] ---------- */
const ALERTS = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };
function alerts(md) {
  md.core.ruler.after('block', 'gh_alerts', (state) => {
    const t = state.tokens;
    for (let i = 0; i < t.length - 2; i++) {
      if (t[i].type !== 'blockquote_open' || t[i + 1].type !== 'paragraph_open' || t[i + 2].type !== 'inline') continue;
      const m = t[i + 2].content.match(/^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)?/i);
      if (!m) continue;
      const kind = m[1].toLowerCase();
      t[i].attrJoin('class', `alert alert-${kind}`);
      t[i].attrSet('data-alert', ALERTS[kind]);
      t[i + 2].content = t[i + 2].content.slice(m[0].length);
      if (!t[i + 2].content.trim()) { t[i + 1].hidden = t[i + 3].hidden = true; }
    }
  });
}

/* ---------- Task lists: - [ ] / - [x] ---------- */
function taskLists(md) {
  md.core.ruler.after('inline', 'task_lists', (state) => {
    const t = state.tokens;
    for (let i = 2; i < t.length; i++) {
      if (t[i].type !== 'inline' || t[i - 1].type !== 'paragraph_open' || t[i - 2].type !== 'list_item_open') continue;
      const first = t[i].children[0];
      if (!first || first.type !== 'text') continue;
      const m = first.content.match(/^\[([ xX])\](?:[  ]|$)/);
      if (!m) continue;
      const checked = m[1] !== ' ';
      first.content = first.content.slice(m[0].length);
      const line = t[i - 2].map ? t[i - 2].map[0] : -1;
      const cb = new state.Token('html_inline', '', 0);
      cb.content = `<input type="checkbox" class="task-cb" data-task-line="${line}"${checked ? ' checked' : ''}>`;
      t[i].children.unshift(cb);
      t[i - 2].attrJoin('class', 'task-item' + (checked ? ' done' : ''));
      // mark the parent list
      for (let j = i - 3; j >= 0; j--) {
        if ((t[j].type === 'bullet_list_open' || t[j].type === 'ordered_list_open') && t[j].level === t[i - 2].level - 1) {
          if (!(t[j].attrGet('class') || '').includes('task-list')) t[j].attrJoin('class', 'task-list');
          break;
        }
      }
    }
  });
}

/* ---------- heading ids + source line attributes ---------- */
export const slugify = (s) =>
  s.toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') || 'section';

function sourceLines(md) {
  md.core.ruler.push('source_lines', (state) => {
    const used = {};
    const t = state.tokens;
    for (let i = 0; i < t.length; i++) {
      const tok = t[i];
      if (tok.map && (tok.nesting === 1 || (tok.nesting === 0 && tok.block))) {
        tok.attrSet('data-ln', `${tok.map[0]}-${tok.map[1]}`);
      }
      if (tok.type === 'heading_open') {
        const text = t[i + 1].children.filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('');
        let id = slugify(text);
        if (used[id]) id += '-' + used[id]++; else used[id] = 1;
        tok.attrSet('id', id);
      }
    }
  });
}

export function createMarkdown() {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });
  md.use(frontMatter).use(mathPlugin).use(footnote).use(mark).use(sub).use(sup)
    .use(deflist).use(emoji).use(alerts).use(taskLists).use(sourceLines);

  // Fences: code (highlighted lazily), mermaid, math
  md.renderer.rules.fence = (tokens, i, o, env, slf) => {
    const tok = tokens[i];
    const lang = (tok.info || '').trim().split(/\s+/)[0].toLowerCase();
    const attrs = slf.renderAttrs(tok);
    if (lang === 'mermaid') {
      return `<div class="mermaid-block"${attrs} data-src="${esc(tok.content)}"><pre class="mermaid-src">${esc(tok.content)}</pre></div>\n`;
    }
    if (lang === 'math' || lang === 'latex' || lang === 'katex') {
      return `<div class="math math-block"${attrs} data-tex="${esc(tok.content.trim())}">${esc(tok.content)}</div>\n`;
    }
    const label = lang || 'text';
    return `<pre class="code"${attrs}><div class="code-head"><span class="code-lang">${esc(label)}</span><button class="code-copy" type="button" tabindex="-1">Copy</button></div><code class="hljs${lang ? ' language-' + esc(lang) : ''}" data-lang="${esc(lang)}">${esc(tok.content)}</code></pre>\n`;
  };
  md.renderer.rules.code_block = (tokens, i, o, env, slf) =>
    `<pre class="code"${slf.renderAttrs(tokens[i])}><code class="hljs">${esc(tokens[i].content)}</code></pre>\n`;
  // A balanced HTML block is wrapped so it can be clicked and edited. A block that only opens or
  // closes a container (`<div align="center">` … blank line … Markdown … `</div>`, `<details>`…)
  // is emitted as-is, so the Markdown blocks in between end up inside it, as on GitHub.
  md.renderer.rules.html_block = (tokens, i, o, env, slf) => {
    const c = tokens[i].content;
    if (tagBalance(c) !== 0) return c;
    return `<div class="html-block"${slf.renderAttrs(tokens[i])}>${c}</div>\n`;
  };
  // Tables get a scroll wrapper on narrow screens
  const tOpen = md.renderer.rules.table_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
  md.renderer.rules.table_open = (t, i, o, e, s) => `<div class="table-wrap">${tOpen(t, i, o, e, s)}`;
  const tClose = md.renderer.rules.table_close || ((t, i, o, e, s) => s.renderToken(t, i, o));
  md.renderer.rules.table_close = (t, i, o, e, s) => `${tClose(t, i, o, e, s)}</div>`;
  // Links: remember they are links; navigation needs Ctrl/Cmd-click
  const linkOpen = md.renderer.rules.link_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
  md.renderer.rules.link_open = (t, i, o, e, s) => {
    const href = t[i].attrGet('href') || '';
    if (!href.startsWith('#')) t[i].attrSet('title', (t[i].attrGet('title') ? t[i].attrGet('title') + ' — ' : '') + 'Ctrl/⌘-click to open');
    return linkOpen(t, i, o, e, s);
  };
  return md;
}

const VOID_TAG = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
/** Opening minus closing (non-void) tags in an HTML fragment. */
function tagBalance(html) {
  let n = 0;
  for (const m of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*?(\/?)>/gi)) {
    if (VOID_TAG.test(m[2]) || m[3]) continue;
    n += m[1] ? -1 : 1;
  }
  return n;
}
