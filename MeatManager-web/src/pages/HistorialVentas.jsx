import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Receipt, Search } from 'lucide-react';
import { fetchTable } from '../utils/apiClient';

const formatCurrency = (amount) =>
    new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        maximumFractionDigits: 0,
    }).format(Number(amount) || 0);

const normalize = (value) => String(value || '').toLowerCase().trim();
const formatDocumentNumber = (value, digits = 4) => String(Number(value) || 0).padStart(digits, '0');
const formatReceiptCode = (branchCode, value) => `${formatDocumentNumber(branchCode, 4)}-${formatDocumentNumber(value, 6)}`;
const normalizePaymentMethodLabel = (value) => {
    const raw = String(value || '').trim();
    const lower = raw.toLowerCase();
    if (lower.includes('postnet') || lower.includes('posnet')) return 'Postnet';
    if (lower.includes('mercado pago')) return 'Mercado Pago';
    if (lower.includes('cuenta dni')) return 'Cuenta DNI';
    if (lower.includes('cuenta corriente')) return 'Cuenta Corriente';
    if (lower.includes('mixto') || lower.includes('mixed')) return 'Pago Mixto';
    if (lower.includes('efectivo')) return 'Efectivo';
    return raw || 'Sin método';
};
const parsePaymentBreakdown = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

const isDigitalPaymentLabel = (value) => {
    const label = normalizePaymentMethodLabel(value).toLowerCase();
    return (
        label === 'mercado pago'
        || label === 'cuenta dni'
        || label === 'postnet'
        || label.includes('transferencia')
    );
};

const HistorialVentas = () => {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [sales, setSales] = useState([]);
    const [paymentFilterMode, setPaymentFilterMode] = useState('all');

    React.useEffect(() => {
        const loadSales = async () => {
            const [salesRows, salesItemsRows] = await Promise.all([
                fetchTable('ventas', { orderBy: 'date', direction: 'desc' }),
                fetchTable('ventas_items'),
            ]);
            const grouped = {};
            for (const item of Array.isArray(salesItemsRows) ? salesItemsRows : []) {
                const ventaId = Number(item.venta_id);
                if (!grouped[ventaId]) grouped[ventaId] = [];
                grouped[ventaId].push(item);
            }
            setSales((Array.isArray(salesRows) ? salesRows : []).map((sale) => ({
                ...sale,
                items: grouped[Number(sale.id)] || [],
            })));
        };

        loadSales().catch((error) => console.error('Error cargando historial de ventas:', error));
    }, []);

    React.useEffect(() => {
        const handleHiddenShortcuts = (e) => {
            if (!(e.ctrlKey && e.shiftKey)) return;

            const key = String(e.key || '').toLowerCase();
            if (key === 'd') {
                e.preventDefault();
                setPaymentFilterMode('digital');
            }
            if (key === 't') {
                e.preventDefault();
                setPaymentFilterMode('all');
            }
        };

        window.addEventListener('keydown', handleHiddenShortcuts);
        return () => window.removeEventListener('keydown', handleHiddenShortcuts);
    }, []);

    const filteredSales = useMemo(() => {
        const term = normalize(search);
        return sales.filter((sale) => {
            const paymentBreakdown = parsePaymentBreakdown(sale.payment_breakdown);
            const paymentRows = paymentBreakdown.length > 0
                ? paymentBreakdown
                    .map((part) => ({
                        method: normalizePaymentMethodLabel(part.method_name || part.method_type),
                        amount: Number(part.amount_charged ?? part.amount ?? 0) || 0,
                    }))
                    .filter((row) => row.amount > 0)
                : [{
                    method: normalizePaymentMethodLabel(sale.payment_method),
                    amount: Number(sale.total) || 0,
                }];

            const matchesPaymentFilter = paymentFilterMode !== 'digital'
                || (paymentRows.length > 0 && paymentRows.every((row) => isDigitalPaymentLabel(row.method)));

            if (!matchesPaymentFilter) return false;
            if (!term) return true;

            const receiptCode = sale.receipt_code || formatReceiptCode(1, sale.receipt_number || sale.id);
            const itemNames = (sale.items || []).map((item) => item.product_name).join(' ');
            const paymentBreakdownText = paymentBreakdown
                .map((part) => `${part.method_name || part.method_type || ''} ${part.amount_charged || part.amount || ''}`)
                .join(' ');
            return [
                receiptCode,
                sale.payment_method,
                paymentBreakdownText,
                sale.source,
                sale.total,
                itemNames,
            ].some((value) => normalize(value).includes(term));
        });
    }, [paymentFilterMode, sales, search]);

    return (
        <div className="animate-fade-in">
            <header className="page-header" style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        style={{
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-bg-card)',
                            color: 'var(--color-text-main)',
                            borderRadius: '10px',
                            padding: '0.55rem 0.8rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                        }}
                    >
                        <ArrowLeft size={16} />
                        Volver
                    </button>
                    
                </div>
            </header>

            <section style={{
                backgroundColor: 'var(--color-bg-card)',
                padding: '1.5rem',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--color-text-muted)' }}>
                        <Receipt size={18} />
                        <span>{filteredSales.length} venta{filteredSales.length !== 1 ? 's' : ''}</span>
                    </div>

                    <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        background: 'var(--color-bg-main)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '10px',
                        padding: '0.65rem 0.85rem',
                        minWidth: '280px',
                        flex: '1 1 320px',
                    }}>
                        <Search size={16} color="var(--color-text-muted)" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar por comprobante, pago, total o producto..."
                            style={{
                                width: '100%',
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                color: 'var(--color-text-main)',
                            }}
                        />
                    </label>
                </div>

                {filteredSales.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '2rem 0' }}>
                        No hay ventas para mostrar con ese criterio.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {filteredSales.map((sale) => {
                            const receiptCode = sale.receipt_code || formatReceiptCode(1, sale.receipt_number || sale.id);
                            const saleDate = new Date(sale.date);
                            const paymentBreakdown = parsePaymentBreakdown(sale.payment_breakdown);
                            const paymentRows = paymentBreakdown.length > 0
                                ? paymentBreakdown
                                    .map((part) => ({
                                        method: normalizePaymentMethodLabel(part.method_name || part.method_type),
                                        amount: Number(part.amount_charged ?? part.amount ?? 0) || 0,
                                    }))
                                    .filter((row) => row.amount > 0)
                                : [{
                                    method: normalizePaymentMethodLabel(sale.payment_method),
                                    amount: Number(sale.total) || 0,
                                }];
                            return (
                                <article
                                    key={sale.id}
                                    style={{
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '14px',
                                        padding: '1rem',
                                        background: 'var(--color-bg-main)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                        <div>
                                            <div style={{ fontWeight: 700, color: 'var(--color-text-main)' }}>
                                                Venta {receiptCode}
                                            </div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                                {saleDate.toLocaleDateString('es-AR')} {saleDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>

                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--color-text-main)' }}>
                                                {formatCurrency(sale.total)}
                                            </div>
                                            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                                                {normalizePaymentMethodLabel(sale.payment_method)}
                                            </div>
                                        </div>
                                    </div>

                                    <div style={{
                                        marginBottom: '0.75rem',
                                        padding: '0.55rem 0.65rem',
                                        borderRadius: '10px',
                                        border: '1px solid var(--color-border)',
                                        background: 'rgba(255,255,255,0.02)',
                                        display: 'grid',
                                        gap: '0.3rem',
                                    }}>
                                        <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                                            Desglose de cobro
                                        </div>
                                        {paymentRows.map((row, index) => (
                                            <div
                                                key={`${sale.id}-payment-${row.method}-${index}`}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    gap: '0.7rem',
                                                    fontSize: '0.84rem',
                                                    color: 'var(--color-text-main)',
                                                }}
                                            >
                                                <span>{row.method}</span>
                                                <strong>{formatCurrency(row.amount)}</strong>
                                            </div>
                                        ))}
                                    </div>

                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                        <span style={{
                                            fontSize: '0.78rem',
                                            padding: '0.2rem 0.55rem',
                                            borderRadius: '999px',
                                            border: '1px solid var(--color-border)',
                                            color: 'var(--color-text-muted)',
                                        }}>
                                            {sale.items?.length || 0} producto{(sale.items?.length || 0) !== 1 ? 's' : ''}
                                        </span>
                                        {sale.source && (
                                            <span style={{
                                                fontSize: '0.78rem',
                                                padding: '0.2rem 0.55rem',
                                                borderRadius: '999px',
                                                background: sale.source === 'qendra' ? '#1d4ed8' : 'rgba(255,255,255,0.05)',
                                                color: sale.source === 'qendra' ? '#fff' : 'var(--color-text-muted)',
                                            }}>
                                                {sale.source}
                                            </span>
                                        )}
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.35rem' }}>
                                        {(sale.items || []).map((item) => (
                                            <div
                                                key={item.id}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    gap: '1rem',
                                                    fontSize: '0.9rem',
                                                    color: 'var(--color-text-muted)',
                                                }}
                                            >
                                                <span>{item.product_name}</span>
                                                <span>
                                                    {Number(item.quantity || 0).toFixed(3)} x {formatCurrency(item.price)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
};

export default HistorialVentas;
