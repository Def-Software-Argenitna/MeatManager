import React, { useState, useEffect } from 'react';
import {
    Send,
    Download,
    Search,
    AlertCircle,
    CheckCircle2,
    FileUp,
    ArrowLeftRight,
    MapPin,
    Calendar,
    Bell,
    Share2,
    Database,
    FolderSync,
    Eye,
    FileJson,
    X,
    Crown,
    Trash2,
    Plus,
    Phone,
    User,
    Pencil
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useUser } from '../context/UserContext';
import { branchSyncService } from '../utils/BranchSyncService';
import './Sucursales.css';

const normalizeBranchCode = (value) => String(value ?? '').replace(/\D/g, '').slice(0, 4).padStart(4, '0');

const normalizeBranchEntry = (entry, fallbackIndex = 0) => {
    if (entry && typeof entry === 'object') {
        return {
            code: normalizeBranchCode(entry.code || entry.id || fallbackIndex + 1),
            name: String(entry.name || '').trim(),
            address: String(entry.address || '').trim(),
            locality: String(entry.locality || '').trim(),
            responsible: String(entry.responsible || '').trim(),
            phone: String(entry.phone || '').trim(),
            type: entry.type || 'sucursal'
        };
    }

    return {
        code: normalizeBranchCode(fallbackIndex + 1),
        name: String(entry || '').trim(),
        address: '',
        locality: '',
        responsible: '',
        phone: '',
        type: 'sucursal'
    };
};

const normalizeRegisteredBranches = (entries) =>
    (Array.isArray(entries) ? entries : [])
        .map((entry, index) => normalizeBranchEntry(entry, index))
        .filter((entry) => entry.name);

const summarizeSnapshotStock = (items) => {
    const normalizedItems = Array.isArray(items) ? items : [];
    const totalKg = normalizedItems.reduce((acc, item) => acc + (Number(item.quantity) || 0), 0);
    const lowStockCount = normalizedItems.filter((item) => (Number(item.quantity) || 0) > 0 && (Number(item.quantity) || 0) < 10).length;
    return {
        itemsCount: normalizedItems.length,
        totalKg,
        lowStockCount
    };
};

const EMPTY_BRANCH_FORM = {
    code: '',
    name: '',
    address: '',
    locality: '',
    responsible: '',
    phone: '',
    type: 'sucursal'
};

const Sucursales = () => {
    const { currentUser } = useUser();
    const isAdmin = currentUser?.role === 'admin';
    const showDesktopBranchCreator = true;
    const [currentBranch, setCurrentBranch] = useState('...');
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [branchProfile, setBranchProfile] = useState({
        code: '0001',
        name: 'Casa Central',
        address: '',
        locality: '',
        phone: '',
        responsible: '',
        type: 'sucursal' // sucursal | master
    });

    const [destinationBranch, setDestinationBranch] = useState('');
    const [transferItems, setTransferItems] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [directoryHandle, setDirectoryHandle] = useState(null);
    const [detectedFiles, setDetectedFiles] = useState([]);

    // Security
    const [showPinDialog, setShowPinDialog] = useState(false);
    const [pinInput, setPinInput] = useState('');

    // Global Stock View States
    const [isGlobalViewOpen, setIsGlobalViewOpen] = useState(false);
    const [globalStockData, setGlobalStockData] = useState([]); // Array of { branch, stock: [] }
    const [importingBranchStock, setImportingBranchStock] = useState(false);

    // Role & Identity States
    const [isMaster, setIsMaster] = useState(false);
    const [registeredBranches, setRegisteredBranches] = useState([]);
    const [branchForm, setBranchForm] = useState(EMPTY_BRANCH_FORM);
    const [editingBranchCode, setEditingBranchCode] = useState(null);
    const [branchFilesModal, setBranchFilesModal] = useState(null);
    const branchSnapshots = useLiveQuery(
        () => db.branch_stock_snapshots?.orderBy('imported_at').reverse().toArray() || [],
        [],
        []
    );

    const verifyMasterPin = async () => {
        if (!isAdmin) {
            alert('Solo un usuario administrador puede activar el modo Master.');
            return;
        }
        const storedPin = await db.settings.get('master_pin') || { value: '1234' };
        if (pinInput === storedPin.value) {
            const newProfile = { ...branchProfile, type: 'master' };
            setBranchProfile(newProfile);
            await db.settings.put({ key: 'branch_profile', value: JSON.stringify(newProfile) });
            await db.settings.put({ key: 'is_master_node', value: true });
            setIsMaster(true);
            setShowPinDialog(false);
            setPinInput('');
            alert("✅ Modo MASTER Activado");
        } else {
            alert("❌ PIN Incorrecto");
        }
    };

    const saveBranchProfile = async () => {
        if (!isAdmin) {
            alert('Solo un usuario administrador puede editar el perfil de sucursal.');
            return;
        }
        const normalizedProfile = {
            ...branchProfile,
            code: normalizeBranchCode(branchProfile.code || 1),
            name: String(branchProfile.name || '').trim() || 'Sucursal'
        };

        await db.settings.put({ key: 'branch_profile', value: JSON.stringify(normalizedProfile) });
        await db.settings.put({ key: 'branch_name', value: normalizedProfile.name });
        await db.settings.put({ key: 'branch_code', value: Number(normalizedProfile.code) });
        setBranchProfile(normalizedProfile);
        setCurrentBranch(normalizedProfile.name);
        setIsEditingProfile(false);
        localStorage.setItem('branch_name', normalizedProfile.name);
    };

    const persistRegisteredBranches = async (nextBranches) => {
        const normalizedBranches = normalizeRegisteredBranches(nextBranches);
        setRegisteredBranches(normalizedBranches);
        await db.settings.put({ key: 'registered_branches', value: JSON.stringify(normalizedBranches) });
    };

    const resetBranchForm = () => {
        setBranchForm(EMPTY_BRANCH_FORM);
        setEditingBranchCode(null);
    };

    const addBranch = async () => {
        if (!isAdmin) {
            alert('Solo un usuario administrador puede registrar sucursales.');
            return;
        }
        const normalizedName = String(branchForm.name || '').trim();
        const normalizedCode = normalizeBranchCode(branchForm.code || registeredBranches.length + 1);

        if (!normalizedName) return;
        if (registeredBranches.some((branch) => (
            branch.code !== editingBranchCode && (
                branch.code === normalizedCode || branch.name.toLowerCase() === normalizedName.toLowerCase()
            )
        ))) {
            alert('Ya existe una sucursal con ese nombre o código.');
            return;
        }

        const branchPayload = {
            code: normalizedCode,
            name: normalizedName,
            address: String(branchForm.address || '').trim(),
            locality: String(branchForm.locality || '').trim(),
            responsible: String(branchForm.responsible || '').trim(),
            phone: String(branchForm.phone || '').trim(),
            type: branchForm.type || 'sucursal'
        };
        const newList = editingBranchCode
            ? registeredBranches.map((branch) => branch.code === editingBranchCode ? branchPayload : branch)
            : [...registeredBranches, branchPayload];
        await persistRegisteredBranches(newList);
        resetBranchForm();
    };

    const removeBranch = async (branchToRemove) => {
        if (!isAdmin) {
            alert('Solo un usuario administrador puede eliminar sucursales.');
            return;
        }
        const newList = registeredBranches.filter((branch) => branch.code !== branchToRemove.code);
        await persistRegisteredBranches(newList);
    };

    const startEditBranch = (branch) => {
        setBranchForm({
            code: branch.code,
            name: branch.name,
            address: branch.address || '',
            locality: branch.locality || '',
            responsible: branch.responsible || '',
            phone: branch.phone || '',
            type: branch.type || 'sucursal'
        });
        setEditingBranchCode(branch.code);
    };

    const exportMyStock = async () => {
        const items = await db.stock.toArray();
        const balances = {};
        items.forEach(i => {
            if (!balances[i.name]) balances[i.name] = { name: i.name, quantity: 0, type: i.type };
            balances[i.name].quantity += i.quantity;
        });

        const now = new Date();
        const startDay = new Date(now);
        startDay.setHours(0, 0, 0, 0);
        const endDay = new Date(now);
        endDay.setHours(23, 59, 59, 999);
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

        const [salesToday, purchasesMonth, cashMovementsToday] = await Promise.all([
            db.ventas.where('date').between(startDay, endDay).toArray(),
            db.compras.where('date').aboveOrEqual(`${startMonth.getFullYear()}-${String(startMonth.getMonth() + 1).padStart(2, '0')}-01`).toArray(),
            db.caja_movimientos.where('date').between(startDay, endDay).toArray()
        ]);

        const salesTotal = salesToday.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
        const purchasesTotal = purchasesMonth.reduce((sum, purchase) => sum + (Number(purchase.total) || 0), 0);
        const totalExpenses = cashMovementsToday.filter((m) => m.type === 'egreso').reduce((sum, movement) => sum + (Number(movement.amount) || 0), 0);
        const totalIncomes = cashMovementsToday.filter((m) => m.type === 'ingreso').reduce((sum, movement) => sum + (Number(movement.amount) || 0), 0);

        const paymentMethods = await db.payment_methods.toArray();
        const totalsByMethod = {};
        salesToday.forEach((sale) => {
            if (Array.isArray(sale.payment_breakdown) && sale.payment_breakdown.length > 0) {
                sale.payment_breakdown.forEach((part) => {
                    const methodName = part.method_name || 'Pago Mixto';
                    totalsByMethod[methodName] = (totalsByMethod[methodName] || 0) + (Number(part.amount_charged) || 0);
                });
                return;
            }
            const methodName = sale.payment_method || 'Efectivo';
            totalsByMethod[methodName] = (totalsByMethod[methodName] || 0) + (Number(sale.total) || 0);
        });

        const cashMethodNames = new Set(
            paymentMethods
                .filter((method) => method.type === 'cash' || method.name === 'Efectivo')
                .map((method) => method.name)
                .concat(['Efectivo'])
        );
        const cashSales = Object.entries(totalsByMethod).reduce((sum, [methodName, total]) => (
            cashMethodNames.has(methodName) ? sum + total : sum
        ), 0);
        const netCashInDrawer = cashSales - totalExpenses + totalIncomes;
        const stockSummary = summarizeSnapshotStock(Object.values(balances).filter(i => i.quantity > 0));

        const data = {
            branch: branchProfile,
            timestamp: new Date().toISOString(),
            stock: Object.values(balances).filter(i => i.quantity > 0),
            summary: {
                sales_today_total: salesTotal,
                sales_today_count: salesToday.length,
                purchases_month_total: purchasesTotal,
                purchases_month_count: purchasesMonth.length,
                stock_total_kg: stockSummary.totalKg,
                stock_items_count: stockSummary.itemsCount,
                stock_low_count: stockSummary.lowStockCount,
                cash_sales_total: cashSales,
                cash_manual_incomes: totalIncomes,
                cash_manual_expenses: totalExpenses,
                cash_in_drawer_total: netCashInDrawer
            }
        };

        const json = JSON.stringify(data, null, 2);
        const fileName = `STOCK_${branchProfile.code}_${branchProfile.name.replace(/\s/g, '_')}.json`;

        if (directoryHandle) {
            try {
                const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(json);
                await writable.close();
                alert(`✅ Stock exportado a la carpeta vinculada.`);
            } catch {
                alert('Error al guardar archivo en carpeta vinculada.');
            }
        } else {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
        }
    };

    const refreshGlobalStock = async () => {
        if (!directoryHandle) return;

        const data = [];
        try {
            for await (const entry of directoryHandle.values()) {
                if (entry.kind === 'file' && entry.name.startsWith('STOCK_') && entry.name.endsWith('.json')) {
                    const file = await entry.getFile();
                    const text = await file.text();
                    try {
                        const json = JSON.parse(text);
                        data.push(json);
                    } catch { console.error("Error parsing", entry.name); }
                }
            }
            setGlobalStockData(data);
            setIsGlobalViewOpen(true);
        } catch {
            alert("No se pudo leer la carpeta de sucursales.");
        }
    };

    // Load branch name from DB
    useEffect(() => {
        const loadName = async () => {
            const setting = await db.settings.get('branch_profile');
            const branchCodeSetting = await db.settings.get('branch_code');
            if (setting) {
                const profile = JSON.parse(setting.value);
                const normalizedProfile = {
                    code: normalizeBranchCode(profile.code || branchCodeSetting?.value || 1),
                    name: profile.name || 'Casa Central',
                    address: profile.address || '',
                    locality: profile.locality || '',
                    phone: profile.phone || '',
                    responsible: profile.responsible || '',
                    type: profile.type || 'sucursal'
                };
                setBranchProfile(normalizedProfile);
                setCurrentBranch(normalizedProfile.name);
            } else {
                // Fallback for old versions
                const legacyName = await db.settings.get('branch_name');
                const fallbackCode = normalizeBranchCode(branchCodeSetting?.value || 1);
                if (legacyName) {
                    setBranchProfile(prev => ({ ...prev, code: fallbackCode, name: legacyName.value }));
                    setCurrentBranch(legacyName.value);
                } else {
                    setBranchProfile(prev => ({ ...prev, code: fallbackCode }));
                }
            }

            const masterSetting = await db.settings.get('is_master_node');
            if (masterSetting) setIsMaster(masterSetting.value);

            const branchesSetting = await db.settings.get('registered_branches');
            if (branchesSetting) {
                const normalizedBranches = normalizeRegisteredBranches(JSON.parse(branchesSetting.value));
                setRegisteredBranches(normalizedBranches);
                await db.settings.put({ key: 'registered_branches', value: JSON.stringify(normalizedBranches) });
            }
        };
        loadName();
    }, []);

    const stockItems = useLiveQuery(() => db.stock.toArray());
    const filteredStock = stockItems?.filter(i =>
        i.name.toLowerCase().includes(searchTerm.toLowerCase()) && i.quantity > 0
    ) || [];

    const requestDirectory = async () => {
        if (!isAdmin) {
            alert('Solo un usuario administrador puede vincular carpetas de sucursales.');
            return;
        }
        try {
            const handle = await window.showDirectoryPicker();
            setDirectoryHandle(handle);
            await branchSyncService.setDirectory(handle);
            localStorage.setItem('branch_linked', 'true');
        } catch {
            console.warn('Directory access denied');
        }
    };

    const importBranchStockFiles = async (event, forcedBranch = null) => {
        if (!isAdmin) {
            alert('Solo un usuario administrador puede importar stock de sucursales.');
            return;
        }

        const files = Array.from(event.target.files || []);
        if (!files.length) return;

        setImportingBranchStock(true);
        try {
            for (const file of files) {
                const text = await file.text();
                const data = JSON.parse(text);
                const branch = data?.branch || forcedBranch || {};
                const stock = Array.isArray(data?.stock) ? data.stock : [];
                const branchCode = normalizeBranchCode(forcedBranch?.code || branch.code || branch.id || 0);
                const branchName = String(forcedBranch?.name || branch.name || file.name.replace(/^STOCK_/i, '').replace(/\.json$/i, '').replace(/_/g, ' ')).trim();
                const snapshotAt = data?.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString();
                const summary = summarizeSnapshotStock(stock);
                const importedSummary = data?.summary || {};

                const existing = await db.branch_stock_snapshots
                    .where('branch_code')
                    .equals(branchCode)
                    .toArray();

                if (existing.length) {
                    await db.branch_stock_snapshots.bulkDelete(existing.map((item) => item.id));
                }

                await db.branch_stock_snapshots.add({
                    branch_code: branchCode,
                    branch_name: branchName || `Sucursal ${branchCode}`,
                    snapshot_at: snapshotAt,
                    imported_at: new Date().toISOString(),
                    source_file: file.name,
                    stock,
                    branch,
                    items_count: summary.itemsCount,
                    total_kg: summary.totalKg,
                    low_stock_count: summary.lowStockCount,
                    sales_today_total: Number(importedSummary.sales_today_total) || 0,
                    sales_today_count: Number(importedSummary.sales_today_count) || 0,
                    purchases_month_total: Number(importedSummary.purchases_month_total) || 0,
                    purchases_month_count: Number(importedSummary.purchases_month_count) || 0,
                    cash_sales_total: Number(importedSummary.cash_sales_total) || 0,
                    cash_manual_incomes: Number(importedSummary.cash_manual_incomes) || 0,
                    cash_manual_expenses: Number(importedSummary.cash_manual_expenses) || 0,
                    cash_in_drawer_total: Number(importedSummary.cash_in_drawer_total) || 0
                });
            }

            alert('Stock de sucursales importado correctamente.');
        } catch (error) {
            console.error(error);
            alert('No se pudo importar uno o más archivos de stock.');
        } finally {
            setImportingBranchStock(false);
            event.target.value = '';
        }
    };

    const removeBranchSnapshots = async (snapshotIds = []) => {
        if (!isAdmin) {
            alert('Solo un usuario administrador puede eliminar stock importado.');
            return;
        }
        if (!snapshotIds.length) return;
        await db.branch_stock_snapshots.bulkDelete(snapshotIds);
        setBranchFilesModal(null);
    };

    useEffect(() => {
        // Sync with service
        branchSyncService.onFilesDetected = (files) => {
            // Filter out files that we sent ourselves (naming convention: FROM_BranchName)
            const incoming = files.filter(f => !f.startsWith(`FROM_${currentBranch.replace(/\s/g, '_')}`));
            setDetectedFiles(incoming);
        };

        if (branchSyncService.directoryHandle) {
            setDirectoryHandle(branchSyncService.directoryHandle);
            branchSyncService.checkFiles();
        }
    }, [currentBranch]);

    // --- TRANSFER OPERATIONS ---

    const addToTransfer = (item) => {
        if (transferItems.find(i => i.id === item.id)) return;
        setTransferItems([...transferItems, { ...item, transferQty: 0 }]);
    };

    const updateQty = (id, val) => {
        setTransferItems(prev => prev.map(i => i.id === id ? { ...i, transferQty: parseFloat(val) || 0 } : i));
    };

    const generateTransferFile = async () => {
        if (transferItems.length === 0 || !destinationBranch) {
            alert('Seleccione items y sucursal destino');
            return;
        }

        const data = {
            id: `T-${Date.now()}`,
            origin: currentBranch,
            destination: destinationBranch,
            date: new Date().toISOString(),
            items: transferItems.map(i => ({ name: i.name, type: i.type, quantity: i.transferQty }))
        };

        const json = JSON.stringify(data, null, 2);
        const fileName = `FROM_${currentBranch.replace(/\s/g, '_')}_PARA_${destinationBranch.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}_${Date.now()}.meat`;

        let savedDirectly = false;

        // Tries to save directly to the linked folder (Google Drive / Dropbox)
        if (directoryHandle) {
            try {
                const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(json);
                await writable.close();
                savedDirectly = true;
                alert(`✅ ¡Éxito! El archivo se guardó automáticamente en tu carpeta vinculada: "${directoryHandle.name}"`);
            } catch {
                console.warn("Could not save directly, falling back to manual download");
            }
        }

        if (!savedDirectly) {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            alert(`✅ Archivo generado. Como no hay carpeta vinculada, se bajó a tu carpeta de "Descargas". Movelo al Drive manualmente.`);
        }

        // Update local stock (discount)
        for (const item of transferItems) {
            await db.stock.add({
                name: item.name,
                type: item.type,
                quantity: -item.transferQty,
                updated_at: new Date(),
                reference: `Envío a sucursal ${destinationBranch}`
            });
        }

        setTransferItems([]);
    };

    const handleImportFile = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (confirm(`¿Recibir ${data.items.length} items de ${data.origin}?`)) {
                    for (const item of data.items) {
                        await db.stock.add({
                            name: item.name,
                            type: item.type,
                            quantity: item.quantity,
                            updated_at: new Date(),
                            reference: `Recibido de ${data.origin}`
                        });
                    }
                    alert('✅ Stock actualizado correctamente');
                }
            } catch {
                alert('Error al leer el archivo');
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="sucursales-container animate-fade-in">
            {/* PIN DIALOG */}
            {showPinDialog && (
                <div className="modal-overlay" style={{ zIndex: 2000 }}>
                    <div className="pin-dialog neo-card animate-scale-in">
                        <h3>Acceso RESTRINGIDO</h3>
                        <p>Ingrese el PIN para activar el <strong>Modo Master</strong>.</p>
                        <input
                            type="password"
                            placeholder="PIN de Seguridad"
                            value={pinInput}
                            onChange={e => setPinInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && verifyMasterPin()}
                            autoFocus
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
                            <button className="neo-button" onClick={() => setShowPinDialog(false)}>Cancelar</button>
                            <button className="neo-button primary" onClick={verifyMasterPin}>Verificar</button>
                        </div>
                    </div>
                </div>
            )}

            <header className="sucursales-header">
                <div className="header-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                        <h1>{showDesktopBranchCreator ? 'Sucursal Local' : 'Sincronización de Sucursales'}</h1>
                        <span className="branch-badge">
                            {isEditingProfile ? (
                                <span>Editando Perfil...</span>
                            ) : (
                                <div onClick={() => isAdmin && setIsEditingProfile(true)} style={{ cursor: isAdmin ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <MapPin size={16} />
                                    <strong>{branchProfile.code}</strong>
                                    <span style={{ opacity: 0.45 }}>-</span>
                                    <strong>{currentBranch}</strong>
                                    <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{isAdmin ? '(Perfil)' : '(Solo lectura)'}</span>
                                </div>
                            )}
                        </span>
                    </div>
                    <p>Perfil: <strong>{branchProfile.type === 'master' ? 'Casa Central / Master' : 'Sucursal de Venta'}</strong></p>
                </div>

                {!showDesktopBranchCreator && <div className="directory-control" style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="neo-button" onClick={exportMyStock} title="Exportar mi stock actual">
                        <FileJson size={18} /> Exportar Stock
                    </button>
                    {directoryHandle ? (
                        <button className="neo-button pro-btn" onClick={refreshGlobalStock}>
                            <Eye size={18} /> Ver Vista Global
                        </button>
                    ) : (
                        <button className="neo-button" onClick={requestDirectory}>
                            <Share2 size={18} /> Vincular Carpeta
                        </button>
                    )}
                </div>}
            </header>

            {/* PROFILE EDITOR MODAL */}
            {isEditingProfile && (
                <div className="modal-overlay" style={{ zIndex: 1100 }}>
                    <div className="profile-edit-modal neo-card animate-scale-in">
                        <header className="modal-header">
                            <h2>Configurar Perfil de Sucursal</h2>
                            <button className="close-btn" onClick={() => setIsEditingProfile(false)}><X /></button>
                        </header>
                        <div className="profile-form">
                            <div className="form-group">
                                <label>Tipo de PC / Rol:</label>
                                <select
                                    className="neo-input"
                                    value={branchProfile.type}
                                    onChange={e => {
                                        if (e.target.value === 'master') {
                                            setShowPinDialog(true);
                                        } else {
                                            setBranchProfile({ ...branchProfile, type: 'sucursal' });
                                        }
                                    }}
                                    style={{ width: '100%', background: 'var(--color-bg-main)', color: 'white', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
                                >
                                    <option value="sucursal">📍 Sucursal de Venta (Estándar)</option>
                                    <option value="master">👑 Administración Central (Master)</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Código de Sucursal:</label>
                                <input
                                    value={branchProfile.code}
                                    onChange={e => setBranchProfile({ ...branchProfile, code: normalizeBranchCode(e.target.value) })}
                                    placeholder="0001"
                                    maxLength={4}
                                />
                                <span className="field-help">Se usa en comprobantes con formato {branchProfile.code || '0001'}-000001.</span>
                            </div>
                            <div className="form-group">
                                <label>Nombre Comercial:</label>
                                <input value={branchProfile.name} onChange={e => setBranchProfile({ ...branchProfile, name: e.target.value })} placeholder="Ej: Carnicería Antigravity Pilar" />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Dirección:</label>
                                    <input value={branchProfile.address} onChange={e => setBranchProfile({ ...branchProfile, address: e.target.value })} placeholder="Calle y N°" />
                                </div>
                                <div className="form-group">
                                    <label>Localidad:</label>
                                    <input value={branchProfile.locality} onChange={e => setBranchProfile({ ...branchProfile, locality: e.target.value })} placeholder="Ciudad" />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Responsable:</label>
                                    <input value={branchProfile.responsible} onChange={e => setBranchProfile({ ...branchProfile, responsible: e.target.value })} placeholder="Nombre completo" />
                                </div>
                                <div className="form-group">
                                    <label>Teléfono de Contacto:</label>
                                    <input value={branchProfile.phone} onChange={e => setBranchProfile({ ...branchProfile, phone: e.target.value })} placeholder="WhatsApp" />
                                </div>
                            </div>
                            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                <button className="neo-button" onClick={() => setIsEditingProfile(false)}>Cancelar</button>
                                <button className="neo-button primary" onClick={saveBranchProfile}>Guardar Perfil</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* BRANCH PROFILE SUMMARY */}
            <div className="neo-card animate-slide-down" style={{ marginBottom: '1.5rem', padding: '1.25rem 1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {branchProfile.type === 'master' ? <Crown size={18} color="#f59e0b" /> : <MapPin size={18} color="#3b82f6" />}
                            <span className="branch-code-pill">{branchProfile.code}</span>
                            {branchProfile.name || 'Sin nombre'}
                        </h3>
                        <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>
                            {branchProfile.type === 'master' ? 'Casa Central / Master' : 'Sucursal de Venta'}
                        </span>
                    </div>
                    <button
                        className="neo-button"
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                        onClick={() => isAdmin && setIsEditingProfile(true)}
                        disabled={!isAdmin}
                    >
                        <Pencil size={14} /> {isAdmin ? 'Editar' : 'Solo admin'}
                    </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.9rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: branchProfile.address ? 1 : 0.4 }}>
                        <MapPin size={15} color="#3b82f6" />
                        <span>{[branchProfile.address, branchProfile.locality].filter(Boolean).join(', ') || 'Sin dirección'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: branchProfile.responsible ? 1 : 0.4 }}>
                        <User size={15} color="#22c55e" />
                        <span>{branchProfile.responsible || 'Sin responsable'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: branchProfile.phone ? 1 : 0.4 }}>
                        <Phone size={15} color="#f59e0b" />
                        <span>{branchProfile.phone || 'Sin teléfono'}</span>
                    </div>
                </div>
            </div>

            {showDesktopBranchCreator && (
                <div className="branch-mode-card neo-card animate-slide-down">
                    <h3>Modo Instalable</h3>
                    <p>En la versión instalable sólo se configura la sucursal de esta máquina. No se habilita alta de otras sucursales ni sincronización entre locales desde aquí.</p>
                    <p>La gestión de múltiples sucursales y su creador quedarán reservados para la versión web/centralizada.</p>
                    <div className="branch-mode-actions">
                        <button className="neo-button primary" onClick={exportMyStock}>
                            <FileJson size={16} /> Exportar archivo de sucursal
                        </button>
                    </div>
                </div>
            )}

            {showDesktopBranchCreator && isAdmin && (
                <div className="identity-panel neo-card animate-slide-down">
                    <div className="identity-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h3>Administrador de Sucursales</h3>
                            <p>Creá sucursales, editá sus datos y administrá los archivos que recibís de cada una.</p>
                        </div>
                    </div>

                    <div className="branch-admin-layout">
                        <div className="branch-admin-form branch-admin-form-wide">
                            <div className="branch-admin-form-header">
                                <div>
                                    <h4>{editingBranchCode ? 'Editar sucursal' : 'Crear sucursal'}</h4>
                                    <p>{editingBranchCode ? 'Actualizá los datos de la sucursal seleccionada.' : 'Completá los datos y después usá la grilla para administrar archivos y acciones.'}</p>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Código</label>
                                    <input value={branchForm.code} onChange={(e) => setBranchForm({ ...branchForm, code: normalizeBranchCode(e.target.value) })} placeholder="0002" maxLength={4} />
                                </div>
                                <div className="form-group">
                                    <label>Nombre</label>
                                    <input value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} placeholder="Sucursal Pilar" />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Dirección</label>
                                    <input value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} placeholder="Calle y número" />
                                </div>
                                <div className="form-group">
                                    <label>Localidad</label>
                                    <input value={branchForm.locality} onChange={(e) => setBranchForm({ ...branchForm, locality: e.target.value })} placeholder="Localidad" />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Responsable</label>
                                    <input value={branchForm.responsible} onChange={(e) => setBranchForm({ ...branchForm, responsible: e.target.value })} placeholder="Responsable" />
                                </div>
                                <div className="form-group">
                                    <label>Teléfono</label>
                                    <input value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} placeholder="Teléfono" />
                                </div>
                            </div>
                            <div className="branch-form-actions">
                                {editingBranchCode && <button className="neo-button" onClick={resetBranchForm}>Cancelar edición</button>}
                                <button className="neo-button primary" onClick={addBranch}>{editingBranchCode ? 'Guardar cambios' : 'Crear sucursal'}</button>
                            </div>
                        </div>
                        <div className="branch-admin-grid branch-admin-grid-full">
                            {registeredBranches.length ? registeredBranches.map((branch) => {
                                const branchFiles = (branchSnapshots || []).filter((snapshot) => snapshot.branch_code === branch.code);
                                return (
                                    <div key={branch.code} className="branch-admin-card">
                                        <div className="branch-admin-card-head">
                                            <div>
                                                <strong>{branch.code}</strong>
                                                <span>{branch.name}</span>
                                            </div>
                                            <small>{branch.locality || 'Sin localidad'}</small>
                                        </div>
                                        <div className="branch-admin-card-body">
                                            <span>{branch.address || 'Sin dirección'}</span>
                                            <span>{branch.responsible || 'Sin responsable'}</span>
                                            <span>{branch.phone || 'Sin teléfono'}</span>
                                            <span>{branchFiles.length} archivo(s) cargado(s)</span>
                                        </div>
                                        <div className="branch-admin-actions">
                                            <button className="neo-button" onClick={() => startEditBranch(branch)}>Editar</button>
                                            <button className="neo-button" onClick={() => removeBranch(branch)}>Borrar</button>
                                            <label className={`branch-stock-upload compact ${importingBranchStock ? 'is-loading' : ''}`}>
                                                <FileUp size={14} />
                                                Cargar archivo
                                                <input
                                                    type="file"
                                                    accept=".json,application/json"
                                                    multiple
                                                    onChange={(event) => importBranchStockFiles(event, branch)}
                                                    disabled={importingBranchStock}
                                                />
                                            </label>
                                            <button className="neo-button" onClick={() => setBranchFilesModal(branch)}>Borrar archivo/s</button>
                                        </div>
                                    </div>
                                );
                            }) : (
                                <span className="text-muted">No hay sucursales creadas todavía.</span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* IDENTITY CONFIG */}
            {!showDesktopBranchCreator && isAdmin && <div className="identity-panel neo-card animate-slide-down">
                <div className="identity-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3>Gestión de Red de Locales</h3>
                        <p>Registre las sucursales habilitadas para el intercambio de datos.</p>
                    </div>
                    {isMaster && (
                        <div className="master-badge">MASTER</div>
                    )}
                </div>
                <div className="branch-admin-layout">
                    <div className="branch-admin-form">
                        <div className="form-row">
                            <div className="form-group">
                                <label>Código</label>
                                <input value={branchForm.code} onChange={(e) => setBranchForm({ ...branchForm, code: normalizeBranchCode(e.target.value) })} placeholder="0002" maxLength={4} />
                            </div>
                            <div className="form-group">
                                <label>Nombre</label>
                                <input value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} placeholder="Sucursal Pilar" />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Dirección</label>
                                <input value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} placeholder="Calle y número" />
                            </div>
                            <div className="form-group">
                                <label>Localidad</label>
                                <input value={branchForm.locality} onChange={(e) => setBranchForm({ ...branchForm, locality: e.target.value })} placeholder="Localidad" />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Responsable</label>
                                <input value={branchForm.responsible} onChange={(e) => setBranchForm({ ...branchForm, responsible: e.target.value })} placeholder="Responsable" />
                            </div>
                            <div className="form-group">
                                <label>Teléfono</label>
                                <input value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} placeholder="Teléfono" />
                            </div>
                        </div>
                        <div className="branch-form-actions">
                            {editingBranchCode && <button className="neo-button" onClick={resetBranchForm}>Cancelar edición</button>}
                            <button className="neo-button primary" onClick={addBranch}>{editingBranchCode ? 'Guardar cambios' : 'Crear sucursal'}</button>
                        </div>
                    </div>
                    <div className="branch-admin-grid">
                        {registeredBranches.length ? registeredBranches.map((branch) => (
                            <div key={branch.code} className="branch-admin-card">
                                <div className="branch-admin-card-head">
                                    <div>
                                        <strong>{branch.code}</strong>
                                        <span>{branch.name}</span>
                                    </div>
                                    <small>{branch.locality || 'Sin localidad'}</small>
                                </div>
                                <div className="branch-admin-card-body">
                                    <span>{branch.address || 'Sin dirección'}</span>
                                    <span>{branch.responsible || 'Sin responsable'}</span>
                                    <span>{branch.phone || 'Sin teléfono'}</span>
                                </div>
                                <div className="branch-admin-actions">
                                    <button className="neo-button" onClick={() => startEditBranch(branch)}>Editar</button>
                                    <button className="neo-button" onClick={() => removeBranch(branch)}>Borrar</button>
                                </div>
                            </div>
                        )) : (
                            <span className="text-muted">No hay sucursales registradas</span>
                        )}
                    </div>
                </div>
            </div>}

            {branchFilesModal && (
                <div className="modal-overlay" style={{ zIndex: 1200 }}>
                    <div className="profile-edit-modal neo-card animate-scale-in">
                        <header className="modal-header">
                            <div>
                                <h2>Archivos cargados</h2>
                                <p className="text-muted">{branchFilesModal.code} - {branchFilesModal.name}</p>
                            </div>
                            <button className="close-btn" onClick={() => setBranchFilesModal(null)}><X /></button>
                        </header>
                        <div className="profile-form">
                            {(() => {
                                const files = (branchSnapshots || []).filter((snapshot) => snapshot.branch_code === branchFilesModal.code);
                                if (!files.length) {
                                    return <p className="text-muted">No hay archivos cargados para esta sucursal.</p>;
                                }
                                return (
                                    <div className="branch-file-list">
                                        {files.map((snapshot) => (
                                            <div key={snapshot.id} className="branch-file-row">
                                                <div>
                                                    <strong>{snapshot.source_file || 'Archivo manual'}</strong>
                                                    <span>{snapshot.snapshot_at ? new Date(snapshot.snapshot_at).toLocaleString('es-AR') : '-'}</span>
                                                </div>
                                                <button className="neo-button" onClick={() => removeBranchSnapshots([snapshot.id])}>Eliminar</button>
                                            </div>
                                        ))}
                                        <div className="branch-file-actions">
                                            <button className="neo-button" onClick={() => setBranchFilesModal(null)}>Cerrar</button>
                                            <button className="neo-button primary" onClick={() => removeBranchSnapshots(files.map((snapshot) => snapshot.id))}>Eliminar todos</button>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* GLOBAL VIEW MODAL */}
            {!showDesktopBranchCreator && isGlobalViewOpen && (
                <div className="modal-overlay">
                    <div className="global-stock-modal animate-scale-in">
                        <header className="modal-header">
                            <div>
                                <h2>Vista Consolidada de Stock</h2>
                                <p className="text-muted">Comparativa de kilos entre sucursales vinculadas.</p>
                            </div>
                            <button className="close-btn" onClick={() => setIsGlobalViewOpen(false)}><X /></button>
                        </header>

                        <div className="modal-body">
                            <table className="global-stock-table">
                                <thead>
                                    <tr>
                                        <th>Producto</th>
                                        {globalStockData.map(b => (
                                            <th key={b.branch?.name || b.branch || Math.random()}>
                                                {typeof b.branch === 'object' ? (b.branch.name || 'Sin Nombre') : (b.branch || 'Sin Nombre')}
                                            </th>
                                        ))}
                                        <th className="total-col">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Array.from(new Set(globalStockData.flatMap(b => b.stock.map(i => i.name)))).sort().map(productName => {
                                        const total = globalStockData.reduce((acc, b) => {
                                            const item = b.stock.find(i => i.name === productName);
                                            return acc + (item ? item.quantity : 0);
                                        }, 0);
                                        return (
                                            <tr key={productName}>
                                                <td><strong>{productName}</strong></td>
                                                {globalStockData.map((b, idx) => {
                                                    const item = b.stock.find(i => i.name === productName);
                                                    return <td key={idx}>{item ? `${item.quantity.toFixed(1)} kg` : '-'}</td>;
                                                })}
                                                <td className="total-col"><strong>{total.toFixed(1)} kg</strong></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {!showDesktopBranchCreator && detectedFiles.length > 0 && (
                <div className="notifications-bar animate-slide-up">
                    <Bell className="bell-icon" />
                    <div className="notif-content">
                        <strong>Recibos Detectados:</strong>
                        <div className="file-pills">
                            {detectedFiles.map(f => (
                                <span key={f} className="file-pill">{f}</span>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {!showDesktopBranchCreator && <div className="sucursales-grid">

                {/* 1. ENVIAR MERCADERIA */}
                <div className="transfer-card send-panel neo-card">
                    <div className="panel-header">
                        <Send size={24} className="icon-send" />
                        <h2>Enviar Mercadería</h2>
                    </div>

                    <div className="destination-config">
                        <label>Sucursal Destino:</label>
                        <input
                            className="neo-input"
                            placeholder="Seleccione o escriba sucursal..."
                            value={destinationBranch}
                            onChange={e => setDestinationBranch(e.target.value)}
                            list="branches-list"
                        />
                        <datalist id="branches-list">
                            {registeredBranches.map(b => (
                                <option key={b.code} value={`${b.code} - ${b.name}`} />
                            ))}
                        </datalist>
                    </div>

                    <div className="stock-selector">
                        <div className="search-box">
                            <Search size={16} />
                            <input
                                placeholder="Buscar en stock..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="stock-list-mini">
                            {filteredStock.map(item => (
                                <div key={item.id} className="stock-item-pick" onClick={() => addToTransfer(item)}>
                                    <div className="item-details">
                                        <span className="name">{item.name}</span>
                                        <span className="qty">{item.quantity} kg</span>
                                    </div>
                                    <button className="add-btn">+</button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="transfer-bucket">
                        <h3>Items a Enviar ({transferItems.length})</h3>
                        <div className="bucket-list">
                            {transferItems.map(item => (
                                <div key={item.id} className="bucket-item">
                                    <span>{item.name}</span>
                                    <div className="qty-edit">
                                        <input
                                            type="number"
                                            value={item.transferQty}
                                            onChange={e => updateQty(item.id, e.target.value)}
                                        />
                                        <span>kg</span>
                                        <button onClick={() => setTransferItems(transferItems.filter(i => i.id !== item.id))}>×</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button
                            className="action-btn-main"
                            disabled={transferItems.length === 0}
                            onClick={generateTransferFile}
                        >
                            <Database size={18} /> GENERAR ARCHIVO Y DESCONTAR
                        </button>
                    </div>
                </div>

                {/* 2. RECIBIR MERCADERIA */}
                <div className="transfer-card receive-panel neo-card">
                    <div className="panel-header">
                        <Download size={24} className="icon-receive" />
                        <h2>Recibir Mercadería</h2>
                    </div>

                    <div className="import-zone">
                        <div className="upload-box" onClick={() => document.getElementById('fileImport').click()}>
                            <FileUp size={48} />
                            <p>Subir archivo <strong>.meat</strong> recibido</p>
                            <span>Arrastrá el archivo o hacé clic acá</span>
                            <input
                                id="fileImport"
                                type="file"
                                accept=".meat"
                                onChange={handleImportFile}
                                style={{ display: 'none' }}
                            />
                        </div>
                    </div>

                    <div className="receive-features">
                        <div className="feature-item">
                            <CheckCircle2 color="#22c55e" size={20} />
                            <div>
                                <h4>Actualización Automática</h4>
                                <p>El stock se suma automáticamente al confirmar el recibo.</p>
                            </div>
                        </div>
                        <div className="feature-item">
                            <ArrowLeftRight color="#3b82f6" size={20} />
                            <div>
                                <h4>Trazabilidad</h4>
                                <p>Cada ingreso queda registrado con la sucursal de origen.</p>
                            </div>
                        </div>
                    </div>

                    {!directoryHandle && (
                        <div className="pro-hint">
                            <Database size={16} />
                            <p>Tip: Vinculá una carpeta de Google Drive para autodetectar recibos sin tener que subirlos manualmente.</p>
                        </div>
                    )}
                </div>

            </div>}
        </div>
    );
};

export default Sucursales;
