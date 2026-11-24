const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { pipeline } = require('stream/promises');
const { normalizeServerUrl } = require('../shared/server-url');

let mainWindow;
let serverUrl = process.env.EARSIP_API_URL || 'https://dekstopmanager-production-93ce332c.up.railway.app';
let accessToken = null;
const eventStreams = new Map();

function requestConfig(config = {}) {
  return {
    ...config,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...config.headers,
    },
  };
}

async function apiRequest(method, route, data, config) {
  try {
    const response = await axios.request({
      method,
      url: `${serverUrl}${route}`,
      data,
      timeout: 30_000,
      maxRedirects: 0,
      ...requestConfig(config),
    });
    return response.data;
  } catch (error) {
    const message = error.response?.data?.message || error.message || 'Tidak dapat terhubung ke server E-Arsip.';
    throw new Error(message);
  }
}

async function responseError(error) {
  let data = error.response?.data;
  if (!Buffer.isBuffer(data) && !(data instanceof ArrayBuffer) && data && typeof data[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of data) chunks.push(Buffer.from(chunk));
    data = Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
    try {
      data = JSON.parse(Buffer.from(data).toString('utf8'));
    } catch {
      data = null;
    }
  }
  return {
    code: data?.code,
    message: data?.message || error.message || 'Permintaan ke server gagal.',
  };
}

function stopEventStream(webContentsId) {
  const stream = eventStreams.get(webContentsId);
  if (!stream) return;
  stream.stopped = true;
  clearTimeout(stream.reconnectTimer);
  stream.request?.destroy();
  eventStreams.delete(webContentsId);
}

function startEventStream(webContents) {
  stopEventStream(webContents.id);
  const state = { stopped: false, request: null, reconnectTimer: null };
  eventStreams.set(webContents.id, state);

  const connect = () => {
    if (state.stopped || !accessToken || webContents.isDestroyed()) return;
    const url = new URL('/api/events/documents', `${serverUrl}/`);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, { headers: { Authorization: `Bearer ${accessToken}` } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        state.reconnectTimer = setTimeout(connect, 3000);
        return;
      }
      let pending = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        pending += chunk;
        if (pending.length > 16_384) pending = pending.slice(-4096);
        const events = pending.split('\n\n');
        pending = events.pop() || '';
        for (const event of events) {
          if (event.includes('event: documents.changed')) {
            webContents.send('documents:changed');
          }
        }
      });
      const reconnect = () => {
        if (state.stopped || state.reconnectTimer) return;
        state.reconnectTimer = setTimeout(() => {
          state.reconnectTimer = null;
          connect();
        }, 3000);
      };
      response.on('end', reconnect);
      response.on('close', reconnect);
    });
    state.request = request;
    request.on('error', () => {
      if (!state.stopped && !state.reconnectTimer) {
        state.reconnectTimer = setTimeout(() => {
          state.reconnectTimer = null;
          connect();
        }, 3000);
      }
    });
  };
  connect();
}

function getUserFileName(document) {
  const safeName = path.basename(String(document.file_name || `dokumen-${document.id}`));
  return safeName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

async function uploadDocument(payload, method, onProgress) {
  const form = new FormData();
  form.append('title', payload.title);
  form.append('category', payload.category);
  form.append('year_period', String(payload.year_period));
  form.append('format', payload.format || '');
  if (payload.source_path) {
    const sourcePath = path.resolve(payload.source_path);
    const stat = await fs.promises.stat(sourcePath);
    if (!stat.isFile() || !stat.size) throw new Error('File kosong dan tidak dapat disimpan.');
    form.append('file', fs.createReadStream(sourcePath), {
      filename: path.basename(payload.file_name || sourcePath),
      knownLength: stat.size,
    });
  }

  try {
    const response = await axios.request({
      method,
      url: `${serverUrl}/api/documents${method === 'put' ? `/${encodeURIComponent(payload.id)}` : ''}`,
      data: form,
      headers: requestConfig({ headers: form.getHeaders() }).headers,
      maxBodyLength: Infinity,
      maxRedirects: 0,
      timeout: 0,
      onUploadProgress: (progress) => onProgress?.({
        phase: progress.progress === 1 ? 'complete' : 'copying',
        copiedBytes: progress.loaded,
        totalBytes: progress.total || 0,
      }),
    });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.message || error.message || 'Unggahan gagal.');
  }
}

function createWindow() {
  const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1500, Math.max(1, workAreaWidth - 24));
  const height = Math.min(980, Math.max(1, workAreaHeight - 24));

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(1000, width),
    minHeight: Math.min(640, height),
    backgroundColor: '#081d24',
    title: 'E-Arsip Instansi',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../mobile-app-settings.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173');
  }

  const webContentsId = mainWindow.webContents.id;
  mainWindow.on('closed', () => {
    stopEventStream(webContentsId);
    accessToken = null;
    mainWindow = null;
  });
  mainWindow.webContents.on('destroyed', () => stopEventStream(webContentsId));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('api:login', async (event, payload = {}) => {
  try {
    for (const id of eventStreams.keys()) stopEventStream(id);
    accessToken = null;
    if (payload.serverUrl) serverUrl = normalizeServerUrl(payload.serverUrl);
    const result = await apiRequest('post', '/api/auth/login', {
      username: String(payload.username || '').trim(),
      password: String(payload.password || ''),
    });
    accessToken = result.token;
    startEventStream(event.sender);
    return { success: true, user: result.user };
  } catch (error) {
    accessToken = null;
    return { success: false, message: error.message };
  }
});

ipcMain.handle('api:logout', async () => {
  try {
    if (accessToken) await apiRequest('post', '/api/auth/logout');
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    accessToken = null;
    for (const id of eventStreams.keys()) stopEventStream(id);
  }
});

ipcMain.handle('api:register', async (_, payload = {}) => {
  try {
    const result = await apiRequest('post', '/api/auth/register', payload);
    return { success: true, message: 'Akun berhasil dibuat. Silakan masuk.', user: result.user };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('api:reset-password', async (_, payload = {}) => {
  try {
    return await apiRequest('post', '/api/auth/reset-password', payload);
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('api:create-recovery-code', async () => apiRequest('post', '/api/auth/recovery-code'));
ipcMain.handle('api:create-invitation', async (_, payload = {}) => {
  try {
    return await apiRequest('post', '/api/admin/invitations', payload);
  } catch (error) {
    return { success: false, message: error.message };
  }
});
ipcMain.handle('api:get-documents', async (_, filters = {}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const suffix = query.size ? `?${query}` : '';
  return apiRequest('get', `/api/documents${suffix}`);
});

ipcMain.handle('api:create-document', async (event, payload = {}) => {
  try {
    const onProgress = (progress) => event.sender.send('document:upload-progress', { operationId: payload.operationId, ...progress });
    return await uploadDocument(payload, 'post', onProgress);
  } catch (error) {
    return { success: false, message: error.message || 'Dokumen gagal disimpan.' };
  }
});

ipcMain.handle('api:update-document', async (event, payload = {}) => {
  try {
    const onProgress = (progress) => event.sender.send('document:upload-progress', { operationId: payload.operationId, ...progress });
    return await uploadDocument(payload, 'put', onProgress);
  } catch (error) {
    return { success: false, message: error.message || 'Dokumen gagal diperbarui.' };
  }
});

ipcMain.handle('api:delete-document', async (_, payload = {}) => {
  try {
    return await apiRequest('delete', `/api/documents/${encodeURIComponent(payload.id)}`);
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('api:download-document', async (event, payload = {}) => {
  try {
    const documents = await apiRequest('get', '/api/documents');
    const document = documents.find((item) => String(item.id) === String(payload.id));
    if (!document) return { success: false, message: 'Dokumen tidak ditemukan.' };
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Simpan dokumen',
      defaultPath: path.join(app.getPath('downloads'), getUserFileName(document)),
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    const temporaryPath = `${filePath}.partial-${crypto.randomUUID()}`;
    let backupPath;
    try {
      const response = await axios.get(`${serverUrl}/api/documents/${encodeURIComponent(payload.id)}/download`, {
        ...requestConfig({ responseType: 'stream', timeout: 0, maxRedirects: 0 }),
      });
      await pipeline(response.data, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
      backupPath = `${filePath}.backup-${crypto.randomUUID()}`;
      try {
        await fs.promises.rename(filePath, backupPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        backupPath = null;
      }
      try {
        await fs.promises.rename(temporaryPath, filePath);
      } catch (error) {
        if (backupPath) await fs.promises.rename(backupPath, filePath);
        throw error;
      }
      if (backupPath) {
        await fs.promises.rm(backupPath, { force: true }).catch((error) => {
          console.error('Unable to remove previous download copy:', error);
        });
      }
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true });
      const details = await responseError(error);
      return { success: false, code: details.code, message: details.message };
    }
    return { success: true, path: filePath, message: 'Dokumen berhasil diunduh.' };
  } catch (error) {
    const details = await responseError(error);
    return { success: false, code: details.code, message: details.message };
  }
});

ipcMain.handle('api:preview-document', async (_, payload = {}) => {
  try {
    const response = await axios.get(`${serverUrl}/api/documents/${encodeURIComponent(payload.id)}/download`, {
      ...requestConfig({ responseType: 'arraybuffer', timeout: 0, maxRedirects: 0 }),
    });
    const disposition = String(response.headers['content-disposition'] || '');
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const rawName = encodedName || disposition.match(/filename="?([^";]+)"?/i)?.[1] || `dokumen-${payload.id}`;
    let fileName = rawName;
    try {
      fileName = decodeURIComponent(rawName);
    } catch {
      fileName = `dokumen-${payload.id}`;
    }
    const extension = path.extname(fileName).toLowerCase();
    if (extension === '.pdf') {
      return { success: true, mode: 'pdf', fileName, data: new Uint8Array(response.data) };
    }

    const openableExtensions = new Set([
      '.bmp', '.csv', '.doc', '.docx', '.gif', '.jpeg', '.jpg', '.odt', '.ods',
      '.png', '.ppt', '.pptx', '.rtf', '.tif', '.tiff', '.txt', '.webp', '.xls', '.xlsx',
    ]);
    if (!openableExtensions.has(extension)) {
      return { success: false, code: 'FILE_PREVIEW_UNAVAILABLE', message: `Pratinjau langsung tidak tersedia untuk format ${extension || 'file ini'}. Unduh file untuk membukanya.` };
    }
    const previewRoot = path.join(app.getPath('temp'), 'e-arsip-preview');
    await fs.promises.mkdir(previewRoot, { recursive: true });
    const previewPath = path.join(previewRoot, `${Date.now()}-${getUserFileName({ ...payload, file_name: fileName })}`);
    await fs.promises.writeFile(previewPath, response.data, { flag: 'wx' });
    const openError = await shell.openPath(previewPath);
    if (openError) return { success: false, code: 'FILE_OPEN_FAILED', message: `File ditemukan, tetapi tidak dapat dibuka: ${openError}` };
    return { success: true, path: previewPath };
  } catch (error) {
    const details = await responseError(error);
    return { success: false, code: details.code, message: details.message };
  }
});

ipcMain.on('api:subscribe-documents', (event) => {
  if (accessToken) startEventStream(event.sender);
});
ipcMain.on('api:unsubscribe-documents', (event) => stopEventStream(event.sender.id));
