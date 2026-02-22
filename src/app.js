import { WatermarkEngine } from './core/watermarkEngine.js';
import { loadImage, checkOriginal } from './utils.js';
import JSZip from 'jszip';
import mediumZoom from 'medium-zoom';

let engine = null;
let imageQueue = [];
let processedCount = 0;
let zoom = null;

const uploadArea       = document.getElementById('uploadArea');
const fileInput        = document.getElementById('fileInput');
const singlePreview    = document.getElementById('singlePreview');
const multiPreview     = document.getElementById('multiPreview');
const imageList        = document.getElementById('imageList');
const progressText     = document.getElementById('progressText');
const downloadAllBtn   = document.getElementById('downloadAllBtn');
const originalImage    = document.getElementById('originalImage');
const processedSection = document.getElementById('processedSection');
const processedImage   = document.getElementById('processedImage');
const originalInfo     = document.getElementById('originalInfo');
const processedInfo    = document.getElementById('processedInfo');
const downloadBtn      = document.getElementById('downloadBtn');
const resetBtn         = document.getElementById('resetBtn');
const loadingOverlay   = document.getElementById('loadingOverlay');
const statusMessage    = document.getElementById('statusMessage');

function showLoading(text) {
    loadingOverlay.style.display = 'flex';
    const el = loadingOverlay.querySelector('p');
    if (el && text) el.textContent = text;
}
function hideLoading() { loadingOverlay.style.display = 'none'; }

function setStatus(msg, type) {
    if (!statusMessage) return;
    statusMessage.textContent = msg || '';
    statusMessage.style.display = msg ? 'block' : 'none';
    statusMessage.className = 'status-msg';
    if (type) statusMessage.classList.add('status-' + type);
}

async function init() {
    document.body.classList.remove('loading');
    try {
        showLoading('Initialising Growmark Engine…');
        engine = await WatermarkEngine.create();
        hideLoading();
        setupEventListeners();
        zoom = mediumZoom('[data-zoomable]', {
            margin: 24, scrollOffset: 0,
            background: 'rgba(11,60,93,0.9)',
        });
    } catch (err) {
        hideLoading();
        setStatus('Engine initialisation failed. Please refresh.', 'error');
        console.error(err);
    }
}

function setupEventListeners() {
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => handleFiles(Array.from(e.target.files)));
    uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', e => {
        e.preventDefault(); uploadArea.classList.remove('dragover');
        handleFiles(Array.from(e.dataTransfer.files));
    });
    downloadAllBtn.addEventListener('click', downloadAll);
    resetBtn.addEventListener('click', reset);
}

function reset() {
    singlePreview.style.display = 'none';
    multiPreview.style.display  = 'none';
    imageQueue = []; processedCount = 0;
    fileInput.value = ''; setStatus('');
    if (processedSection) processedSection.style.display = 'none';
    if (downloadBtn) downloadBtn.style.display = 'none';
}

function handleFiles(files) {
    const valid = files.filter(f => f.type.match('image/(jpeg|png|webp)') && f.size <= 20 * 1024 * 1024);
    if (!valid.length) { setStatus('Please upload JPG, PNG or WebP images under 20 MB.', 'warn'); return; }
    imageQueue.forEach(item => {
        if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
        if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);
    });
    imageQueue = valid.map((file, i) => ({
        id: Date.now() + i, file, name: file.name, status: 'pending',
        originalImg: null, processedBlob: null, originalUrl: null, processedUrl: null,
    }));
    processedCount = 0;
    if (valid.length === 1) {
        singlePreview.style.display = 'block'; multiPreview.style.display = 'none';
        processSingle(imageQueue[0]);
    } else {
        singlePreview.style.display = 'none'; multiPreview.style.display = 'block';
        imageList.innerHTML = ''; downloadAllBtn.style.display = 'none'; updateProgress();
        multiPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        imageQueue.forEach(item => createImageCard(item));
        processQueue();
    }
}

async function processSingle(item) {
    showLoading('Analysing image…');
    try {
        const img = await loadImage(item.file);
        item.originalImg = img;
        originalImage.src = img.src;

        const { is_google, is_original } = await checkOriginal(item.file);
        if (!is_google) setStatus('Note: Image does not appear to be a Gemini AI image.', 'warn');
        else if (!is_original) setStatus('Note: This may not be the original uncompressed file.', 'warn');
        else setStatus('');

        const wm = engine.getWatermarkInfo(img.width, img.height);
        originalInfo.textContent = img.width + ' × ' + img.height + ' px  ·  Watermark: ' + wm.size + 'px @ (' + wm.position.x + ',' + wm.position.y + ')';

        showLoading('Removing watermark…');
        const result = await engine.removeWatermarkFromImage(img);
        const blob   = await new Promise(res => result.toBlob(res, 'image/png'));
        item.processedBlob = blob;
        item.processedUrl  = URL.createObjectURL(blob);
        processedImage.src = item.processedUrl;
        processedInfo.textContent = img.width + ' × ' + img.height + ' px  ·  Watermark removed ✓';
        processedSection.style.display = 'block';
        downloadBtn.style.display = 'flex';
        downloadBtn.onclick = () => downloadImage(item);
        zoom.detach(); zoom.attach('[data-zoomable]');
        processedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        hideLoading();
    } catch (err) {
        hideLoading(); setStatus('Processing failed. Please try again.', 'error'); console.error(err);
    }
}

function createImageCard(item) {
    const card = document.createElement('div');
    card.id = 'card-' + item.id;
    card.className = 'gm-card';
    card.innerHTML =
        '<div class="gm-card-inner">' +
            '<div class="gm-card-thumb-wrap"><img id="result-' + item.id + '" class="gm-card-thumb" data-zoomable alt="' + item.name + '" /></div>' +
            '<div class="gm-card-body"><p class="gm-card-name" title="' + item.name + '">' + item.name + '</p><p id="status-' + item.id + '" class="gm-card-status">Queued…</p></div>' +
            '<div class="gm-card-action"><button id="download-' + item.id + '" class="gm-btn-dl hidden"><svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>Download</button></div>' +
        '</div>';
    imageList.appendChild(card);
}

async function processQueue() {
    await Promise.all(imageQueue.map(async item => {
        const img = await loadImage(item.file);
        item.originalImg = img; item.originalUrl = img.src;
        const el = document.getElementById('result-' + item.id);
        if (el) { el.src = img.src; zoom.attach('#result-' + item.id); }
    }));
    const C = 3;
    for (let i = 0; i < imageQueue.length; i += C) {
        await Promise.all(imageQueue.slice(i, i + C).map(processItem));
    }
    if (processedCount > 0) downloadAllBtn.style.display = 'flex';
}

async function processItem(item) {
    if (item.status !== 'pending') return;
    item.status = 'processing';
    setCardStatus(item.id, '⚙ Processing…', 'proc');
    try {
        const result = await engine.removeWatermarkFromImage(item.originalImg);
        const blob   = await new Promise(res => result.toBlob(res, 'image/png'));
        item.processedBlob = blob; item.processedUrl = URL.createObjectURL(blob);
        const el = document.getElementById('result-' + item.id);
        if (el) el.src = item.processedUrl;
        const wm = engine.getWatermarkInfo(item.originalImg.width, item.originalImg.height);
        setCardStatus(item.id, item.originalImg.width + '×' + item.originalImg.height + '  WM ' + wm.size + 'px removed ✓', 'done');
        const dlBtn = document.getElementById('download-' + item.id);
        if (dlBtn) { dlBtn.classList.remove('hidden'); dlBtn.onclick = () => downloadImage(item); }
        item.status = 'completed'; processedCount++; updateProgress();
    } catch (err) {
        item.status = 'error'; setCardStatus(item.id, '✕ Failed', 'error'); console.error(err);
    }
}

function setCardStatus(id, text, state) {
    const el = document.getElementById('status-' + id);
    if (!el) return;
    el.textContent = text; el.className = 'gm-card-status';
    if (state) el.classList.add(state);
}

function updateProgress() {
    if (progressText) progressText.textContent = 'Processed: ' + processedCount + ' / ' + imageQueue.length;
}

function downloadImage(item) {
    const a = document.createElement('a');
    a.href = item.processedUrl;
    a.download = 'growmark_' + item.name.replace(/\.[^.]+$/, '') + '.png';
    a.click();
}

async function downloadAll() {
    const done = imageQueue.filter(i => i.status === 'completed');
    if (!done.length) return;
    const zip = new JSZip();
    done.forEach(item => zip.file('growmark_' + item.name.replace(/\.[^.]+$/, '') + '.png', item.processedBlob));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'growmark_batch_' + Date.now() + '.zip';
    a.click();
}

init();
