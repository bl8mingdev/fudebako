// Lazy "hydration" of heavy content: KaTeX, Mermaid and highlight.js are only
// downloaded when a document actually contains math, diagrams or code.
// Results are cached so re-rendering after each edit is instant and flicker-free.

const mathCache = new Map();
const codeCache = new Map();
const mermaidCache = new Map();

let katexP, hljsP, mermaidP;
const loadKatex = () => (katexP ||= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default));
const loadHljs = () => (hljsP ||= import('highlight.js/lib/common').then((m) => m.default));
let mermaidTheme = null;
const loadMermaid = () => (mermaidP ||= import('mermaid').then((m) => m.default));

function mermaidVars(dark) {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return {
    darkMode: dark,
    background: v('--surface-hex') || (dark ? '#191b1f' : '#fffdf9'),
    primaryColor: v('--m-node') || (dark ? '#23262c' : '#fbf8f2'),
    primaryTextColor: v('--ink-hex') || (dark ? '#ece9e2' : '#1d1c1a'),
    primaryBorderColor: v('--accent-hex') || '#e2553d',
    secondaryColor: v('--m-node2') || (dark ? '#2a2420' : '#fdeee9'),
    tertiaryColor: v('--m-node3') || (dark ? '#1e2025' : '#f3efe7'),
    lineColor: v('--ink2-hex') || (dark ? '#a9a59c' : '#57534c'),
    textColor: v('--ink-hex') || (dark ? '#ece9e2' : '#1d1c1a'),
    edgeLabelBackground: v('--surface-hex') || (dark ? '#181a1e' : '#fffdf9'),
    labelBackground: v('--surface-hex') || (dark ? '#181a1e' : '#fffdf9'),
    actorBkg: v('--m-node') || (dark ? '#1f2227' : '#fbf8f2'),
    noteBkgColor: v('--m-node2') || (dark ? '#2b211e' : '#fdeee9'),
    noteTextColor: v('--ink-hex') || (dark ? '#ece9e2' : '#1d1c1a'),
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSize: '14px',
  };
}

export function resetMermaidTheme() {
  mermaidCache.clear();
  mermaidTheme = null;
}

let mermaidSeq = 0;
async function renderMermaid(code) {
  const mermaid = await loadMermaid();
  const dark = document.documentElement.dataset.resolvedTheme === 'dark';
  const key = (dark ? 'd:' : 'l:') + code;
  if (mermaidCache.has(key)) return mermaidCache.get(key);
  if (mermaidTheme !== dark) {
    mermaid.initialize({ startOnLoad: false, layout: 'dagre', theme: 'base', themeVariables: mermaidVars(dark), securityLevel: 'strict', flowchart: { curve: 'basis', htmlLabels: true } });
    mermaidTheme = dark;
  }
  let out;
  try {
    const { svg } = await mermaid.render('mmd-' + ++mermaidSeq, code);
    out = { svg };
  } catch (e) {
    out = { error: String(e && e.message ? e.message : e).split('\n').slice(0, 4).join('\n') };
    document.querySelectorAll('#dmmd-' + mermaidSeq).forEach((n) => n.remove());
  }
  mermaidCache.set(key, out);
  return out;
}

function fillMermaid(el, res) {
  if (res.svg) el.innerHTML = `<div class="mermaid-svg">${res.svg}</div>`;
  else el.innerHTML = `<div class="render-error"><b>Mermaid</b><pre>${res.error.replace(/</g, '&lt;')}</pre></div>`;
  el.classList.add('ready');
}

export async function hydrate(root) {
  const jobs = [];
  const dark = document.documentElement.dataset.resolvedTheme === 'dark';

  // --- math
  const maths = root.querySelectorAll('.math:not(.ready)');
  if (maths.length) {
    const pending = [];
    for (const el of maths) {
      const key = (el.classList.contains('math-block') ? 'B' : 'I') + el.dataset.tex;
      if (mathCache.has(key)) { el.innerHTML = mathCache.get(key); el.classList.add('ready'); }
      else pending.push([el, key]);
    }
    if (pending.length) jobs.push(loadKatex().then((katex) => {
      for (const [el, key] of pending) {
        const html = katex.renderToString(el.dataset.tex, { displayMode: key[0] === 'B', throwOnError: false, output: 'html', trust: false, strict: 'ignore' });
        mathCache.set(key, html);
        el.innerHTML = html; el.classList.add('ready');
      }
    }));
  }

  // --- code highlighting
  const codes = root.querySelectorAll('pre.code code:not(.ready)');
  if (codes.length) {
    const pending = [];
    for (const el of codes) {
      const key = el.dataset.lang + '\u0000' + el.textContent;
      if (codeCache.has(key)) { el.innerHTML = codeCache.get(key); el.classList.add('ready'); }
      else pending.push([el, key]);
    }
    if (pending.length) jobs.push(loadHljs().then((hljs) => {
      for (const [el, key] of pending) {
        const lang = el.dataset.lang;
        let html;
        try {
          html = lang && hljs.getLanguage(lang)
            ? hljs.highlight(el.textContent, { language: lang, ignoreIllegals: true }).value
            : lang ? el.innerHTML : hljs.highlightAuto(el.textContent).value;
        } catch { html = el.innerHTML; }
        codeCache.set(key, html);
        el.innerHTML = html; el.classList.add('ready');
      }
    }));
  }

  // --- mermaid (sequential: mermaid is not re-entrant)
  const mers = [...root.querySelectorAll('.mermaid-block:not(.ready)')];
  if (mers.length) {
    for (const el of mers) {
      const key = (dark ? 'd:' : 'l:') + el.dataset.src;
      if (mermaidCache.has(key)) fillMermaid(el, mermaidCache.get(key));
    }
    const rest = mers.filter((el) => !el.classList.contains('ready'));
    if (rest.length) jobs.push((async () => {
      for (const el of rest) {
        const res = await renderMermaid(el.dataset.src);
        if (el.isConnected) fillMermaid(el, res);
      }
    })());
  }
  await Promise.all(jobs);
}

// One-off preview renders used by the live preview under the block editor
export async function previewMath(tex, display = true) {
  const katex = await loadKatex();
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore' });
}
export async function previewMermaid(code) {
  return renderMermaid(code);
}
