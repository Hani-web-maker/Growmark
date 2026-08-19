/**
 * Minimal DOM shim so src/core/watermarkEngine.js runs UNMODIFIED in Node.
 *
 * The engine uses exactly four browser APIs:
 *   new Image() + .src/.onload   (WatermarkEngine.create)
 *   document.createElement('canvas')
 *   ctx.drawImage(img, 0, 0)
 *   ctx.getImageData / ctx.putImageData
 *
 * Only those are implemented. Importing this module installs the globals as a
 * side effect, so it must be imported BEFORE the engine.
 *
 * drawImage is a straight copy rather than a source-over composite. That is
 * exact for the way the engine uses it (drawing onto a freshly sized, i.e.
 * transparent, canvas) and the test asserts every fixture is fully opaque, so
 * there is no premultiplied-alpha rounding to diverge on. If a future fixture
 * has partial alpha, this shim must be revisited — the test checks for that.
 */

import { decodePNG } from './png.mjs';

class ImageDataShim {
  constructor(data, width, height) {
    if (typeof data === 'number') {
      height = width; width = data;
      data = new Uint8ClampedArray(width * height * 4);
    }
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

class CanvasRenderingContext2DShim {
  constructor(canvas) { this.canvas = canvas; }

  drawImage(img, dx = 0, dy = 0) {
    const { width: cw, height: ch, _data: dst } = this.canvas;
    const { width: iw, height: ih, _data: src } = img;
    for (let y = 0; y < ih; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= ch) continue;
      for (let x = 0; x < iw; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= cw) continue;
        const s = (y * iw + x) * 4;
        const d = (ty * cw + tx) * 4;
        dst[d] = src[s]; dst[d + 1] = src[s + 1];
        dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3];
      }
    }
  }

  getImageData(x, y, w, h) {
    const { width: cw, _data: src } = this.canvas;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const from = ((y + row) * cw + x) * 4;
      out.set(src.subarray(from, from + w * 4), row * w * 4);
    }
    return new ImageDataShim(out, w, h);
  }

  putImageData(imageData, dx = 0, dy = 0) {
    const { width: cw, _data: dst } = this.canvas;
    const { width: iw, height: ih, data: src } = imageData;
    for (let row = 0; row < ih; row++) {
      dst.set(src.subarray(row * iw * 4, (row + 1) * iw * 4), ((dy + row) * cw + dx) * 4);
    }
  }
}

class CanvasShim {
  constructor() { this._w = 0; this._h = 0; this._data = new Uint8ClampedArray(0); }
  get width()  { return this._w; }
  set width(v) { this._w = v; this._realloc(); }
  get height() { return this._h; }
  set height(v){ this._h = v; this._realloc(); }
  _realloc()   { this._data = new Uint8ClampedArray(this._w * this._h * 4); }
  getContext(kind) {
    if (kind !== '2d') throw new Error(`Unsupported canvas context: ${kind}`);
    return new CanvasRenderingContext2DShim(this);
  }
}

class ImageShim {
  constructor() {
    this.width = 0; this.height = 0;
    this._data = null;
    this.onload = null; this.onerror = null;
    this._src = '';
  }
  get src() { return this._src; }
  set src(value) {
    this._src = value;
    queueMicrotask(() => {
      try {
        const m = /^data:image\/png;base64,(.*)$/s.exec(value);
        if (!m) throw new Error('Image shim only supports data:image/png;base64 URLs');
        const decoded = decodePNG(Buffer.from(m[1], 'base64'));
        this.width = decoded.width;
        this.height = decoded.height;
        this._data = decoded.data;
        if (this.onload) this.onload();
      } catch (err) {
        if (this.onerror) this.onerror(err); else throw err;
      }
    });
  }
}

globalThis.Image = ImageShim;
globalThis.ImageData = ImageDataShim;
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`Unsupported element: ${tag}`);
    return new CanvasShim();
  },
};

export { ImageShim, CanvasShim, ImageDataShim };
