/**
 * Alpha Map calculator
 * Calculate alpha map from background capture image
 */

export function calculateAlphaMap(bgCaptureImageData) {
  const { width, height, data } = bgCaptureImageData;
  const alphaMap = new Float32Array(width * height);

  for (let i = 0; i < alphaMap.length; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const maxChannel = Math.max(r, g, b);
    alphaMap[i] = maxChannel / 255.0;
  }

  return alphaMap;
}
