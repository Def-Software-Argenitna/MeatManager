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
    qendraDbExists: () => ipcRenderer.invoke('qendra-db-exists'),
    qendraCheckFirebird: () => ipcRenderer.invoke('qendra-check-firebird'),
    qendraListTables: () => ipcRenderer.invoke('qendra-list-tables'),
    qendraImportPlus: (table) => ipcRenderer.invoke('qendra-import-plus', table),
    qendraSyncVentas: (dias) => ipcRenderer.invoke('qendra-sync-ventas', dias),
    qendraGetTodayTickets: (horas) => ipcRenderer.invoke('qendra-get-today-tickets', horas),
    qendraUpdatePrecio: (plu, precio) => ipcRenderer.invoke('qendra-update-precio', plu, precio),
    nukeIndexedDb: () => ipcRenderer.invoke('nuke-indexeddb'),
});

window.addEventListener('DOMContentLoaded', () => {
    // Reserved for preload bootstrap hooks.
});
