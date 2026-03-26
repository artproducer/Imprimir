const HARDCODED_CLIENT_ID = '357370160811-p0fvc37cgrr5385olh07da3249pm8hl0.apps.googleusercontent.com';
const DEST = 'variedadeslg@print.epsonconnect.com';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const SK_ACCESS = 'print_access_token';
const SK_EXPIRY = 'print_token_expiry';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

let accessToken = null;
let tokenClient = null;
let tokenExpiry = 0;
let tokenRefreshTimer = null;
let lastAuthError = '';
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

function isAuthed() {
    return !!accessToken && tokenExpiry > Date.now();
}

function clearStoredToken() {
    accessToken = null;
    tokenExpiry = 0;
    localStorage.removeItem(SK_ACCESS);
    localStorage.removeItem(SK_EXPIRY);
    if (tokenRefreshTimer) {
        window.clearTimeout(tokenRefreshTimer);
        tokenRefreshTimer = null;
    }
}

function restoreStoredToken() {
    const storedToken = localStorage.getItem(SK_ACCESS);
    const storedExpiry = parseInt(localStorage.getItem(SK_EXPIRY) || '0', 10);
    if (!storedToken || !storedExpiry || storedExpiry <= Date.now()) {
        clearStoredToken();
        return false;
    }

    accessToken = storedToken;
    tokenExpiry = storedExpiry;
    scheduleTokenRefresh();
    return true;
}

function scheduleTokenRefresh() {
    if (tokenRefreshTimer) window.clearTimeout(tokenRefreshTimer);
    if (!accessToken || !tokenExpiry) return;

    const refreshIn = Math.max(15000, tokenExpiry - Date.now() - TOKEN_REFRESH_BUFFER_MS);
    tokenRefreshTimer = window.setTimeout(async () => {
        try {
            const refreshed = await ensureAccessToken(false);
            if (!refreshed) onLoggedOut();
        } catch (_) {
            clearStoredToken();
            onLoggedOut();
        }
    }, refreshIn);
}

function persistToken(response) {
    accessToken = response.access_token;
    tokenExpiry = Date.now() + ((response.expires_in || 3600) * 1000);
    localStorage.setItem(SK_ACCESS, accessToken);
    localStorage.setItem(SK_EXPIRY, String(tokenExpiry));
    scheduleTokenRefresh();
}

async function waitForGoogleIdentity(maxAttempts = 40) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) return true;
        await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return false;
}

async function initTokenClient() {
    if (tokenClient) return true;
    if (!HARDCODED_CLIENT_ID.trim()) throw new Error('Falta configurar HARDCODED_CLIENT_ID');

    const loaded = await waitForGoogleIdentity();
    if (!loaded) throw new Error('Google Identity Services no cargo a tiempo.');

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: HARDCODED_CLIENT_ID.trim(),
        scope: SCOPE,
        callback: () => {},
        error_callback: () => {}
    });
    return true;
}

async function requestAccessToken(promptValue) {
    await initTokenClient();

    return new Promise((resolve, reject) => {
        tokenClient.callback = (response) => {
            if (response.error) {
                const error = new Error(response.error);
                error.data = response;
                reject(error);
                return;
            }
            persistToken(response);
            resolve(response);
        };

        tokenClient.error_callback = (error) => {
            reject(new Error(error.type || 'popup_error'));
        };

        tokenClient.requestAccessToken({ prompt: promptValue });
    });
}

async function ensureAccessToken(interactive = false) {
    if (isAuthed() && tokenExpiry > Date.now() + TOKEN_REFRESH_BUFFER_MS) return true;
    if (restoreStoredToken() && tokenExpiry > Date.now() + TOKEN_REFRESH_BUFFER_MS) return true;

    try {
        lastAuthError = '';
        await requestAccessToken(interactive ? 'consent' : '');
        onAuthed();
        return true;
    } catch (err) {
        lastAuthError = err && err.message ? err.message : 'No se pudo conectar con Google';
        if (!interactive) clearStoredToken();
        return false;
    }
}

async function ensureSession() {
    if (restoreStoredToken()) {
        onAuthed();
        return true;
    }

    const refreshed = await ensureAccessToken(false);
    if (refreshed) return true;

    onLoggedOut();
    return false;
}

function setAuthLoading() {
    if (authText) authText.textContent = 'Conectando...';
    if (authStatus) authStatus.className = 'auth-status';
}

function onAuthed() {
    if (authBtn) authBtn.hidden = true;
    if (disconnectBtn) disconnectBtn.hidden = false;
    if (authStatus) authStatus.className = 'auth-status connected';
    if (authText) authText.textContent = 'Sesion activa y lista para enviar';
    if (dropzone) dropzone.classList.remove('disabled');
    if (fileInput) fileInput.disabled = false;
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

function onLoggedOut() {
    clearStoredToken();
    renderLoggedOutState('Sesion cerrada');
}

async function startAuth() {
    if (isAuthed()) return;
    if (!HARDCODED_CLIENT_ID.trim()) {
        showAuthError('Falta configurar HARDCODED_CLIENT_ID');
        return;
    }

    setAuthLoading();
    const connected = await ensureAccessToken(true);
    if (connected) return;
    showAuthError(lastAuthError || 'No se pudo conectar con Google');
}

function disconnect() {
    const tokenToRevoke = accessToken;
    onLoggedOut();

    if (window.google && google.accounts && google.accounts.oauth2 && tokenToRevoke) {
        google.accounts.oauth2.revoke(tokenToRevoke, () => {});
    }
}

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

    let hasToken = await ensureAccessToken(false);
    if (!hasToken) hasToken = await ensureAccessToken(true);
    if (!hasToken) {
        setStatus('error', 'Sesion expirada. Vuelve a conectar Google.');
        showAuthError(lastAuthError || 'Sesion expirada');
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

        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw })
        });

        if (response.status === 401) {
            onLoggedOut();
            throw new Error('Tu sesion de Google expiro. Conecta de nuevo.');
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `Error HTTP ${response.status}`);
        }

        setStatus('success', `Envio exitoso. Se enviaron ${files.length} archivo${files.length > 1 ? 's' : ''}.`);
        files = [];
        renderFiles();
    } catch (error) {
        setStatus('error', error.message);
        if (sendBtn) sendBtn.disabled = files.length === 0 || !isAuthed();
    }
}

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
    renderLoggedOutState('No conectado');
    ensureSession();

    if (location.search.includes('code=')) {
        history.replaceState(null, '', location.origin + location.pathname);
    }
});
