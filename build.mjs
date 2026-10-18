// Builds the single self-contained index.html from src/ (no dependencies).
//   node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const JS = ['core.js', 'store.js', 'seed.js', 'ui.js', 'pages-a.js', 'pages-b.js', 'pages-c.js'];

const js = JS.map((f) => `/* ---- ${f} ---- */\n${read(f)}`).join('\n')
  // never allow an inline script to be terminated early
  .replace(/<\/script/gi, '<\\/script');
const html = read('shell.html')
  .replace('/*__CSS__*/', () => read('styles.css'))
  .replace('/*__JS__*/', () => js)
  .replace('__BUILD__', new Date().toISOString());

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`index.html written (${(html.length / 1024).toFixed(0)} KB, ${JS.length} modules)`);
