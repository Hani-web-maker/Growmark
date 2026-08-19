/**
 * Minimal PNG decoder — pure JS, Node built-ins only (zlib).
 *
 * Exists so the regression test can run headless without adding a dependency
 * and without a native canvas build. Supports what the fixtures actually are:
 * bit depth 8, non-interlaced, colour types 0/2/3/4/6. Anything else throws
 * loudly rather than silently returning wrong pixels.
 */

import zlib from 'node:zlib';

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePNG(buffer) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== sig[i]) throw new Error('Not a PNG file');
  }

  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];

  let off = 8;
  while (off < buffer.length) {
    const len  = buffer.readUInt32BE(off);
    const type = buffer.toString('latin1', off + 4, off + 8);
    const data = buffer.subarray(off + 8, off + 8 + len);

    if (type === 'IHDR') {
      width     = data.readUInt32BE(0);
      height    = data.readUInt32BE(4);
      bitDepth  = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }

  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth ${bitDepth} (only 8 supported)`);
  }
  if (interlace !== 0) {
    throw new Error('Unsupported interlaced PNG');
  }
  const channels = CHANNELS[colorType];
  if (!channels) {
    throw new Error(`Unsupported PNG colour type ${colorType}`);
  }

  const raw       = zlib.inflateSync(Buffer.concat(idat));
  const bpp       = channels;                 // bit depth 8 → 1 byte per channel
  const stride    = width * bpp;
  const unfiltered = Buffer.alloc(height * stride);

  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter  = raw[pos++];
    const rowIn   = raw.subarray(pos, pos + stride);
    pos += stride;

    const rowOut  = unfiltered.subarray(y * stride, (y + 1) * stride);
    const prevRow = y > 0 ? unfiltered.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rowOut[x - bpp] : 0;
      const b = prevRow ? prevRow[x] : 0;
      const c = prevRow && x >= bpp ? prevRow[x - bpp] : 0;
      const v = rowIn[x];

      switch (filter) {
        case 0: rowOut[x] = v;                                  break;
        case 1: rowOut[x] = (v + a) & 0xff;                      break;
        case 2: rowOut[x] = (v + b) & 0xff;                      break;
        case 3: rowOut[x] = (v + ((a + b) >> 1)) & 0xff;         break;
        case 4: rowOut[x] = (v + paeth(a, b, c)) & 0xff;         break;
        default: throw new Error(`Unknown PNG filter type ${filter} on row ${y}`);
      }
    }
  }

  // Expand to RGBA
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * channels;
    const d = i * 4;
    let r, g, b, a = 255;

    if (colorType === 0) {
      r = g = b = unfiltered[s];
    } else if (colorType === 2) {
      r = unfiltered[s]; g = unfiltered[s + 1]; b = unfiltered[s + 2];
    } else if (colorType === 3) {
      const idx = unfiltered[s];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (colorType === 4) {
      r = g = b = unfiltered[s]; a = unfiltered[s + 1];
    } else { // 6
      r = unfiltered[s]; g = unfiltered[s + 1]; b = unfiltered[s + 2]; a = unfiltered[s + 3];
    }

    out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = a;
  }

  return { width, height, data: out };
}
