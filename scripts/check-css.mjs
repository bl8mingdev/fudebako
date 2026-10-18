// Guards against unbalanced braces in stylesheets. In dev each file is isolated, but the production
// build concatenates them, so one unclosed block silently swallows every rule that follows.
import fs from 'node:fs';
import path from 'node:path';
const dir = 'src/styles';
let bad = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  let depth = 0, line = 1, openedAt = [];
  for (const c of src) {
    if (c === '\n') line++;
    if (c === '{') openedAt.push(line), depth++;
    if (c === '}') { depth--; openedAt.pop(); if (depth < 0) { console.error(`${f}:${line}: unexpected "}"`); bad++; break; } }
  }
  if (depth > 0) { console.error(`${f}: ${depth} unclosed "{" (last opened at line ${openedAt.at(-1)})`); bad++; }
}
if (bad) process.exit(1);
console.log('CSS braces OK');
