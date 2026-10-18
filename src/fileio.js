// File I/O that works everywhere:
//  - Tauri (Windows / Linux / Android): native dialogs + fs plugin
//  - Chromium browsers / installed PWA: File System Access API
//  - Anything else (Android Chrome, Firefox, Safari): <input type=file> + download

const T = () => window.__TAURI__;
export const isTauri = () => !!(window.__TAURI__ && window.__TAURI__.core);
const FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }];
const PICKER_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'], 'text/plain': ['.txt'] } }];

export const baseName = (p) => (p || '').split(/[\\/]/).pop().replace(/^.*%2F/i, '');

/** @returns {Promise<{text:string,name:string,path?:string,handle?:any}|null>} */
export async function openFile() {
  if (isTauri()) {
    const path = await T().dialog.open({ multiple: false, directory: false, filters: FILTERS });
    if (!path) return null;
    const p = typeof path === 'string' ? path : path.path;
    const text = await T().fs.readTextFile(p);
    return { text, name: decodeURIComponent(baseName(p)), path: p };
  }
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES, excludeAcceptAllOption: false });
      const file = await handle.getFile();
      return { text: await file.text(), name: file.name, handle };
    } catch (e) { if (e.name === 'AbortError') return null; throw e; }
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain' });
    input.onchange = async () => {
      const f = input.files[0];
      resolve(f ? { text: await f.text(), name: f.name } : null);
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Save. `doc` = {name, path?, handle?}. Returns updated doc meta or null if cancelled. */
export async function saveFile(doc, text, saveAs = false) {
  if (isTauri()) {
    let path = saveAs ? null : doc.path;
    if (!path) {
      path = await T().dialog.save({ defaultPath: doc.name || 'Untitled.md', filters: FILTERS });
      if (!path) return null;
    }
    await T().fs.writeTextFile(path, text);
    return { ...doc, path, name: decodeURIComponent(baseName(path)) };
  }
  if (window.showSaveFilePicker) {
    let handle = saveAs ? null : doc.handle;
    try {
      if (!handle) handle = await window.showSaveFilePicker({ suggestedName: doc.name || 'Untitled.md', types: PICKER_TYPES });
      const w = await handle.createWritable();
      await w.write(text); await w.close();
      return { ...doc, handle, name: handle.name };
    } catch (e) { if (e.name === 'AbortError') return null; throw e; }
  }
  download(doc.name || 'Untitled.md', text, 'text/markdown');
  return { ...doc };
}

export function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportFile(name, content, type, ext) {
  if (isTauri()) {
    const path = await T().dialog.save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await T().fs.writeTextFile(path, content);
    return true;
  }
  download(name, content, type);
  return true;
}

export async function openExternal(url) {
  if (isTauri() && T().opener) return T().opener.openUrl(url);
  window.open(url, '_blank', 'noopener');
}
