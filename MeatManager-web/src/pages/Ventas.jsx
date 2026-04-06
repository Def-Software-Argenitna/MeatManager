import React, { useState, useRef } from 'react';
import { Search, Trash2, Banknote, ShoppingBag, Tag, Users, User, X, PackageX, PackageCheck, AlertTriangle, Printer, Settings, Beef, ChevronRight, CreditCard, Calculator } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { scaleService } from '../utils/SerialScaleService';
import { formatPrice } from '../utils/priceFormat';
import { desktopApi } from '../utils/desktopApi';
import { fetchTable, getNextRemoteReceiptData, getRemoteSetting, saveTableRecord } from '../utils/apiClient';
import PaymentMethodIcon from '../components/PaymentMethodIcon';
import './Ventas.css';

const CATEGORIES = [
    { id: 'vaca', label: 'Vaca' },
    { id: 'cerdo', label: 'Cerdo' },
    { id: 'pollo', label: 'Pollo' },
    { id: 'pre-elaborados', label: 'Pre-elaborados' },
];

const getClientDisplayName = (client) => {
    const firstName = String(client?.first_name || '').trim();
    const lastName = String(client?.last_name || '').trim();
    return [firstName, lastName].filter(Boolean).join(' ') || String(client?.name || '').trim();
};

const formatDocumentNumber = (value, digits = 4) => String(Number(value) || 0).padStart(digits, '0');
const formatReceiptCode = (branchCode, value) => `${formatDocumentNumber(branchCode, 4)}-${formatDocumentNumber(value, 6)}`;
const normalizeProductKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
const formatNumericLocale = (value, locale = 'es-AR', options = undefined) => toNumber(value).toLocaleString(locale, options);

const Ventas = () => {
    const [cart, setCart] = useState([]);
    const [categoryFilter, setCategoryFilter] = useState('all');
    // Estado para el formato de precio
    const [priceFormat, setPriceFormat] = useState('4d2d');

    // Solo redondear si es manual y formato 6d
    // (Ajusta el uso de priceFormat en el resto del componente)
    // Ejemplo de uso:
    // if (priceFormat === '6d') price = Math.round(price);
    const [isProcessing, setIsProcessing] = useState(false);
    const processingRef = useRef(false); // guard sincrónico contra doble-submit
    const [showCartMobile, setShowCartMobile] = useState(false);

    // Price Management State
    const [editingPriceId, setEditingPriceId] = useState(null);
    const [newPrice, setNewPrice] = useState('');
    const [newPlu, setNewPlu] = useState('');

    const [selectedClientId, setSelectedClientId] = useState(null);
    const [clientSearch, setClientSearch] = useState('');
    const [showClientList, setShowClientList] = useState(false);

    // Payment Selection State
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);
    const [cashReceived, setCashReceived] = useState('');
    const [isSplitPayment, setIsSplitPayment] = useState(false);
    const [splitPayments, setSplitPayments] = useState([]);

    // Scale State
    // Manual Weight Modal State
    const [showWeightModal, setShowWeightModal] = useState(false);
    const [weightInput, setWeightInput] = useState("1.000");
    const [weightProduct, setWeightProduct] = useState(null);
    const [isScaleConnected, setIsScaleConnected] = useState(false);
    const [isSimulated, setIsSimulated] = useState(false);

    // Scale Diagnostic Modal
    const [showScaleDiag, setShowScaleDiag] = useState(false);
    const [scaleDiagLog, setScaleDiagLog] = useState([]);

    // Quick Product Creation from Barcode
    const [showQuickCreateModal, setShowQuickCreateModal] = useState(false);
    const [pendingBarcode, setPendingBarcode] = useState(null); // {plu, weight}
    const [quickProductName, setQuickProductName] = useState('');
    const [quickProductPrice, setQuickProductPrice] = useState('');
    const [quickProductCategory, setQuickProductCategory] = useState('vaca');

    // Barcode Scanner State
    const [scannerError, setScannerError] = useState('');
    const [barcodeInputValue, setBarcodeInputValue] = useState('');
    const barcodeInputRef = React.useRef(null);

    // ── QENDRA Sync ─────────────────────────────────────────────────────────
    const [qendraSyncing, setQendraSyncing] = useState(false);
    const [qendraSyncResult, setQendraSyncResult] = useState(null); // {created, skipped, error, diag}
    const [qendraSyncDias, setQendraSyncDias] = useState(30); // 0 = todos

    // Delete Ticket Modal
    // Delete Ticket Modal
    const [showDeleteTicketModal, setShowDeleteTicketModal] = useState(false);
    const [deleteTicketSearch, setDeleteTicketSearch] = useState('');
    const [confirmDeleteTicketId, setConfirmDeleteTicketId] = useState(null);
    const [deleteAuthorizationCode, setDeleteAuthorizationCode] = useState('');
    const [deleteModalRefreshTick, setDeleteModalRefreshTick] = useState(0);

    // ROBUST SCANNER LOGIC: Force focus to scanner if no other modal/input is active
    React.useEffect(() => {
        const handleKeys = () => {
            if (showClientList || showPaymentModal || showDeleteTicketModal || showScaleDiag || showQuickCreateModal) return;
            if (document.activeElement.tagName === 'INPUT' && document.activeElement !== barcodeInputRef.current) return;
            if (document.activeElement.tagName === 'TEXTAREA') return;
            
            // Re-focus scanner if focus was lost
            if (document.activeElement !== barcodeInputRef.current) {
                barcodeInputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleKeys);
        return () => window.removeEventListener('keydown', handleKeys);
    }, [showClientList, showPaymentModal, showDeleteTicketModal, showScaleDiag, showQuickCreateModal]);

    // Ticket Preview Modal (multi-item barcode)
    const [showTicketPreview, setShowTicketPreview] = useState(false);
    const [ticketPreviewItems, setTicketPreviewItems] = useState([]);

    // Print Confirm Modal (reemplaza al confirm() nativo que roba el foco en Electron)
    const [showPrintConfirmModal, setShowPrintConfirmModal] = useState(false);
    const [pendingPrintData, setPendingPrintData] = useState(null);
    const [stockItems, setStockItems] = useState([]);
    const [prices, setPrices] = useState([]);
    const [clients, setClients] = useState([]);
    const [dbPaymentMethods, setDbPaymentMethods] = useState([]);
    const [shopInfo, setShopInfo] = useState({ name: 'Nuestra Carnicería', address: '', phone: '' });
    const [todayOpeningMovements, setTodayOpeningMovements] = useState([]);
    const [recentSales, setRecentSales] = useState([]);
    const [recentSalesItems, setRecentSalesItems] = useState({});

    // Toast (reemplaza todos los alert() nativos que roban el foco en Electron)
    const [toastMsg, setToastMsg] = useState(null); // { text, type: 'error'|'success'|'warning' }
    const toastTimerRef = React.useRef(null);
    const showToast = React.useCallback((text, type = 'error') => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToastMsg({ text, type });
        toastTimerRef.current = setTimeout(() => setToastMsg(null), 4000);
    }, []);

    const navigate = useNavigate();
    const { currentUser } = useUser();

    const refreshVentasData = React.useCallback(async () => {
        const [
            stockRows,
            priceRows,
            clientRows,
            paymentRows,
            salesRows,
            salesItemsRows,
            movementsRows,
        ] = await Promise.all([
            fetchTable('stock'),
            fetchTable('prices'),
            fetchTable('clients'),
            fetchTable('payment_methods'),
            fetchTable('ventas', { orderBy: 'date', direction: 'desc', limit: 150 }),
            fetchTable('ventas_items'),
            fetchTable('caja_movimientos'),
        ]);

        setStockItems(Array.isArray(stockRows) ? stockRows : []);
        setPrices(Array.isArray(priceRows) ? priceRows : []);
        setClients(Array.isArray(clientRows) ? clientRows : []);
        setDbPaymentMethods(
            (Array.isArray(paymentRows) ? paymentRows : []).filter((m) => {
                const allowedNames = ['Posnet', 'Mercado Pago', 'Cuenta DNI', 'Efectivo', 'Transferencia'];
                return m.enabled && allowedNames.includes(m.name);
            })
        );

        const recentRows = Array.isArray(salesRows) ? salesRows : [];
        setRecentSales(recentRows);

        const recentIds = new Set(recentRows.map((sale) => Number(sale.id)));
        const groupedItems = {};
        for (const item of Array.isArray(salesItemsRows) ? salesItemsRows : []) {
            const ventaId = Number(item.venta_id);
            if (!recentIds.has(ventaId)) continue;
            if (!groupedItems[ventaId]) groupedItems[ventaId] = [];
            groupedItems[ventaId].push(item);
        }
        setRecentSalesItems(groupedItems);

        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        setTodayOpeningMovements(
            (Array.isArray(movementsRows) ? movementsRows : []).filter((movement) => {
                const movementDate = movement?.date ? new Date(movement.date) : null;
                return (
                    movementDate &&
                    !Number.isNaN(movementDate.getTime()) &&
                    movementDate >= start &&
                    movementDate <= end &&
                    movement.type === 'apertura'
                );
            })
        );
    }, []);

    React.useEffect(() => {
        const loadVentasBootstrap = async () => {
            const [formato, name, address, phone] = await Promise.all([
                getRemoteSetting('precio_formato'),
                getRemoteSetting('shop_name'),
                getRemoteSetting('shop_address'),
                getRemoteSetting('whatsapp_number'),
            ]);

            setPriceFormat(formato || '4d2d');
            setShopInfo({
                name: name || 'Nuestra Carnicería',
                address: address || '',
                phone: phone || '',
            });

            await refreshVentasData();
        };

        loadVentasBootstrap().catch((error) => {
            console.error('Error cargando ventas:', error);
            showToast('❌ No se pudieron cargar los datos de ventas.', 'error');
        });
    }, [refreshVentasData, showToast]);

    const handleQendraSyncVentas = async () => {
        setQendraSyncing(true);
        setQendraSyncResult(null);
        try {
            const res = await desktopApi.qendraSyncVentas(qendraSyncDias);
            if (!res.ok) {
                setQendraSyncResult({ error: res.error });
                return;
            }

            // Mostrar diagnóstico si no hay tickets en el rango
            if (res.tickets.length === 0) {
                const d = res.diag || {};
                const totalRows = d.totalRows || 0;
                let msg = totalRows === 0
                    ? 'La tabla VENTAS de QENDRA está vacía (sin ventas registradas).'
                    : `VENTAS tiene ${totalRows} registros, pero ninguno en los últimos ${qendraSyncDias === 0 ? 'todos' : qendraSyncDias + ' días'}. ` +
                      `Última venta en QENDRA: ${d.fechaMax ? new Date(d.fechaMax).toLocaleDateString('es-AR') : 'desconocida'}.`;
                setQendraSyncResult({ created: 0, skipped: 0, total: 0, diagMsg: msg });
                return;
            }

            // Agrupar items por ticket
            const itemsByTicket = {};
            for (const item of res.items) {
                const tid = item.ID_TICKET;
                if (!itemsByTicket[tid]) itemsByTicket[tid] = [];
                itemsByTicket[tid].push(item);
            }
            let created = 0, skipped = 0;
            for (const ticket of res.tickets) {
                const ticketId = String(ticket.ID_TICKET);
                // Verificar si ya fue importado
                const existing = recentSales.find((venta) => String(venta.qendra_ticket_id || '') === ticketId);
                if (existing) { skipped++; continue; }
                const fechaStr = ticket.FECHA ? new Date(ticket.FECHA).toISOString() : new Date().toISOString();
                const total = parseFloat(ticket.TOTAL) || 0;
                const { insertId: ventaId } = await saveTableRecord('ventas', 'insert', {
                    date: fechaStr,
                    total,
                    payment_method: 'Balanza QENDRA',
                    payment_method_id: null,
                    clientId: null,
                    synced: 0,
                    qendra_ticket_id: ticketId,
                    source: 'qendra',
                    vendedor: '',
                });
                // Agregar items del ticket
                const ticketItems = itemsByTicket[ticket.ID_TICKET] || [];
                for (const it of ticketItems) {
                    const pesoKg = parseFloat(it.PESO_KG) || 0;
                    const importe = parseFloat(it.IMPORTE) || 0;
                    const producto = `PLU ${it.ID_PLU}`;
                    await saveTableRecord('ventas_items', 'insert', {
                        venta_id: ventaId,
                        product_name: producto,
                        quantity: pesoKg,
                        price: pesoKg > 0 ? importe / pesoKg : importe,
                        subtotal: importe,
                        synced: 0,
                    });
                }
                created++;
            }
            await refreshVentasData();
            setQendraSyncResult({ created, skipped, total: res.tickets.length });
        } catch (e) {
            setQendraSyncResult({ error: String(e) });
        } finally {
            setQendraSyncing(false);
        }
    };
    // ────────────────────────────────────────────────────────────────────────

    // ── QENDRA Visor de Tickets ───────────────────────────────────────────────
    const [showQendraVisor, setShowQendraVisor] = useState(false);
    const [qendraVisorTab, setQendraVisorTab] = useState('pendientes');
    const [qendraVisorTickets, setQendraVisorTickets] = useState([]);
    const [qendraVisorLoading, setQendraVisorLoading] = useState(false);
    const [qendraVisorCobrados, setQendraVisorCobrados] = useState([]);
    const [qendraActiveTicketId, setQendraActiveTicketId] = useState(null);

    const handleOpenQendraVisor = async () => {
        setShowQendraVisor(true);
        setQendraVisorLoading(true);
        setQendraVisorTickets([]);
        setQendraVisorCobrados([]);
        setQendraVisorTab('pendientes');
        try {
            const res = await desktopApi.qendraGetTodayTickets(8);
            if (res.ok) {
                const itemsByTicket = {};
                for (const it of res.items) {
                    const tid = it.ID_TICKET;
                    if (!itemsByTicket[tid]) itemsByTicket[tid] = [];
                    itemsByTicket[tid].push(it);
                }
                const ticketsConItems = res.tickets.map(t => ({
                    ...t,
                    items: itemsByTicket[t.ID_TICKET] || [],
                }));
                setQendraVisorTickets(ticketsConItems);
            }
            // Cobrados de hoy en MeatManager
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            const ventasRows = await fetchTable('ventas', { orderBy: 'date', direction: 'desc', limit: 300 });
            const cobrados = (Array.isArray(ventasRows) ? ventasRows : []).filter((v) => {
                const saleDate = v?.date ? new Date(v.date) : null;
                return saleDate && saleDate >= hoy && v.source === 'qendra';
            });
            setQendraVisorCobrados(cobrados);
        } catch (e) {
            console.error('Error al cargar visor QENDRA:', e);
        } finally {
            setQendraVisorLoading(false);
        }
    };

    const handleLoadQendraTicket = (ticket) => {
        if (!ticket.items || ticket.items.length === 0) {
            showToast('Este ticket no tiene items con peso registrado.', 'warning');
            return;
        }
        const newCart = ticket.items
            .filter(it => parseFloat(it.PESO_KG) > 0 || parseFloat(it.IMPORTE) > 0)
            .map((it, idx) => {
                const pesoKg = parseFloat(it.PESO_KG) || 0;
                const importe = parseFloat(it.IMPORTE) || 0;
                const precioPorKg = pesoKg > 0 ? importe / pesoKg : importe;
                return {
                    id: `qendra_${it.ID_PLU}_${idx}`,
                    name: `PLU ${it.ID_PLU}`,
                    price: precioPorKg,
                    quantity: pesoKg > 0 ? pesoKg : 1,
                    weight: pesoKg > 0 ? pesoKg : 1,
                    unit: pesoKg > 0 ? 'kg' : 'unidad',
                    category: 'otros',
                    fromQendra: true,
                    plu: it.ID_PLU,
                };
            });
        setCart(newCart);
        setQendraActiveTicketId(String(ticket.ID_TICKET));
        setShowQendraVisor(false);
        if (window.innerWidth < 1024) setShowCartMobile(true);
    };
    // ────────────────────────────────────────────────────────────────────────

    // Auto-focus precio: triple intento para Electron (inmediato, 0ms, 150ms)
    const priceInputRef = React.useRef(null);
    const isEditingPriceRef = React.useRef(false);
    React.useLayoutEffect(() => {
        isEditingPriceRef.current = !!editingPriceId;
        if (!editingPriceId) return;
        const focusInput = () => {
            const el = priceInputRef.current || document.getElementById('modal-price-input');
            if (el) { el.focus(); el.select(); }
        };
        focusInput();
        const t1 = setTimeout(focusInput, 0);
        const t2 = setTimeout(focusInput, 150);
        return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [editingPriceId]);

    // ── FOCO PERMANENTE - POS WATCHDOG ────────────────────────────────────────
    React.useEffect(() => {
        // Enfoque inicial rápido
        setTimeout(() => {
            if (!isEditingPriceRef.current && !showPaymentModal && !showQuickCreateModal && !showDeleteTicketModal && !showQendraVisor && !showPrintConfirmModal) {
                barcodeInputRef.current?.focus();
            }
        }, 100);

        const watchdog = setInterval(() => {
            // Si hay un modal abierto, pausamos el watchdog
            if (
                isEditingPriceRef.current || 
                showPaymentModal || 
                showQuickCreateModal || 
                showDeleteTicketModal || 
                showQendraVisor || 
                showTicketPreview || 
                showScaleDiag ||
                showPrintConfirmModal
            ) {
                return;
            }

            const active = document.activeElement;
            const isInput = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA';

            // Si el foco se perdió y está en el "body" u otro elemento no interactivo
            // forzamos el foco de nuevo al scanner.
            // Si ya está en algún INPUT (buscador, manual, etc), respetamos y no tocamos nada.
            if (!isInput) {
                barcodeInputRef.current?.focus();
            }
        }, 500); // Revisa cada medio segundo

        return () => clearInterval(watchdog);
    }, [
        showPaymentModal, 
        showQuickCreateModal, 
        showDeleteTicketModal, 
        showQendraVisor, 
        showTicketPreview, 
        showScaleDiag, 
        editingPriceId,
        showPrintConfirmModal
    ]);
    // ────────────────────────────────────────────────────────────────────────

    const hasCashOpeningToday = (todayOpeningMovements?.length || 0) > 0;

    React.useEffect(() => {
        if (showDeleteTicketModal) {
            setDeleteModalRefreshTick((prev) => prev + 1);
        }
    }, [showDeleteTicketModal]);

    React.useEffect(() => {
        if (!showDeleteTicketModal) return;
        refreshVentasData().catch((error) => console.error('Error refrescando modal de ventas:', error));
    }, [showDeleteTicketModal, deleteModalRefreshTick, refreshVentasData]);

    // SOUND HELPERS
    const playBeep = () => {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.1);
        } catch (e) { console.error(e); }
    };

    const playCashRegister = () => {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(audioCtx.destination);
            osc1.frequency.setValueAtTime(600, audioCtx.currentTime);
            osc2.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            osc1.start();
            osc1.stop(audioCtx.currentTime + 0.1);
            osc2.start(audioCtx.currentTime + 0.1);
            osc2.stop(audioCtx.currentTime + 0.3);
        } catch (e) { console.error(e); }
    };

    // PRINT HELPER
    const printTicket = (saleData, items) => {
        const printWindow = window.open('', '_blank', 'width=400,height=600');
        if (!printWindow) {
            showToast('⚠️ Bloqueador de ventanas detectado. Habilite las ventanas emergentes para imprimir tickets.', 'warning');
            return;
        }
        const ticketHtml = `
            <html>
            <head>
                <title>Ticket de Venta</title>
                <style>
                    body { font-family: 'Courier New', Courier, monospace; width: 80mm; padding: 5mm; color: #000; }
                    .center { text-align: center; }
                    .header { border-bottom: 1px dashed #000; padding-bottom: 3mm; margin-bottom: 3mm; }
                    .shop-name { font-size: 16px; font-weight: bold; }
                    .item { display: flex; justify-content: space-between; margin-bottom: 1mm; font-size: 12px; }
                    .total-area { border-top: 1px double #000; padding-top: 2mm; margin-top: 3mm; font-weight: bold; }
                    .footer { margin-top: 5mm; font-size: 10px; border-top: 1px dashed #000; padding-top: 2mm; }
                    @media print { body { width: 80mm; padding: 0; } }
                </style>
            </head>
            <body>
                <div class="center header">
                    <div class="shop-name">${shopInfo?.name}</div>
                    <div>${shopInfo?.address || ''}</div>
                    <div>${shopInfo?.phone ? 'Tel: ' + shopInfo.phone : ''}</div>
                    <br>
                    <div>Fecha: ${new Date().toLocaleString()}</div>
                    <div>Comprobante: Venta ${saleData.receipt_code || `0001-${String(saleData.receipt_number || saleData.id).padStart(6, '0')}`}</div>
                    <div>Comprobante No Fiscal</div>
                </div>
                <div>
                    ${items.map(i => `
                        <div class="item">
                            <span>${i.name.slice(0, 20)}</span>
                        </div>
                        <div class="item">
                            <span style="padding-left: 2mm;">${toNumber(i.quantity).toFixed(3)} ${i.unit || 'kg'} x $${toNumber(i.price).toLocaleString()}</span>
                            <span>$${(toNumber(i.price) * toNumber(i.quantity)).toLocaleString()}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="total-area">
                    <div class="item"><span>SUBTOTAL</span><span>$${formatNumericLocale(saleData.subtotal)}</span></div>
                    ${toNumber(saleData.adjustment) !== 0 ? `<div class="item"><span>ADJ.</span><span>$${formatNumericLocale(saleData.adjustment)}</span></div>` : ''}
                    <div class="item" style="font-size: 14px; margin-top: 1mm;"><span>TOTAL</span><span>$${formatNumericLocale(saleData.total)}</span></div>
                </div>
                <div class="center footer">
                    ¡Gracias por su compra!<br>
                    Software: MeatManager PRO
                </div>
                <script>
                    window.onload = () => { 
                        window.print(); 
                        setTimeout(() => window.close(), 100); 
                    };
                </script>
            </body>
            </html>
        `;
        printWindow.document.write(ticketHtml);
        printWindow.document.close();
    };

    const products = React.useMemo(() => {
        if (!stockItems) return [];

        const grouped = {};

        stockItems.forEach(item => {
            const key = item.name + '-' + item.type; // Group by name & type

            if (!grouped[key]) {
                const priceRecord = prices?.find(p => p.product_id === key) || {};

                grouped[key] = {
                    id: key,
                    name: item.name,
                    category: item.type,
                    totalQuantity: 0,
                    unit: item.unit || 'kg',
                    price: toNumber(priceRecord.price),
                    plu: priceRecord.plu || ''
                };
            }
            grouped[key].totalQuantity += toNumber(item.quantity);
        });

        return Object.values(grouped);
    }, [stockItems, prices]);

    const findPriceRecordByPlu = React.useCallback((pluValue) => {
        const normalized = String(pluValue || '').trim();
        if (!normalized) return null;
        const normalizedNumber = String(parseInt(normalized, 10));
        return prices.find((price) => {
            const pricePlu = String(price?.plu || '').trim();
            return pricePlu === normalized || pricePlu === normalizedNumber;
        }) || null;
    }, [prices]);

    const findStockItemByName = React.useCallback((name) => {
        const normalized = String(name || '').trim().toUpperCase();
        return stockItems.find((item) => String(item?.name || '').trim().toUpperCase() === normalized) || null;
    }, [stockItems]);

    const findProductByPriceRecord = React.useCallback((priceRecord) => {
        if (!priceRecord) return null;
        const productId = String(priceRecord.product_id || '').trim();
        return products.find((product) => {
            const productKey = `${product.name}-${product.category}`;
            return (
                product.id === productId ||
                productKey === productId ||
                normalizeProductKey(productKey) === normalizeProductKey(productId)
            );
        }) || null;
    }, [products]);

    // Filter products
    const filteredProducts = products.filter(p => {
        const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
        const term = barcodeInputValue.trim().toLowerCase();
        const matchesSearch =
            term.length === 0 ||
            p.name.toLowerCase().includes(term) ||
            String(p.plu || '').toLowerCase().includes(term) ||
            String(p.id || '').toLowerCase().includes(term);
        return matchesCategory && matchesSearch;
    });

    const updatePrice = async (productId, priceVal, pluVal) => {
        const price = parseFloat(priceVal);
        if (isNaN(price) || price <= 0) {
            showToast('⚠️ Por favor, ingrese un precio válido.', 'warning');
            return;
        }
        const plu = pluVal;
        const existing = prices.find((item) => String(item.product_id || '') === String(productId));

        if (existing) {
            await saveTableRecord('prices', 'update', { price, plu, updated_at: new Date().toISOString() }, existing.id);
        } else {
            await saveTableRecord('prices', 'insert', { product_id: productId, price, plu, updated_at: new Date().toISOString() });
        }
        await refreshVentasData();
        setEditingPriceId(null);
        setNewPrice('');
        setNewPlu('');
    };

    const handleScanTicket = async (barcodeData) => {
        if (!barcodeData || barcodeData.trim().length === 0) {
            setScannerError('El código de barras está vacío');
            setTimeout(() => { if (!isEditingPriceRef.current) barcodeInputRef.current?.focus(); }, 50);
            return;
        }

        const cleanData = barcodeData.trim();
        console.log("📦 Escaneando código RAW:", cleanData, `(${cleanData.length} chars)`);

        // INTENTAR MÚLTIPLES PARSEOS
        let successCount = 0;
        let failedItems = [];

        // ============ FORMATO 1: EAN-13 INDIVIDUAL (Balanzas Systel / 3nstar / estándar) ============
        // Estructura: 2X + PLU(5) + PESO(5) + CHECK(1) = 13 dígitos
        // El primer dígito es 2, el segundo varía: 0=precio incrustado, 1=peso incrustado
        // Balanza Systel típica: 20PPPPPKKKKKC (precio) o 21PPPPPKKKKKC (peso por kg)
        // También algunos equipos usan solo 2PPPPPKKKKKC (12 + check)
        // NOTA: algunos escáneres emiten caracteres no numéricos (ej. 'D') → se limpian con /\D/g
        const eanDigits = cleanData.replace(/\D/g, ''); // quitar cualquier carácter no numérico
        if ((eanDigits.length === 13 || eanDigits.length === 12 || eanDigits.length === 11) && eanDigits.startsWith('2')) {
            playBeep();
            // Formato Systel: 2 + PLU(5) + SEP(1) + PESO(5) + CHECK(1) = 13 dígitos
            // PLU siempre en [1:6]. Para 13 dígitos hay un byte separador en [6], PESO en [7:12].
            // Para 12/11 dígitos: PESO en [6:11].
            const pluRaw    = eanDigits.substring(1, 6);
            const weightRaw = eanDigits.length === 13 ? eanDigits.substring(7, 12) : eanDigits.substring(6, 11);
            const pluNumber = parseInt(pluRaw, 10).toString();
            const weight = parseFloat(weightRaw) / 1000;

            // Si el PLU es >= 10000 es el código RESUMEN DEL TICKET (total del comprobante),
            // no un código de producto individual. Informar al usuario.
            if (parseInt(pluRaw, 10) >= 10000) {
                setScannerError(
                    `⚠️ Ese código es el resumen total del ticket, no un producto individual.\n\n` +
                    `Escaneá los códigos de cada artículo por separado — son los que aparecen al lado de cada ítem en el comprobante (los más chicos, encima del nombre del producto).`
                );
                setTimeout(() => { if (!isEditingPriceRef.current) barcodeInputRef.current?.focus(); }, 50);
                return;
            }

            console.log(`✅ EAN-13 individual: PLU ${pluNumber}, Peso ${weight}kg`);

            let priceRecord = findPriceRecordByPlu(pluNumber) || findPriceRecordByPlu(pluRaw);

            if (priceRecord) {
                let product = findProductByPriceRecord(priceRecord);
                // Fallback: buscar por plu en caso de que el id no matchee
                if (!product) product = products?.find(p => p.plu === pluNumber || p.plu === pluRaw);
                if (product) {
                    addToCart({ ...product, price: priceRecord.price }, weight);
                    setScannerError('');
                } else {
                    // product_id viejo formato: "bife_angosto" → buscar "BIFE ANGOSTO" en stock
                    const normalizedName = (priceRecord.product_id || '')
                        .replace(/_/g, ' ').toUpperCase();
                    const stockItem = normalizedName ? findStockItemByName(normalizedName) : null;
                    if (stockItem) {
                        const fallbackProduct = {
                            id: `${stockItem.name}-${stockItem.type}`,
                            name: stockItem.name,
                            category: stockItem.type,
                            unit: stockItem.unit || 'kg',
                            price: priceRecord.price,
                            plu: pluNumber,
                        };
                        addToCart(fallbackProduct, weight);
                        setScannerError('');
                    } else {
                        setScannerError(`⚠️ PLU ${pluNumber} configurado pero el producto no fue encontrado. Revisá la configuración de precios.`);
                        setTimeout(() => { if (!isEditingPriceRef.current) barcodeInputRef.current?.focus(); }, 50);
                    }
                }
                return;
            } else {
                setPendingBarcode({ plu: pluNumber, pluRaw: pluRaw, weight: weight });
                setQuickProductName('');
                setQuickProductPrice('');
                setQuickProductCategory('vaca');
                setShowQuickCreateModal(true);
                setScannerError('');
                return;
            }
        }

        // ============ FORMATO 2: MÚLTIPLES EAN-13 CONCATENADOS ============
        // 2001110199502000120108502001202011X (3 productos pegados)
        // → Muestra modal de preview con estado de stock de cada item
        if (cleanData.length >= 26 && cleanData.startsWith('2')) {
            const codes = [];
            for (let i = 0; i + 13 <= cleanData.length; i += 13) {
                codes.push(cleanData.substring(i, i + 13));
            }

            if (codes.length >= 2) {
                console.log(`🔄 Detectados ${codes.length} productos concatenados`);
                playBeep();

                const previewItems = [];
                for (const code of codes) {
                    if (code.length === 13 && code.startsWith('2')) {
                        // PLU en [1:6], separador en [6], PESO en [7:12]
                        const pluRaw    = code.substring(1, 6);
                        const weightRaw = code.substring(7, 12);
                        const pluNumber = parseInt(pluRaw, 10).toString();
                        const weight = parseFloat(weightRaw) / 1000;

                        let priceRecord = findPriceRecordByPlu(pluNumber) || findPriceRecordByPlu(pluRaw);
                        const product = priceRecord ? findProductByPriceRecord(priceRecord) : null;

                        previewItems.push({ plu: pluNumber, pluRaw, weight, priceRecord, product });
                    }
                }

                if (previewItems.length >= 2) {
                    setTicketPreviewItems(previewItems);
                    setShowTicketPreview(true);
                    return;
                }
            }
        }

        // ============ FORMATO 3: SEPARADO POR ; O , ============
        // 111,1.500;12,1.085;120,2.110
        // Si tiene múltiples items (con ;) → modal de preview
        // Si es un solo PLU,kg → agregar directo (entrada manual)
        if (cleanData.includes(';') || cleanData.includes(',')) {
            const semiItems = cleanData.split(';');
            playBeep();

            if (semiItems.length > 1) {
                // Ticket multi-item → mostrar preview
                const previewItems = [];
                for (const itemStr of semiItems) {
                    const [plu, qtyStr] = itemStr.split(',');
                    if (!plu || !qtyStr) continue;
                    const qty = parseFloat(qtyStr);
                    if (isNaN(qty)) continue;

                    const priceRecord = findPriceRecordByPlu(plu.trim());
                    const product = priceRecord ? findProductByPriceRecord(priceRecord) : null;
                    previewItems.push({ plu: plu.trim(), weight: qty, priceRecord, product });
                }

                if (previewItems.length > 0) {
                    setTicketPreviewItems(previewItems);
                    setShowTicketPreview(true);
                    return;
                }
            } else {
                // Item único PLU,kg → agregar directo
                const items = semiItems;
                for (const itemStr of items) {
                    const [plu, qtyStr] = itemStr.split(',');
                    if (!plu || !qtyStr) continue;
                    const qty = parseFloat(qtyStr);
                    if (isNaN(qty)) continue;

                    const priceRecord = findPriceRecordByPlu(plu.trim());
                    if (priceRecord) {
                        const product = findProductByPriceRecord(priceRecord);
                        if (product) {
                            addToCart({ ...product, price: priceRecord.price }, qty);
                            successCount++;
                        } else {
                            failedItems.push(plu.trim());
                        }
                    } else {
                        failedItems.push(plu.trim());
                    }
                }

                if (successCount > 0) {
                    setScannerError(`✅ ${successCount} producto(s) agregado(s). ${failedItems.length > 0 ? `No encontrados: ${failedItems.join(', ')}` : ''}`);
                    setTimeout(() => setScannerError(''), 3000);
                    return;
                }
            }
        }

        // ============ FORMATO 4: SEPARADO POR ESPACIO O CARÁCTER ESPECIAL ============
        // Intenta encontrar patrones EAN-13 en el texto
        const ean13Pattern = /2\d{11}\w/g;
        const matches = cleanData.match(ean13Pattern);
        
        if (matches && matches.length >= 1) {
            playBeep();
            console.log(`🔍 Encontrados ${matches.length} código(s) EAN-13`);

            for (const code of matches) {
                const codeDigits = code.replace(/\D/g, '');
                // PLU en [1:6], para 13 dígitos PESO en [7:12], para 12/11 en [6:11]
                const pluRaw    = codeDigits.substring(1, 6);
                const weightRaw = codeDigits.length === 13 ? codeDigits.substring(7, 12) : codeDigits.substring(6, 11);
                const pluNumber = parseInt(pluRaw, 10).toString();
                const weight = parseFloat(weightRaw) / 1000;

                let priceRecord = findPriceRecordByPlu(pluNumber) || findPriceRecordByPlu(pluRaw);

                if (priceRecord) {
                    const product = findProductByPriceRecord(priceRecord);
                    if (product) {
                        addToCart({ ...product, price: priceRecord.price }, weight);
                        successCount++;
                    } else {
                        failedItems.push(pluNumber);
                    }
                } else {
                    failedItems.push(pluNumber);
                }
            }

            if (successCount > 0) {
                setScannerError(`✅ ${successCount} producto(s) agregado(s). ${failedItems.length > 0 ? `No encontrados: ${failedItems.join(', ')}` : ''}`);
                setTimeout(() => setScannerError(''), 3000);
                return;
            }
        }

        // ============ SIN COINCIDENCIAS ============
        setScannerError(`❌ CÓDIGO NO RECONOCIDO: "${cleanData}" (${cleanData.length} chars)\n\nFormatos soportados:\n1. EAN-13 balanza: 2PPPPPKKKKKC (13 dígitos, empieza en 2)\n2. Múltiples concatenados: 200111019950200012010850...\n3. Separados: 111,1.5;120,2.1\n\nVerificá en consola (F12) el código RAW recibido.`);
        console.log("❌ Formato no reconocido:", JSON.stringify(cleanData), `len=${cleanData.length}`);
        setTimeout(() => { if (!isEditingPriceRef.current) barcodeInputRef.current?.focus(); }, 50);
    };

    const handleQuickCreateProduct = async () => {
        if (!quickProductName || !quickProductPrice || !pendingBarcode) {
            showToast('⚠️ Por favor, completá el nombre y el precio.', 'warning');
            return;
        }

        const price = parseFloat(quickProductPrice);
        if (isNaN(price) || price <= 0) {
            showToast('⚠️ El precio debe ser un número válido.', 'warning');
            return;
        }

        try {
            // 1. Crear producto en Stock (con cantidad inicial 0)
            const productId = `${quickProductName}-${quickProductCategory}`;
            await saveTableRecord('stock', 'insert', {
                name: quickProductName,
                type: quickProductCategory,
                quantity: 0, // Inicialmente sin stock
                unit: 'kg',
                updated_at: new Date().toISOString(),
            });

            // 2. Crear precio con PLU
            await saveTableRecord('prices', 'insert', {
                product_id: productId,
                price: price,
                plu: pendingBarcode.plu,
                updated_at: new Date().toISOString(),
            });

            await refreshVentasData();

            // 3. Agregar al carrito con el peso escaneado
            const newProduct = {
                id: productId,
                name: quickProductName,
                category: quickProductCategory,
                totalQuantity: 0,
                unit: 'kg',
                price: price,
                plu: pendingBarcode.plu
            };

            addToCart(newProduct, pendingBarcode.weight);

            // Limpiar y cerrar
            setShowQuickCreateModal(false);
            setPendingBarcode(null);
            setQuickProductName('');
            setQuickProductPrice('');
            setTimeout(() => { if (!isEditingPriceRef.current) barcodeInputRef.current?.focus(); }, 50);

            showToast(`✅ Producto "${quickProductName}" creado y agregado al carrito con ${pendingBarcode.weight}kg`, 'success');
        } catch (error) {
            console.error("Error creando producto:", error);
            showToast('❌ Error al crear el producto: ' + error.message, 'error');
        }
    };


    // --- CART ACTIONS ---

    const handleManualWeightConfirm = () => {
        if (!weightProduct) return;
        const w = parseFloat(weightInput.replace(",", "."));
        if (isNaN(w) || w <= 0) {
            showToast("⚠️ Peso inválido.", "error");
            return;
        }
        addToCart(weightProduct, w);
        setShowWeightModal(false);
        setWeightProduct(null);
    };
    const addToCart = async (product, externalWeight = null) => {
        if (product.price <= 0) {
            showToast('⚠️ Este producto no tiene precio configurado. Configure el precio primero.', 'warning');
            setEditingPriceId(product.id);
            setNewPrice('');
            setNewPlu(product.plu || '');
            return;
        }

        // weight management: prompt or automatic
        let weight = externalWeight;
        if (!weight) {
            if (isSimulated) {
                weight = parseFloat((Math.random() * 2 + 0.3).toFixed(3));
            } else if (isScaleConnected) {
                weight = await scaleService.readWeight();
            } else if (product.unit === 'kg') {
                setWeightProduct(product);
                setWeightInput("1.000");
                setShowWeightModal(true);
                return;
            } else {
                weight = 1;
            }
        }

        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) {
                return prev.map(item =>
                    item.id === product.id
                        ? { ...item, quantity: item.unit === 'kg' ? item.quantity + weight : item.quantity + 1 }
                        : item
                );
            }
            return [...prev, { ...product, quantity: weight }];
        });

        // Auto-open cart on mobile when adding first item or if explicitly wanted
        if (window.innerWidth < 1024 && cart.length === 0) {
            setShowCartMobile(true);
        }
    };

    const removeFromCart = (id) => {
        setCart(prev => prev.filter(item => item.id !== id));
    };

    const updateQuantity = (id, delta) => {
        setCart(prev => prev.map(item => {
            if (item.id === id) {
                const decimals = item.unit === 'kg' ? 3 : 0;
                const minQty = item.unit === 'kg' ? 0.001 : 1;
                const newQty = Math.max(minQty, parseFloat((item.quantity + delta).toFixed(decimals)));
                return { ...item, quantity: newQty };
            }
            return item;
        }));
    };

    const manualQuantity = (id, val) => {
        const qty = parseFloat(val);
        setCart(prev => prev.map(item => item.id === id ? { ...item, quantity: qty || 0 } : item));
    }

    const addDiagLog = (type, msg) =>
        setScaleDiagLog(prev => [...prev, { type, msg, time: new Date().toLocaleTimeString() }]);

    const handleConnectScale = async () => {
        // Abrir modal y limpiar log anterior
        setScaleDiagLog([]);
        setShowScaleDiag(true);
        addDiagLog('info', 'Iniciando detección de balanza...');

        // Escuchar mensajes detallados del proceso principal (solo en Electron)
        if (window.electronAPI?.onScaleDiagnostic) {
            window.electronAPI.offScaleDiagnostic();
            window.electronAPI.onScaleDiagnostic(({ type, msg }) => {
                setScaleDiagLog(prev => [...prev, { type, msg, time: new Date().toLocaleTimeString() }]);
            });
        }

        const success = await scaleService.requestPort();

        if (!success) {
            // Si no hay mensajes del main (ej: web), mostrar mensaje genérico
            addDiagLog('error', 'No se seleccionó ningún puerto. El diálogo fue cancelado o no hay dispositivos disponibles.');
            window.electronAPI?.offScaleDiagnostic();
            return;
        }

        addDiagLog('info', 'Puerto obtenido. Intentando abrir conexión serie...');
        const connected = await scaleService.connect();
        setIsScaleConnected(connected);

        if (connected) {
            setIsSimulated(false);
            addDiagLog('success', '¡Balanza conectada correctamente! Ya podés pesar.');
        } else {
            addDiagLog('error', 'No se pudo abrir el puerto serie. Probá desconectar y volver a conectar el cable USB.');
        }

        window.electronAPI?.offScaleDiagnostic();
    };

    const toggleTestMode = () => {
        setIsSimulated(prev => {
            const next = !prev;
            if (next) {
                setIsScaleConnected(false);
            }
            return next;
        });
    };

    const readScaleForItem = async (itemId) => {
        let weight = null;
        if (isSimulated) {
            weight = parseFloat((Math.random() * 2 + 0.5).toFixed(3));
        } else if (isScaleConnected) {
            weight = await scaleService.readWeight();
        }

        if (weight !== null) {
            setCart(prev => prev.map(item => item.id === itemId ? { ...item, quantity: weight } : item));
        }
    };

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const selectedClient = clients?.find(c => Number(c.id) === Number(selectedClientId));
    const selectedClientHasCurrentAccount = selectedClient?.has_current_account !== false;
    const currentAccountMethod = React.useMemo(() => (
        selectedClientId && selectedClientHasCurrentAccount
            ? { id: 'current_account', name: 'Cuenta Corriente', type: 'cuenta_corriente', percentage: 0 }
            : null
    ), [selectedClientId, selectedClientHasCurrentAccount]);
    const currentAccountAvailable = Boolean(selectedClientId) && selectedClientHasCurrentAccount;
    const availableSplitMethods = React.useMemo(() => (
        currentAccountMethod ? [...(dbPaymentMethods || []), currentAccountMethod] : (dbPaymentMethods || [])
    ), [currentAccountMethod, dbPaymentMethods]);

    const getMethodById = React.useCallback((id) => {
        if (id === 'current_account') return currentAccountMethod;
        return dbPaymentMethods?.find(m => m.id === id) || null;
    }, [currentAccountMethod, dbPaymentMethods]);

    const activeMethod = getMethodById(selectedPaymentMethod);
    const cartAdjustment = activeMethod ? (cartTotal * (activeMethod.percentage || 0)) / 100 : 0;
    const finalTotal = cartTotal + cartAdjustment;

    const splitPaymentSummary = React.useMemo(() => {
        const rows = splitPayments.map((row, index) => {
            const method = getMethodById(row.methodId);
            const chargedAmount = parseFloat(row.amount) || 0;
            const percentage = method?.percentage || 0;
            const divisor = 1 + (percentage / 100);
            const baseAmount = divisor > 0 ? chargedAmount / divisor : 0;
            const adjustment = chargedAmount - baseAmount;
            return {
                index,
                method,
                chargedAmount,
                baseAmount,
                adjustment,
            };
        });

        const coveredSubtotal = rows.reduce((sum, row) => sum + row.baseAmount, 0);
        const chargedTotal = rows.reduce((sum, row) => sum + row.chargedAmount, 0);
        const totalAdjustment = rows.reduce((sum, row) => sum + row.adjustment, 0);
        const pendingSubtotal = Math.max(0, cartTotal - coveredSubtotal);
        const cashRow = rows.find(row => row.method?.type === 'cash');
        const cashCharged = cashRow?.chargedAmount || 0;
        const cashReceivedValue = parseFloat(cashReceived) || 0;
        const cashChange = cashReceivedValue >= cashCharged ? (cashReceivedValue - cashCharged) : 0;

        return {
            rows,
            coveredSubtotal,
            chargedTotal,
            totalAdjustment,
            pendingSubtotal,
            cashCharged,
            cashReceivedValue,
            cashChange,
            isValid:
                rows.length > 0 &&
                rows.every(row => row.method && row.chargedAmount > 0) &&
                Math.abs(coveredSubtotal - cartTotal) < 0.01,
        };
    }, [splitPayments, cashReceived, cartTotal, getMethodById]);

    const resetPaymentState = () => {
        setSelectedPaymentMethod(null);
        setCashReceived('');
        setIsSplitPayment(false);
        setSplitPayments([]);
    };

    const seedDefaultSplitPayments = (methods = dbPaymentMethods, preferredMethodId = selectedPaymentMethod) => {
        const preferredMethod = preferredMethodId ? getMethodById(preferredMethodId) : null;
        const defaultMethod = preferredMethod || methods?.find(m => m.type === 'cash') || methods?.[0];
        if (!defaultMethod) {
            setSplitPayments([]);
            return;
        }
        const percentage = defaultMethod.percentage || 0;
        const total = cartTotal * (1 + (percentage / 100));
        setSplitPayments([{ methodId: defaultMethod.id, amount: total.toFixed(2) }]);
    };

    const updateSplitPayment = (index, field, value) => {
        setSplitPayments(prev => prev.map((row, rowIndex) => (
            rowIndex === index ? { ...row, [field]: value } : row
        )));
        if (field === 'methodId' || field === 'amount') setCashReceived('');
    };

    const addSplitPaymentRow = () => {
        const fallbackMethod = dbPaymentMethods?.[0];
        setSplitPayments(prev => ([
            ...prev,
            { methodId: fallbackMethod?.id || null, amount: '' },
        ]));
        setCashReceived('');
    };

    const removeSplitPaymentRow = (index) => {
        setSplitPayments(prev => prev.filter((_, rowIndex) => rowIndex !== index));
        setCashReceived('');
    };

    const openPaymentModal = (preferredMethod = null) => {
        if (!hasCashOpeningToday) {
            showToast('⚠️ Debés registrar la apertura de caja antes de comenzar a vender.', 'warning');
            navigate('/caja');
            return;
        }
        const defaultMethod = preferredMethod || dbPaymentMethods?.find(m => m.type === 'cash') || dbPaymentMethods?.[0];
        setSelectedPaymentMethod(defaultMethod?.id || null);
        setIsSplitPayment(false);
        setSplitPayments([]);
        setCashReceived('');
        setShowPaymentModal(true);
    };

    const handleCheckout = async (methodObj, splitSummary = null) => {
        if (processingRef.current) return; // bloqueo sincrónico
        if (!methodObj) {
            showToast('⚠️ Error: No se seleccionó un método de pago válido.', 'warning');
            return;
        }

        if (methodObj.type === 'cuenta_corriente' && !selectedClientId) {
            showToast('⚠️ Debe seleccionar un cliente para vender a cuenta corriente.', 'warning');
            return;
        }
        if (methodObj.type === 'cuenta_corriente' && !selectedClientHasCurrentAccount) {
            showToast('⚠️ El cliente seleccionado no tiene cuenta corriente habilitada.', 'warning');
            return;
        }

        processingRef.current = true;
        setIsProcessing(true);
        setShowPaymentModal(false);

        try {
            const isMixedSale = methodObj.type === 'mixed';
            const paymentBreakdown = isMixedSale
                ? splitSummary.rows.map(row => ({
                    method_id: row.method.id,
                    method_name: row.method.name,
                    method_type: row.method.type,
                    percentage: row.method.percentage || 0,
                    subtotal_base: Math.round(row.baseAmount * 100) / 100,
                    adjustment: Math.round(row.adjustment * 100) / 100,
                    amount_charged: Math.round(row.chargedAmount * 100) / 100,
                }))
                : null;

            console.log("Iniciando checkout con:", { methodObj, cartTotal, cart, paymentBreakdown });

            const adjustment = isMixedSale ? splitSummary.totalAdjustment : (cartTotal * (methodObj.percentage || 0)) / 100;
            const finalTotal = isMixedSale ? splitSummary.chargedTotal : cartTotal + adjustment;
            const numericClientId = selectedClientId ? Number(selectedClientId) : null;
            const shouldLinkClientToCurrentAccount = methodObj.type === 'cuenta_corriente'
                || (
                    Array.isArray(paymentBreakdown) &&
                    paymentBreakdown.some((part) => part.method_type === 'cuenta_corriente' || part.method_name === 'Cuenta Corriente')
                );
            const { receiptNumber: saleReceiptNumber, receiptCode: saleReceiptCode } = await getNextRemoteReceiptData('sales_receipt_counter');

            // 1. Registrar la Venta
            const { insertId: saleId } = await saveTableRecord('ventas', 'insert', {
                date: new Date(),
                subtotal: cartTotal,
                adjustment: adjustment,
                total: finalTotal,
                receipt_number: saleReceiptNumber,
                receipt_code: saleReceiptCode,
                payment_method: methodObj.name,
                payment_method_id: methodObj.id || null,
                payment_breakdown: paymentBreakdown,
                clientId: shouldLinkClientToCurrentAccount ? numericClientId : null,
                ...(qendraActiveTicketId ? { qendra_ticket_id: qendraActiveTicketId, source: 'qendra' } : {}),
            });

            console.log("Venta creada ID:", saleId);

            // 2. Registrar Items de la Venta
            const saleItems = cart.map(i => ({
                venta_id: saleId,
                product_name: i.name,
                quantity: i.quantity,
                price: i.price,
                subtotal: i.price * i.quantity,
                synced: 0
            }));
            await Promise.all(saleItems.map((item) => saveTableRecord('ventas_items', 'insert', item)));

            // 3. Ajustar Balance del Cliente (si es cta cte)
            if (methodObj.type === 'cuenta_corriente' && numericClientId !== null) {
                const client = clients.find((item) => Number(item.id) === numericClientId);
                if (client) {
                    await saveTableRecord('clients', 'update', {
                        balance: (client.balance || 0) - finalTotal,
                        last_updated: new Date().toISOString(),
                    }, numericClientId);
                }
            }

            // 4. Descontar Stock (Añadiendo movimiento negativo)
            const stockAdjustments = cart.map(item => ({
                name: item.name,
                type: item.category,
                quantity: -item.quantity,
                unit: item.unit || 'kg',
                updated_at: new Date(),
                synced: 0
            }));

            await Promise.all(stockAdjustments.map((item) => saveTableRecord('stock', 'insert', item)));
            await refreshVentasData();

            console.log("Proceso de guardado completado.");
            playCashRegister();
            setQendraActiveTicketId(null); // limpiar ticket QENDRA activo

            // Guardar snapshot del carrito antes de resetear (para imprimir después)
            const cartSnapshot = [...cart];
            setPendingPrintData({
                saleData: { id: saleId, receipt_number: saleReceiptNumber, receipt_code: saleReceiptCode, subtotal: cartTotal, adjustment: adjustment, total: finalTotal },
                items: cartSnapshot
            });

            // Resetear todo ANTES de mostrar el modal (sin confirm() nativo que roba el foco)
            setCart([]);
            setSelectedClientId(null);
            setClientSearch('');
            resetPaymentState();
            setShowPrintConfirmModal(true);
        } catch (error) {
            console.error('Error crítico al guardar la venta:', error);
            showToast('❌ Hubo un fallo al guardar la venta en la base de datos: ' + error.message, 'error');
        } finally {
            processingRef.current = false;
            setIsProcessing(false);
        }
    };

    const handlePrintConfirm = (shouldPrint) => {
        if (shouldPrint && pendingPrintData) {
            printTicket(pendingPrintData.saleData, pendingPrintData.items);
        }
        setShowPrintConfirmModal(false);
        setPendingPrintData(null);
        // Devolver el foco al scanner sin pasar por ningún diálogo nativo
        setTimeout(() => barcodeInputRef.current?.focus(), 100);
    };

    const confirmPayment = () => {
        if (isSplitPayment) {
            if (!splitPaymentSummary.isValid) {
                showToast('⚠️ El pago mixto no cubre exactamente el subtotal de la venta.', 'warning');
                return;
            }
            handleCheckout({ name: 'Pago Mixto', type: 'mixed', id: null, percentage: 0 }, splitPaymentSummary);
            return;
        }

        if (!activeMethod) {
            showToast('⚠️ Seleccioná un método de pago.', 'warning');
            return;
        }

        handleCheckout(activeMethod);
    };

    const filteredClients = clients?.filter((client) => {
        const term = clientSearch.toLowerCase().trim();
        if (!term) return true;
        const displayName = getClientDisplayName(client).toLowerCase();
        const phone = String(client.phone || client.phone1 || '').toLowerCase();
        return displayName.includes(term) || phone.includes(term);
    });

    const handleDeleteTicket = async (id) => {
        const remoteDeleteCode = await getRemoteSetting('ticket_delete_authorization_code');
        const expectedCode = String(remoteDeleteCode ?? '').trim();
        const providedCode = String(deleteAuthorizationCode || '').trim();

        if (!expectedCode) {
            showToast('⚠️ No hay código maestro configurado para eliminar tickets. Configuralo en Seguridad.', 'warning');
            return;
        }

        if (!providedCode) {
            showToast('⚠️ Ingresá el código de autorización para borrar el ticket.', 'warning');
            return;
        }

        if (providedCode !== expectedCode) {
            showToast('❌ Código maestro incorrecto. No se eliminó el ticket.', 'error');
            return;
        }

        const venta = recentSales.find((sale) => Number(sale.id) === Number(id));
        if (!venta) {
            throw new Error('La venta ya no existe.');
        }

        const items = recentSalesItems?.[id] || recentSalesItems?.[Number(id)] || [];

        if (items.length > 0) {
            const stockRestorations = items.map((item) => {
                const ref = findStockItemByName(item.product_name);
                return {
                    name: item.product_name,
                    type: ref?.type || 'vaca',
                    quantity: item.quantity,
                    unit: ref?.unit || item.unit || 'kg',
                    updated_at: new Date().toISOString(),
                    reference: `anulacion_venta_${id}`,
                };
            });
            await Promise.all(stockRestorations.map((item) => saveTableRecord('stock', 'insert', item)));
        }

        if (venta.clientId && venta.payment_method === 'Cuenta Corriente') {
            const numericClientId = Number(venta.clientId);
            const client = clients.find((item) => Number(item.id) === numericClientId);
            if (client) {
                await saveTableRecord('clients', 'update', {
                    balance: Number(client.balance || 0) + Number(venta.total || 0),
                    last_updated: new Date().toISOString(),
                }, numericClientId);
            }
        }

        await saveTableRecord('deleted_sales_history', 'insert', {
            sale_id: venta.id,
            receipt_number: venta.receipt_number || null,
            receipt_code: venta.receipt_code || formatReceiptCode(1, venta.receipt_number || venta.id),
            sale_date: venta.date || null,
            deleted_at: new Date().toISOString(),
            deleted_by_user_id: currentUser?.id || null,
            deleted_by_username: currentUser?.username || 'Usuario desconocido',
            payment_method: venta.payment_method || '',
            clientId: venta.clientId ?? null,
            total: Number(venta.total || 0),
            source: venta.source || 'manual',
            authorization_verified: 1,
            sale_snapshot: venta,
            items_snapshot: items,
        });

        await Promise.all(items.map((item) => saveTableRecord('ventas_items', 'delete', null, item.id)));
        await saveTableRecord('ventas', 'delete', null, id);
        await refreshVentasData();

        setDeleteAuthorizationCode('');
        setConfirmDeleteTicketId(null);
        showToast('✅ Ticket eliminado y registrado en historial.', 'success');
    };

    const filteredRecentSales = React.useMemo(() => {
        const term = deleteTicketSearch.trim().toLowerCase();
        if (!recentSales) return [];
        if (!term) return recentSales;
        return recentSales.filter((s) => {
            const fallbackReceiptCode = formatReceiptCode(1, s.receipt_number || s.id);
            return (
                String(s.id).toLowerCase().includes(term) ||
                String(s.total).toLowerCase().includes(term) ||
                String(s.receipt_number || '').toLowerCase().includes(term) ||
                String(s.receipt_code || '').toLowerCase().includes(term) ||
                fallbackReceiptCode.toLowerCase().includes(term) ||
                (s.payment_method || '').toLowerCase().includes(term)
            );
        });
    }, [recentSales, deleteTicketSearch]);

    return (
        <>
        {/* TOAST — reemplaza todos los alert() nativos para no perder foco en Electron */}
        {toastMsg && (
            <div
                onClick={() => setToastMsg(null)}
                style={{
                    position: 'fixed', top: '1.2rem', left: '50%', transform: 'translateX(-50%)',
                    zIndex: 99999, padding: '0.85rem 1.4rem',
                    borderRadius: '10px', maxWidth: '90vw', minWidth: '280px',
                    background: toastMsg.type === 'success' ? '#166534' : toastMsg.type === 'warning' ? '#854d0e' : '#991b1b',
                    color: '#fff', fontWeight: '600', fontSize: '0.95rem',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                    cursor: 'pointer', textAlign: 'center', userSelect: 'none',
                }}
            >
                {toastMsg.text}
            </div>
        )}
        {/* TOP BAR - Premium TPV Style */}
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.75rem 1.5rem', background: 'rgba(10, 10, 10, 0.8)',
            backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,0.05)',
            color: 'var(--color-text-main)', zIndex: 100
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '32px', height: '32px', background: 'var(--color-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Beef size={20} color="#000" />
                    </div>
                    <span style={{ fontWeight: '800', fontSize: '1.1rem', letterSpacing: '0.02em' }}>CENTRO DE <span style={{ color: 'var(--color-primary)' }}>VENTAS</span></span>
                </div>
                <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.1)' }}></div>
                <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', fontWeight: '500' }}>
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <User size={14} />
                    </div>
                    <span style={{ color: 'var(--color-text-muted)' }}>Cajera:</span>
                    <span style={{ fontWeight: '600' }}>{currentUser?.displayName || 'Sara J.'}</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}><Printer size={18} /></button>
                    <button style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}><Settings size={18} /></button>
                    <button style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}><X size={18} /></button>
                </div>
            </div>
        </div>

        <div className={`pos-container animate-fade-in ${showCartMobile ? 'show-cart-mobile' : ''}`}>
            {/* Mobile Cart FAB */}
            <button
                className="mobile-cart-toggle"
                onClick={() => setShowCartMobile(!showCartMobile)}
            >
                <div className="cart-badge-count">{cart.length}</div>
                <ShoppingBag size={24} />
            </button>
            {/* PRODUCTS_SECTION */}
            <div className="pos-products-area">
                <div style={{ marginBottom: '1.25rem', padding: '0.2rem' }}>
                    <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <Search size={18} style={{ position: 'absolute', left: '1.1rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.3 }} />
                            <input
                                ref={barcodeInputRef}
                                type="text"
                                placeholder="Escanear producto, PLU o buscador..."
                                value={barcodeInputValue}
                                onChange={e => {
                                    setBarcodeInputValue(e.target.value);
                                    if (scannerError) setScannerError('');
                                }}
                                style={{
                                    width: '100%', padding: '1rem 1.25rem 1rem 3.2rem',
                                    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)',
                                    borderRadius: '16px', color: '#fff', fontSize: '1.05rem', fontWeight: '600',
                                    boxShadow: 'inset 0 0 10px rgba(0,0,0,0.2)'
                                }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        handleScanTicket(barcodeInputValue.trim());
                                        setBarcodeInputValue('');
                                    }
                                }}
                                autoFocus
                            />
                        </div>
                        <button 
                            className={`category-pill ${isSimulated ? 'active' : ''}`} 
                            onClick={toggleTestMode}
                            style={{ 
                                whiteSpace: 'nowrap', minWidth: '140px', padding: '1rem',
                                boxShadow: isSimulated ? '0 0 15px rgba(34, 197, 94, 0.3)' : 'none'
                             }}
                        >
                            {isSimulated ? '🔵 SIMULADOR OK' : '⚫ SIMULADOR OFF'}
                        </button>
                        <button
                            className={`category-pill ${isScaleConnected ? 'active' : ''}`}
                            onClick={handleConnectScale}
                            style={{
                                whiteSpace: 'nowrap', minWidth: '150px', padding: '1rem',
                                boxShadow: isScaleConnected ? '0 0 15px rgba(34, 197, 94, 0.3)' : 'none'
                            }}
                        >
                            {isScaleConnected ? '⚖️ BALANZA OK' : '⚖️ CONECTAR'}
                        </button>
                    </div>
                    {scannerError && (
                        <div style={{
                            marginTop: '0.75rem',
                            padding: '0.85rem 1rem',
                            borderRadius: '12px',
                            background: 'rgba(239,68,68,0.12)',
                            border: '1px solid rgba(239,68,68,0.35)',
                            color: '#fecaca',
                            fontSize: '0.82rem',
                            lineHeight: 1.45,
                            whiteSpace: 'pre-line'
                        }}>
                            {scannerError}
                        </div>
                    )}
                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="category-pill"
                            onClick={handleOpenQendraVisor}
                            style={{ fontSize: '0.78rem', fontWeight: '800' }}
                        >
                            🎫 QENDRA HOY
                        </button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                            Importar
                            <select
                                value={qendraSyncDias}
                                onChange={(e) => setQendraSyncDias(Number(e.target.value))}
                                style={{
                                    padding: '0.45rem 0.6rem',
                                    borderRadius: '10px',
                                    border: '1px solid var(--glass-border)',
                                    background: 'rgba(255,255,255,0.03)',
                                    color: 'var(--color-text-main)'
                                }}
                            >
                                <option value={1}>1 día</option>
                                <option value={7}>7 días</option>
                                <option value={30}>30 días</option>
                                <option value={0}>todo</option>
                            </select>
                        </label>
                        <button
                            type="button"
                            className="category-pill"
                            onClick={handleQendraSyncVentas}
                            disabled={qendraSyncing}
                            style={{ fontSize: '0.78rem', fontWeight: '800', opacity: qendraSyncing ? 0.7 : 1 }}
                        >
                            {qendraSyncing ? '⏳ IMPORTANDO...' : '⬇️ IMPORTAR VENTAS'}
                        </button>
                        {qendraSyncResult && (
                            <div style={{
                                padding: '0.5rem 0.8rem',
                                borderRadius: '10px',
                                background: qendraSyncResult.error ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
                                border: `1px solid ${qendraSyncResult.error ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)'}`,
                                color: qendraSyncResult.error ? '#fecaca' : '#bbf7d0',
                                fontSize: '0.76rem'
                            }}>
                                {qendraSyncResult.error
                                    ? `QENDRA: ${qendraSyncResult.error}`
                                    : qendraSyncResult.diagMsg || `QENDRA: ${qendraSyncResult.created || 0} importadas, ${qendraSyncResult.skipped || 0} omitidas.`}
                            </div>
                        )}
                    </div>
                </div>

                <div className="pos-categories" style={{ marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '1rem' }}>
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat.id}
                            className={`category-pill ${categoryFilter === cat.id ? 'active' : ''}`}
                            onClick={() => setCategoryFilter(cat.id)}
                            style={{ fontSize: '0.8rem', letterSpacing: '0.05em', fontWeight: '800' }}
                        >
                            {cat.label.toUpperCase()}
                        </button>
                    ))}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                         <button onClick={() => navigate('/ventas/lista')} className="category-pill" style={{ opacity: 0.6 }}>🎟️ TICKETS</button>
                    </div>
                </div>
                <div className="products-grid">
                    {filteredProducts.length === 0 ? (
                        <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
                            <ShoppingBag style={{ opacity: 0.3, width: 48, height: 48, marginBottom: '1rem' }} />
                            <p>No hay productos disponibles.</p>
                        </div>
                    ) : (
                        filteredProducts.map(product => (
                            <div
                                key={product.id}
                                className="product-card"
                                onClick={() => addToCart(product)}
                                style={{ position: 'relative', overflow: 'visible' }}
                            >
                                <div className="product-name">{product.name}</div>
                                {toNumber(product.price) > 0 ? (
                                    <div className="product-price">${formatPrice(toNumber(product.price), priceFormat)}</div>
                                ) : (
                                    <div className="product-price" style={{ color: '#ef4444' }}>Sin Precio</div>
                                )}

                                <div className="product-stock" style={{ color: product.totalQuantity <= 5 ? '#ef4444' : 'inherit' }}>
                                    Stock: {toNumber(product.totalQuantity).toFixed(product.unit === 'kg' ? 3 : 0)} {product.unit}
                                </div>

                                <button
                                    className="price-tag-btn"
                                    onClick={(e) => { e.stopPropagation(); setEditingPriceId(product.id); setNewPrice(toNumber(product.price) || ''); setNewPlu(product.plu || ''); }}
                                    style={{
                                        position: 'absolute', top: '8px', right: '8px',
                                        background: 'transparent', border: 'none', 
                                        width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                        cursor: 'pointer', color: 'rgba(255,255,255,0.2)'
                                    }}
                                >
                                    <Tag size={14} />
                                </button>

                            </div>
                        ))
                    )}
                </div>
            </div>
            <div className="pos-ticket">
                <div className="ticket-header" style={{ padding: '1rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '1rem', fontWeight: '950', margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--color-primary)', letterSpacing: '0.05em' }}>
                        <ShoppingBag size={18} />
                        TICKET ACTUAL
                    </h2>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: '700', opacity: 0.8 }}>
                        #{formatReceiptCode(recentSales?.length + 1 || 1)}
                    </span>
                </div>

                <div className="ticket-items">
                    {cart.map((item, idx) => (
                        <div key={idx} className="ticket-item">
                            <div className="item-info">
                                <span className="item-name">{item.name}</span>
                                <div className="item-detail">
                                    <span style={{ color: 'var(--color-text-main)', fontWeight: '600' }}>{toNumber(item.quantity).toFixed(3)} {item.unit || 'Kg'}</span>
                                    <span>× ${formatPrice(toNumber(item.price), priceFormat)}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.45rem', flexWrap: 'wrap' }}>
                                    <button
                                        type="button"
                                        onClick={() => updateQuantity(item.id, item.unit === 'kg' ? -0.1 : -1)}
                                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', color: '#fff', borderRadius: '8px', width: '28px', height: '28px', cursor: 'pointer' }}
                                    >
                                        -
                                    </button>
                                    <input
                                        type="number"
                                        min={item.unit === 'kg' ? '0.001' : '1'}
                                        step={item.unit === 'kg' ? '0.001' : '1'}
                                        value={toNumber(item.quantity)}
                                        onChange={(e) => manualQuantity(item.id, e.target.value)}
                                        style={{
                                            width: item.unit === 'kg' ? '88px' : '70px',
                                            padding: '0.35rem 0.45rem',
                                            borderRadius: '8px',
                                            border: '1px solid var(--glass-border)',
                                            background: 'rgba(255,255,255,0.04)',
                                            color: '#fff',
                                            fontWeight: '700'
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => updateQuantity(item.id, item.unit === 'kg' ? 0.1 : 1)}
                                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', color: '#fff', borderRadius: '8px', width: '28px', height: '28px', cursor: 'pointer' }}
                                    >
                                        +
                                    </button>
                                    {item.unit === 'kg' && (
                                        <button
                                            type="button"
                                            onClick={() => readScaleForItem(item.id)}
                                            style={{ background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)', color: '#fdba74', borderRadius: '8px', padding: '0.35rem 0.6rem', cursor: 'pointer', fontSize: '0.72rem', fontWeight: '800' }}
                                        >
                                            ⚖️ PESAR
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <span className="item-total">${formatPrice(item.price * item.quantity, priceFormat)}</span>
                                <button
                                    onClick={() => removeFromCart(item.id)}
                                    style={{ background: 'none', border: 'none', color: 'rgba(239, 68, 68, 0.4)', cursor: 'pointer', padding: '0.2rem' }}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {cart.length === 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, opacity: 0.2, gap: '1.5rem', padding: '4rem 0' }}>
                            <ShoppingBag size={80} strokeWidth={1} />
                            <p style={{ fontWeight: '500', fontSize: '1.1rem', letterSpacing: '0.05em' }}>TICKET VACIO</p>
                        </div>
                    )}
                </div>

                <div className="ticket-footer">
                    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: '900', opacity: 0.6 }}>TOTAL</span>
                            <span style={{ fontSize: '2.5rem', fontWeight: '950', color: 'var(--color-primary)', textShadow: '0 0 15px var(--color-primary-glow)' }}>${formatPrice(cartTotal, priceFormat)}</span>
                        </div>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                        {selectedClient && (
                            <div style={{
                                marginBottom: '0.75rem',
                                padding: '0.7rem 0.8rem',
                                borderRadius: '12px',
                                background: 'rgba(59,130,246,0.10)',
                                border: '1px solid rgba(59,130,246,0.25)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '0.75rem'
                            }}>
                                <div>
                                    <div style={{ fontSize: '0.8rem', fontWeight: '800', color: '#bfdbfe' }}>{getClientDisplayName(selectedClient)}</div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                                        {selectedClientHasCurrentAccount ? 'Cuenta corriente habilitada' : 'Solo venta normal'}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedClientId(null)}
                                    style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', borderRadius: '8px', padding: '0.3rem 0.55rem', cursor: 'pointer' }}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            {dbPaymentMethods?.slice(0, 2).map(m => (
                                <button 
                                    key={m.id} 
                                    className={`payment-method-btn ${selectedPaymentMethod === m.id ? 'active' : ''}`} 
                                    onClick={() => setSelectedPaymentMethod(m.id)}
                                    style={{ padding: '0.6rem', fontSize: '0.75rem', fontWeight: '800' }}
                                >
                                    {m.name.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="action-buttons">
                        <button className="btn-secondary" onClick={() => setShowClientList(true)}>CLIENTES</button>
                        <button className="btn-secondary">CONFIG</button>
                        <button className="btn-danger" onClick={() => { if(window.confirm('¿Anular ticket?')) setCart([]); }}>ANULAR</button>
                    </div>

                    <button
                        className="pay-button"
                        style={{ marginTop: '0.75rem', width: '100%' }}
                        disabled={cart.length === 0 || isProcessing}
                        onClick={() => openPaymentModal()}
                    >
                        {isProcessing ? 'PROCESANDO...' : 'COBRAR TICKET'}
                    </button>
                    {!hasCashOpeningToday && (
                        <div style={{
                            marginTop: '0.6rem',
                            padding: '0.75rem 0.85rem',
                            borderRadius: '12px',
                            background: 'rgba(245, 158, 11, 0.08)',
                            border: '1px solid rgba(245, 158, 11, 0.22)',
                            color: '#f59e0b',
                            fontSize: '0.75rem',
                            lineHeight: 1.45,
                            textAlign: 'center'
                        }}>
                            La caja todavía no fue abierta hoy. Registrá la apertura en <strong>Caja</strong> para habilitar ventas.
                        </div>
                    )}
                    
                    <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
                        <button
                            onClick={() => { setShowDeleteTicketModal(true); setDeleteTicketSearch(''); setConfirmDeleteTicketId(null); }}
                            style={{ background: 'none', border: 'none', color: 'rgba(239, 68, 68, 0.4)', fontSize: '0.6rem', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', textTransform: 'uppercase', margin: '0 auto' }}
                        >
                            <Trash2 size={12} /> ELIMINAR TICKET ({recentSales?.length || 0})
                        </button>
                    </div>
                </div>
            </div>
        </div>

        {showWeightModal && (
            <div className="modal-overlay">
                <div className="modal-content neo-card" style={{ maxWidth: "400px", width: "90%", animation: "slideUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
                    <div style={{ padding: "2rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
                            <div style={{ padding: "0.75rem", background: "rgba(249, 115, 22, 0.1)", borderRadius: "50%" }}>
                                <Calculator size={24} color="var(--color-primary)" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: "1.2rem", fontWeight: "900", margin: 0 }}>PESO MANUAL</h2>
                                <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", margin: 0 }}>{weightProduct?.name}</p>
                            </div>
                        </div>
                        <div style={{ marginBottom: "2rem" }}>
                            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: "800", color: "var(--color-text-muted)", marginBottom: "0.5rem", textTransform: "uppercase" }}>Kilogramos</label>
                            <div style={{ position: "relative" }}>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={weightInput}
                                    onChange={e => setWeightInput(e.target.value.replace(",", "."))}
                                    onKeyDown={e => {
                                        if (e.key === "Enter") handleManualWeightConfirm();
                                        if (e.key === "Escape") setShowWeightModal(false);
                                    }}
                                    autoFocus
                                    onFocus={e => e.target.select()}
                                    style={{
                                        width: "100%",
                                        padding: "1.25rem",
                                        fontSize: "2rem",
                                        fontWeight: "900",
                                        textAlign: "center",
                                        background: "rgba(0,0,0,0.3)",
                                        border: "2px solid var(--color-primary)",
                                        borderRadius: "16px",
                                        color: "#fff",
                                        boxShadow: "0 0 20px rgba(249, 115, 22, 0.1)"
                                    }}
                                />
                                <div style={{ position: "absolute", right: "1.5rem", top: "50%", transform: "translateY(-50%)", fontWeight: "900", color: "var(--color-primary)", fontSize: "1.2rem", opacity: 0.5 }}>KG</div>
                            </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                            <button className="btn-secondary" onClick={() => setShowWeightModal(false)}>CANCELAR</button>
                            <button className="btn-primary" onClick={handleManualWeightConfirm} style={{ padding: "1rem" }}>AGREGAR</button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        {showClientList && (
            <div
                style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => setShowClientList(false)}
            >
                <div
                    className="neo-card"
                    style={{ width: 'min(560px, 94vw)', maxHeight: '82vh', overflow: 'hidden', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Seleccionar cliente</h2>
                            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                Elegí un cliente para habilitar cuenta corriente y asociar la venta.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowClientList(false)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                        >
                            <X size={18} />
                        </button>
                    </div>
                    <input
                        type="text"
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        placeholder="Buscar por nombre o teléfono..."
                        autoFocus
                        style={{
                            padding: '0.8rem 0.95rem',
                            borderRadius: '12px',
                            border: '1px solid var(--glass-border)',
                            background: 'rgba(255,255,255,0.04)',
                            color: '#fff'
                        }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={() => {
                                setSelectedClientId(null);
                                setShowClientList(false);
                            }}
                            style={{ padding: '0.45rem 0.7rem', borderRadius: '999px', border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer', fontSize: '0.76rem', fontWeight: '700' }}
                        >
                            Venta sin cliente
                        </button>
                    </div>
                    <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.55rem', paddingRight: '0.25rem' }}>
                        {filteredClients?.length ? filteredClients.map((client) => {
                            const isActiveClient = Number(selectedClientId) === Number(client.id);
                            return (
                                <button
                                    key={client.id}
                                    type="button"
                                    onClick={() => {
                                        setSelectedClientId(client.id);
                                        setShowClientList(false);
                                        setClientSearch('');
                                    }}
                                    style={{
                                        textAlign: 'left',
                                        padding: '0.8rem 0.95rem',
                                        borderRadius: '12px',
                                        border: isActiveClient ? '1px solid rgba(59,130,246,0.45)' : '1px solid var(--glass-border)',
                                        background: isActiveClient ? 'rgba(59,130,246,0.10)' : 'rgba(255,255,255,0.03)',
                                        color: '#fff',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <div style={{ fontWeight: '800', fontSize: '0.9rem' }}>{getClientDisplayName(client)}</div>
                                    <div style={{ marginTop: '0.2rem', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
                                        {String(client.phone || client.phone1 || 'Sin teléfono')}
                                        {' · '}
                                        {client.has_current_account !== false ? 'Cuenta corriente disponible' : 'Sin cuenta corriente'}
                                    </div>
                                </button>
                            );
                        }) : (
                            <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                                No se encontraron clientes con ese criterio.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

            {/* PAYMENT MODAL */}
            {showPaymentModal && (
                <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="modal-content neo-card" style={{ maxWidth: '760px', width: '94%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '1rem' }}>Finalizar Venta</h2>

                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                                <span style={{ color: 'var(--color-text-muted)' }}>Subtotal:</span>
                                <span>${formatNumericLocale(cartTotal)}</span>
                            </div>

                            {!isSplitPayment && cartAdjustment !== 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                                    <span style={{ color: 'var(--color-text-muted)' }}>Recargo/Descuento:</span>
                                    <span style={{ color: cartAdjustment > 0 ? '#ef4444' : '#22c55e' }}>
                                        {cartAdjustment > 0 ? '+' : ''}${formatNumericLocale(cartAdjustment)}
                                    </span>
                                </div>
                            )}

                            {isSplitPayment && (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                                        <span style={{ color: 'var(--color-text-muted)' }}>Subtotal cubierto:</span>
                                        <span>${formatNumericLocale(splitPaymentSummary.coveredSubtotal, 'es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                                        <span style={{ color: 'var(--color-text-muted)' }}>Pendiente de cubrir:</span>
                                        <span style={{ color: splitPaymentSummary.pendingSubtotal > 0.009 ? '#ef4444' : '#22c55e' }}>
                                            ${formatNumericLocale(splitPaymentSummary.pendingSubtotal, 'es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                    {splitPaymentSummary.totalAdjustment !== 0 && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                                            <span style={{ color: 'var(--color-text-muted)' }}>Recargo/Descuento combinado:</span>
                                            <span style={{ color: splitPaymentSummary.totalAdjustment > 0 ? '#ef4444' : '#22c55e' }}>
                                                {splitPaymentSummary.totalAdjustment > 0 ? '+' : ''}${formatNumericLocale(splitPaymentSummary.totalAdjustment, 'es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    )}
                                </>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)' }}>
                                <span style={{ fontWeight: 'bold' }}>{isSplitPayment ? 'TOTAL COBRADO:' : 'TOTAL A PAGAR:'}</span>
                                <span style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--color-primary)' }}>
                                    ${isSplitPayment
                                        ? formatNumericLocale(splitPaymentSummary.chargedTotal, 'es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                        : formatNumericLocale(finalTotal)}
                                </span>
                            </div>
                        </div>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Método de Pago</label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--color-text-main)' }}>
                                    <input
                                        type="checkbox"
                                        checked={isSplitPayment}
                                        onChange={(e) => {
                                            const checked = e.target.checked;
                                            setIsSplitPayment(checked);
                                            setCashReceived('');
                                            if (checked) seedDefaultSplitPayments(dbPaymentMethods, selectedPaymentMethod);
                                            else setSplitPayments([]);
                                        }}
                                    />
                                    Cobro mixto
                                </label>
                            </div>

                            {!isSplitPayment ? (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                    {dbPaymentMethods?.map(m => (
                                        <button
                                            key={m.id}
                                            onClick={() => {
                                                setSelectedPaymentMethod(m.id);
                                                setCashReceived('');
                                            }}
                                            style={{
                                                padding: '0.75rem',
                                                borderRadius: 'var(--radius-md)',
                                                border: selectedPaymentMethod === m.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                background: selectedPaymentMethod === m.id ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-bg-card)',
                                                color: 'var(--color-text-main)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                gap: '0.2rem',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            <PaymentMethodIcon method={m} size={38} compact />
                                            <div style={{ fontSize: '0.8rem', fontWeight: '600', textAlign: 'center' }}>{m.name}</div>
                                            {m.percentage !== 0 && (
                                                <div style={{ fontSize: '0.7rem', color: m.percentage > 0 ? '#ef4444' : '#22c55e' }}>
                                                    {m.percentage > 0 ? '+' : ''}{m.percentage}%
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => {
                                            if (!currentAccountAvailable || !currentAccountMethod) return;
                                            setSelectedPaymentMethod(currentAccountMethod.id);
                                            setCashReceived('');
                                        }}
                                        disabled={!currentAccountAvailable}
                                        title={currentAccountAvailable ? 'Registrar venta en cuenta corriente' : 'Seleccioná un cliente con cuenta corriente habilitada'}
                                        style={{
                                            padding: '0.75rem',
                                            borderRadius: 'var(--radius-md)',
                                            border: selectedPaymentMethod === currentAccountMethod?.id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                            background: selectedPaymentMethod === currentAccountMethod?.id ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-bg-card)',
                                            color: currentAccountAvailable ? 'var(--color-text-main)' : 'var(--color-text-muted)',
                                            cursor: currentAccountAvailable ? 'pointer' : 'not-allowed',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: '0.2rem',
                                            transition: 'all 0.2s',
                                            opacity: currentAccountAvailable ? 1 : 0.55
                                        }}
                                    >
                                        <div style={{ fontSize: '1.8rem', lineHeight: 1 }}>📋</div>
                                        <div style={{ fontSize: '0.8rem', fontWeight: '600', textAlign: 'center' }}>Cuenta Corriente</div>
                                        <div style={{ fontSize: '0.68rem', textAlign: 'center', color: currentAccountAvailable ? '#f59e0b' : 'var(--color-text-muted)' }}>
                                            {currentAccountAvailable ? 'Cliente habilitado' : 'Elegí un cliente'}
                                        </div>
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gap: '0.75rem' }}>
                                    {splitPayments.map((row, index) => {
                                        const rowMethod = getMethodById(row.methodId);
                                        const rowSummary = splitPaymentSummary.rows.find(item => item.index === index);
                                        return (
                                            <div key={index} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.85rem', display: 'grid', gap: '0.65rem' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr auto', gap: '0.6rem', alignItems: 'end' }}>
                                                    <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                                        <span>Medio</span>
                                                        <select
                                                            value={row.methodId || ''}
                                                            onChange={(e) => {
                                                                const rawValue = e.target.value;
                                                                updateSplitPayment(index, 'methodId', rawValue === 'current_account' ? rawValue : Number(rawValue));
                                                            }}
                                                            style={{ padding: '0.65rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-main)', color: 'var(--color-text-main)' }}
                                                        >
                                                            {availableSplitMethods?.map(m => (
                                                                <option key={m.id} value={m.id}>{m.name}</option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <label style={{ display: 'grid', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                                        <span>Importe cobrado</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={row.amount}
                                                            onChange={(e) => updateSplitPayment(index, 'amount', e.target.value)}
                                                            style={{ padding: '0.65rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-main)', color: 'var(--color-text-main)' }}
                                                            placeholder="0.00"
                                                        />
                                                    </label>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeSplitPaymentRow(index)}
                                                        disabled={splitPayments.length === 1}
                                                        style={{ padding: '0.65rem 0.8rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-main)', cursor: splitPayments.length === 1 ? 'not-allowed' : 'pointer', opacity: splitPayments.length === 1 ? 0.4 : 1 }}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                                                    <span style={{ color: 'var(--color-text-muted)' }}>
                                                        Base cubierta: ${toNumber(rowSummary?.baseAmount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </span>
                                                    <span style={{ color: (rowMethod?.percentage || 0) >= 0 ? '#ef4444' : '#22c55e' }}>
                                                        Ajuste: {(toNumber(rowSummary?.adjustment) > 0 ? '+' : '')}${toNumber(rowSummary?.adjustment).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    <button
                                        type="button"
                                        onClick={addSplitPaymentRow}
                                        style={{ padding: '0.7rem', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-main)', cursor: 'pointer', fontWeight: '600' }}
                                    >
                                        + Agregar otro medio
                                    </button>

                                    <div style={{
                                        padding: '0.75rem 0.9rem',
                                        borderRadius: 'var(--radius-md)',
                                        background: splitPaymentSummary.isValid ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                                        color: splitPaymentSummary.isValid ? '#22c55e' : '#ef4444',
                                        fontSize: '0.82rem',
                                        fontWeight: '600',
                                    }}>
                                        {splitPaymentSummary.isValid
                                            ? 'Distribución válida. El subtotal quedó cubierto.'
                                            : 'La suma de medios todavía no cubre exactamente el subtotal de la venta.'}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* CALCULADORA DE VUELTO (Solo efectivo) */}
                        {((!isSplitPayment && activeMethod?.type === 'cash') || (isSplitPayment && splitPaymentSummary.cashCharged > 0)) && (
                            <div style={{
                                marginBottom: '1.5rem',
                                padding: '1rem',
                                background: 'rgba(34, 197, 94, 0.05)',
                                border: '1px dashed #22c55e',
                                borderRadius: 'var(--radius-md)'
                            }}>
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', color: '#22c55e', marginBottom: '0.3rem', fontWeight: '700' }}>ABONA CON:</label>
                                        <div style={{ position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontWeight: 'bold' }}>$</span>
                                            <input
                                                type="number"
                                                value={cashReceived}
                                                onChange={(e) => setCashReceived(e.target.value)}
                                                autoFocus
                                                style={{
                                                    width: '100%',
                                                    padding: '0.6rem 0.6rem 0.6rem 1.8rem',
                                                    fontSize: '1.2rem',
                                                    fontWeight: 'bold',
                                                    background: '#000',
                                                    border: '1px solid #22c55e',
                                                    borderRadius: '4px',
                                                    color: '#fff'
                                                }}
                                                placeholder="0"
                                            />
                                        </div>
                                    </div>
                                    <div style={{ flex: 1, textAlign: 'right' }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>
                                            {isSplitPayment ? 'EFECTIVO A CUBRIR:' : 'SU VUELTO:'}
                                        </label>
                                        <div style={{
                                            fontSize: '1.5rem',
                                            fontWeight: '800',
                                            color: isSplitPayment
                                                ? '#22c55e'
                                                : parseFloat(cashReceived) >= finalTotal ? '#22c55e' : '#666'
                                        }}>
                                            ${isSplitPayment
                                                ? formatNumericLocale(splitPaymentSummary.cashCharged, 'es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                                : parseFloat(cashReceived) >= finalTotal ? formatNumericLocale(parseFloat(cashReceived) - finalTotal) : '0'}
                                        </div>
                                        {isSplitPayment && (
                                            <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: splitPaymentSummary.cashReceivedValue >= splitPaymentSummary.cashCharged ? '#22c55e' : 'var(--color-text-muted)' }}>
                                                Vuelto: ${formatNumericLocale(splitPaymentSummary.cashChange, 'es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                                onClick={() => {
                                    setShowPaymentModal(false);
                                    resetPaymentState();
                                }}
                                style={{
                                    flex: 1,
                                    padding: '0.75rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    background: 'transparent',
                                    color: 'var(--color-text-main)',
                                    cursor: 'pointer'
                                }}>
                                Cancelar
                            </button>
                            <button
                                onClick={confirmPayment}
                                className="neo-button"
                                style={{ flex: 1, opacity: isProcessing ? 0.7 : 1 }}
                                disabled={isProcessing || (!isSplitPayment && !activeMethod)}
                            >
                                {isProcessing ? 'Procesando...' : 'Confirmar Pago'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL CONFIRMAR IMPRESIÓN (reemplaza confirm() nativo para no perder foco en Electron) */}
            {showPrintConfirmModal && (
                <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
                    <div className="modal-content neo-card" style={{ maxWidth: '360px', width: '90%', textAlign: 'center', padding: '2rem' }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🧾</div>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: '800', marginBottom: '0.5rem' }}>¡Venta registrada!</h2>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                            ¿Desea imprimir el ticket?
                        </p>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                autoFocus
                                onClick={() => handlePrintConfirm(false)}
                                style={{
                                    flex: 1,
                                    padding: '0.75rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    background: 'transparent',
                                    color: 'var(--color-text-main)',
                                    cursor: 'pointer',
                                    fontSize: '0.95rem'
                                }}
                            >
                                No, gracias
                            </button>
                            <button
                                onClick={() => handlePrintConfirm(true)}
                                className="neo-button"
                                style={{ flex: 1 }}
                            >
                                Imprimir 🖨️
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL CONFIGURACIÓN DE PRECIOS */}
            {editingPriceId && (
                <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="modal-content neo-card" style={{ maxWidth: '400px', width: '90%', padding: '2rem' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div style={{ padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '50%' }}>
                                <Tag size={24} color="#ef4444" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: '800', margin: 0 }}>Actualizar Precio</h2>
                                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: 0 }}>
                                    {products.find(p => p.id === editingPriceId)?.name}
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '2rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Precio por Kilo / Unidad</label>
                                <div style={{ position: 'relative' }}>
                                    <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 'bold', color: 'var(--color-primary)' }}>$</span>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={newPrice}
                                        onChange={e => {
                                            const val = e.target.value.replace(',', '.');
                                            // More permissive regex to allow typing (dot at end, etc)
                                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                setNewPrice(val);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                updatePrice(editingPriceId, newPrice, newPlu);
                                            } else if (e.key === 'Escape') {
                                                setEditingPriceId(null);
                                            }
                                        }}
                                        ref={priceInputRef}
                                        onFocus={e => e.target.select()}
                                        placeholder="0.00"
                                        id="modal-price-input"
                                        style={{
                                            width: '100%',
                                            padding: '1rem 1rem 1rem 2.2rem',
                                            fontSize: '1.5rem',
                                            fontWeight: '800',
                                            background: 'var(--color-bg-main)',
                                            border: '2px solid var(--color-primary)',
                                            borderRadius: 'var(--radius-md)',
                                            color: 'var(--color-text-main)'
                                        }}
                                    />
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Código PLU (Para la Balanza)</label>
                                <input
                                    type="text"
                                    value={newPlu}
                                    onChange={e => setNewPlu(e.target.value)}
                                    placeholder="Ej: 101"
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem 1rem',
                                        fontSize: '1.1rem',
                                        background: 'var(--color-bg-main)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-md)',
                                        color: 'var(--color-text-main)'
                                    }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                onClick={() => setEditingPriceId(null)}
                                style={{
                                    flex: 1,
                                    padding: '1rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    background: 'transparent',
                                    color: 'var(--color-text-main)',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => updatePrice(editingPriceId, newPrice, newPlu)}
                                className="neo-button"
                                style={{
                                    flex: 1,
                                    padding: '1rem',
                                    fontSize: '1rem',
                                    fontWeight: '800'
                                }}
                            >
                                Guardar Precio
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL CREACIÓN RÁPIDA DE PRODUCTO */}
            {showQuickCreateModal && pendingBarcode && (
                <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="modal-content neo-card" style={{ maxWidth: '500px', width: '90%', padding: '2rem' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div style={{ padding: '0.75rem', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '50%' }}>
                                <ShoppingBag size={24} color="#22c55e" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: '800', margin: 0 }}>Producto Nuevo Detectado</h2>
                                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: 0 }}>
                                    PLU: {pendingBarcode.plu} • Peso: {pendingBarcode.weight}kg
                                </p>
                            </div>
                        </div>

                        <div style={{ background: 'rgba(34, 197, 94, 0.05)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
                            <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: '1.5' }}>
                                📦 Este producto no está en tu catálogo. Completá los datos para crearlo automáticamente y agregarlo al carrito.
                            </p>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '2rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Nombre del Producto</label>
                                <input
                                    autoFocus
                                    type="text"
                                    value={quickProductName}
                                    onChange={e => setQuickProductName(e.target.value)}
                                    placeholder="Ej: Bola de Lomo"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            document.getElementById('quick-price-input')?.focus();
                                        }
                                    }}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem 1rem',
                                        fontSize: '1.1rem',
                                        background: 'var(--color-bg-main)',
                                        border: '2px solid var(--color-border)',
                                        borderRadius: 'var(--radius-md)',
                                        color: 'var(--color-text-main)'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Precio por Kilo</label>
                                <div style={{ position: 'relative' }}>
                                    <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', fontWeight: 'bold', color: 'var(--color-primary)' }}>$</span>
                                    <input
                                        id="quick-price-input"
                                        type="text"
                                        inputMode="decimal"
                                        value={quickProductPrice}
                                        onChange={e => {
                                            const val = e.target.value.replace(',', '.');
                                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                setQuickProductPrice(val);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                handleQuickCreateProduct();
                                            }
                                        }}
                                        placeholder="0.00"
                                        style={{
                                            width: '100%',
                                            padding: '1rem 1rem 1rem 2.2rem',
                                            fontSize: '1.5rem',
                                            fontWeight: '800',
                                            background: 'var(--color-bg-main)',
                                            border: '2px solid var(--color-primary)',
                                            borderRadius: 'var(--radius-md)',
                                            color: 'var(--color-text-main)'
                                        }}
                                    />
                                </div>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Categoría</label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                                    {['vaca', 'cerdo', 'pollo'].map(cat => (
                                        <button
                                            key={cat}
                                            onClick={() => setQuickProductCategory(cat)}
                                            style={{
                                                padding: '0.75rem',
                                                borderRadius: 'var(--radius-md)',
                                                border: quickProductCategory === cat ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                background: quickProductCategory === cat ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-bg-card)',
                                                color: 'var(--color-text-main)',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                                fontWeight: '600',
                                                textTransform: 'capitalize'
                                            }}
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                onClick={() => {
                                    setShowQuickCreateModal(false);
                                    setPendingBarcode(null);
                                    setTimeout(() => { if (!isEditingPriceRef.current) barcodeInputRef.current?.focus(); }, 50);
                                }}
                                style={{
                                    flex: 1,
                                    padding: '1rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    background: 'transparent',
                                    color: 'var(--color-text-main)',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleQuickCreateProduct}
                                className="neo-button"
                                style={{
                                    flex: 2,
                                    padding: '1rem',
                                    fontSize: '1rem',
                                    fontWeight: '800'
                                }}
                            >
                                ✅ Crear y Agregar al Carrito
                            </button>
                        </div>
                    </div>
                </div>
            )}

        {/* ── Modal de diagnóstico de balanza ────────────────────────────── */}
        {showScaleDiag && (
            <div style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
            }}>
                <div style={{
                    background: '#1e1e2e', borderRadius: '12px', padding: '1.5rem',
                    width: '480px', maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                    fontFamily: 'monospace', border: '1px solid #3b3b52'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 700, color: '#e2e8f0', fontFamily: 'sans-serif' }}>⚖️ Diagnóstico de Balanza</span>
                        <button onClick={() => setShowScaleDiag(false)} style={{
                            background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem'
                        }}>✕</button>
                    </div>

                    <div style={{
                        background: '#0f0f1a', borderRadius: '8px', padding: '1rem',
                        minHeight: '160px', maxHeight: '320px', overflowY: 'auto',
                        display: 'flex', flexDirection: 'column', gap: '0.5rem'
                    }}>
                        {scaleDiagLog.length === 0 && (
                            <span style={{ color: '#4a4a6a', fontSize: '0.8rem' }}>Esperando...</span>
                        )}
                        {scaleDiagLog.map((entry, i) => {
                            const colors = { info: '#60a5fa', success: '#4ade80', error: '#f87171', warn: '#fbbf24' };
                            const icons  = { info: 'ℹ', success: '✔', error: '✘', warn: '⚠' };
                            return (
                                <div key={i} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', lineHeight: 1.4 }}>
                                    <span style={{ color: '#4a4a6a', minWidth: '58px' }}>{entry.time}</span>
                                    <span style={{ color: colors[entry.type] || '#e2e8f0', minWidth: '14px' }}>{icons[entry.type]}</span>
                                    <span style={{ color: '#cbd5e1' }}>{entry.msg}</span>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => setShowScaleDiag(false)} style={{
                            background: '#3b82f6', color: '#fff', border: 'none',
                            borderRadius: '8px', padding: '0.5rem 1.2rem',
                            cursor: 'pointer', fontFamily: 'sans-serif', fontWeight: 600
                        }}>Cerrar</button>
                    </div>
                </div>
            </div>
        )}
        {/* ─── Modal Visor Tickets QENDRA ──────────────────────────────────── */}
        {showQendraVisor && (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                backgroundColor: 'rgba(0,0,0,0.75)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <div style={{
                    background: 'var(--color-bg-card)',
                    borderRadius: 16, padding: '1.5rem',
                    width: 'min(900px, 96vw)', maxHeight: '85vh',
                    display: 'flex', flexDirection: 'column', gap: '0.75rem',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                }}>
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>🎫 Visor de Tickets QENDRA</h2>
                        <button onClick={() => setShowQendraVisor(false)}
                            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                    </div>

                    {/* Tabs */}
                    {(() => {
                        const cobradosIds = new Set(qendraVisorCobrados.map(v => String(v.qendra_ticket_id)));
                        const pendientesList = qendraVisorTickets.filter(t => !cobradosIds.has(String(t.ID_TICKET)));
                        const tabBtn = (tab, label, count) => (
                            <button onClick={() => setQendraVisorTab(tab)} style={{
                                padding: '0.5rem 1.2rem', fontWeight: 700, cursor: 'pointer',
                                borderRadius: '8px 8px 0 0', border: 'none',
                                backgroundColor: qendraVisorTab === tab ? 'var(--color-primary)' : 'transparent',
                                color: qendraVisorTab === tab ? '#fff' : 'var(--color-text-muted)',
                                borderBottom: qendraVisorTab === tab ? 'none' : '2px solid var(--color-border)',
                            }}>{label} ({count})</button>
                        );
                        return (
                            <>
                                <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid var(--color-border)' }}>
                                    {tabBtn('pendientes', '⏳ Pendientes', pendientesList.length)}
                                    {tabBtn('cobrados', '✅ Cobrados hoy', qendraVisorCobrados.length)}
                                    <button onClick={handleOpenQendraVisor}
                                        style={{ marginLeft: 'auto', padding: '0.4rem 0.8rem', border: '1px solid var(--color-border)', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                                        🔄 Actualizar
                                    </button>
                                </div>

                                {/* Content */}
                                <div style={{ overflowY: 'auto', flex: 1 }}>
                                    {qendraVisorLoading ? (
                                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                            ⏳ Conectando con QENDRA…
                                        </div>
                                    ) : qendraVisorTab === 'pendientes' ? (
                                        pendientesList.length === 0 ? (
                                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                                No hay tickets pendientes en las últimas 8 horas.
                                            </div>
                                        ) : pendientesList.map(ticket => {
                                            const fecha = ticket.FECHA ? new Date(ticket.FECHA) : null;
                                            const hora = fecha ? fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—';
                                            const esActivo = String(ticket.ID_TICKET) === String(qendraActiveTicketId);
                                            return (
                                                <div key={ticket.ID_TICKET} style={{
                                                    border: esActivo ? '2px solid #34d399' : '1px solid var(--color-border)',
                                                    borderRadius: 10, padding: '0.8rem',
                                                    marginBottom: '0.6rem',
                                                    background: esActivo ? 'rgba(52,211,153,0.07)' : 'var(--color-bg-main)',
                                                }}>
                                                    {/* Ticket Header */}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                                        <div>
                                                            <span style={{ fontWeight: 700, fontSize: '1rem' }}>
                                                                #{ticket.ID_TICKET}
                                                            </span>
                                                            <span style={{ marginLeft: 10, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                                                                {hora}
                                                            </span>
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                            <span style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-primary)' }}>
                                                                ${parseFloat(ticket.TOTAL || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                            </span>
                                                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                                                                {parseFloat(ticket.KG_TOTAL || 0).toFixed(3)} kg
                                                            </span>
                                                            <button
                                                                onClick={() => handleLoadQendraTicket(ticket)}
                                                                disabled={esActivo}
                                                                style={{
                                                                    padding: '0.35rem 0.9rem', fontWeight: 700, cursor: esActivo ? 'default' : 'pointer',
                                                                    backgroundColor: esActivo ? '#34d399' : 'var(--color-primary)',
                                                                    color: '#fff', border: 'none', borderRadius: 8,
                                                                    opacity: esActivo ? 0.8 : 1,
                                                                }}>
                                                                {esActivo ? '✓ En carrito' : '📤 Cargar'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {/* Items del ticket */}
                                                    {ticket.items.length > 0 && (
                                                        <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                                            {ticket.items.map((it, i) => (
                                                                <span key={i} style={{
                                                                    background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
                                                                    borderRadius: 6, padding: '0.2rem 0.5rem', fontSize: '0.8rem',
                                                                }}>
                                                                    {`PLU ${it.ID_PLU}`}
                                                                    {' — '}
                                                                    {parseFloat(it.PESO_KG || 0).toFixed(3)} kg
                                                                    {' — '}
                                                                    ${parseFloat(it.IMPORTE || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        /* TAB COBRADOS */
                                        qendraVisorCobrados.length === 0 ? (
                                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                                No se cobraron tickets QENDRA hoy todavía.
                                            </div>
                                        ) : qendraVisorCobrados.map(v => {
                                            const fecha = v.date ? new Date(v.date) : null;
                                            const hora = fecha ? fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—';
                                            return (
                                                <div key={v.id} style={{
                                                    border: '1px solid var(--color-border)', borderRadius: 10,
                                                    padding: '0.7rem 1rem', marginBottom: '0.5rem',
                                                    background: 'rgba(34,197,94,0.05)',
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                }}>
                                                    <div>
                                                        <span style={{ fontWeight: 700 }}>#{v.qendra_ticket_id}</span>
                                                        <span style={{ marginLeft: 10, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                                                            {hora} · {v.payment_method}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                        <span style={{ fontWeight: 700, color: '#22c55e', fontSize: '1.05rem' }}>
                                                            ${parseFloat(v.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                                                        </span>
                                                        <span style={{
                                                            background: 'rgba(34,197,94,0.1)', color: '#22c55e',
                                                            borderRadius: 6, padding: '0.15rem 0.5rem', fontSize: '0.77rem', fontWeight: 700,
                                                        }}>✅ COBRADO</span>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </>
                        );
                    })()}
                </div>
            </div>
        )}
        {/* ─────────────────────────────────────────────────────────────────── */}

        {/* ─── MODAL ELIMINAR TICKET ────────────────────────────────────────────── */}
        {showDeleteTicketModal && (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                backgroundColor: 'rgba(0,0,0,0.75)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }} onClick={() => setShowDeleteTicketModal(false)}>
                <div style={{
                    background: 'var(--color-bg-card)',
                    borderRadius: 16, padding: '1.5rem',
                    width: 'min(520px, 96vw)', maxHeight: '80vh',
                    display: 'flex', flexDirection: 'column', gap: '1rem',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                }} onClick={e => e.stopPropagation()}>

                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>🗑️ Eliminar Ticket</h2>
                            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                Tickets recientes — {recentSales?.length || 0} registrados
                            </p>
                        </div>
                        <button
                            onClick={() => setShowDeleteTicketModal(false)}
                            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1 }}
                        >✕</button>
                    </div>

                    {/* Buscador */}
                    <input
                        type="text"
                        placeholder="Buscar por comprobante, total o medio de pago..."
                        value={deleteTicketSearch}
                        onChange={e => { setDeleteTicketSearch(e.target.value); setConfirmDeleteTicketId(null); setDeleteAuthorizationCode(''); }}
                        autoFocus
                        style={{
                            padding: '0.6rem 0.9rem',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-bg-main)',
                            color: 'var(--color-text-main)',
                            fontSize: '0.9rem',
                        }}
                    />

                    {/* Lista */}
                    <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {filteredRecentSales.length === 0 && (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                                No se encontraron tickets con ese criterio.
                            </div>
                        )}
                        {filteredRecentSales.map(s => (
                            <div key={s.id} style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '0.65rem 0.9rem',
                                background: confirmDeleteTicketId === s.id ? 'rgba(239,68,68,0.07)' : 'var(--color-bg-main)',
                                border: confirmDeleteTicketId === s.id ? '1px solid rgba(239,68,68,0.4)' : '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                gap: '0.75rem',
                                transition: 'all 0.15s',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                                    <span style={{ fontWeight: '700', fontSize: '0.95rem' }}>
                                        #{s.receipt_code || formatReceiptCode(1, s.receipt_number || s.id)}
                                    </span>
                                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                                        {new Date(s.date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    {s.payment_method && (
                                        <span style={{
                                            background: 'var(--color-bg-card)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: '999px',
                                            padding: '0.1rem 0.5rem',
                                            fontSize: '0.75rem',
                                            color: 'var(--color-text-muted)',
                                        }}>{s.payment_method}</span>
                                    )}
                                    {s.source === 'qendra' && (
                                        <span style={{ fontSize: '0.72rem', background: '#3b82f6', color: '#fff', borderRadius: '4px', padding: '0 5px' }}>QENDRA</span>
                                    )}
                                    {/* Resumen de ítems en una sola línea */}
                                    {recentSalesItems?.[s.id]?.length > 0 && (
                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                            {recentSalesItems[s.id].map(i => i.product_name).join(', ')}
                                        </span>
                                    )}
                                </div>
                                <span style={{ fontWeight: '800', color: '#22c55e', fontSize: '1rem', whiteSpace: 'nowrap' }}>
                                    ${toNumber(s.total).toLocaleString('es-AR')}
                                </span>
                                {confirmDeleteTicketId === s.id ? (
                                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                        <input
                                            type="password"
                                            inputMode="numeric"
                                            value={deleteAuthorizationCode}
                                            onChange={(e) => setDeleteAuthorizationCode(e.target.value.replace(/\D/g, '').slice(0, 12))}
                                            placeholder="Código maestro"
                                            style={{
                                                width: '150px',
                                                padding: '0.45rem 0.65rem',
                                                borderRadius: '6px',
                                                border: '1px solid rgba(239,68,68,0.35)',
                                                background: 'var(--color-bg-card)',
                                                color: 'var(--color-text-main)',
                                                fontSize: '0.82rem'
                                            }}
                                        />
                                        <button onClick={() => handleDeleteTicket(s.id)}
                                            style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: 'pointer', fontWeight: '700', fontSize: '0.82rem' }}>
                                            Confirmar
                                        </button>
                                        <button onClick={() => { setConfirmDeleteTicketId(null); setDeleteAuthorizationCode(''); }}
                                            style={{ background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '0.35rem 0.6rem', cursor: 'pointer', fontSize: '0.82rem' }}>
                                            Cancelar
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={() => { setConfirmDeleteTicketId(s.id); setDeleteAuthorizationCode(''); }} title="Eliminar ticket"
                                        style={{ background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', padding: '0.3rem 0.55rem', flexShrink: 0 }}>
                                        <Trash2 size={15} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {/* ─── MODAL PREVIEW TICKET MULTI-ITEM (balanza) ──────────────────── */}
        {showTicketPreview && (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                backgroundColor: 'rgba(0,0,0,0.75)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }} onClick={() => setShowTicketPreview(false)}>
                <div style={{
                    background: 'var(--color-bg-card)',
                    borderRadius: 16, padding: '1.5rem',
                    width: 'min(540px, 96vw)', maxHeight: '82vh',
                    display: 'flex', flexDirection: 'column', gap: '1rem',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                }} onClick={e => e.stopPropagation()}>

                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>🏷️ Ticket escaneado</h2>
                            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                {ticketPreviewItems.length} item(s) detectados · Revisá el estado antes de agregar al carrito
                            </p>
                        </div>
                        <button onClick={() => setShowTicketPreview(false)}
                            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1 }}>✕</button>
                    </div>

                    {/* Lista de items */}
                    <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {ticketPreviewItems.map((item, idx) => {
                            const notConfigured = !item.priceRecord || !item.product;
                            const noStock = !notConfigured && item.product.totalQuantity <= 0;
                            const ok = !notConfigured && !noStock;

                            return (
                                <div key={idx} style={{
                                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                                    padding: '0.7rem 0.9rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: `1px solid ${notConfigured ? '#ef4444' : noStock ? '#f59e0b' : 'var(--color-border)'}`,
                                    background: notConfigured ? 'rgba(239,68,68,0.05)' : noStock ? 'rgba(245,158,11,0.05)' : 'var(--color-bg-main)',
                                }}>
                                    {/* Ícono de estado */}
                                    <div style={{ flexShrink: 0 }}>
                                        {notConfigured && <PackageX size={20} color="#ef4444" />}
                                        {noStock     && <AlertTriangle size={20} color="#f59e0b" />}
                                        {ok          && <PackageCheck size={20} color="#22c55e" />}
                                    </div>

                                    {/* Info del producto */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: '700', fontSize: '0.95rem', color: notConfigured ? '#ef4444' : 'var(--color-text-main)' }}>
                                            {item.product ? item.product.name : `PLU ${item.plu}`}
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
                                            {notConfigured
                                                ? '❌ No configurado en el sistema — ir a Stock a cargarlo'
                                                : noStock
                                                    ? `⚠️ Sin stock disponible (${toNumber(item.product.totalQuantity).toFixed(3)} ${item.product.unit}) — verificá en Stock`
                                                    : `✅ Stock disponible: ${toNumber(item.product.totalQuantity).toFixed(3)} ${item.product.unit}`
                                            }
                                        </div>
                                    </div>

                                    {/* Peso y precio */}
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontWeight: '700', fontSize: '0.95rem' }}>{toNumber(item.weight).toFixed(3)} kg</div>
                                        {item.priceRecord && (
                                            <div style={{ fontSize: '0.78rem', color: '#22c55e' }}>
                                                ${(toNumber(item.priceRecord?.price) * toNumber(item.weight)).toLocaleString('es-AR')}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Resumen de problemas */}
                    {ticketPreviewItems.some(i => !i.priceRecord || !i.product) && (
                        <div style={{
                            padding: '0.75rem 1rem',
                            background: 'rgba(239,68,68,0.08)',
                            border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '0.82rem',
                            color: '#ef4444',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem',
                        }}>
                            <span>
                                ⚠️ {ticketPreviewItems.filter(i => !i.priceRecord || !i.product).length} producto(s) no configurado(s).
                                Parece que alguien olvidó importar el artículo desde la app de la balanza.
                            </span>
                            <button
                                onClick={() => { setShowTicketPreview(false); navigate('/stock'); }}
                                style={{
                                    flexShrink: 0,
                                    padding: '0.4rem 0.9rem',
                                    background: '#ef4444', color: '#fff',
                                    border: 'none', borderRadius: '6px',
                                    cursor: 'pointer', fontWeight: '700', fontSize: '0.8rem',
                                }}
                            >Ir a Stock →</button>
                        </div>
                    )}

                    {/* Botones de acción */}
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        <button
                            onClick={() => setShowTicketPreview(false)}
                            style={{
                                flex: 1, padding: '0.75rem',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                background: 'transparent', color: 'var(--color-text-main)',
                                cursor: 'pointer', fontWeight: '600',
                            }}
                        >Cancelar</button>
                        <button
                            onClick={() => {
                                const toAdd = ticketPreviewItems.filter(i => i.priceRecord && i.product);
                                toAdd.forEach(i => addToCart({ ...i.product, price: i.priceRecord.price }, i.weight));
                                setShowTicketPreview(false);
                                if (toAdd.length < ticketPreviewItems.length) {
                                    setScannerError(`✅ ${toAdd.length} agregado(s). ${ticketPreviewItems.length - toAdd.length} no configurado(s) — revisá Stock.`);
                                    setTimeout(() => setScannerError(''), 4000);
                                }
                            }}
                            disabled={!ticketPreviewItems.some(i => i.priceRecord && i.product)}
                            className="neo-button"
                            style={{ flex: 2, padding: '0.75rem', fontWeight: '800', fontSize: '0.95rem' }}
                        >
                            ✅ Agregar al carrito ({ticketPreviewItems.filter(i => i.priceRecord && i.product).length} items)
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
};

export default Ventas;
