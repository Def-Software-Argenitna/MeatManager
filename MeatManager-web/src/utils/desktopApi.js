import Dexie from 'dexie';

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
        if (!window.electronAPI?.getMachineId) throw new Error('Electron API no disponible');
        return window.electronAPI.getMachineId();
    },
    async qendraDbExists() {
        if (!window.electronAPI?.qendraDbExists) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraDbExists();
    },
    async qendraCheckFirebird() {
        if (!window.electronAPI?.qendraCheckFirebird) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraCheckFirebird();
    },
    async qendraListTables() {
        if (!window.electronAPI?.qendraListTables) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraListTables();
    },
    async qendraImportPlus(table) {
        if (!window.electronAPI?.qendraImportPlus) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraImportPlus(table);
    },
    async qendraSyncVentas(dias) {
        if (!window.electronAPI?.qendraSyncVentas) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraSyncVentas(dias);
    },
    async qendraGetTodayTickets(horas) {
        if (!window.electronAPI?.qendraGetTodayTickets) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraGetTodayTickets(horas);
    },
    async qendraUpdatePrecio(plu, precio) {
        if (!window.electronAPI?.qendraUpdatePrecio) throw new Error('Electron API no disponible');
        return window.electronAPI.qendraUpdatePrecio(plu, precio);
    },
};
