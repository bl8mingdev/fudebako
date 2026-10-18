// Generates THIRD-PARTY-NOTICES.md: every production dependency shipped in the app,
// with its licence text. Run with `npm run notices` before each release.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { maxBuffer: 1e8 }).toString());
const pkgs = new Map();
(function walk(deps) {
  for (const [name, d] of Object.entries(deps || {})) {
    if (!pkgs.has(name)) pkgs.set(name, d.version);
    walk(d.dependencies);
  }
})(tree.dependencies);

// elkjs is replaced by a stub at build time (see vite.config.js) and is not shipped.
pkgs.delete('elkjs');

const rows = [], texts = [];
for (const [name, version] of [...pkgs].sort((a, b) => a[0].localeCompare(b[0]))) {
  const dir = path.join('node_modules', name);
  let pj = {};
  try { pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
  const lic = typeof pj.license === 'string' ? pj.license : 'see licence text';
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : '';
  const repo = typeof pj.repository === 'string' ? pj.repository : pj.repository?.url || pj.homepage || '';
  rows.push(`| ${name} | ${version} | ${lic} | ${repo.replace(/^git\+/, '').replace(/\.git$/, '')} |`);
  if (text) texts.push(`### ${name} ${version}\n\n\`\`\`\n${text}\n\`\`\``);
}

const out = `# Third-party notices

Fudebako includes the following open-source packages. Their licences are reproduced below.

The desktop/Android shell is built with [Tauri](https://tauri.app) and Rust crates listed in
\`src-tauri/Cargo.lock\`; those crates are licensed under MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0
or MPL-2.0 (cssparser, selectors, dtoa-short, option-ext; source on crates.io).

Colour values of the Catppuccin palette come from [catppuccin/palette](https://github.com/catppuccin/palette) (MIT).

| Package | Version | Licence | Source |
|---|---|---|---|
${rows.join('\n')}

## Licence texts

${texts.join('\n\n')}
`;
fs.writeFileSync('THIRD-PARTY-NOTICES.md', out);
console.log(`THIRD-PARTY-NOTICES.md: ${rows.length} packages`);
