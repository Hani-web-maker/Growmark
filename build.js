/**
 * Growmark Build Script
 * Cross-platform (Windows / macOS / Linux)
 * Uses esbuild in full bundle mode — no import statements in output
 */

const esbuild = require('./node_modules/esbuild/lib/main.js');
const fs = require('fs');
const path = require('path');

const isProd = process.argv.includes('--production') || process.argv.includes('--prod');

const SRC   = path.resolve(__dirname, 'src');
const PUB   = path.resolve(__dirname, 'public');
const DIST  = path.resolve(__dirname, 'dist');

// ── Clean dist ────────────────────────────────────────────────────────────────
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
}
fs.mkdirSync(DIST, { recursive: true });

// ── Copy HTML pages ───────────────────────────────────────────────────────────
const htmlFiles = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));
htmlFiles.forEach(file => {
  fs.copyFileSync(path.join(PUB, file), path.join(DIST, file));
  console.log(`  ✓ Copied ${file}`);
});

// ── Bundle JS ─────────────────────────────────────────────────────────────────
async function build() {
  console.log(`\n  Building Growmark (${isProd ? 'production' : 'development'})…\n`);

  const result = await esbuild.build({
    entryPoints: [path.join(SRC, 'app.js')],
    outfile: path.join(DIST, 'app.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'Growmark',
    target: ['es2017', 'chrome80', 'firefox80', 'safari13'],
    loader: {
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.webp': 'dataurl',
    },
    minify: isProd,
    sourcemap: !isProd,
    metafile: true,
    logLevel: 'info',
  });

  // Print bundle sizes
  const appJs = path.join(DIST, 'app.js');
  const bytes  = fs.statSync(appJs).size;
  const kb     = (bytes / 1024).toFixed(1);
  console.log(`\n  ✓ dist/app.js  ${kb} kB`);

  // Verify no import statements remain
  const content = fs.readFileSync(appJs, 'utf8');
  const hasImports = /^\s*(import|export)\s/m.test(content);
  if (hasImports) {
    console.error('\n  ✗ Bundle still contains import/export statements!');
    process.exit(1);
  } else {
    console.log('  ✓ No import/export statements — bundle is self-contained');
  }

  console.log(`\n  🚀 Build complete → dist/\n`);
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
