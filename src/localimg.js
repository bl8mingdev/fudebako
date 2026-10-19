// Local images: `![](images/logo.png)` or `<img src="public/icon.svg">` point at files next to the
// document, but the app itself is served from its own origin (tauri://localhost, http://localhost…),
// so the browser would look for them there and fail. Rendering therefore swaps relative and
// file-system sources for `data-local-src`, and resolveImages() loads them from disk as blob URLs:
//  - Tauri: relative to the open file's path (or the open folder for `/root-relative` paths)
//  - File System Access folder: through the folder's directory handle
//  - <input webkitdirectory> folder: from the File objects picked with it
import { isTauri } from './fileio.js';

const T = () => window.__TAURI__;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DRIVE = /^[a-z]:[\\/]/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon' };
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;

const isLocal = (u) => !!u && !u.startsWith('#') && !u.startsWith('//') && (DRIVE.test(u) || /^file:/i.test(u) || !SCHEME.test(u));

/** Rewrites the `src` of local images in rendered HTML so the browser doesn't request them from the app's origin. */
export function markLocal(html) {
  if (!html.includes('<img')) return html;
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    tag.replace(/(\s)src\s*=\s*(["'])(.*?)\2/i, (m, sp, q, url) => (isLocal(url.trim()) ? `${sp}data-local-src=${q}${url}${q}` : m)));
}

let getContext = () => ({});
/** `fn` returns { path, folder, entry } describing the open document. */
export function setImageContext(fn) { getContext = fn; }

const cache = new Map(); // key → Promise<string|null>
export function clearImageCache() {
  for (const p of cache.values()) p.then((u) => u && URL.revokeObjectURL(u));
  cache.clear();
}

const segs = (p) => p.split(/[\\/]+/);
function normalize(parts) {
  const out = [];
  for (const s of parts) {
    if (!s || s === '.') continue;
    if (s === '..') { if (!out.length || out[out.length - 1] === '..') out.push('..'); else out.pop(); }
    else out.push(s);
  }
  return out;
}
const clean = (u) => { u = u.replace(/[?#].*$/, ''); try { return decodeURIComponent(u); } catch { return u; } };

/** The path to hand to the native side: `file://` URLs become plain paths, %-escapes are decoded. */
function nativeSrc(url) {
  if (!/^file:/i.test(url)) return clean(url);
  const p = clean(url.replace(/^file:\/\/(localhost)?/i, ''));
  return /^\/[a-z]:/i.test(p) ? p.slice(1) : p;
}

/** Path inside the open folder for `url` relative to the entry at `rel` (browser folders). */
function folderRel(url, rel) {
  url = clean(url);
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const parts = normalize(/^[\\/]/.test(url) ? segs(url) : [...segs(dir), ...segs(url)]);
  return parts[0] === '..' ? null : parts.join('/');
}

async function load(url, ctx) {
  const { path, folder, entry } = ctx;
  if (isTauri()) {
    // Read by the app's own `read_image` command (src-tauri/src/lib.rs), which resolves the path
    // natively, so Windows drive letters and separators are handled by Rust's std::path.
    const src = nativeSrc(url);
    const bytes = await T().core.invoke('read_image', { src, doc: path || null, root: folder?.kind === 'tauri' ? folder.root : null });
    const ext = (src.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    return URL.createObjectURL(new Blob([bytes], { type: MIME[ext] || 'application/octet-stream' }));
  }
  if (!folder || !entry || DRIVE.test(url) || /^file:/i.test(url)) return null;
  const rel = folderRel(url, entry.rel);
  if (!rel) return null;
  if (folder.kind === 'fsa') {
    const parts = rel.split('/');
    let dir = folder.root;
    for (const s of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(s);
    const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
    return URL.createObjectURL(file);
  }
  const file = folder.assets?.get(rel);
  return file ? URL.createObjectURL(file) : null;
}

/** Loads every `img[data-local-src]` under `root`. */
export async function resolveImages(root) {
  const imgs = root.querySelectorAll('img[data-local-src]:not([src])');
  if (!imgs.length) return;
  const ctx = getContext();
  const scope = ctx.path || (ctx.folder && ctx.entry ? ctx.folder.name + '/' + ctx.entry.rel : '');
  await Promise.all([...imgs].map(async (img) => {
    const url = img.dataset.localSrc.trim();
    const key = scope + '\u0000' + url;
    if (!cache.has(key)) cache.set(key, load(url, ctx).catch((e) => ({ error: String(e?.message || e) })));
    const res = await cache.get(key);
    if (!img.isConnected) return;
    if (typeof res === 'string') { img.src = res; img.classList.remove('img-missing'); img.removeAttribute('title'); return; }
    cache.delete(key); // retry next time: the file may appear later
    img.classList.add('img-missing');
    img.title = isTauri() || (ctx.folder && ctx.entry)
      ? `Image not found: ${url}` + (res?.error ? `\n${res.error}` : '')
      : `Local image: ${url}\nOpen the folder that contains this file (Ctrl+Shift+O) to show it.`;
    if (res?.error) console.warn('[Fudebako] image', url, res.error);
  }));
}
