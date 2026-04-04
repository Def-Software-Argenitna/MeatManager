import { db } from '../db';

export const exportFullBackup = async () => {
    const backup = {
        version: 1,
        timestamp: new Date().toISOString(),
        tables: {}
    };

    const tableNames = [
        'ventas', 'stock', 'despostada_logs', 'payment_methods', 'prices',
        'clients', 'suppliers', 'purchase_items', 'categories', 'animal_lots',
        'compras', 'pedidos', 'repartidores', 'menu_digital', 'ventas_items',
        'compras_items', 'caja_movimientos', 'settings'
    ];

    for (const tableName of tableNames) {
        if (db[tableName]) {
            backup.tables[tableName] = await db[tableName].toArray();
        }
    }

    const dataStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `MeatManager_Backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const importFullBackup = async (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const backup = JSON.parse(e.target.result);

                if (!backup.tables) {
                    throw new Error("Formato de backup inválido");
                }

                if (!confirm("Esto reemplazará TODOS los datos actuales con los del backup. ¿Estás seguro?")) {
                    resolve(false);
                    return;
                }

                // Use a transaction for safety
                await db.transaction('rw', db.tables, async () => {
                    for (const tableName in backup.tables) {
                        if (db[tableName]) {
                            await db[tableName].clear();
                            await db[tableName].bulkAdd(backup.tables[tableName]);
                        }
                    }
                });

                resolve(true);
            } catch (err) {
                console.error("Import Error:", err);
                reject(err);
            }
        };
        reader.readAsText(file);
    });
};
