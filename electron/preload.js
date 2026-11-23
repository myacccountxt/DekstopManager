const { contextBridge, ipcRenderer, webUtils } = require('electron');

function invokeWithProgress(channel, payload, onProgress) {
  const listener = (_, progress) => {
    if (progress.operationId === payload.operationId) onProgress?.(progress);
  };
  ipcRenderer.on('document:upload-progress', listener);
  return ipcRenderer.invoke(channel, payload).finally(() => {
    ipcRenderer.removeListener('document:upload-progress', listener);
  });
}

contextBridge.exposeInMainWorld('electronAPI', {
  login: (payload) => ipcRenderer.invoke('api:login', payload),
  logout: () => ipcRenderer.invoke('api:logout'),
  register: (payload) => ipcRenderer.invoke('api:register', payload),
  resetPassword: (payload) => ipcRenderer.invoke('api:reset-password', payload),
  createRecoveryCode: () => ipcRenderer.invoke('api:create-recovery-code'),
  createInvitation: (payload) => ipcRenderer.invoke('api:create-invitation', payload),
  getDocuments: (filters = {}) => ipcRenderer.invoke('api:get-documents', filters),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  createDocument: (payload, onProgress) => invokeWithProgress('api:create-document', payload, onProgress),
  updateDocument: (payload, onProgress) => invokeWithProgress('api:update-document', payload, onProgress),
  deleteDocument: (id) => ipcRenderer.invoke('api:delete-document', { id }),
  downloadDocument: (id) => ipcRenderer.invoke('api:download-document', { id }),
  previewDocument: (id) => ipcRenderer.invoke('api:preview-document', { id }),
  onDocumentsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('documents:changed', listener);
    ipcRenderer.send('api:subscribe-documents');
    return () => {
      ipcRenderer.removeListener('documents:changed', listener);
      ipcRenderer.send('api:unsubscribe-documents');
    };
  },
});
