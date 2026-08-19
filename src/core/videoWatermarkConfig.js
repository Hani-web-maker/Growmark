/**
 * Video watermark geometry + provisional alpha-map source.
 *
 * Mirrors the structure of detectWatermarkConfig / calculateWatermarkPosition
 * in watermarkEngine.js as SEPARATE functions. watermarkEngine.js is protected
 * and is not imported, edited or re-exported here — the duplication is
 * deliberate so video thresholds can diverge from image ones without ever
 * touching the validated image path.
 */

import BG_48_PATH from '../assets/bg_48.png';
import BG_96_PATH from '../assets/bg_96.png';

/**
 * Pick watermark size + margins from frame dimensions.
 * Same thresholds as the image engine, kept separate on purpose.
 */
export function detectVideoWatermarkConfig(frameWidth, frameHeight) {
  if (frameWidth > 1024 && frameHeight > 1024) {
    return { logoSize: 96, marginRight: 64, marginBottom: 64 };
  } else {
    return { logoSize: 48, marginRight: 32, marginBottom: 32 };
  }
}

/** Bottom-right anchored box, same convention as the image engine. */
export function calculateVideoWatermarkPosition(frameWidth, frameHeight, config) {
  const { logoSize, marginRight, marginBottom } = config;
  return {
    x: frameWidth - marginRight - logoSize,
    y: frameHeight - marginBottom - logoSize,
    width: logoSize,
    height: logoSize
  };
}

/**
 * The box must lie fully inside the frame.
 *
 * removeWatermark() in blendModes.js does no bounds checking, so an
 * out-of-range box does not throw — it corrupts. Reading past the alpha map
 * yields undefined, which becomes NaN through the blend and clamps to 0 in the
 * Uint8ClampedArray, i.e. black pixels; an out-of-range x wraps silently into
 * the next row. Callers must refuse to process rather than produce that.
 */
export function isPositionWithinFrame(position, frameWidth, frameHeight) {
  return position.x >= 0 &&
         position.y >= 0 &&
         position.width  > 0 &&
         position.height > 0 &&
         position.x + position.width  <= frameWidth &&
         position.y + position.height <= frameHeight;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load calibration capture: ${String(src).slice(0, 48)}…`));
    img.src = src;
  });
}

/**
 * Provisional alpha-map source built from the EXISTING IMAGE captures.
 *
 * Returns the raw capture as ImageData — not a finished alpha map — so that
 * VideoEngine derives the map itself through the protected calculateAlphaMap().
 *
 * These captures calibrate IMAGE watermarks. See the TODO at the top of
 * videoEngine.js: this is a stand-in until a real video-watermark capture
 * exists. It deliberately REFUSES to resample a capture to a different size;
 * an interpolated calibration would be an unverifiable number, and wrong
 * calibration corrupts silently.
 */
export function createProvisionalAlphaMapSource() {
  const cache = new Map();

  return {
    provisional: true,
    label: 'provisional — derived from the 48/96 image captures, not a video-watermark capture',

    async resolve(frameWidth, frameHeight) {
      const { logoSize } = detectVideoWatermarkConfig(frameWidth, frameHeight);
      if (cache.has(logoSize)) return cache.get(logoSize);

      const img = await loadImageElement(logoSize === 96 ? BG_96_PATH : BG_48_PATH);

      if (img.width !== logoSize || img.height !== logoSize) {
        throw new Error(
          `Calibration capture is ${img.width}×${img.height} but a ${logoSize}×${logoSize} map is ` +
          `required. Resampling the capture is refused — it would silently change removal accuracy. ` +
          `A real capture at this size is needed.`
        );
      }

      const canvas = new OffscreenCanvas(logoSize, logoSize);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);

      const entry = { size: logoSize, captureImageData: ctx.getImageData(0, 0, logoSize, logoSize) };
      cache.set(logoSize, entry);
      return entry;
    }
  };
}
