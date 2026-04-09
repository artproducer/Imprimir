/**
 * IMPRIMIR - Frontend con backend Supabase
 * Envia documentos a la impresora via Gmail API a traves de Edge Functions.
 */

const SUPABASE_FUNCTIONS_BASE_URL = 'https://mrxdljauagbjusmdcciv.supabase.co/functions/v1';
const DEST = 'variedadeslg@print.epsonconnect.com';
const SK_SESSION_ID = 'print_session_id';

let sessionProfile = null;
let isConnected = false;
let files = [];
let defaultAuthBtnHtml = '';

let dropzone;
let fileInput;
let fileList;
let sendBtn;
let statusEl;
let authBtn;
let authStatus;
let authText;
let disconnectBtn;

// ── Utilidades de backend ──

function getBackendBaseUrl() {
    const base = SUPABASE_FUNCTIONS_BASE_URL.trim().replace(/\/+$/, '');
    if (!base || base.includes('TU_PROJECT_REF')) {
        throw new Error('Configura SUPABASE_FUNCTIONS_BASE_URL en script.js');
    }
    return base;
}

function createSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }
    return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSessionId() {
    let sessionId = localStorage.getItem(SK_SESSION_ID);
    if (!sessionId) {
        sessionId = createSessionId();
        localStorage.setItem(SK_SESSION_ID, sessionId);
    }
    return sessionId;
}

function getAppReturnUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('gmail_connected');
    url.searchParams.delete('gmail_error');
    url.searchParams.delete('gmail_email');
    url.hash = '';
    return url.toString();
}

async function backendFetchJson(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    headers.set('x-session-id', getSessionId());

    const res = await fetch(`${getBackendBaseUrl()}/${path}`, {
        ...options,
        headers
    });

    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch (_) {
        data = null;
    }

    if (!res.ok) {
        const err = new Error((data && (data.message || data.error)) || text || 'Error en la solicitud');
        err.status = res.status;
        err.data = data;
        throw err;
    }

    return data;
}

// ── Estado de autenticacion ──

function isAuthed() {
    return isConnected;
}

function onAuthed(profile = null) {
    if (profile) sessionProfile = profile;
    isConnected = true;

    if (authBtn) authBtn.hidden = true;
    if (disconnectBtn) disconnectBtn.hidden = false;
    if (authStatus) authStatus.className = 'auth-status connected';
    if (authText) authText.textContent = sessionProfile?.email || 'Sesion activa y lista para enviar';
    if (dropzone) dropzone.classList.remove('disabled');
    if (fileInput) fileInput.disabled = false;
    renderFiles();
}

function onLoggedOut() {
    isConnected = false;
    sessionProfile = null;
    renderLoggedOutState('Sesion cerrada');
}

function renderLoggedOutState(message = 'No conectado') {
    if (authBtn) {
        authBtn.hidden = false;
        authBtn.innerHTML = defaultAuthBtnHtml;
    }
    if (disconnectBtn) disconnectBtn.hidden = true;
    if (authStatus) authStatus.className = 'auth-status';
    if (authText) authText.textContent = message;
    if (dropzone) dropzone.classList.add('disabled');
    if (fileInput) fileInput.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'status';
    }
    renderFiles();
}

function showAuthError(message) {
    if (authBtn) authBtn.hidden = false;
    if (disconnectBtn) disconnectBtn.hidden = true;
    if (authStatus) authStatus.className = 'auth-status';
    if (authText) authText.textContent = message;
    if (dropzone) dropzone.classList.add('disabled');
    if (fileInput) fileInput.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
}

// ── Autenticacion via Supabase ──

async function ensureSession(showErrors = false) {
    try {
        const data = await backendFetchJson(`gmail-session?session_id=${encodeURIComponent(getSessionId())}`);
        if (data && data.connected) {
            onAuthed(data.profile || { email: 'connected' });
            return true;
        }
        renderLoggedOutState('No conectado');
        return false;
    } catch (err) {
        renderLoggedOutState('No conectado');
        if (showErrors) setStatus('error', err.message);
        return false;
    }
}

function startAuth() {
    try {
        const url = new URL(`${getBackendBaseUrl()}/google-auth-start`);
        url.searchParams.set('session_id', getSessionId());
        url.searchParams.set('redirect_to', getAppReturnUrl());
        window.location.href = url.toString();
    } catch (err) {
        showAuthError(err.message);
    }
}

async function disconnect() {
    let logoutError = null;
    try {
        await backendFetchJson('gmail-disconnect', {
            method: 'POST',
            body: JSON.stringify({ sessionId: getSessionId() })
        });
    } catch (err) {
        logoutError = err;
    } finally {
        onLoggedOut();
    }

    if (logoutError) {
        showToast(logoutError.message, 'error');
    } else {
        showToast('Sesión cerrada correctamente', 'success');
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast-message ${type}`;
    
    // Iconos según el tipo
    const icon = type === 'success' 
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';

    toast.innerHTML = `${icon}<span>${message}</span>`;
    container.appendChild(toast);

    // Auto-eliminar del DOM después de la animación
    setTimeout(() => {
        toast.remove();
    }, 4500);
}

function handleAuthRedirectFeedback() {
    const url = new URL(window.location.href);
    const connected = url.searchParams.get('gmail_connected');
    const error = url.searchParams.get('gmail_error');
    if (!connected && !error) return;

    if (connected === '1') {
        // Se completo la conexion, ensureSession cargara el perfil
    } else if (error) {
        showAuthError(error);
    }

    url.searchParams.delete('gmail_connected');
    url.searchParams.delete('gmail_error');
    url.searchParams.delete('gmail_email');
    window.history.replaceState({}, document.title, url.toString());
}

// ── Archivos ──

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function getExt(name) {
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index + 1) : '--';
}

function addFiles(newFiles) {
    newFiles.forEach((file) => {
        if (!files.find((existing) => existing.name === file.name && existing.size === file.size)) {
            files.push(file);
        }
    });
    renderFiles();
}

function removeFile(index) {
    files.splice(index, 1);
    renderFiles();
}

function renderFiles() {
    if (!fileList) return;
    fileList.innerHTML = '';

    files.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <span class="file-ext">${getExt(file.name)}</span>
            <span class="file-name" title="${file.name}">${file.name}</span>
            <span class="file-size">${formatSize(file.size)}</span>
            <button class="file-remove" type="button" data-index="${index}" aria-label="Eliminar archivo">x</button>
        `;
        fileList.appendChild(item);
    });

    if (sendBtn) sendBtn.disabled = files.length === 0 || !isAuthed();
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.className = 'status';
    }
}

// ── Envio ──

function setStatus(type, message) {
    if (!statusEl) return;
    statusEl.className = `status ${type}`;

    let icon = '';
    if (type === 'loading') icon = '<span class="spinner"></span>';
    if (type === 'success') icon = '<span style="font-size:1.2em; margin-right:8px;">OK</span>';
    if (type === 'error') icon = '<span style="font-size:1.2em; margin-right:8px;">!</span>';

    statusEl.innerHTML = `${icon}${message}`;
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function buildMimeMessage(attachments) {
    const boundary = 'dsorak_' + Date.now();
    const newline = '\r\n';
    let raw = [
        `To: ${DEST}`,
        'Subject: ',
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        '',
        ''
    ].join(newline);

    for (const attachment of attachments) {
        const chunks = attachment.data.match(/.{1,76}/g) || [attachment.data];
        raw += [
            `--${boundary}`,
            `Content-Type: ${attachment.mimeType}; name="${attachment.name}"`,
            `Content-Disposition: attachment; filename="${attachment.name}"`,
            'Content-Transfer-Encoding: base64',
            '',
            chunks.join(newline),
            ''
        ].join(newline);
    }

    raw += `--${boundary}--`;

    const bytes = new TextEncoder().encode(raw);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

async function sendFiles() {
    if (!files.length) return;

    if (sendBtn) sendBtn.disabled = true;
    setStatus('loading', 'Verificando sesion...');

    const hasSession = await ensureSession(true);
    if (!hasSession) {
        setStatus('error', 'Sesion expirada. Vuelve a conectar Google.');
        showAuthError('Sesion expirada');
        return;
    }

    try {
        setStatus('loading', `Preparando archivos (${files.length})...`);
        const attachments = await Promise.all(
            files.map(async (file) => ({
                name: file.name,
                mimeType: file.type || 'application/octet-stream',
                data: await readFileAsBase64(file)
            }))
        );

        setStatus('loading', 'Enviando a impresion...');
        const raw = await buildMimeMessage(attachments);

        const response = await backendFetchJson('gmail-send', {
            method: 'POST',
            body: JSON.stringify({
                sessionId: getSessionId(),
                raw
            })
        });

        if (response && response.profile) onAuthed(response.profile);

        const msg = `¡Éxito! Se enviaron ${files.length} archivo${files.length > 1 ? 's' : ''} a imprimir.`;
        setStatus('success', msg);
        showToast(msg, 'success');
        
        files = [];
        renderFiles();
    } catch (error) {
        if (error.status === 401) {
            onLoggedOut();
            const errMsg = 'Tu sesión de Google expiró. Conecta de nuevo.';
            setStatus('error', errMsg);
            showToast(errMsg, 'error');
            return;
        }
        setStatus('error', error.message);
        showToast(error.message, 'error');
        if (sendBtn) sendBtn.disabled = files.length === 0 || !isAuthed();
    }
}

// ── Eventos ──

function bindEvents() {
    if (authBtn) authBtn.addEventListener('click', startAuth);
    if (disconnectBtn) disconnectBtn.addEventListener('click', disconnect);
    if (sendBtn) sendBtn.addEventListener('click', sendFiles);

    if (dropzone) {
        dropzone.addEventListener('dragover', (event) => {
            event.preventDefault();
            if (!dropzone.classList.contains('disabled')) dropzone.classList.add('drag-over');
        });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
        dropzone.addEventListener('drop', (event) => {
            event.preventDefault();
            dropzone.classList.remove('drag-over');
            if (dropzone.classList.contains('disabled')) return;
            addFiles([...event.dataTransfer.files]);
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            addFiles([...fileInput.files]);
            fileInput.value = '';
        });
    }

    if (fileList) {
        fileList.addEventListener('click', (event) => {
            const button = event.target.closest('.file-remove');
            if (!button) return;
            removeFile(Number(button.dataset.index));
        });
    }

    window.addEventListener('focus', () => {
        ensureSession();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') ensureSession();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    dropzone = document.getElementById('dropzone');
    fileInput = document.getElementById('fileInput');
    fileList = document.getElementById('fileList');
    sendBtn = document.getElementById('sendBtn');
    statusEl = document.getElementById('status');
    authBtn = document.getElementById('authBtn');
    authStatus = document.getElementById('authStatus');
    authText = document.getElementById('authText');
    disconnectBtn = document.getElementById('disconnectBtn');
    defaultAuthBtnHtml = authBtn ? authBtn.innerHTML : '';

    bindEvents();
    handleAuthRedirectFeedback();
    renderLoggedOutState('No conectado');
    ensureSession();
});
