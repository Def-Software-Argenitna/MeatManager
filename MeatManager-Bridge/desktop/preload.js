const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridgeDesktop', {
    getStatus: () => ipcRenderer.invoke('status:get'),
    restartBridge: () => ipcRenderer.invoke('status:restart-bridge'),
    checkUpdates: () => ipcRenderer.invoke('update:check'),
    installUpdateNow: () => ipcRenderer.invoke('update:install-now'),
    openLogDir: () => ipcRenderer.invoke('app:open-log-dir'),

    getOnboarding: () => ipcRenderer.invoke('onboarding:get'),
    onboardingLogin: (payload) => ipcRenderer.invoke('onboarding:login', payload),
    onboardingClients: (payload) => ipcRenderer.invoke('onboarding:clients', payload),
    onboardingBranches: (payload) => ipcRenderer.invoke('onboarding:branches', payload),
    onboardingPorts: () => ipcRenderer.invoke('onboarding:ports'),
    onboardingSave: (payload) => ipcRenderer.invoke('onboarding:save', payload),

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
