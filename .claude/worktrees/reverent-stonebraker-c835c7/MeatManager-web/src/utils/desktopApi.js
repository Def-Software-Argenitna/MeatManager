const isElectronAvailable = () => Boolean(window.electronAPI);

async function browserNukeIndexedDb() {
    try {
        await new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase('CarniceriaDB');
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            req.onblocked = () => resolve(); // igualmente continuar
        });
        if (window?.localStorage) window.localStorage.clear();
        if (window?.sessionStorage) window.sessionStorage.clear();
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

export const desktopApi = {
    async nukeIndexedDb() {
        if (window.electronAPI?.nukeIndexedDb) {
            return window.electronAPI.nukeIndexedDb();
        }
        return browserNukeIndexedDb();
    },
    async getMachineId() {
        if (!window.electronAPI?.getMachineId) return null;
        return window.electronAPI.getMachineId();
    },
    async chooseDirectory() {
        if (!isElectronAvailable()) return { ok: false, unsupported: true, error: 'Disponible solo en Electron' };
        if (!window.electronAPI?.chooseDirectory) throw new Error('Electron API no disponible');
        return window.electronAPI.chooseDirectory();
    },
    async saveHtmlPdf(payload) {
        if (!isElectronAvailable()) return { ok: false, unsupported: true, error: 'Disponible solo en Electron' };
        if (!window.electronAPI?.saveHtmlPdf) throw new Error('Electron API no disponible');
        return window.electronAPI.saveHtmlPdf(payload);
    },
    async openPath(targetPath) {
        if (!isElectronAvailable()) return { ok: false, unsupported: true, error: 'Disponible solo en Electron' };
        if (!window.electronAPI?.openPath) throw new Error('Electron API no disponible');
        return window.electronAPI.openPath(targetPath);
    },
};
