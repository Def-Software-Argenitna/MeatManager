const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onAiStatus: (callback) => ipcRenderer.on('ai-status', (_event, value) => callback(value)),
    startTgBot: (config) => ipcRenderer.send('start-tg-bot', config),
    stopTgBot: () => ipcRenderer.send('stop-tg-bot'),
    sendTgReply: (chatId, text) => ipcRenderer.send('send-tg-reply', { chatId, text }),
    onTgMessage: (callback) => ipcRenderer.on('tg-message', (_event, value) => callback(value)),
    offTgMessage: () => ipcRenderer.removeAllListeners('tg-message'),
    offAiStatus: () => ipcRenderer.removeAllListeners('ai-status'),
    onScaleDiagnostic: (callback) => ipcRenderer.on('scale-diagnostic', (_event, value) => callback(value)),
    offScaleDiagnostic: () => ipcRenderer.removeAllListeners('scale-diagnostic'),
    getMachineId: () => ipcRenderer.invoke('get-machine-id'),
    nukeIndexedDb: () => ipcRenderer.invoke('nuke-indexeddb'),
    chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
    saveHtmlPdf: (payload) => ipcRenderer.invoke('save-html-pdf', payload),
    openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
});

window.addEventListener('DOMContentLoaded', () => {
    // Reserved for preload bootstrap hooks.
});
