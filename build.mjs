// Bundles the game into dist/: game.js plus index.html for the artifact,
// and preview.html (the same page with a document skeleton) for local testing.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'dist/game.js',
  legalComments: 'none',
});
const page = readFileSync('index.html', 'utf8');
writeFileSync('dist/index.html', page);
writeFileSync(
  'dist/preview.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${page}</body></html>`,
);
console.log('built dist/game.js');
