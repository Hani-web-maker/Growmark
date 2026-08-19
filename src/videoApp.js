import { VideoEngine } from './core/videoEngine.js';
import { createProvisionalAlphaMapSource } from './core/videoWatermarkConfig.js';

let engine = null;
let currentUrl = null;
let abortController = null;

const fileInput      = document.getElementById('fileInput');
const runBtn         = document.getElementById('runBtn');
const cancelBtn      = document.getElementById('cancelBtn');
const progressBar    = document.getElementById('progressBar');
const progressText   = document.getElementById('progressText');
const stageText      = document.getElementById('stageText');
const statusMessage  = document.getElementById('statusMessage');
const resultVideo    = document.getElementById('resultVideo');
const downloadLink   = document.getElementById('downloadLink');
const statsText      = document.getElementById('statsText');
const advisory       = document.getElementById('advisory');
const gateMessage    = document.getElementById('gateMessage');
// Present on video.html, absent on the dev harness — everything below is guarded.
const uploadArea     = document.getElementById('uploadArea');
const originalVideo  = document.getElementById('originalVideo');

let originalUrl = null;

function setStatus(msg, type) {
    if (!statusMessage) return;
    statusMessage.textContent = msg || '';
    statusMessage.style.display = msg ? 'block' : 'none';
    statusMessage.className = 'status';
    if (type) statusMessage.classList.add('status-' + type);
}

function setStage(text) {
    if (stageText) stageText.textContent = text || '';
}

function setProgress(processed, total) {
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    if (progressBar) {
        if (progressBar.tagName === 'PROGRESS') progressBar.value = pct;
        else progressBar.style.width = pct + '%';
    }
    if (progressText) progressText.textContent = `${processed} / ${total} frames  (${pct}%)`;
}

/**
 * The demuxer reads ISO-BMFF (MP4/MOV). WebM is a different container it cannot
 * parse, so reject it here with a clear message rather than letting it surface
 * as an opaque parse error deep in the pipeline.
 */
function validateFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.webm') || file.type === 'video/webm') {
        setStatus('WebM files are not supported yet — this tool reads MP4 and MOV. ' +
                  'Please convert the clip to MP4 and try again.', 'error');
        return false;
    }
    return true;
}

function showOriginal(file) {
    if (!originalVideo) return;
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = URL.createObjectURL(file);
    originalVideo.src = originalUrl;
}

/**
 * Capability gate — first thing, before any file is accepted. If WebCodecs is
 * missing we say exactly what is missing and stop; we never half-process.
 */
function checkCapabilities() {
    const { supported, missing } = VideoEngine.checkSupport();
    if (supported) return true;

    if (gateMessage) {
        gateMessage.style.display = 'block';
        gateMessage.innerHTML =
            '<strong>This browser cannot run video processing.</strong>' +
            '<p>Video removal needs the WebCodecs API. Missing here: <code>' +
            missing.join('</code>, <code>') + '</code>.</p>' +
            '<p>Chrome, Edge or Opera 94+ on desktop support these. Firefox and Safari ' +
            'do not yet expose the full set.</p>';
    }
    if (fileInput) fileInput.disabled = true;
    if (runBtn) runBtn.disabled = true;
    if (uploadArea) uploadArea.classList.add('is-disabled');
    return false;
}

/**
 * Desktop-only advisory. Warns but never blocks — the user can still proceed.
 */
function checkEnvironmentAdvisory() {
    const reasons = [];
    const narrow = window.matchMedia('(max-width: 820px)').matches;
    const mem = navigator.deviceMemory;

    if (narrow) reasons.push('a narrow screen (this looks like a phone or tablet)');
    if (typeof mem === 'number' && mem <= 4) reasons.push(`about ${mem} GB of device memory`);

    if (reasons.length && advisory) {
        advisory.style.display = 'block';
        advisory.textContent =
            'Heads up: browser video processing is memory-heavy and may fail or crash the tab on ' +
            'this device — we detected ' + reasons.join(' and ') + '. A desktop with 8 GB or more ' +
            'is recommended. You can still continue if you want to try.';
    }
}

function init() {
    if (!checkCapabilities()) return;
    checkEnvironmentAdvisory();
    setupEventListeners();
}

function acceptSelection() {
    setStatus('');
    const file = fileInput.files[0];
    if (!file) { runBtn.disabled = true; return; }
    if (!validateFile(file)) { runBtn.disabled = true; return; }
    showOriginal(file);
    runBtn.disabled = false;
}

function setupEventListeners() {
    fileInput.addEventListener('change', acceptSelection);

    if (uploadArea) {
        uploadArea.addEventListener('click', () => { if (!fileInput.disabled) fileInput.click(); });
        uploadArea.addEventListener('keydown', e => {
            if ((e.key === 'Enter' || e.key === ' ') && !fileInput.disabled) { e.preventDefault(); fileInput.click(); }
        });
        uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
        uploadArea.addEventListener('drop', e => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            if (fileInput.disabled || !e.dataTransfer.files.length) return;
            fileInput.files = e.dataTransfer.files;
            acceptSelection();
        });
    }
    runBtn.addEventListener('click', run);
    cancelBtn.addEventListener('click', () => {
        if (abortController) abortController.abort();
    });
}

async function run() {
    const file = fileInput.files[0];
    if (!file) return;
    if (!validateFile(file)) return;
    showOriginal(file);

    runBtn.disabled = true;
    cancelBtn.disabled = false;
    setStatus('');
    setProgress(0, 0);
    if (resultVideo) resultVideo.style.display = 'none';
    if (downloadLink) downloadLink.style.display = 'none';
    if (statsText) statsText.textContent = '';

    abortController = new AbortController();

    engine = new VideoEngine({
        alphaMapSource: createProvisionalAlphaMapSource(),
        onProgress: ({ processed, total }) => setProgress(processed, total),
        onStage: (stage, detail) => setStage(detail || stage),
        signal: abortController.signal
    });

    const startedAt = performance.now();

    try {
        const { blob, stats } = await engine.process(file);

        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = URL.createObjectURL(blob);

        resultVideo.src = currentUrl;
        resultVideo.style.display = 'block';

        downloadLink.href = currentUrl;
        downloadLink.download = 'growmark_' + file.name.replace(/\.[^.]+$/, '') + '.mp4';
        downloadLink.style.display = 'inline-block';

        const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
        statsText.textContent =
            `${stats.width}×${stats.height} · ${stats.frames} frames · ${stats.fps.toFixed(2)} fps · ` +
            `audio: ${stats.audio} · ${(blob.size / 1048576).toFixed(1)} MB · ${seconds}s\n` +
            `alpha map: ${stats.alphaMapLabel}`;

        setStage('Done');
        setStatus(
            'Experimental result. Video calibration is provisional, so results vary — ' +
            'check the output before using it.',
            'warn'
        );
    } catch (err) {
        setStage('');
        setStatus(err && err.message ? err.message : 'Processing failed.', 'error');
        console.error(err);
    } finally {
        runBtn.disabled = false;
        cancelBtn.disabled = true;
        abortController = null;
    }
}

init();
