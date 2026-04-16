const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridgeDesktop', {
    getStatus: () => ipcRenderer.invoke('status:get'),
    restartBridge: () => ipcRenderer.invoke('status:restart-bridge'),
    checkUpdates: () => ipcRenderer.invoke('update:check'),
    installUpdateNow: () => ipcRenderer.invoke('update:install-now'),
    openLogDir: () => ipcRenderer.invoke('app:open-log-dir'),
    getConfig: () => ipcRenderer.invoke('config:get'),
    saveConfig: (values) => ipcRenderer.invoke('config:save', values),
    listScalePorts: () => ipcRenderer.invoke('scale:list-ports'),
    onStatus: (handler) => {
        const listener = (_, payload) => handler(payload);
        ipcRenderer.on('bridge-status', listener);
        return () => ipcRenderer.removeListener('bridge-status', listener);
    },
    onUpdateEvent: (handler) => {
        const listener = (_, payload) => handler(payload);
        ipcRenderer.on('update-event', listener);
        return () => ipcRenderer.removeListener('update-event', listener);
    },
});
