import Dexie from 'dexie';

const isElectronAvailable = () => Boolean(window.electronAPI);

async function browserNukeIndexedDb() {
    try {
        await Dexie.delete('CarniceriaDB');
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
    async qendraDbExists() {
        if (!isElectronAvailable()) return { ok: false, unsupported: true, error: 'Disponible solo en Electron' };
        if (!window.electronAPI?.qendraDbExists) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraDbExists();
    },
    async qendraCheckFirebird() {
        if (!isElectronAvailable()) return { ok: false, unsupported: true, error: 'Disponible solo en Electron' };
        if (!window.electronAPI?.qendraCheckFirebird) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraCheckFirebird();
    },
    async qendraListTables() {
        if (!isElectronAvailable()) return { ok: false, unsupported: true, error: 'Disponible solo en Electron' };
        if (!window.electronAPI?.qendraListTables) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraListTables();
    },
    async qendraImportPlus(table) {
        if (!isElectronAvailable()) return { ok: false, unsupported: true, error: 'Disponible solo en Electron' };
        if (!window.electronAPI?.qendraImportPlus) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraImportPlus(table);
    },
    async qendraSyncVentas(dias) {
        if (!isElectronAvailable()) return { ok: false, unsupported: true, error: 'Disponible solo en Electron' };
        if (!window.electronAPI?.qendraSyncVentas) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraSyncVentas(dias);
    },
    async qendraGetTodayTickets(horas) {
        if (!isElectronAvailable()) return { ok: false, unsupported: true, error: 'Disponible solo en Electron' };
        if (!window.electronAPI?.qendraGetTodayTickets) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraGetTodayTickets(horas);
    },
    async qendraUpdatePrecio(plu, precio) {
        if (!isElectronAvailable()) return { ok: false, unsupported: true, error: 'Disponible solo en Electron' };
        if (!window.electronAPI?.qendraUpdatePrecio) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraUpdatePrecio(plu, precio);
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
