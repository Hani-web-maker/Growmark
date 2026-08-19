/**
 * Growmark Build Script
 * Cross-platform (Windows / macOS / Linux)
 * Uses esbuild in full bundle mode — no import statements in output
 *
 * SOURCE  → public/   (maintained by hand: HTML, assets, CNAME, robots, sitemap)
 *           src/      (JS, bundled by esbuild)
 * OUTPUT  → docs/     (generated — never hand-edit; this directory is CLEANED
 *                      and regenerated on every build)
 *
 * docs/ IS COMMITTED TO GIT ON PURPOSE. Do NOT add it to .gitignore.
 * GitHub Pages serves the live site (geminiaiwatermarkremover.com) directly
 * from /docs on the main branch, so if docs/ is not committed, nothing is live.
 * Edits belong in public/ or src/; docs/ is the build product of both.
 */

const esbuild = require('./node_modules/esbuild/lib/main.js');
const fs = require('fs');
const path = require('path');

const isProd = process.argv.includes('--production') || process.argv.includes('--prod');

const SRC   = path.resolve(__dirname, 'src');
const PUB   = path.resolve(__dirname, 'public');
const DOCS  = path.resolve(__dirname, 'docs');

// ── Clean docs ────────────────────────────────────────────────────────────────
if (fs.existsSync(DOCS)) {
  fs.rmSync(DOCS, { recursive: true, force: true });
}
fs.mkdirSync(DOCS, { recursive: true });

// ── Copy every file in public/ → docs/, preserving subdirectories ─────────────
function copyDir(srcDir, destDir, relBase = '') {
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath  = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    const relPath  = relBase ? path.posix.join(relBase, entry.name) : entry.name;

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      count += copyDir(srcPath, destPath, relPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  ✓ Copied ${relPath}`);
      count++;
    }
  }
  return count;
}

if (!fs.existsSync(PUB)) {
  console.error(`\n  ✗ Source directory not found: ${PUB}\n`);
  process.exit(1);
}
const copied = copyDir(PUB, DOCS);
console.log(`  ✓ ${copied} file(s) copied from public/`);

// ── Bundle JS ─────────────────────────────────────────────────────────────────
async function build() {
  console.log(`\n  Building Growmark (${isProd ? 'production' : 'development'})…\n`);

  const result = await esbuild.build({
    entryPoints: [
      path.join(SRC, 'app.js'),
      path.join(SRC, 'videoApp.js'),   // dev-video.html — internal harness, noindex
    ],
    outdir: DOCS,
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

  // Print bundle sizes and verify no import statements remain
  for (const name of ['app.js', 'videoApp.js']) {
    const outPath = path.join(DOCS, name);
    const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`\n  ✓ docs/${name}  ${kb} kB`);

    const content = fs.readFileSync(outPath, 'utf8');
    const hasImports = /^\s*(import|export)\s/m.test(content);
    if (hasImports) {
      console.error(`\n  ✗ ${name} still contains import/export statements!`);
      process.exit(1);
    } else {
      console.log(`  ✓ ${name}: no import/export statements — bundle is self-contained`);
    }
  }

  console.log(`\n  🚀 Build complete → docs/\n`);
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
