/**
 * Barrister Pro — Frontend Intelligence Engine
 * Specialized for high-precision legal analysis
 */

// ==================== State Management ====================
let isProcessing = false;

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    // Attach Event Listeners to Sidebar
    document.getElementById('navFull').addEventListener('click', () => runAnalysis('full'));
    document.getElementById('navSummary').addEventListener('click', () => runAnalysis('summary'));
    document.getElementById('navRisks').addEventListener('click', () => runAnalysis('risks'));
    document.getElementById('navKeys').addEventListener('click', () => runAnalysis('keypoints'));
    
    // File Upload Listeners
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleUpload(file);
    });

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('active');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('active');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('active');
        const file = e.dataTransfer.files[0];
        if (file && file.type === 'application/pdf') {
            handleUpload(file);
        } else {
            updateStatus('❌ Invalid file type. PDF only.', 'error');
        }
    });

    // Chat Enter Sync
    document.getElementById('questionInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            askQuestion();
        }
    });

    // Handle initial active state
    showView('workspace');
});

// ==================== Navigation ====================
function showView(viewId) {
    const views = ['workspace']; // Add more if other views are implemented
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === viewId) ? 'block' : 'none';
    });

    // Update active state in sidebar
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if (item.getAttribute('onclick')?.includes(viewId) || item.id?.includes(viewId)) {
            item.classList.add('active');
        } else {
            // Only remove active if it's a view-switching button
            if (item.getAttribute('onclick')?.includes('showView')) {
                item.classList.remove('active');
            }
        }
    });
}

// ==================== AI Analysis Pipeline ====================
async function handleUpload(file) {
    if (isProcessing) return;
    isProcessing = true;

    const formData = new FormData();
    formData.append('file', file);

    updateStatus('📄 Initializing Professional Analysis...', 'loading');
    const scanner = document.getElementById('scanner');
    scanner.style.display = 'block';
    
    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            updateStatus(`✅ ${data.filename} Indexed`, 'success');
            renderDocInfo(data.doc_info, data.filename);
            
            // Activate Sidebar Actions
            enableSidebarActions(true);
            
            // Transition Workspace
            document.getElementById('uploadSection').style.transition = 'opacity 0.5s ease';
            document.getElementById('uploadSection').style.opacity = '0';
            
            setTimeout(() => {
                document.getElementById('uploadSection').style.display = 'none';
                document.getElementById('intelligenceArea').style.display = 'block';
                document.getElementById('intelligenceArea').style.opacity = '0';
                setTimeout(() => {
                    document.getElementById('intelligenceArea').style.opacity = '1';
                    document.getElementById('intelligenceArea').style.transition = 'opacity 0.5s ease';
                }, 50);
            }, 500);

        } else {
            updateStatus(`❌ Analysis Error: ${data.error}`, 'error');
        }
    } catch (error) {
        updateStatus('❌ Connection failed. Check server.', 'error');
        console.error('Upload error:', error);
    } finally {
        isProcessing = false;
        scanner.style.display = 'none';
    }
}

function renderDocInfo(info, filename) {
    const docPill = document.getElementById('docPill');
    const docStats = document.getElementById('docStats');
    
    docPill.style.display = 'inline-flex';
    document.getElementById('docName').textContent = filename;
    
    docStats.style.display = 'grid';
    document.getElementById('infoPages').textContent = info.total_pages || '-';
    document.getElementById('infoSections').textContent = info.total_sections || '-';
    document.getElementById('infoChars').textContent = formatChars(info.total_characters);
}

function enableSidebarActions(enabled) {
    const ids = ['navFull', 'navSummary', 'navRisks', 'navKeys'];
    ids.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = !enabled;
            if (enabled) btn.classList.add('ready');
        }
    });
}

// ==================== Analysis Actions ====================
async function runAnalysis(type) {
    if (isProcessing) return;
    isProcessing = true;
    
    const endpoints = {
        'full': { url: '/analyze', key: 'analysis', label: 'Pro Legal Audit' },
        'summary': { url: '/summary', key: 'summary', label: 'Executive Summary' },
        'risks': { url: '/risks', key: 'risk_analysis', label: 'Risk Assessment' },
        'keypoints': { url: '/keypoints', key: 'key_points', label: 'Key Obligations' }
    };

    const config = endpoints[type];
    if (!config) {
        isProcessing = false;
        return;
    }

    // Show Loading in Chat
    const loadingId = addBotMessage(`<div class="pro-spinner"></div> Analyzing <strong>${config.label}</strong>...`);
    updateChatStatus('Analyzing...', true);
    
    try {
        const response = await fetch(config.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
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
        addBotMessage('❌ Intelligent engine is temporarily unavailable.');
    } finally {
        isProcessing = false;
        updateChatStatus('Ready', false);
    }
}

function addReportCard(title, content, sources) {
    const reportsArea = document.getElementById('reportsArea');
    const cardId = 'report-' + Date.now();
    
    const card = document.createElement('div');
    card.className = 'report-card';
    card.id = cardId;
    
    card.innerHTML = `
        <header class="report-header">
            <h3><i class="fas fa-file-invoice"></i> ${title}</h3>
            <button class="nav-icon" onclick="removeMessage('${cardId}')" style="background:transparent;border:none;color:var(--txt-muted);cursor:pointer;width:auto;"><i class="fas fa-times"></i></button>
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
    const input = document.getElementById('questionInput');
    const question = input.value.trim();

    if (!question || isProcessing) return;
    isProcessing = true;

    // User Message
    addUserMessage(question);
    input.value = '';
    input.style.height = 'auto';

    // Loading State
    const loadingId = addBotMessage('<div class="pro-spinner"></div> Synthesizing answer...');
    updateChatStatus('Synthesizing...', true);

    try {
        const response = await fetch('/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
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
        addBotMessage('❌ Connection to AI heart failed.');
    } finally {
        isProcessing = false;
        updateChatStatus('Ready', false);
        input.focus();
    }
}

// ==================== Message Helpers ====================
function addUserMessage(text) {
    const chat = document.getElementById('chatMessages');
    const msg = document.createElement('div');
    msg.className = 'msg user';
    msg.textContent = text;
    chat.appendChild(msg);
    scrollChat();
}

function addBotMessage(html, sources) {
    const chat = document.getElementById('chatMessages');
    const msgId = 'msg-' + Date.now();
    const msg = document.createElement('div');
    msg.className = 'msg bot';
    msg.id = msgId;
    
    let content = `<div>${formatMarkdown(html)}</div>`;
    if (sources && sources.length > 0) {
        content += renderSources(sources);
    }
    
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
        status.className = 'upload-status ' + type;
        status.style.display = 'block';
    }
}

function updateChatStatus(text, loading) {
    const el = document.getElementById('chatStatus');
    if (el) {
        el.innerHTML = `
            <span class="status-dot" style="${loading ? 'background:var(--clr-warning);box-shadow:0 0 8px var(--clr-warning);' : ''}"></span>
            ${text}
        `;
    }
}

// ==================== Data Formatting ====================
function formatChars(count) {
    if (!count) return '0';
    if (count > 1000000) return (count / 1000000).toFixed(1) + 'M';
    if (count > 1000) return (count / 1000).toFixed(1) + 'K';
    return count;
}

function renderSources(sources) {
    if (!sources || sources.length === 0) return '';
    const unique = [...new Set(sources.map(s => `P${s.page}`))];
    return `
        <div style="margin-top:0.75rem; padding:0.5rem; border-left:2px solid var(--clr-gold); font-size:0.75rem; color:var(--txt-muted);">
            <strong>Evidence Index:</strong> ${unique.join(', ')}
        </div>
    `;
}

function formatMarkdown(text) {
    if (!text) return '';
    // Skip if it looks like HTML
    if (text.includes('<div') || text.includes('<span')) return text;
    
    let html = text.replace(/## (.+)/g, '<h2>$1</h2>');
    html = html.replace(/### (.+)/g, '<h3>$1</h3>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\* (.+)/g, '<li>$1</li>');
    html = html.replace(/<li>(.+)<\/li>\n<li>/g, '<li>$1</li><li>');
    return html.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

