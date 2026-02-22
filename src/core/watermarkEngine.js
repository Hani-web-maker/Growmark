import { calculateAlphaMap } from './alphaMap.js';
import { removeWatermark } from './blendModes.js';
import BG_48_PATH from '../assets/bg_48.png';
import BG_96_PATH from '../assets/bg_96.png';

export function detectWatermarkConfig(imageWidth, imageHeight) {
  if (imageWidth > 1024 && imageHeight > 1024) {
    return { logoSize: 96, marginRight: 64, marginBottom: 64 };
  } else {
    return { logoSize: 48, marginRight: 32, marginBottom: 32 };
  }
}

export function calculateWatermarkPosition(imageWidth, imageHeight, config) {
  const { logoSize, marginRight, marginBottom } = config;
  return {
    x: imageWidth - marginRight - logoSize,
    y: imageHeight - marginBottom - logoSize,
    width: logoSize,
    height: logoSize
  };
}

export class WatermarkEngine {
  constructor(bgCaptures) {
    this.bgCaptures = bgCaptures;
    this.alphaMaps = {};
  }

  static async create() {
    const bg48 = new Image();
    const bg96 = new Image();

    await Promise.all([
      new Promise((resolve, reject) => {
        bg48.onload = resolve;
        bg48.onerror = reject;
        bg48.src = BG_48_PATH;
      }),
      new Promise((resolve, reject) => {
        bg96.onload = resolve;
        bg96.onerror = reject;
        bg96.src = BG_96_PATH;
      })
    ]);

    return new WatermarkEngine({ bg48, bg96 });
  }

  async getAlphaMap(size) {
    if (this.alphaMaps[size]) return this.alphaMaps[size];

    const bgImage = size === 48 ? this.bgCaptures.bg48 : this.bgCaptures.bg96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bgImage, 0, 0);

    const imageData = ctx.getImageData(0, 0, size, size);
    const alphaMap = calculateAlphaMap(imageData);
    this.alphaMaps[size] = alphaMap;
    return alphaMap;
  }

  async removeWatermarkFromImage(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const config = detectWatermarkConfig(canvas.width, canvas.height);
    const position = calculateWatermarkPosition(canvas.width, canvas.height, config);
    const alphaMap = await this.getAlphaMap(config.logoSize);

    removeWatermark(imageData, alphaMap, position);
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  getWatermarkInfo(imageWidth, imageHeight) {
    const config = detectWatermarkConfig(imageWidth, imageHeight);
    const position = calculateWatermarkPosition(imageWidth, imageHeight, config);
    return { size: config.logoSize, position, config };
  }
}
