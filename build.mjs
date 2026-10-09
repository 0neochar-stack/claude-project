// Bundles the game into dist/: game.js plus index.html for the artifact,
// and preview.html (the same page with a document skeleton) for local testing.
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ANIMAL_CLIPS, MODEL_FILES } from './src/modelList.js';
import { optimizeModel } from './tools/optimize-models.mjs';

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
// The downloaded models the game uses, slimmed down, next to the page (only redone when the source changes).
for (const file of new Set(Object.values(MODEL_FILES))) {
  const src = `models/${file}`, dst = `dist/models/${file}`;
  if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) {
    mkdirSync(dirname(dst), { recursive: true });
    await optimizeModel(src, dst, file.startsWith('animals/') ? ANIMAL_CLIPS : undefined);
  }
  // Artifact hosting only serves web types, so the game fetches each model as base64 text.
  writeFileSync(`${dst}.txt`, readFileSync(dst).toString('base64'));
}
console.log('built dist/game.js');
