/**
 * Barrister Pro — Frontend Intelligence Engine
 * Specialized for high-precision legal analysis
 */

// ==================== Upload State Machine ====================
// States: IDLE | UPLOADING | SUCCESS | ERROR | TIMEOUT
// The UI MUST always reflect the true application state.
// Nothing moves forward until the backend confirms success.

const UploadState = Object.freeze({
    IDLE:      'IDLE',
    UPLOADING: 'UPLOADING',
    SUCCESS:   'SUCCESS',
    ERROR:     'ERROR',
    TIMEOUT:   'TIMEOUT',
});

let uploadState = UploadState.IDLE;

// Config
const UPLOAD_TIMEOUT_MS   = 90_000;  // 90 s — abort the request
const UPLOAD_SLOW_WARN_MS = 15_000;  // 15 s — show "taking longer than expected"
const MAX_FILE_SIZE_MB    = 200;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// ==================== General State ====================
let isProcessing    = false;
let abortController = null;
let uploadAbort     = null;   // separate controller for the upload fetch
let slowWarnTimer   = null;
let timeoutTimer    = null;

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    // Sidebar analysis buttons
    document.getElementById('navFull').addEventListener('click',    () => runAnalysis('full'));
    document.getElementById('navSummary').addEventListener('click', () => runAnalysis('summary'));
    document.getElementById('navRisks').addEventListener('click',   () => runAnalysis('risks'));
    document.getElementById('navKeys').addEventListener('click',    () => runAnalysis('keypoints'));

    // Upload listeners on the initial DOM elements
    attachUploadListeners();

    // Chat Enter
    document.getElementById('questionInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            askQuestion();
        }
    });

    showView('workspace');
});

// ==================== Navigation ====================
function showView(viewId) {
    const views = ['workspace'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === viewId) ? 'block' : 'none';
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('onclick')?.includes(viewId) || item.id?.includes(viewId)) {
            item.classList.add('active');
        } else if (item.getAttribute('onclick')?.includes('showView')) {
            item.classList.remove('active');
        }
    });
}

// ==================== Upload: Entry Point ====================

/**
 * Called when the user selects or drops a file.
 * Runs pre-flight validation BEFORE touching the upload UI or making any request.
 */
function handleUpload(file) {
    // Ignore if we're mid-upload
    if (uploadState === UploadState.UPLOADING) return;

    // ── Pre-flight validation ──────────────────────────────
    const validationError = validateFile(file);
    if (validationError) {
        showValidationError(validationError);
        return;
    }

    // ── All good — start the upload ───────────────────────
    startUpload(file);
}

/**
 * Validates the file before the request. Returns an error string or null.
 */
function validateFile(file) {
    if (!file) {
        return 'No file selected. Please choose a PDF document.';
    }
    if (file.size === 0) {
        return 'This file is empty. Please select a valid PDF document.';
    }
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        return 'Only PDF files are supported. Please select a .pdf document.';
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(0);
        return `File is too large (${sizeMB} MB). Maximum size is ${MAX_FILE_SIZE_MB} MB.`;
    }
    return null;
}

/**
 * Show an inline validation error inside the idle upload zone.
 * Does NOT replace the upload zone — user can still retry.
 */
function showValidationError(message) {
    // Remove any previous validation message
    const existing = document.getElementById('validationMsg');
    if (existing) existing.remove();

    const uploadArea = document.getElementById('uploadArea');
    if (!uploadArea) return;

    const msg = document.createElement('div');
    msg.id = 'validationMsg';
    msg.className = 'upload-validation-msg';
    msg.setAttribute('role', 'alert');
    msg.innerHTML = `<i class="fas fa-circle-exclamation" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;

    uploadArea.appendChild(msg);

    // Auto-clear after 6 seconds
    setTimeout(() => {
        if (msg.parentNode) msg.remove();
    }, 6000);
}

// ==================== Upload: State Transitions ====================

/**
 * IDLE → UPLOADING
 * Sets state, shows uploading UI, starts fetch with timeout.
 */
async function startUpload(file) {
    uploadState = UploadState.UPLOADING;
    isProcessing = true;

    // Mark sidebar AI item
    const navAI = document.querySelector('.nav-item[onclick*="showView"]');
    if (navAI) navAI.classList.add('processing');

    // Show uploading phase
    showUploadingPhase(file);

    // Set up timers
    uploadAbort = new AbortController();

    slowWarnTimer = setTimeout(() => {
        if (uploadState === UploadState.UPLOADING) {
            showSlowWarning();
        }
    }, UPLOAD_SLOW_WARN_MS);

    timeoutTimer = setTimeout(() => {
        if (uploadState === UploadState.UPLOADING) {
            uploadAbort.abort('timeout');
        }
    }, UPLOAD_TIMEOUT_MS);

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData,
            signal: uploadAbort.signal,
        });

        // Clear timers on any response
        clearUploadTimers();

        // Parse the response — handle malformed JSON gracefully
        let data;
        try {
            data = await response.json();
        } catch {
            throw new Error('The server returned an unexpected response. Please try again.');
        }

        if (!response.ok && !data?.success) {
            // HTTP error (4xx/5xx) with no useful body
            throw new Error(data?.error || `Server error (${response.status}). Please try again.`);
        }

        if (data.success) {
            // ── UPLOADING → SUCCESS ──
            transitionToSuccess(data.doc_info, data.filename, navAI);
        } else {
            // Backend returned success:false with an error message
            throw new Error(data.error || 'Upload failed. Please try again.');
        }

    } catch (err) {
        clearUploadTimers();

        if (navAI) navAI.classList.remove('processing');

        // Determine whether the abort was a timeout or a user/other cancel.
        // uploadAbort.abort('timeout') sets signal.reason === 'timeout'.
        const isTimeout = err?.name === 'AbortError' &&
            (uploadAbort?.signal?.reason === 'timeout' ||
             err?.message === 'timeout' ||
             String(err?.cause ?? '').includes('timeout'));

        if (isTimeout) {
            // ── UPLOADING → TIMEOUT ──
            uploadState = UploadState.TIMEOUT;
            isProcessing = false;
            showTimeoutPhase(file);
        } else if (err?.name === 'AbortError') {
            // Aborted by user (future cancel button) — restore idle silently
            uploadState = UploadState.IDLE;
            isProcessing = false;
            restoreIdleState();
        } else {
            // ── UPLOADING → ERROR ──
            uploadState = UploadState.ERROR;
            isProcessing = false;
            showErrorPhase(err.message || 'An unexpected error occurred. Please try again.', file);
        }
    }
}

function clearUploadTimers() {
    clearTimeout(slowWarnTimer);
    clearTimeout(timeoutTimer);
    slowWarnTimer = null;
    timeoutTimer  = null;
}

/**
 * UPLOADING → SUCCESS
 * Only called after backend confirms success.
 */
function transitionToSuccess(docInfo, filename, navAI) {
    uploadState = UploadState.SUCCESS;

    if (navAI) navAI.classList.remove('processing');

    // Update doc pill (hidden in top nav until workspace shows)
    const docPill = document.getElementById('docPill');
    if (docPill) {
        docPill.style.display = 'inline-flex';
        const docNameEl = document.getElementById('docName');
        if (docNameEl) docNameEl.textContent = filename;
    }

    // Show complete/indexed phase, then move to workspace
    showCompletePhase(docInfo, filename, () => {
        transitionToWorkspace();
    });
}

// ==================== Upload: Phase Renderers ====================

/**
 * Renders the animated uploading state inside the hero card.
 * Only called after a real file has been selected and validated.
 * Uses ua-* classes so UploadAnimator can target elements by stable selectors.
 */
function showUploadingPhase(file) {
    const hero = document.querySelector('#uploadSection .pro-card.hero');
    if (!hero) return;

    const sizeStr = formatFileSize(file.size);

    // 12 text lines inside the document card visual
    let linesHTML = '';
    for (let i = 0; i < 12; i++) {
        linesHTML += `<div class="upload-doc-scan__line" aria-hidden="true"></div>`;
    }

    hero.innerHTML = `
        <div class="upload-uploading" id="uploadingPhase" role="status" aria-live="polite" aria-label="Uploading ${escapeHtml(file.name)}">

            <div class="upload-doc-scan ua-doc-card" aria-hidden="true">
                <div class="upload-doc-scan__corner"></div>
                ${linesHTML}
                <div class="upload-doc-scan__beam ua-scan-line"></div>
            </div>

            <div class="upload-uploading__meta">
                <span class="upload-uploading__label">Uploading document</span>
                <span class="upload-uploading__filename" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                <span class="upload-uploading__filesize">${sizeStr}</span>
            </div>

            <div class="upload-progress" aria-hidden="true">
                <div class="upload-progress__track">
                    <div class="upload-progress__fill ua-shimmer-track">
                        <div class="upload-progress__shimmer ua-shimmer-fill"></div>
                    </div>
                </div>
                <div class="upload-progress__label">
                    <span class="upload-progress__text" id="uploadProgressText">Transferring to intelligence engine</span>
                    <span class="upload-thinking ua-dots" aria-hidden="true">
                        <span class="ua-dot"></span>
                        <span class="ua-dot"></span>
                        <span class="ua-dot"></span>
                    </span>
                </div>
            </div>

        </div>
    `;

    // Animate the phase entering, then start the continuous upload loops
    const phase = document.getElementById('uploadingPhase');
    phase.style.opacity   = '0';
    phase.style.transform = 'translateY(20px) scale(0.97)';

    UploadAnimator.playEnter(phase, () => {
        UploadAnimator.startUploading(phase);
    });
}

/**
 * Injects a "taking longer than expected" warning into the uploading phase.
 * Does NOT cancel the request. Upload is still active.
 */
function showSlowWarning() {
    const phase = document.getElementById('uploadingPhase');
    if (!phase) return;

    // Don't add twice
    if (phase.querySelector('.upload-slow-warning')) return;

    const warning = document.createElement('div');
    warning.className = 'upload-slow-warning';
    warning.setAttribute('role', 'status');
    warning.setAttribute('aria-live', 'polite');
    warning.innerHTML = `
        <i class="fas fa-clock" aria-hidden="true"></i>
        <span>Upload is taking longer than expected. Still working&hellip;</span>
    `;
    phase.appendChild(warning);

    // Update progress label
    const label = document.getElementById('uploadProgressText');
    if (label) label.classList.add('slow');
}

/**
 * Renders the success / indexed phase.
 * Stats animate only after this is called — never before backend confirms.
 */
function showCompletePhase(docInfo, filename, onDone) {
    const hero = document.querySelector('#uploadSection .pro-card.hero');
    if (!hero) return;

    hero.innerHTML = `
        <div class="upload-complete" role="status" aria-live="assertive" aria-label="Document indexed successfully">
            <div class="upload-complete__check" aria-hidden="true">
                <i class="fas fa-check"></i>
            </div>
            <p class="upload-complete__title">Document Indexed</p>
            <p class="upload-complete__subtitle">${escapeHtml(filename)} is ready for analysis</p>

            <div class="upload-complete__stats" aria-label="Document statistics">
                <div class="upload-complete__stat" id="cstat-pages">
                    <span class="upload-complete__stat-value" id="cstat-pages-val">0</span>
                    <span class="upload-complete__stat-label">Pages</span>
                </div>
                <div class="upload-complete__stat" id="cstat-sections">
                    <span class="upload-complete__stat-value" id="cstat-sections-val">0</span>
                    <span class="upload-complete__stat-label">Sections</span>
                </div>
                <div class="upload-complete__stat" id="cstat-chars">
                    <span class="upload-complete__stat-value" id="cstat-chars-val">0</span>
                    <span class="upload-complete__stat-label">Characters</span>
                </div>
            </div>
        </div>
    `;

    // Staggered stat reveals — real values from docInfo
    [
        { id: 'cstat-pages',    valId: 'cstat-pages-val',    value: docInfo.total_pages       || 0, fmt: v => v,              delay: 120 },
        { id: 'cstat-sections', valId: 'cstat-sections-val', value: docInfo.total_sections    || 0, fmt: v => v,              delay: 260 },
        { id: 'cstat-chars',    valId: 'cstat-chars-val',    value: docInfo.total_characters  || 0, fmt: formatCharsCounter,  delay: 400 },
    ].forEach(({ id, valId, value, fmt, delay }) => {
        setTimeout(() => {
            const stat  = document.getElementById(id);
            const valEl = document.getElementById(valId);
            if (stat)  stat.classList.add('stat-visible');
            animateCounter(valEl, value, 900, fmt);
        }, delay);
    });

    setTimeout(onDone, 1900);
}

/**
 * Renders the error phase.
 * @param {string} message  — human-readable error from the server or network
 * @param {File}   file     — original file (for retry)
 */
function showErrorPhase(message, file) {
    const hero = document.querySelector('#uploadSection .pro-card.hero');
    if (!hero) return;

    // Humanise the message slightly — strip technical fetch noise
    const displayMsg = humaniseError(message);

    hero.innerHTML = `
        <div class="upload-error" role="alert" aria-label="Upload failed">
            <div class="upload-error__icon" aria-hidden="true">
                <i class="fas fa-xmark"></i>
            </div>
            <p class="upload-error__title">Upload Failed</p>
            <p class="upload-error__message">Your document could not be uploaded to the intelligence engine.</p>
            ${displayMsg ? `<p class="upload-error__detail" aria-live="polite">${escapeHtml(displayMsg)}</p>` : ''}
            <div class="upload-error__actions">
                <button class="upload-btn upload-btn--primary" id="retryBtn" aria-label="Try uploading again">
                    <i class="fas fa-arrow-rotate-right" aria-hidden="true"></i>
                    Try Again
                </button>
                <button class="upload-btn upload-btn--ghost" id="cancelBtn" aria-label="Cancel and return to upload area">
                    Cancel
                </button>
            </div>
        </div>
    `;

    document.getElementById('retryBtn')?.addEventListener('click', () => {
        restoreIdleState();
        // If we still have the file reference, retry immediately
        if (file) {
            // Small delay so the idle state renders before we kick off again
            setTimeout(() => handleUpload(file), 80);
        }
    });

    document.getElementById('cancelBtn')?.addEventListener('click', () => {
        restoreIdleState();
    });
}

/**
 * Renders the timeout phase.
 * @param {File} file — original file (for retry)
 */
function showTimeoutPhase(file) {
    const hero = document.querySelector('#uploadSection .pro-card.hero');
    if (!hero) return;

    hero.innerHTML = `
        <div class="upload-timeout" role="alert" aria-label="Upload timed out">
            <div class="upload-timeout__icon" aria-hidden="true">
                <i class="fas fa-clock"></i>
            </div>
            <p class="upload-timeout__title">Upload Timed Out</p>
            <p class="upload-timeout__message">
                The request took too long and was stopped. This can happen with very large documents
                or a slow connection. Your document was not uploaded.
            </p>
            <div class="upload-timeout__actions">
                <button class="upload-btn upload-btn--primary" id="retryBtn" aria-label="Try uploading again">
                    <i class="fas fa-arrow-rotate-right" aria-hidden="true"></i>
                    Try Again
                </button>
                <button class="upload-btn upload-btn--ghost" id="cancelBtn" aria-label="Cancel and return to upload area">
                    Cancel
                </button>
            </div>
        </div>
    `;

    document.getElementById('retryBtn')?.addEventListener('click', () => {
        restoreIdleState();
        if (file) {
            setTimeout(() => handleUpload(file), 80);
        }
    });

    document.getElementById('cancelBtn')?.addEventListener('click', () => {
        restoreIdleState();
    });
}

/**
 * Restore the upload card to its original IDLE state.
 * Re-attaches all listeners.
 */
function restoreIdleState() {
    uploadState  = UploadState.IDLE;
    isProcessing = false;
    clearUploadTimers();

    if (uploadAbort) {
        try { uploadAbort.abort(); } catch {}
        uploadAbort = null;
    }

    const uploadSection = document.getElementById('uploadSection');
    if (uploadSection) {
        uploadSection.style.opacity    = '1';
        uploadSection.style.transition = '';
    }

    const hero = document.querySelector('#uploadSection .pro-card.hero');
    if (!hero) return;

    hero.innerHTML = `
        <div class="pro-upload"
             id="uploadArea"
             role="button"
             tabindex="0"
             aria-label="Upload a PDF document for analysis. Click or drag and drop."
             onclick="if(!isProcessing) document.getElementById('fileInput').click()"
             onkeydown="if(!isProcessing && (event.key==='Enter'||event.key===' ')){event.preventDefault();document.getElementById('fileInput').click();}">
            <span class="upload-icon" aria-hidden="true"><i class="fas fa-scale-balanced"></i></span>
            <h3>Begin Document Analysis</h3>
            <p>Upload a legal PDF document to initialize the intelligence engine</p>
            <span class="upload-drop-msg" aria-hidden="true">Drop document to analyze</span>
            <input type="file" id="fileInput" accept=".pdf" hidden aria-label="Select PDF file">
            <div id="uploadStatus" class="upload-status" role="status" aria-live="polite"></div>
        </div>
        <div id="docStats" class="stats-grid" style="display: none;">
            <div class="stat-item">
                <span class="stat-value" id="infoPages">0</span>
                <span class="stat-label">Document Pages</span>
            </div>
            <div class="stat-item">
                <span class="stat-value" id="infoSections">0</span>
                <span class="stat-label">Identified Sections</span>
            </div>
            <div class="stat-item">
                <span class="stat-value" id="infoChars">0</span>
                <span class="stat-label">Character Units</span>
            </div>
        </div>
    `;

    attachUploadListeners();
}

// ==================== Upload: Workspace Transition ====================

function transitionToWorkspace() {
    const uploadSection = document.getElementById('uploadSection');
    if (uploadSection) {
        uploadSection.style.transition = 'opacity 0.4s ease';
        uploadSection.style.opacity    = '0';
    }

    setTimeout(() => {
        if (uploadSection) uploadSection.style.display = 'none';

        const intelligenceArea = document.getElementById('intelligenceArea');
        if (intelligenceArea) {
            intelligenceArea.style.display    = 'block';
            intelligenceArea.style.opacity    = '0';
            intelligenceArea.style.transition = '';
            intelligenceArea.classList.add('intelligence-enter');

            void intelligenceArea.offsetWidth; // force reflow
            intelligenceArea.style.opacity    = '1';
            intelligenceArea.style.transition = 'opacity 0.45s ease';
        }

        enableSidebarActions(true);
        isProcessing = false;
    }, 420);
}

// ==================== Upload: Listener Setup ====================

/**
 * Attaches drag/drop and file-input listeners.
 * Called on init and after any DOM operation that recreates #uploadArea / #fileInput.
 */
function attachUploadListeners() {
    const fileInput  = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    if (!fileInput || !uploadArea) return;

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleUpload(file);
    });

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (uploadState === UploadState.IDLE) {
            uploadArea.classList.add('active');
        }
    });

    uploadArea.addEventListener('dragleave', (e) => {
        if (!uploadArea.contains(e.relatedTarget)) {
            uploadArea.classList.remove('active');
        }
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('active');

        if (uploadState === UploadState.UPLOADING) return;

        const file = e.dataTransfer.files[0];
        if (file) {
            handleUpload(file);
        }
    });
}

// ==================== Animation Helpers ====================

function animateCounter(el, target, duration, formatter) {
    if (!el) return;
    const fmt = formatter || (v => v);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = fmt(target);
        return;
    }
    const startTime = performance.now();
    function easeOutExpo(t) {
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }
    function tick(now) {
        const elapsed  = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        el.textContent = fmt(Math.round(easeOutExpo(progress) * target));
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

function formatCharsCounter(count) {
    if (!count) return '0';
    if (count > 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
    if (count > 1_000)     return (count / 1_000).toFixed(1) + 'K';
    return String(count);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 KB';
    const kb = bytes / 1024;
    return kb > 1024
        ? (kb / 1024).toFixed(1) + ' MB'
        : Math.round(kb) + ' KB';
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Strip raw fetch/network noise from error messages shown to users.
 */
function humaniseError(message) {
    if (!message) return '';
    const msg = String(message);
    // Raw fetch failures
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION')) {
        return 'Could not connect to the server. Please check your connection.';
    }
    if (msg.includes('JSON') || msg.includes('Unexpected token')) {
        return 'The server returned an unexpected response. Please try again.';
    }
    return msg;
}

// ==================== Workspace Reset ====================

function resetWorkspace() {
    if (abortController) abortController.abort();

    clearUploadTimers();
    if (uploadAbort) {
        try { uploadAbort.abort(); } catch {}
        uploadAbort = null;
    }

    isProcessing = false;

    document.getElementById('intelligenceArea').style.display = 'none';

    const uploadSection = document.getElementById('uploadSection');
    uploadSection.style.display    = 'block';
    uploadSection.style.opacity    = '1';
    uploadSection.style.transition = '';

    restoreIdleState();

    const docPill = document.getElementById('docPill');
    if (docPill) docPill.style.display = 'none';

    document.getElementById('chatMessages').innerHTML = `
        <div class="msg bot">
            <p>Analysis cleared. Upload a new legal document to proceed.</p>
        </div>
    `;
    document.getElementById('reportsArea').innerHTML = '';

    enableSidebarActions(false);
    toggleProcessing(false);
}

// ==================== Sidebar ====================

function enableSidebarActions(enabled) {
    const ids = ['navFull', 'navSummary', 'navRisks', 'navKeys'];
    ids.forEach((id, index) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = !enabled;
        if (enabled) {
            btn.classList.add('ready');
            btn.classList.remove('nav-animate-in');
            void btn.offsetWidth;
            setTimeout(() => btn.classList.add('nav-animate-in'), index * 80);
        } else {
            btn.classList.remove('ready', 'nav-animate-in');
        }
    });
}

// ==================== Analysis Actions ====================

async function runAnalysis(type) {
    if (isProcessing) return;

    const endpoints = {
        'full':      { url: '/analyze',   key: 'analysis',      label: 'Pro Legal Audit' },
        'summary':   { url: '/summary',   key: 'summary',       label: 'Executive Summary' },
        'risks':     { url: '/risks',     key: 'risk_analysis', label: 'Risk Assessment' },
        'keypoints': { url: '/keypoints', key: 'key_points',    label: 'Key Obligations' },
    };

    const config = endpoints[type];
    if (!config) return;

    const loadingId = addBotMessage(`<div class="pro-spinner"></div> Analyzing <strong>${config.label}</strong>...`);
    updateChatStatus('Analyzing...', true);
    toggleProcessing(true);
    abortController = new AbortController();

    try {
        const response = await fetch(config.url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            signal:  abortController.signal,
        });

        const data = await response.json();
        removeMessage(loadingId);

        if (data.success) {
            const content = data[config.key] || 'Analysis unavailable.';
            addReportCard(config.label, content, data.sources);
            addBotMessage(`Analysis of <strong>${config.label}</strong> is complete. Information successfully added to your workspace.`);
        } else {
            addBotMessage(`❌ Analysis failed: ${data.error}`);
        }
    } catch (error) {
        removeMessage(loadingId);
        if (error.name !== 'AbortError') {
            addBotMessage('❌ Intelligent engine is temporarily unavailable.');
        }
    } finally {
        toggleProcessing(false);
        updateChatStatus('Ready', false);
    }
}

function stopProcess() {
    if (abortController) {
        abortController.abort();
        addBotMessage('🛑 Process stopped by user.');
    }
}

function toggleProcessing(processing) {
    isProcessing = processing;
    const sendBtn = document.getElementById('sendBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (sendBtn && stopBtn) {
        sendBtn.style.display = processing ? 'none' : 'flex';
        stopBtn.style.display = processing ? 'flex' : 'none';
    }
}

function addReportCard(title, content, sources) {
    const reportsArea = document.getElementById('reportsArea');
    const cardId      = 'report-' + Date.now();
    const card        = document.createElement('div');
    card.className    = 'report-card';
    card.id           = cardId;

    card.innerHTML = `
        <header class="report-header">
            <h3><i class="fas fa-file-invoice"></i> ${title}</h3>
            <button class="nav-icon"
                    onclick="removeMessage('${cardId}')"
                    style="background:transparent;border:none;color:var(--txt-muted);cursor:pointer;width:auto;"
                    aria-label="Close ${escapeHtml(title)} report">
                <i class="fas fa-times"></i>
            </button>
        </header>
        <div class="report-body">
            ${formatMarkdown(content)}
            ${renderSources(sources)}
        </div>
    `;

    reportsArea.prepend(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==================== Chat / Q&A ====================

async function askQuestion() {
    const input    = document.getElementById('questionInput');
    const question = input.value.trim();
    if (!question || isProcessing) return;

    addUserMessage(question);
    input.value        = '';
    input.style.height = 'auto';

    const loadingId = addBotMessage('<div class="pro-spinner"></div> Synthesizing answer...');
    updateChatStatus('Synthesizing...', true);
    toggleProcessing(true);
    abortController = new AbortController();

    try {
        const response = await fetch('/ask', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ question }),
            signal:  abortController.signal,
        });

        const data = await response.json();
        removeMessage(loadingId);

        if (data.success) {
            addBotMessage(data.answer, data.sources);
        } else {
            addBotMessage(`❌ Error: ${data.error}`);
        }
    } catch (error) {
        removeMessage(loadingId);
        if (error.name !== 'AbortError') {
            addBotMessage('❌ Connection to AI engine failed.');
        }
    } finally {
        toggleProcessing(false);
        updateChatStatus('Ready', false);
        input.focus();
    }
}

// ==================== Message Helpers ====================

function addUserMessage(text) {
    const chat = document.getElementById('chatMessages');
    const msg  = document.createElement('div');
    msg.className   = 'msg user';
    msg.textContent = text;
    chat.appendChild(msg);
    scrollChat();
}

function addBotMessage(html, sources) {
    const chat  = document.getElementById('chatMessages');
    const msgId = 'msg-' + Date.now();
    const msg   = document.createElement('div');
    msg.className = 'msg bot';
    msg.id        = msgId;

    let content = `<div>${formatMarkdown(html)}</div>`;
    if (sources && sources.length > 0) content += renderSources(sources);

    msg.innerHTML = content;
    chat.appendChild(msg);
    scrollChat();
    return msgId;
}

function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function scrollChat() {
    const chat = document.getElementById('chatMessages');
    chat.scrollTop = chat.scrollHeight;
}

function updateStatus(msg, type) {
    const status = document.getElementById('uploadStatus');
    if (status) {
        status.textContent = msg;
        status.className   = 'upload-status ' + type;
        status.style.display = 'block';
    }
}

function updateChatStatus(text, loading) {
    const el = document.getElementById('chatStatus');
    if (el) {
        el.innerHTML = `
            <span class="status-dot" style="${loading
                ? 'background:var(--clr-warning);box-shadow:0 0 8px var(--clr-warning);'
                : ''}"></span>
            ${text}
        `;
    }
}

// ==================== Data Formatting ====================

function formatChars(count) {
    if (!count) return '0';
    if (count > 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
    if (count > 1_000)     return (count / 1_000).toFixed(1) + 'K';
    return count;
}

function renderSources(sources) {
    if (!sources || sources.length === 0) return '';
    const unique = [...new Set(sources.map(s => `P${s.page}`))];
    return `
        <div style="margin-top:0.75rem;padding:0.5rem;border-left:2px solid var(--clr-gold);font-size:0.75rem;color:var(--txt-muted);">
            <strong>Evidence Index:</strong> ${unique.join(', ')}
        </div>
    `;
}

function formatMarkdown(text) {
    if (!text) return '';
    if (text.includes('<div') || text.includes('<span')) return text;

    let html = text.replace(/## (.+)/g,        '<h2>$1</h2>');
    html     = html.replace(/### (.+)/g,       '<h3>$1</h3>');
    html     = html.replace(/\*\*(.+?)\*\*/g,  '<strong>$1</strong>');
    html     = html.replace(/\* (.+)/g,        '<li>$1</li>');
    html     = html.replace(/<li>(.+)<\/li>\n<li>/g, '<li>$1</li><li>');
    return html.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// ── backward-compat stub (was called by old renderDocInfo path) ──
function renderDocInfo(info, filename) {
    const docPill = document.getElementById('docPill');
    if (docPill) {
        docPill.style.display = 'inline-flex';
        const el = document.getElementById('docName');
        if (el) el.textContent = filename;
    }
}
