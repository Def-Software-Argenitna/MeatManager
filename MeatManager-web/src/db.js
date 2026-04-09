// db.js — Stub sin Dexie. Toda la persistencia es directamente en la API REST.
// Este archivo existe solo para compatibilidad de imports mientras se termina la migración.
// NO usar: no hay IndexedDB, no hay Dexie, no hay sincronización local.

/**
 * @deprecated No usar db directamente. Usar fetchTable/saveTableRecord de apiClient.
 */
export const db = null;

export const getUnsyncedCount = async () => 0;

export const getNextDocumentNumber = async (_counterKey) => 0;

export const formatDocumentNumber = (value, digits = 4) =>
    String(Number(value) || 0).padStart(digits, '0');

export const formatReceiptCode = (branchCode, value) =>
    `${formatDocumentNumber(branchCode, 4)}-${formatDocumentNumber(value, 6)}`;

export const getNextReceiptData = async (_counterKey) => {
    throw new Error('getNextReceiptData: usar getNextRemoteReceiptData de apiClient');
};

export const initializePaymentMethods = async () => {
    // No-op: los métodos de pago se inicializan en la API al crear el tenant
};

export const initializeSettings = async () => {
    // No-op: los settings viven en la API
};
