export const exportFullBackup = async () => {
    throw new Error('El backup local basado en IndexedDB fue retirado. Usá el backend/MySQL para respaldos.');
};

export const importFullBackup = async (file) => {
    void file;
    throw new Error('La restauración local basada en IndexedDB fue retirada. Usá herramientas de backend/MySQL.');
};
