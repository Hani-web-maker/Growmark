/**
 * Ground-truth regression test for the watermark removal engine.
 *
 * src/assets/watermarked.png (input) and src/assets/removed.png (known-good
 * output) are a fixed pair. This test pushes the input through the EXISTING,
 * UNMODIFIED engine and asserts the result is pixel-identical to the output.
 *
 * Both fixtures are read-only. This file imports the engine and never modifies
 * it, nor any file under src/core/.
 *
 * Import fidelity: the engine is imported by its real browser entry point
 * (src/core/watermarkEngine.js) with its original `import ... from '*.png'`
 * statements intact. tests/png-loader.mjs resolves those to base64 data URLs,
 * which is exactly what esbuild's `dataurl` loader produces for the browser
 * bundle. A DOM shim supplies Image/canvas. So a pass here exercises the same
 * module graph the browser runs — it cannot pass while that graph is broken.
 *
 * Run: npm test
 */

import './dom-shim.mjs';   // side effect: installs Image/document globals — must precede the engine
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decodePNG } from './png.mjs';

const ASSETS = new URL('../src/assets/', import.meta.url);
const MAX_REPORTED = 12;

function fail(msg) {
  console.error(`\n  ✗ FAIL — ${msg}\n`);
  process.exit(1);
}

async function loadAsImage(name) {
  // Mirrors the browser path in src/utils.js loadImage(): file bytes → data URL
  // → Image.src → onload.
  const buf = await readFile(new URL(name, ASSETS));
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function main() {
  console.log('\n  Growmark — engine regression (ground-truth fixture pair)\n');

  // Imported dynamically so the DOM shim above is installed first.
  const { WatermarkEngine } = await import('../src/core/watermarkEngine.js');

  const engine = await WatermarkEngine.create();

  const input    = await loadAsImage('watermarked.png');
  const expected = decodePNG(await readFile(new URL('removed.png', ASSETS)));

  console.log(`  input    : watermarked.png  ${input.width}×${input.height}`);
  console.log(`  expected : removed.png      ${expected.width}×${expected.height}`);

  if (input.width !== expected.width || input.height !== expected.height) {
    fail(`fixture dimensions differ: input ${input.width}×${input.height} vs expected ${expected.width}×${expected.height}`);
  }

  // Guard the shim's assumption (see tests/dom-shim.mjs): a straight-copy
  // drawImage is only browser-exact while every fixture is fully opaque.
  for (const [name, img] of [['watermarked.png', input], ['removed.png', expected]]) {
    const data = img._data ?? img.data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 255) {
        fail(`${name} has a non-opaque pixel at index ${(i - 3) / 4}; the DOM shim's ` +
             `copy-based drawImage is no longer equivalent to the browser and must be revisited`);
      }
    }
  }

  const info = engine.getWatermarkInfo(input.width, input.height);
  console.log(`  watermark: ${info.size}px box at (${info.position.x},${info.position.y})\n`);

  const canvas = await engine.removeWatermarkFromImage(input);
  const actual = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);

  if (actual.width !== expected.width || actual.height !== expected.height) {
    fail(`output dimensions ${actual.width}×${actual.height} != expected ${expected.width}×${expected.height}`);
  }

  const diffs = [];
  let total = 0;
  for (let i = 0, n = expected.width * expected.height; i < n; i++) {
    const o = i * 4;
    if (actual.data[o]     !== expected.data[o]     ||
        actual.data[o + 1] !== expected.data[o + 1] ||
        actual.data[o + 2] !== expected.data[o + 2] ||
        actual.data[o + 3] !== expected.data[o + 3]) {
      total++;
      if (diffs.length < MAX_REPORTED) {
        diffs.push({
          x: i % expected.width,
          y: Math.floor(i / expected.width),
          got:  [actual.data[o], actual.data[o + 1], actual.data[o + 2], actual.data[o + 3]],
          want: [expected.data[o], expected.data[o + 1], expected.data[o + 2], expected.data[o + 3]],
        });
      }
    }
  }

  if (total > 0) {
    console.error(`  ${total} of ${expected.width * expected.height} pixels differ from ground truth.`);
    console.error(`  First ${diffs.length}:\n`);
    for (const d of diffs) {
      console.error(`    (${d.x},${d.y})  got rgba(${d.got.join(',')})  want rgba(${d.want.join(',')})`);
    }
    fail('engine output is not pixel-identical to removed.png');
  }

  console.log(`  ✓ PASS — output is pixel-identical to removed.png ` +
              `(${expected.width * expected.height} pixels compared)\n`);
}

main().catch(err => {
  console.error('\n  ✗ FAIL — test threw:\n');
  console.error(err);
  process.exit(1);
});
