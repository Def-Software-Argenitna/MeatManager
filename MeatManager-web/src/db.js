import Dexie from 'dexie';
import { auth } from './firebase';
import { buildApiUrl } from './utils/runtimeConfig';
import { getStoredAuthToken } from './utils/apiClient';

export const db = new Dexie('CarniceriaDB');

const DEFAULT_PAYMENT_METHODS = [
    { name: 'Posnet', type: 'card', percentage: 0, enabled: true, icon: '💳', bank: 'posnet' },
    { name: 'Mercado Pago', type: 'wallet', percentage: 0, enabled: true, icon: '💙' },
    { name: 'Cuenta DNI', type: 'wallet', percentage: 0, enabled: true, icon: '🆔' },
    { name: 'Efectivo', type: 'cash', percentage: 0, enabled: true, icon: '💵' },
    { name: 'Transferencia', type: 'transfer', percentage: 0, enabled: true, icon: '🏦' },
    { name: 'Cuenta Corriente', type: 'cuenta_corriente', percentage: 0, enabled: true, icon: '📋' },
];

db.version(2).stores({
    ventas: '++id, date, total, payment_method, synced',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, total_weight, yield_percentage, synced',
    payment_methods: '++id, name, type, percentage, enabled',
    prices: '++id, product_id, price, updated_at'
});

db.version(3).stores({
    compras: '++id, date, supplier, items, total, synced'
});

// Version 4: Clients & Current Accounts
db.version(4).stores({
    clients: '++id, name, phone, balance, last_updated',
    purchase_items: '++id, name, category_id, last_price, unit',
    categories: '++id, name, parent_id', // Hierarchical categories
    suppliers: '++id, name, cuit, iva_condition, phone, address, email' // Argentine business data
});

// Version 5: Detailed Supplier Address
db.version(5).stores({
    suppliers: '++id, name, cuit, iva_condition, phone, street, number, floor_dept, neighborhood, city, province, zip_code, email'
});

// Version 6: Traceability & Raw Material Inventory (Media Res, Animales Enteros)
db.version(6).stores({
    purchase_items: '++id, name, category_id, last_price, unit, type', // type: 'directo' | 'despostada'
    animal_lots: '++id, purchase_id, supplier, date, species, weight, status', // Pieces waiting for butchery
    compras: '++id, date, supplier, invoice_num, total, items_detail, synced' // Added invoice_num for remitos/facturas
});

// Version 7: Licensing & Settings
db.version(7).stores({
    settings: 'key, value' // Single key-value store for app config (license, shop name, etc.)
});

// Version 8: Advanced PRO Reports & Costs
db.version(8).stores({
    despostada_logs: '++id, type, date, supplier, total_weight, yield_percentage, lot_id, synced'
});

// Version 9: Orders (Pedidos) & WhatsApp Integration
db.version(9).stores({
    pedidos: '++id, customer_id, customer_name, items, total, status, delivery_date, created_at, source, whatsapp_id'
});

// Version 10: Digital Menu Configuration
db.version(10).stores({
    menu_digital: '++id, product_name, price, category, is_offer'
});

// Version 11: Logistics support (indexing delivery_type and address)
db.version(11).stores({
    pedidos: '++id, customer_id, customer_name, items, total, status, delivery_date, created_at, source, whatsapp_id, delivery_type, address'
});

// Version 12: Delivery tracking (adding repartidor and location)
db.version(12).stores({
    pedidos: '++id, customer_id, customer_name, items, total, status, delivery_date, created_at, source, whatsapp_id, delivery_type, address, repartidor'
});

// Version 13: Structured Delivery Driver Management
db.version(13).stores({
    repartidores: '++id, name, vehicle, phone, status'
});

// Version 14: Fleet Legal Documentation (Compliance)
db.version(14).stores({
    repartidores: '++id, name, vehicle, plate, phone, vtv_expiry, license_expiry, insurance_expiry, status'
});

// Version 15: Optimization for Joins & Cloud Sync Normalization
db.version(15).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, synced',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, updated_at',
    clients: '++id, name, phone, balance, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal'
});

// Version 16: Index 'synced' on sub-items for efficient cloud sync tracking
db.version(16).stores({
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, synced'
}).upgrade(async (tx) => {
    // Ensure existing sub-items have synced = 1 to avoid re-syncing everything
    await tx.ventas_items.toCollection().modify({ synced: 1 });
    await tx.compras_items.toCollection().modify({ synced: 1 });
});

// Version 17: Cash Management (Expenses, Cash-in/out)
db.version(17).stores({
    caja_movimientos: '++id, type, amount, category, description, date, synced'
});

// Version 19: AI & System Logging
db.version(19).stores({
    prices: '++id, product_id, price, plu, updated_at',
    app_logs: '++id, level, message, details, timestamp, synced'
});


// Version 20: Qendra integration — deduplicate imported tickets
db.version(20).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, synced, qendra_ticket_id, source'
});

// Version 21: User management with role-based access control
db.version(21).stores({
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
}).upgrade(async (tx) => {
    const count = await tx.table('users').count();
    if (count === 0) {
        const masterPin = await tx.table('settings').get('master_pin');
        await tx.table('users').add({
            username: 'Admin',
            pin: masterPin?.value || '1234',
            role: 'admin',
            active: 1,
        });
    }
});

db.version(22).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, phone, balance, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, synced',
    caja_movimientos: '++id, type, amount, category, description, date, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    settings: 'key, value'
}).upgrade(async (tx) => {
    await tx.table('ventas').toCollection().modify((venta) => {
        if (venta.payment_breakdown === undefined) venta.payment_breakdown = null;
    });
});

// Version 23: Extended optional client contact data
db.version(23).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, phone, address, balance, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, synced',
    caja_movimientos: '++id, type, amount, category, description, date, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    settings: 'key, value'
}).upgrade(async (tx) => {
    await tx.table('clients').toCollection().modify((client) => {
        if (client.address === undefined) client.address = '';
        if (client.phones === undefined) client.phones = client.phone || '';
        if (client.emails === undefined) client.emails = '';
    });
});

// Version 24: Structured client contact data and current account flags
db.version(24).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, synced',
    caja_movimientos: '++id, type, amount, category, description, date, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    settings: 'key, value'
}).upgrade(async (tx) => {
    await tx.table('clients').toCollection().modify((client) => {
        const phoneLines = String(client.phones || client.phone || '')
            .split('\n')
            .map((line) => String(line || '').trim())
            .filter(Boolean);
        const emailLines = String(client.emails || '')
            .split('\n')
            .map((line) => String(line || '').trim())
            .filter(Boolean);

        if (client.street === undefined) client.street = client.address || '';
        if (client.street_number === undefined) client.street_number = '';
        if (client.zip_code === undefined) client.zip_code = '';
        if (client.city === undefined) client.city = '';
        if (client.phone1 === undefined) client.phone1 = phoneLines[0] || client.phone || '';
        if (client.phone2 === undefined) client.phone2 = phoneLines[1] || '';
        if (client.email1 === undefined) client.email1 = emailLines[0] || '';
        if (client.email2 === undefined) client.email2 = emailLines[1] || '';
        if (client.has_current_account === undefined) client.has_current_account = true;
        if (client.has_initial_balance === undefined) client.has_initial_balance = Number(client.balance || 0) !== 0;
    });
});

// Version 25: Split client full name into first and last name
db.version(25).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, first_name, last_name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, synced',
    caja_movimientos: '++id, type, amount, category, description, date, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    settings: 'key, value'
}).upgrade(async (tx) => {
    await tx.table('clients').toCollection().modify((client) => {
        const fullName = String(client.name || '').trim();
        if (client.first_name === undefined || client.last_name === undefined) {
            const parts = fullName.split(/\s+/).filter(Boolean);
            client.first_name = client.first_name ?? (parts.shift() || '');
            client.last_name = client.last_name ?? parts.join(' ');
        }
    });
});

db.version(26).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, first_name, last_name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, synced',
    caja_movimientos: '++id, type, amount, category, description, date, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    settings: 'key, value'
}).upgrade(async (tx) => {
    await tx.table('payment_methods').clear();
    await tx.table('payment_methods').bulkAdd(DEFAULT_PAYMENT_METHODS);
});

db.version(27).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, first_name, last_name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, usage, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, destination, synced',
    caja_movimientos: '++id, type, amount, category, description, date, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    settings: 'key, value'
}).upgrade(async (tx) => {
    await tx.table('purchase_items').toCollection().modify((item) => {
        if (item.usage === undefined) item.usage = 'venta';
    });
    await tx.table('compras_items').toCollection().modify((item) => {
        if (item.destination === undefined) item.destination = 'venta';
    });
});

db.version(28).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, receipt_number, receipt_code, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, first_name, last_name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, usage, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, destination, synced',
    caja_movimientos: '++id, type, amount, category, description, date, receipt_number, receipt_code, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    settings: 'key, value'
}).upgrade(async (tx) => {
    await tx.table('ventas').toCollection().modify((venta) => {
        if (venta.receipt_number === undefined) venta.receipt_number = null;
    });
    await tx.table('caja_movimientos').toCollection().modify((mov) => {
        if (mov.receipt_number === undefined) mov.receipt_number = null;
    });
});

db.version(29).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, receipt_number, receipt_code, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, first_name, last_name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, usage, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, destination, synced',
    caja_movimientos: '++id, type, amount, category, description, date, receipt_number, receipt_code, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    settings: 'key, value'
}).upgrade(async (tx) => {
    const branchCodeSetting = await tx.table('settings').get('branch_code');
    const branchCode = branchCodeSetting?.value || 1;

    await tx.table('settings').put({ key: 'branch_code', value: branchCode });

    await tx.table('ventas').toCollection().modify((venta) => {
        if (venta.receipt_code === undefined || !venta.receipt_code) {
            venta.receipt_code = formatReceiptCode(branchCode, venta.receipt_number || venta.id);
        }
    });

    await tx.table('caja_movimientos').toCollection().modify((mov) => {
        if (mov.receipt_code === undefined || !mov.receipt_code) {
            mov.receipt_code = mov.receipt_number ? formatReceiptCode(branchCode, mov.receipt_number) : null;
        }
    });
});

db.version(30).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, receipt_number, receipt_code, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, first_name, last_name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, usage, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, destination, synced',
    caja_movimientos: '++id, type, amount, category, description, date, receipt_number, receipt_code, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    branch_stock_snapshots: '++id, branch_code, branch_name, snapshot_at, imported_at',
    settings: 'key, value'
});

db.version(31).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, receipt_number, receipt_code, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, first_name, last_name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, usage, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, destination, synced',
    caja_movimientos: '++id, type, amount, category, description, date, receipt_number, receipt_code, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    branch_stock_snapshots: '++id, branch_code, branch_name, snapshot_at, imported_at',
    deleted_sales_history: '++id, deleted_at, deleted_by_user_id, sale_id, receipt_code, sale_date, payment_method, clientId',
    settings: 'key, value'
}).upgrade(async (tx) => {
    const deleteCode = await tx.table('settings').get('ticket_delete_authorization_code');
    if (!deleteCode) {
        await tx.table('settings').put({ key: 'ticket_delete_authorization_code', value: '' });
    }
});

db.version(32).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, receipt_number, receipt_code, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, first_name, last_name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, usage, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, destination, synced',
    caja_movimientos: '++id, type, amount, category, description, date, receipt_number, receipt_code, synced',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    branch_stock_snapshots: '++id, branch_code, branch_name, snapshot_at, imported_at',
    deleted_sales_history: '++id, deleted_at, deleted_by_user_id, sale_id, receipt_code, sale_date, payment_method, clientId',
    settings: 'key, value'
}).upgrade(async (tx) => {
    const paymentMethods = tx.table('payment_methods');
    const existingCurrentAccount = await paymentMethods.where('name').equals('Cuenta Corriente').first();
    if (!existingCurrentAccount) {
        await paymentMethods.add({ name: 'Cuenta Corriente', type: 'cuenta_corriente', percentage: 0, enabled: true, icon: '📋' });
    }
});

db.version(33).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, receipt_number, receipt_code, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, first_name, last_name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, usage, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, destination, synced',
    caja_movimientos: '++id, type, amount, category, description, date, receipt_number, receipt_code, synced',
    cash_closures: '++id, &closure_date, closed_at, report_path',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    branch_stock_snapshots: '++id, branch_code, branch_name, snapshot_at, imported_at',
    deleted_sales_history: '++id, deleted_at, deleted_by_user_id, sale_id, receipt_code, sale_date, payment_method, clientId',
    settings: 'key, value'
}).upgrade(async (tx) => {
    const reportFolder = await tx.table('settings').get('cash_closure_reports_folder');
    if (!reportFolder) {
        await tx.table('settings').put({ key: 'cash_closure_reports_folder', value: '' });
    }
});

db.version(34).stores({
    ventas: '++id, date, total, payment_method, payment_method_id, clientId, receipt_number, receipt_code, synced, qendra_ticket_id, source',
    stock: '++id, name, type, quantity, updated_at, synced',
    despostada_logs: '++id, type, date, supplier, total_weight, lot_id, synced',
    payment_methods: '++id, name, type, enabled',
    prices: '++id, product_id, price, plu, updated_at',
    clients: '++id, name, first_name, last_name, phone, address, city, balance, has_current_account, last_updated, synced',
    suppliers: '++id, name, cuit, city, province, synced',
    purchase_items: '++id, name, category_id, type, species, usage, default_iva_rate, synced',
    categories: '++id, name, parent_id, synced',
    animal_lots: '++id, purchase_id, supplier, date, status, synced',
    compras: '++id, date, supplier, invoice_num, total, synced',
    pedidos: '++id, customer_id, customer_name, status, delivery_date, created_at, source, sync_cloud',
    repartidores: '++id, name, vehicle, status, synced',
    menu_digital: '++id, product_name, category, is_offer, synced',
    ventas_items: '++id, venta_id, product_name, quantity, price, subtotal, synced',
    compras_items: '++id, purchase_id, product_name, quantity, weight, unit_price, subtotal, destination, iva_rate, iva_amount, net_subtotal, synced',
    caja_movimientos: '++id, type, amount, category, description, date, receipt_number, receipt_code, synced',
    cash_closures: '++id, &closure_date, closed_at, report_path',
    supplier_item_tax_profiles: '++id, supplier_name, product_name, last_iva_rate, updated_at, [supplier_name+product_name]',
    app_logs: '++id, level, message, details, timestamp, synced',
    users: '++id, username, role, active',
    user_permissions: '++id, user_id, path',
    branch_stock_snapshots: '++id, branch_code, branch_name, snapshot_at, imported_at',
    deleted_sales_history: '++id, deleted_at, deleted_by_user_id, sale_id, receipt_code, sale_date, payment_method, clientId',
    settings: 'key, value'
}).upgrade(async (tx) => {
    const inferPurchaseItemIvaRate = (item) => {
        const species = String(item?.species || '').trim().toLowerCase();
        const type = String(item?.type || '').trim().toLowerCase();
        if (type === 'despostada' || ['vaca', 'cerdo', 'pollo', 'pescado'].includes(species)) {
            return 10.5;
        }
        return 21;
    };

    await tx.table('purchase_items').toCollection().modify((item) => {
        if (item.default_iva_rate == null) {
            item.default_iva_rate = inferPurchaseItemIvaRate(item);
        }
    });
});

// Helper to check sync status
export const getUnsyncedCount = async () => {
    const tables = ['ventas', 'ventas_items', 'stock', 'clients', 'suppliers', 'compras', 'compras_items', 'despostada_logs', 'caja_movimientos'];
    let total = 0;
    for (const table of tables) {
        if (db[table]) {
            try {
                total += await db[table].where('synced').equals(0).count();
            } catch {
                // Table might not have synced index or not exist in this version
            }
        }
    }
    return total;
};

export const getNextDocumentNumber = async (counterKey) => {
    return db.transaction('rw', db.settings, async () => {
        const current = await db.settings.get(counterKey);
        const nextNumber = (Number(current?.value) || 0) + 1;
        await db.settings.put({ key: counterKey, value: nextNumber });
        return nextNumber;
    });
};

export const formatDocumentNumber = (value, digits = 4) => String(Number(value) || 0).padStart(digits, '0');
export const formatReceiptCode = (branchCode, value) => `${formatDocumentNumber(branchCode, 4)}-${formatDocumentNumber(value, 6)}`;

export const getNextReceiptData = async (counterKey) => {
    return db.transaction('rw', db.settings, async () => {
        const currentCounter = await db.settings.get(counterKey);
        const branchCodeSetting = await db.settings.get('branch_code');
        const nextNumber = (Number(currentCounter?.value) || 0) + 1;
        const branchCode = Number(branchCodeSetting?.value) || 1;

        await db.settings.put({ key: counterKey, value: nextNumber });
        if (!branchCodeSetting) {
            await db.settings.put({ key: 'branch_code', value: branchCode });
        }

        return {
            receiptNumber: nextNumber,
            receiptCode: formatReceiptCode(branchCode, nextNumber),
            branchCode
        };
    });
};

// Initialize default payment methods
export const initializePaymentMethods = async () => {
    const count = await db.payment_methods.count();
    if (count === 0) {
        await db.payment_methods.bulkAdd([
            // Efectivo
            { name: 'Efectivo', type: 'cash', percentage: 0, enabled: true, icon: '💵' },

            // Tarjetas de Débito
            { name: 'Débito Visa', type: 'debit', percentage: 0, enabled: true, icon: '💳', bank: 'visa' },
            { name: 'Débito Mastercard', type: 'debit', percentage: 0, enabled: true, icon: '💳', bank: 'mastercard' },
            { name: 'Débito Maestro', type: 'debit', percentage: 0, enabled: true, icon: '💳', bank: 'maestro' },
            { name: 'Débito Cabal', type: 'debit', percentage: 0, enabled: true, icon: '💳', bank: 'cabal' },

            // Tarjetas de Crédito
            { name: 'Crédito Visa', type: 'credit', percentage: 10, enabled: true, icon: '💳', bank: 'visa' },
            { name: 'Crédito Mastercard', type: 'credit', percentage: 10, enabled: true, icon: '💳', bank: 'mastercard' },
            { name: 'Crédito American Express', type: 'credit', percentage: 15, enabled: true, icon: '💳', bank: 'amex' },
            { name: 'Crédito Cabal', type: 'credit', percentage: 10, enabled: true, icon: '💳', bank: 'cabal' },
            { name: 'Naranja', type: 'credit', percentage: 12, enabled: true, icon: '🍊', bank: 'naranja' },

            // Billeteras Virtuales
            { name: 'Mercado Pago', type: 'wallet', percentage: 5, enabled: true, icon: '💙' },
            { name: 'Ualá', type: 'wallet', percentage: 0, enabled: true, icon: '🔵' },
            { name: 'Cuenta DNI', type: 'wallet', percentage: 0, enabled: true, icon: '🆔' },
            { name: 'Personal Pay', type: 'wallet', percentage: 3, enabled: true, icon: '📱' },
            { name: 'Modo', type: 'wallet', percentage: 0, enabled: true, icon: '🟣' },
            { name: 'Cuenta Corriente', type: 'cuenta_corriente', percentage: 0, enabled: true, icon: '📋' },

            // Transferencias
            { name: 'Transferencia Bancaria', type: 'transfer', percentage: 0, enabled: true, icon: '🏦' },
            { name: 'CBU/CVU', type: 'transfer', percentage: 0, enabled: true, icon: '🔢' },

            // Criptomonedas
            { name: 'Bitcoin (BTC)', type: 'crypto', percentage: -5, enabled: false, icon: '₿' },
            { name: 'Ethereum (ETH)', type: 'crypto', percentage: -5, enabled: false, icon: 'Ξ' },
            { name: 'USDT (Tether)', type: 'crypto', percentage: -3, enabled: false, icon: '₮' },
            { name: 'DAI', type: 'crypto', percentage: -3, enabled: false, icon: '◈' },
        ]);
    }
};

// Initialize app settings
export const initializeSettings = async () => {
    const license = await db.settings.get('license_mode');
    if (!license) {
        // Default to 'light' for new installations
        await db.settings.put({ key: 'license_mode', value: 'light' });
        await db.settings.put({ key: 'installation_id', value: Math.random().toString(36).substring(2, 10).toUpperCase() });
        await db.settings.put({ key: 'cloud_enabled', value: false });
        await db.settings.put({ key: 'master_pin', value: '1234' });
        await db.settings.put({ key: 'branch_code', value: 1 });
        await db.settings.put({ key: 'ticket_delete_authorization_code', value: '' });
        await db.settings.put({ key: 'cash_closure_reports_folder', value: '' });
    } else {
        const deleteCode = await db.settings.get('ticket_delete_authorization_code');
        if (!deleteCode) {
            await db.settings.put({ key: 'ticket_delete_authorization_code', value: '' });
        }
        const closureFolder = await db.settings.get('cash_closure_reports_folder');
        if (!closureFolder) {
            await db.settings.put({ key: 'cash_closure_reports_folder', value: '' });
        }
    }
};

// ── MySQL Sync (SaaS) ────────────────────────────────────────────────────────
const MYSQL_DATA_URL = buildApiUrl('/data');

async function syncToMysql(table, operation, record, id) {
    try {
        if (!sessionStorage.getItem('mm_tenant')) return;
        const token = getStoredAuthToken() || (auth.currentUser ? await auth.currentUser.getIdToken() : null);
        if (!token) return;

        fetch(MYSQL_DATA_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                table,
                operation,
                record: record ?? undefined,
                id: id ?? undefined,
            }),
        }).catch((e) => console.warn('[MySQL sync]', table, operation, e.message));
    } catch (e) {
        console.warn('[MySQL sync]', table, operation, e.message);
    }
}

const SYNC_TABLES = [
    'users', 'user_permissions',
    'ventas', 'ventas_items',
    'stock', 'clients',
    'compras', 'compras_items',
    'suppliers', 'categories', 'purchase_items',
    'pedidos', 'repartidores', 'caja_movimientos',
    'payment_methods', 'menu_digital',
    'prices', 'despostada_logs', 'animal_lots',
    'deleted_sales_history', 'branch_stock_snapshots'
];

SYNC_TABLES.forEach((tbl) => {
    if (!db[tbl]) return;

    db[tbl].hook('creating', function (primKey, obj) {
        this.onsuccess = (generatedPk) => {
            syncToMysql(tbl, 'insert', { ...obj, id: generatedPk });
        };
    });

    db[tbl].hook('updating', function (mods, primKey, obj) {
        syncToMysql(tbl, 'update', { ...obj, ...mods, id: primKey }, primKey);
    });

    db[tbl].hook('deleting', function (primKey) {
        syncToMysql(tbl, 'delete', null, primKey);
    });
});

db.settings.hook('creating', function (_pk, obj) {
    this.onsuccess = () => syncToMysql('settings', 'upsert', obj);
});

db.settings.hook('updating', function (mods, _pk, obj) {
    syncToMysql('settings', 'upsert', { ...obj, ...mods });
});
