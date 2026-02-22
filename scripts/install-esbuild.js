/**
 * Growmark — Cross-platform esbuild binary installer
 * Run: node scripts/install-esbuild.js
 * Detects OS/arch and places the correct native binary
 */

const { execSync } = require('child_process');
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const platform = os.platform(); // win32 | darwin | linux
const arch     = os.arch();     // x64 | arm64 | ia32

const pkgMap = {
  'win32-x64':   '@esbuild/win32-x64',
  'win32-ia32':  '@esbuild/win32-ia32',
  'win32-arm64': '@esbuild/win32-arm64',
  'darwin-x64':  '@esbuild/darwin-x64',
  'darwin-arm64':'@esbuild/darwin-arm64',
  'linux-x64':   '@esbuild/linux-x64',
  'linux-arm64': '@esbuild/linux-arm64',
  'linux-ia32':  '@esbuild/linux-ia32',
};

const key = `${platform}-${arch}`;
const pkg = pkgMap[key];

if (!pkg) {
  console.error(`Unsupported platform: ${key}`);
  process.exit(1);
}

console.log(`Installing esbuild native binary for ${key} (${pkg})…`);

try {
  execSync(`npm install ${pkg} --save-dev --prefer-offline`, {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });
  console.log('esbuild binary installed successfully.');
} catch (e) {
  console.error('Failed to install esbuild binary. Try running: npm install');
  process.exit(1);
}
