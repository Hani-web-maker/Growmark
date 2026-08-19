/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ TODO — VIDEO ALPHA CALIBRATION IS PROVISIONAL                             │
 * │                                                                           │
 * │ There is NO video-watermark capture yet. The alpha map handed to this     │
 * │ engine is derived from src/assets/bg_48.png / bg_96.png, which calibrate  │
 * │ the IMAGE watermark. The Gemini/Veo VIDEO watermark may differ in size,   │
 * │ position and opacity, and may animate over the clip.                      │
 * │                                                                           │
 * │ Consequence: removal quality on video is UNVERIFIED. Treat output as      │
 * │ experimental. Do not make pixel-perfect or lossless claims anywhere in    │
 * │ the UI.                                                                   │
 * │                                                                           │
 * │ To fix properly: capture a real video watermark against a known           │
 * │ background, and pass it in as a different alphaMapSource. No change to    │
 * │ this file is needed — the source is a constructor parameter by design.    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Browser-local video watermark removal: demux → decode → per-frame removal →
 * encode → mux. Everything stays on the device.
 *
 * The removal maths is NOT reimplemented here. calculateAlphaMap() and
 * removeWatermark() are imported from the protected core and called unmodified.
 */

import { calculateAlphaMap } from './alphaMap.js';
import { removeWatermark } from './blendModes.js';
import {
  detectVideoWatermarkConfig,
  calculateVideoWatermarkPosition,
  isPositionWithinFrame
} from './videoWatermarkConfig.js';

import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/** Pause feeding the decoder once the encoder is this far behind. */
const MAX_ENCODE_QUEUE = 10;
/** Force a keyframe at least this often so the output stays seekable. */
const KEYFRAME_INTERVAL = 150;
/** MPEG-4 descriptor tag for DecoderSpecificInfo (the AudioSpecificConfig). */
const TAG_DECODER_SPECIFIC_INFO = 0x05;

const REQUIRED_APIS = ['VideoDecoder', 'VideoEncoder', 'EncodedVideoChunk', 'OffscreenCanvas'];

function nextTick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** Track units → microseconds, which is what WebCodecs and mp4-muxer use. */
function toMicros(value, timescale) {
  return Math.round((value / timescale) * 1e6);
}

/** Serialise a parsed mp4box config box (avcC/hvcC) back to bytes, minus the box header. */
function boxToBytes(box) {
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer, 8); // strip the 8-byte box header
}

/** Depth-first search for a descriptor tag inside an esds descriptor tree. */
function findDescriptorByTag(descriptor, tag) {
  if (!descriptor) return null;
  if (descriptor.tag === tag) return descriptor;
  for (const child of descriptor.descs || []) {
    const hit = findDescriptorByTag(child, tag);
    if (hit) return hit;
  }
  return null;
}

export class VideoEngine {
  /**
   * @param {Object} options
   * @param {Object} options.alphaMapSource  REQUIRED. { provisional, label, resolve(w,h) }
   *        where resolve() returns { size, captureImageData }. The RAW capture is
   *        returned, not a finished map — this engine derives the map itself via the
   *        protected calculateAlphaMap(). Injected, never hardcoded, so a real video
   *        capture can replace it without editing this file.
   * @param {(p:{processed:number,total:number,stage:string}) => void} [options.onProgress]
   * @param {(stage:string, detail?:string) => void} [options.onStage]
   * @param {AbortSignal} [options.signal]
   */
  constructor({ alphaMapSource, onProgress, onStage, signal } = {}) {
    if (!alphaMapSource || typeof alphaMapSource.resolve !== 'function') {
      throw new Error('VideoEngine requires an alphaMapSource with a resolve(width, height) method.');
    }
    this.alphaMapSource = alphaMapSource;
    this.onProgress = onProgress || (() => {});
    this.onStage    = onStage || (() => {});
    this.signal     = signal || null;
    this._alphaMapCache = new Map();
  }

  /** Capability gate. Call before anything else; never half-process. */
  static checkSupport() {
    const missing = REQUIRED_APIS.filter(name => typeof globalThis[name] === 'undefined');
    return { supported: missing.length === 0, missing };
  }

  _throwIfAborted() {
    if (this.signal && this.signal.aborted) {
      throw new Error('Processing cancelled.');
    }
  }

  /** Derive the alpha map for these frame dimensions via the protected calculateAlphaMap(). */
  async _resolveAlphaMap(frameWidth, frameHeight) {
    const { size, captureImageData } = await this.alphaMapSource.resolve(frameWidth, frameHeight);

    if (this._alphaMapCache.has(size)) return { size, alphaMap: this._alphaMapCache.get(size) };

    if (!captureImageData || captureImageData.width !== size || captureImageData.height !== size) {
      throw new Error(
        `alphaMapSource returned a ${captureImageData?.width}×${captureImageData?.height} capture ` +
        `but declared size ${size}. These must agree.`
      );
    }

    const alphaMap = calculateAlphaMap(captureImageData); // protected, unmodified
    this._alphaMapCache.set(size, alphaMap);
    return { size, alphaMap };
  }

  /**
   * @param {File|Blob} file
   * @returns {Promise<{blob: Blob, stats: Object}>}
   */
  async process(file) {
    const support = VideoEngine.checkSupport();
    if (!support.supported) {
      throw new Error(`This browser is missing: ${support.missing.join(', ')}.`);
    }

    this.onStage('reading', 'Reading file…');
    const buffer = await file.arrayBuffer();

    this.onStage('demuxing', 'Reading video structure…');
    const demuxed = await this._demux(buffer);

    return this._transcode(demuxed);
  }

  // ── Demux ──────────────────────────────────────────────────────────────────
  _demux(buffer) {
    return new Promise((resolve, reject) => {
      const mp4 = createFile();
      const videoSamples = [];
      const audioSamples = [];
      let info = null;
      let videoTrack = null;
      let audioTrack = null;

      mp4.onError = (module, message) => reject(new Error(`Could not read this MP4 (${module}): ${message}`));

      mp4.onReady = movie => {
        info = movie;
        videoTrack = movie.videoTracks && movie.videoTracks[0];
        audioTrack = movie.audioTracks && movie.audioTracks[0];

        if (!videoTrack) {
          reject(new Error('No video track found in this file.'));
          return;
        }

        mp4.setExtractionOptions(videoTrack.id, 'video', { nbSamples: Infinity });
        if (audioTrack) mp4.setExtractionOptions(audioTrack.id, 'audio', { nbSamples: Infinity });
        mp4.start();
      };

      mp4.onSamples = (id, user, samples) => {
        // Encoded samples are a few KB each; only decoded VideoFrames are the
        // memory hazard, and those are never accumulated (see _transcode).
        const sink = user === 'video' ? videoSamples : audioSamples;
        for (const s of samples) {
          sink.push({
            data: s.data.slice(),
            cts: s.cts,
            dts: s.dts,
            duration: s.duration,
            timescale: s.timescale,
            isSync: s.is_sync
          });
        }
      };

      try {
        const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
        mp4.appendBuffer(mp4Buffer);
        mp4.flush();
      } catch (err) {
        reject(new Error(`Could not parse this MP4: ${err.message}`));
        return;
      }

      if (!info) {
        reject(new Error('Could not read this file as MP4. Only MP4 input is supported.'));
        return;
      }
      if (videoSamples.length === 0) {
        reject(new Error('The video track contains no frames.'));
        return;
      }

      // Codec description for the decoder (avcC / hvcC).
      let videoDescription = null;
      const trak = mp4.getTrackById(videoTrack.id);
      for (const entry of trak.mdia.minf.stbl.stsd.entries) {
        const cfg = entry.avcC || entry.hvcC;
        if (cfg) { videoDescription = boxToBytes(cfg); break; }
      }

      // Audio passthrough description (AudioSpecificConfig out of esds).
      let audioDescription = null;
      if (audioTrack) {
        const atrak = mp4.getTrackById(audioTrack.id);
        for (const entry of atrak.mdia.minf.stbl.stsd.entries) {
          if (entry.esds && entry.esds.esd) {
            const dsi = findDescriptorByTag(entry.esds.esd, TAG_DECODER_SPECIFIC_INFO);
            if (dsi && dsi.data) { audioDescription = new Uint8Array(dsi.data); break; }
          }
        }
      }

      resolve({ info, videoTrack, audioTrack, videoSamples, audioSamples, videoDescription, audioDescription });
    });
  }

  // ── Decode → remove → encode → mux ─────────────────────────────────────────
  async _transcode({ videoTrack, audioTrack, videoSamples, audioSamples, videoDescription, audioDescription }) {
    const width  = videoTrack.video.width  || videoTrack.track_width;
    const height = videoTrack.video.height || videoTrack.track_height;
    const total  = videoTrack.nb_samples || videoSamples.length;

    // ── Up-front rejections. Fail loudly before touching a single frame. ─────
    if (width % 2 !== 0 || height % 2 !== 0) {
      throw new Error(
        `Video is ${width}×${height}. H.264 needs even dimensions in both axes, ` +
        `so this file cannot be re-encoded without rescaling, which would change the output.`
      );
    }

    const config   = detectVideoWatermarkConfig(width, height);
    const resolved = await this._resolveAlphaMap(width, height);

    // The resolved capture size is authoritative for the box; the config only
    // supplies margins. Otherwise the map and the box could disagree.
    const position = calculateVideoWatermarkPosition(width, height, { ...config, logoSize: resolved.size });

    // ── The two asserts that keep removeWatermark() in bounds. ───────────────
    // Neither failure mode throws on its own: a short map reads undefined →
    // NaN → clamps to 0 (black pixels), and an x past the right edge wraps into
    // the next row. Both corrupt silently, so refuse to start.
    if (resolved.alphaMap.length !== position.width * position.height) {
      throw new Error(
        `Alpha map size mismatch: map has ${resolved.alphaMap.length} entries but the ` +
        `${position.width}×${position.height} box needs ${position.width * position.height}. ` +
        `Refusing to process — a short map reads out of range and writes black pixels.`
      );
    }
    if (!isPositionWithinFrame(position, width, height)) {
      throw new Error(
        `Watermark box (x=${position.x}, y=${position.y}, ${position.width}×${position.height}) ` +
        `does not fit inside the ${width}×${height} frame. Refusing to process — an out-of-range ` +
        `box wraps into neighbouring rows and corrupts them.`
      );
    }

    const durationSec = videoTrack.duration / videoTrack.timescale;
    const fps = durationSec > 0 ? total / durationSec : 30;

    // ── One-shot diagnostic line, so a wrong capture is visible in console ───
    console.log(
      `[Growmark video] frame ${width}×${height} | ` +
      `watermark ${resolved.size}px box at (${position.x},${position.y}) ${position.width}×${position.height} | ` +
      `${total} frames @ ${fps.toFixed(3)} fps | ` +
      `alpha map: ${this.alphaMapSource.label || 'unlabelled'}`
    );

    const audioInfo = this._planAudio(audioTrack, audioDescription);

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: fps },
      audio: audioInfo ? {
        codec: audioInfo.codec,
        numberOfChannels: audioInfo.numberOfChannels,
        sampleRate: audioInfo.sampleRate
      } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    });

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let processed = 0;
    let encodedFrames = 0;
    let failure = null;

    // ── Encoder ─────────────────────────────────────────────────────────────
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try { muxer.addVideoChunk(chunk, meta); }
        catch (err) { failure = failure || new Error(`Muxing a video frame failed: ${err.message}`); }
      },
      error: err => { failure = failure || new Error(`Video encoding failed: ${err.message}`); }
    });

    const encoderConfig = await this._pickEncoderConfig(width, height, fps);
    encoder.configure(encoderConfig);

    // ── Decoder: draw → remove → re-encode with the ORIGINAL timestamps ──────
    const decoder = new VideoDecoder({
      output: frame => {
        // frame.close() must happen on every path — WebCodecs frames hold GPU
        // memory and leaking them crashes the tab within a few hundred frames.
        try {
          if (failure) return;
          ctx.drawImage(frame, 0, 0);
          const imageData = ctx.getImageData(0, 0, width, height);

          removeWatermark(imageData, resolved.alphaMap, position); // protected, unmodified

          ctx.putImageData(imageData, 0, 0);

          // Copying timestamp and duration exactly is what prevents A/V drift.
          const cleaned = new VideoFrame(canvas, {
            timestamp: frame.timestamp,
            duration: frame.duration ?? undefined
          });
          try {
            encoder.encode(cleaned, { keyFrame: encodedFrames % KEYFRAME_INTERVAL === 0 });
            encodedFrames++;
          } finally {
            cleaned.close();
          }

          processed++;
          this.onProgress({ processed, total, stage: 'processing' });
        } catch (err) {
          failure = failure || new Error(`Frame processing failed: ${err.message}`);
        } finally {
          frame.close();
        }
      },
      error: err => { failure = failure || new Error(`Video decoding failed: ${err.message}`); }
    });

    const decoderConfig = { codec: videoTrack.codec, codedWidth: width, codedHeight: height };
    if (videoDescription) decoderConfig.description = videoDescription;
    decoder.configure(decoderConfig);

    // ── Stream frames with backpressure ─────────────────────────────────────
    this.onStage('processing', 'Removing watermark…');
    for (const sample of videoSamples) {
      this._throwIfAborted();
      if (failure) break;

      while (encoder.encodeQueueSize > MAX_ENCODE_QUEUE || decoder.decodeQueueSize > MAX_ENCODE_QUEUE) {
        if (failure) break;
        await nextTick();
      }

      decoder.decode(new EncodedVideoChunk({
        type: sample.isSync ? 'key' : 'delta',
        timestamp: toMicros(sample.cts, sample.timescale),
        duration:  toMicros(sample.duration, sample.timescale),
        data: sample.data
      }));
    }

    await decoder.flush();
    await encoder.flush();
    decoder.close();
    encoder.close();

    if (failure) throw failure;

    // ── Audio: encoded chunks passed straight through, never re-encoded ──────
    if (audioInfo) {
      this.onStage('audio', 'Copying audio track…');
      let first = true;
      for (const sample of audioSamples) {
        const meta = first
          ? { decoderConfig: {
                codec: audioTrack.codec,
                sampleRate: audioInfo.sampleRate,
                numberOfChannels: audioInfo.numberOfChannels,
                description: audioInfo.description
              } }
          : undefined;
        muxer.addAudioChunkRaw(
          sample.data,
          sample.isSync ? 'key' : 'delta',
          toMicros(sample.cts, sample.timescale),
          toMicros(sample.duration, sample.timescale),
          meta
        );
        first = false;
      }
    }

    this.onStage('finalising', 'Writing MP4…');
    muxer.finalize();

    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });

    return {
      blob,
      stats: {
        frames: processed,
        width, height,
        fps,
        durationSec,
        audio: audioInfo ? 'passthrough' : 'none',
        alphaMapLabel: this.alphaMapSource.label || 'unlabelled',
        provisional: this.alphaMapSource.provisional !== false
      }
    };
  }

  /**
   * Decide how audio is handled. Audio is passed through untouched or the run
   * fails — it is never silently dropped, because silent output is the single
   * most common failure of this pipeline.
   */
  _planAudio(audioTrack, audioDescription) {
    if (!audioTrack) return null; // genuinely no audio track in the source

    const codec = String(audioTrack.codec || '');
    let muxCodec = null;
    if (codec.startsWith('mp4a.40')) muxCodec = 'aac';
    else if (codec.startsWith('opus')) muxCodec = 'opus';

    if (!muxCodec) {
      throw new Error(
        `This file's audio is "${codec}", which cannot be copied through without re-encoding. ` +
        `Refusing to produce a silent video. Convert the audio to AAC and try again.`
      );
    }
    if (muxCodec === 'aac' && !audioDescription) {
      throw new Error(
        'The AAC audio configuration (esds) could not be read from this file, so the audio track ' +
        'cannot be copied through. Refusing to produce a silent video.'
      );
    }

    return {
      codec: muxCodec,
      numberOfChannels: audioTrack.audio.channel_count,
      sampleRate: audioTrack.audio.sample_rate,
      description: audioDescription
    };
  }

  /** Pick the first H.264 profile this browser will actually accept. */
  async _pickEncoderConfig(width, height, fps) {
    const bitrate = Math.max(1_000_000, Math.min(20_000_000, Math.round(width * height * fps * 0.12)));
    const candidates = ['avc1.640028', 'avc1.4D0028', 'avc1.42E028', 'avc1.42001E'];

    for (const codec of candidates) {
      const config = {
        codec, width, height,
        bitrate,
        framerate: fps,
        avc: { format: 'avc' } // AVCC / length-prefixed, which is what the muxer writes
      };
      try {
        const check = await VideoEncoder.isConfigSupported(config);
        if (check.supported) return config;
      } catch { /* try the next profile */ }
    }

    throw new Error(
      `This browser cannot encode H.264 at ${width}×${height}. Either this build has no H.264 ` +
      `encoder (some Chromium builds ship without it) or the resolution exceeds what the ` +
      `available encoder supports.`
    );
  }
}
