/**
 * Node ESM loader hook: resolve `.png` imports to a base64 data URL string.
 *
 * This mirrors esbuild's `loader: { '.png': 'dataurl' }` config in build.js
 * exactly, so that src/core/watermarkEngine.js can be imported in Node with
 * its ORIGINAL import statements:
 *
 *     import BG_48_PATH from '../assets/bg_48.png';
 *
 * resolving to the same `data:image/png;base64,...` string the browser bundle
 * gets. Without this the test would need a different import path than the
 * browser, and could pass while the browser build was broken.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.png')) {
    return {
      url: new URL(specifier, context.parentURL).href,
      format: 'module',
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.png')) {
    const buf = await readFile(fileURLToPath(url));
    const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(dataUrl)};`,
    };
  }
  return nextLoad(url, context);
}
