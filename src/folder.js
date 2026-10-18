// Folder workspaces: list every Markdown file in a folder (recursively) and read/write them.
//  - Tauri (Windows/Linux): native folder dialog + fs plugin, remembered across launches
//  - Chromium / PWA: File System Access API (handle kept in IndexedDB)
//  - Elsewhere: <input webkitdirectory> (read-only, saving downloads a copy)
import { isTauri } from './fileio.js';

const MD = /\.(md|markdown|mdown|mkd|mdx)$/i;
const SKIP = /^(\.|node_modules$|target$|dist$|build$|__pycache__$|venv$)/;
const MAX_FILES = 3000, MAX_DEPTH = 10;
const T = () => window.__TAURI__;

/* ---------- tiny IndexedDB store for directory handles ---------- */
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fudebako', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      let tx, r;
      try { tx = req.result.transaction('kv', mode); r = fn(tx.objectStore('kv')); }
      catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}
const idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k)).catch(() => {});
const idbGet = (k) => idb('readonly', (s) => s.get(k)).catch(() => null);
const idbDel = (k) => idb('readwrite', (s) => s.delete(k)).catch(() => {});

const sepOf = (p) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
const join = (a, b) => (a.endsWith('/') || a.endsWith('\\') ? a + b : a + sepOf(a) + b);
const baseName = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();

/** Folder = { kind, name, root, readonly?, files: [{ rel, name, path?, handle?, file? }] } */
export async function pickFolder() {
  if (isTauri()) {
    const root = await T().dialog.open({ directory: true, multiple: false });
    if (!root) return null;
    const p = typeof root === 'string' ? root : root.path;
    localStorage.setItem('fudebako.folder', p);
    return scan({ kind: 'tauri', name: baseName(p), root: p });
  }
  if (window.showDirectoryPicker) {
    try {
      const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'fudebako' });
      await idbSet('folder', h);
      return scan({ kind: 'fsa', name: h.name, root: h });
    } catch (e) { if (e.name === 'AbortError') return null; throw e; }
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
    input.webkitdirectory = true;
    input.onchange = () => {
      const all = [...input.files].filter((f) => MD.test(f.name) && !f.webkitRelativePath.split('/').slice(1, -1).some((s) => SKIP.test(s)));
      if (!all.length) return resolve(null);
      const name = all[0].webkitRelativePath.split('/')[0];
      const files = all.slice(0, MAX_FILES).map((f) => ({ rel: f.webkitRelativePath.split('/').slice(1).join('/'), name: f.name, file: f }));
      resolve({ kind: 'input', name, root: null, readonly: true, files: sortFiles(files) });
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Re-open the folder used last time. With `interactive`, may prompt for permission (needs a click). */
export async function restoreFolder(interactive = false) {
  if (isTauri()) {
    const p = localStorage.getItem('fudebako.folder');
    if (!p) return null;
    try { return await scan({ kind: 'tauri', name: baseName(p), root: p }); } catch { return null; }
  }
  const h = await idbGet('folder');
  if (!h || !h.queryPermission) return null;
  let perm = await h.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted' && interactive) perm = await h.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') return { kind: 'fsa', name: h.name, root: h, pending: true, files: [] };
  return scan({ kind: 'fsa', name: h.name, root: h });
}
export function forgetFolder() {
  localStorage.removeItem('fudebako.folder');
  idbDel('folder');
}

export async function scan(folder) {
  const files = [];
  if (folder.kind === 'tauri') {
    const walk = async (dir, rel, depth) => {
      let entries;
      try { entries = await T().fs.readDir(dir); } catch { return; }
      for (const e of entries) {
        if (files.length >= MAX_FILES) return;
        if (e.isDirectory) { if (!SKIP.test(e.name) && depth < MAX_DEPTH) await walk(join(dir, e.name), rel + e.name + '/', depth + 1); }
        else if (MD.test(e.name)) files.push({ rel: rel + e.name, name: e.name, path: join(dir, e.name) });
      }
    };
    await walk(folder.root, '', 0);
  } else if (folder.kind === 'fsa') {
    const walk = async (dir, rel, depth) => {
      for await (const h of dir.values()) {
        if (files.length >= MAX_FILES) return;
        if (h.kind === 'directory') { if (!SKIP.test(h.name) && depth < MAX_DEPTH) await walk(h, rel + h.name + '/', depth + 1); }
        else if (MD.test(h.name)) files.push({ rel: rel + h.name, name: h.name, handle: h });
      }
    };
    await walk(folder.root, '', 0);
  } else return folder;
  return { ...folder, pending: false, files: sortFiles(files) };
}

function sortFiles(files) {
  return files.sort((a, b) => {
    const da = a.rel.split('/').length, db = b.rel.split('/').length;
    const pa = a.rel.slice(0, a.rel.lastIndexOf('/') + 1), pb = b.rel.slice(0, b.rel.lastIndexOf('/') + 1);
    if (pa !== pb) return pa.localeCompare(pb, undefined, { numeric: true, sensitivity: 'base' }) || da - db;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export async function readEntry(entry) {
  if (entry.path) return T().fs.readTextFile(entry.path);
  if (entry.handle) return (await entry.handle.getFile()).text();
  return entry.file.text();
}

/** Create a new Markdown file in the folder (optionally in a sub-folder `dirRel`). */
export async function createEntry(folder, dirRel, fileName, text) {
  if (!MD.test(fileName)) fileName += '.md';
  const rel = (dirRel ? dirRel + '/' : '') + fileName;
  if (folder.files.some((f) => f.rel.toLowerCase() === rel.toLowerCase())) throw new Error(fileName + ' already exists');
  if (folder.kind === 'tauri') {
    let dir = folder.root;
    for (const part of dirRel ? dirRel.split('/') : []) dir = join(dir, part);
    const path = join(dir, fileName);
    await T().fs.writeTextFile(path, text);
    return { rel, name: fileName, path };
  }
  if (folder.kind === 'fsa') {
    let dir = folder.root;
    for (const part of dirRel ? dirRel.split('/') : []) dir = await dir.getDirectoryHandle(part);
    const handle = await dir.getFileHandle(fileName, { create: true });
    const w = await handle.createWritable(); await w.write(text); await w.close();
    return { rel, name: fileName, handle };
  }
  throw new Error('This folder is read-only in this browser');
}

/* ---------- tree model ---------- */
export function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], rel: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push(f);
  }
  return root;
}
