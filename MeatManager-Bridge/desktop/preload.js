const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridgeDesktop', {
    getStatus: () => ipcRenderer.invoke('status:get'),
    restartBridge: () => ipcRenderer.invoke('status:restart-bridge'),
    checkUpdates: () => ipcRenderer.invoke('update:check'),
    installUpdateNow: () => ipcRenderer.invoke('update:install-now'),
    openLogDir: () => ipcRenderer.invoke('app:open-log-dir'),
    getAppMeta: () => ipcRenderer.invoke('app:meta'),
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
    requestWindowFocus: () => ipcRenderer.invoke('window:focus'),
    onboarding: {
        status: () => ipcRenderer.invoke('onboarding:status'),
        login: (payload) => ipcRenderer.invoke('onboarding:login', payload),
        complete: (payload) => ipcRenderer.invoke('onboarding:complete', payload),
        reset: () => ipcRenderer.invoke('onboarding:reset'),
    },
    scale: {
        listPorts: () => ipcRenderer.invoke('scale:list-ports'),
        saveConfig: (payload) => ipcRenderer.invoke('scale:save-config', payload),
        test: () => ipcRenderer.invoke('scale:test'),
        reset: () => ipcRenderer.invoke('scale:reset'),
    },
});
