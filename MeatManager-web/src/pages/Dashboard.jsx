import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLicense } from '../context/LicenseContext';
import { isEffectiveAdminUser, useUser } from '../context/UserContext';
import { fetchTable } from '../utils/apiClient';
import { Banknote, ShoppingCart, TrendingUp, AlertTriangle, Wallet, Crown, BarChart3 } from 'lucide-react';
import './Dashboard.css';

const toNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const formatReceiptCode = (branchNumber = 1, receiptNumber = 0) =>
    `${String(branchNumber || 1).padStart(4, '0')}-${String(receiptNumber || 0).padStart(6, '0')}`;

const revealVariants = {
    left: {
        initial: { opacity: 0, x: -90, scale: 0.88 },
        animate: { opacity: 1, x: 0, scale: 1 },
    },
    right: {
        initial: { opacity: 0, x: 90, scale: 0.88 },
        animate: { opacity: 1, x: 0, scale: 1 },
    },
    up: {
        initial: { opacity: 0, y: -70, scale: 0.9 },
        animate: { opacity: 1, y: 0, scale: 1 },
    },
    down: {
        initial: { opacity: 0, y: 70, scale: 0.9 },
        animate: { opacity: 1, y: 0, scale: 1 },
    },
};

const DashboardReveal = ({ from = 'up', delay = 0, className = '', children, style = {} }) => (
    <motion.div
        data-mm-local-motion="true"
        className={className}
        style={style}
        initial={revealVariants[from].initial}
        animate={revealVariants[from].animate}
        transition={{
            duration: 0.52,
            delay,
            ease: [0.22, 1, 0.36, 1],
        }}
    >
        {children}
    </motion.div>
);

const Dashboard = () => {
    const navigate = useNavigate();
    const { currentUser, accessProfile } = useUser();
    const { hasModule } = useLicense();
    const isAdmin = isEffectiveAdminUser(currentUser, accessProfile);
    const [selectedRemoteBranch, setSelectedRemoteBranch] = useState('all');
    const [ventasDia, setVentasDia] = useState([]);
    const [allVentas, setAllVentas] = useState([]);
    const [comprasMes, setComprasMes] = useState([]);
    const [stockItems, setStockItems] = useState([]);
    const [clients, setClients] = useState([]);
    const [proLogs, setProLogs] = useState([]);
    const [branchSnapshots, setBranchSnapshots] = useState([]);

    useEffect(() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);

        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        let cancelled = false;

        const loadDashboard = async () => {
            try {
                const [ventasRows, ventasItemsRows, comprasRows, stockRows, clientRows, logRows, snapshotRows] = await Promise.all([
                    fetchTable('ventas', { limit: 5000, orderBy: 'date', direction: 'DESC' }),
                    fetchTable('ventas_items', { limit: 10000, orderBy: 'id', direction: 'DESC' }),
                    fetchTable('compras', { limit: 5000, orderBy: 'date', direction: 'DESC' }),
                    fetchTable('stock', { limit: 5000, orderBy: 'updated_at', direction: 'DESC' }),
                    fetchTable('clients', { limit: 5000, orderBy: 'id', direction: 'ASC' }),
                    fetchTable('despostada_logs', { limit: 5000, orderBy: 'date', direction: 'DESC' }),
                    fetchTable('branch_stock_snapshots', { limit: 5000, orderBy: 'snapshot_at', direction: 'DESC' }),
                ]);

                if (cancelled) return;

                const salesList = Array.isArray(ventasRows) ? ventasRows : [];
                const saleItems = Array.isArray(ventasItemsRows) ? ventasItemsRows : [];
                const itemsBySaleId = new Map();
                saleItems.forEach((item) => {
                    const key = Number(item.venta_id);
                    const list = itemsBySaleId.get(key) || [];
                    list.push(item);
                    itemsBySaleId.set(key, list);
                });

                setVentasDia(
                    salesList.filter((sale) => {
                        const saleDate = new Date(sale.date);
                        return saleDate >= start && saleDate <= end;
                    })
                );
                setAllVentas(
                    salesList
                        .slice()
                        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
                        .slice(0, 5)
                        .map((sale) => ({
                            ...sale,
                            items: Array.isArray(sale.items) ? sale.items : (itemsBySaleId.get(Number(sale.id)) || []),
                        }))
                );
                setComprasMes((Array.isArray(comprasRows) ? comprasRows : []).filter((compra) => new Date(compra.date) >= monthStart));
                setStockItems(Array.isArray(stockRows) ? stockRows : []);
                setClients(Array.isArray(clientRows) ? clientRows : []);
                setProLogs(Array.isArray(logRows) ? logRows : []);
                setBranchSnapshots(Array.isArray(snapshotRows) ? snapshotRows : []);
            } catch (error) {
                if (!cancelled) {
                    console.error('[DASHBOARD] No se pudieron cargar métricas desde la API', error);
                    setVentasDia([]);
                    setAllVentas([]);
                    setComprasMes([]);
                    setStockItems([]);
                    setClients([]);
                    setProLogs([]);
                    setBranchSnapshots([]);
                }
            }
        };

        loadDashboard();
        return () => {
            cancelled = true;
        };
    }, []);

    const totalVentasDia = ventasDia.reduce((acc, sale) => acc + toNumber(sale.total), 0);
    const totalComprasMes = comprasMes.reduce((acc, compra) => acc + toNumber(compra.total), 0);
    const totalStockKg = stockItems.reduce((acc, item) => (
        String(item.unit || '').toLowerCase() === 'kg' ? acc + toNumber(item.quantity) : acc
    ), 0);
    const lowStockCount = stockItems.filter((item) => toNumber(item.quantity) < 10).length;
    const totalDeudaCalle = clients.reduce((acc, client) => {
        const balance = toNumber(client.balance);
        return balance < 0 ? acc + Math.abs(balance) : acc;
    }, 0);
    const avgYield = proLogs.length > 0
        ? (proLogs.reduce((acc, log) => acc + toNumber(log.yield_percentage), 0) / proLogs.length)
        : 0;

    const filteredBranchSnapshots = branchSnapshots.filter((snapshot) => selectedRemoteBranch === 'all' || snapshot.branch_code === selectedRemoteBranch);
    const remoteBranchCount = filteredBranchSnapshots.length;
    const remoteTotalKg = filteredBranchSnapshots.reduce((acc, snapshot) => acc + toNumber(snapshot.total_kg), 0);
    const remoteLowStock = filteredBranchSnapshots.reduce((acc, snapshot) => acc + toNumber(snapshot.low_stock_count), 0);
    const remoteSalesToday = filteredBranchSnapshots.reduce((acc, snapshot) => acc + toNumber(snapshot.sales_today_total), 0);
    const remotePurchasesMonth = filteredBranchSnapshots.reduce((acc, snapshot) => acc + toNumber(snapshot.purchases_month_total), 0);
    const remoteCashInDrawer = filteredBranchSnapshots.reduce((acc, snapshot) => acc + toNumber(snapshot.cash_in_drawer_total), 0);

    const formatCurrency = (amount) =>
        new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(toNumber(amount));

    return (
        <div className="dashboard-page animate-fade-in">
            <header className="page-header">
                
                </header>

            <div className="dashboard-stats-grid">
                <StatCard title="Ventas del Día" value={formatCurrency(totalVentasDia)} icon={Banknote} trend="Hoy" delay={0.02} from="left" />
                <StatCard title="Compras (Mes)" value={formatCurrency(totalComprasMes)} icon={ShoppingCart} trend="Mensual" isNegative delay={0.08} from="up" />
                <StatCard
                    title="Fiado en Calle"
                    value={formatCurrency(totalDeudaCalle)}
                    icon={Wallet}
                    trend="Por Cobrar"
                    isWarning={totalDeudaCalle > 0}
                    onClick={() => navigate('/clientes')}
                    delay={0.14}
                    from="right"
                />
                <StatCard title="Stock Kilos" value={`${totalStockKg.toFixed(1)} kg`} icon={TrendingUp} trend="Total Carne" delay={0.2} from="down" />
                <StatCard
                    title="Alertas Stock"
                    value={`${lowStockCount} Items`}
                    icon={AlertTriangle}
                    isWarning={lowStockCount > 0}
                    trend="Stock Bajo (<10)"
                    isNegative={lowStockCount > 5}
                    delay={0.26}
                    from="left"
                />
                {hasModule('informes-pro') && (
                    <StatCard
                        title="Rendimiento Avg"
                        value={`${avgYield.toFixed(1)}%`}
                        icon={Crown}
                        trend="Análisis PRO"
                        isWarning={avgYield < 70}
                        onClick={() => navigate('/informes-pro')}
                        delay={0.32}
                        from="right"
                    />
                )}
                {isAdmin && remoteBranchCount > 0 && (
                    <StatCard
                        title="Sucursales Remotas"
                        value={`${remoteBranchCount}`}
                        icon={BarChart3}
                        trend={`${remoteTotalKg.toFixed(1)} kg informados`}
                        isWarning={remoteLowStock > 0}
                        delay={0.38}
                        from="up"
                    />
                )}
                {isAdmin && remoteBranchCount > 0 && (
                    <StatCard title="Ventas Remotas" value={formatCurrency(remoteSalesToday)} icon={Banknote} trend="Informadas por archivo" delay={0.44} from="down" />
                )}
                {isAdmin && remoteBranchCount > 0 && (
                    <StatCard title="Compras Remotas" value={formatCurrency(remotePurchasesMonth)} icon={ShoppingCart} trend="Informadas por archivo" isNegative delay={0.5} from="left" />
                )}
                {isAdmin && remoteBranchCount > 0 && (
                    <StatCard title="Caja Remota" value={formatCurrency(remoteCashInDrawer)} icon={Wallet} trend="Cierre informado" delay={0.56} from="right" />
                )}
            </div>

            <div className="dashboard-main-grid">
                <DashboardReveal className="dashboard-panel" from="left" delay={0.18}>
                    <div className="dashboard-panel-header">
                        <h3 className="dashboard-section-title">Últimas Ventas</h3>
                        <button onClick={() => navigate('/ventas/historial')} className="dashboard-link-btn">Ver todas</button>
                    </div>

                    {allVentas.length === 0 ? (
                        <p className="dashboard-empty">No hay ventas registradas aún.</p>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--color-text-muted)' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                                    <th style={{ padding: '0.75rem 0' }}>Hora</th>
                                    <th style={{ padding: '0.75rem 0' }}>Items</th>
                                    <th style={{ padding: '0.75rem 0' }}>Total</th>
                                    <th style={{ padding: '0.75rem 0' }}>Pago</th>
                                </tr>
                            </thead>
                            <tbody>
                                {allVentas.map((venta) => (
                                    <tr key={venta.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '0.75rem 0' }}>
                                            {(() => {
                                                const d = new Date(venta.date);
                                                const hoy = new Date();
                                                const esHoy = d.getDate() === hoy.getDate() && d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear();
                                                const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                                                if (esHoy) return hora;
                                                const fecha = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
                                                return <span>{fecha}<br /><span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{hora}</span></span>;
                                            })()}
                                        </td>
                                        <td style={{ padding: '0.75rem 0' }}>
                                            <div style={{ fontWeight: '600', color: 'var(--color-text-primary)' }}>
                                                Venta {venta.receipt_code || formatReceiptCode(1, venta.receipt_number || venta.id)}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                                {Array.isArray(venta.items) ? venta.items.length : 0} productos
                                            </div>
                                        </td>
                                        <td style={{ padding: '0.75rem 0', fontWeight: '600', color: 'var(--color-text-primary)' }}>
                                            {formatCurrency(venta.total)}
                                        </td>
                                        <td style={{ padding: '0.75rem 0' }}>
                                            <span style={{
                                                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                                                color: '#22c55e',
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: '4px',
                                                fontSize: '0.8rem',
                                                textTransform: 'capitalize'
                                            }}>
                                                {venta.payment_method || 'Sin método'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </DashboardReveal>

                <DashboardReveal className="dashboard-panel" from="right" delay={0.24}>
                    <h3 className="dashboard-section-title" style={{ marginBottom: '1rem' }}>Accesos Rápidos</h3>
                    <div className="dashboard-actions-grid">
                        <QuickAction label="Nueva Venta" onClick={() => navigate('/ventas')} color="var(--color-primary)" />
                        <QuickAction label="Registrar Compra" onClick={() => navigate('/compras')} color="#f59e0b" />
                        <QuickAction label="Ver Clientes" onClick={() => navigate('/clientes')} color="#ec4899" />
                        <QuickAction label="Caja" onClick={() => navigate('/caja')} color="#22c55e" />
                        <QuickAction label="Ver Inventario" onClick={() => navigate('/stock')} color="#8b5cf6" />
                    </div>
                </DashboardReveal>
            </div>

            {isAdmin && (
                <DashboardReveal className="dashboard-panel dashboard-remote-panel" from="down" delay={0.3}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                        <div>
                            <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Dashboard de Sucursales</h3>
                            <p style={{ color: 'var(--color-text-muted)', margin: '0.35rem 0 0' }}>Resumen construido a partir de los archivos de stock importados desde `Sucursales`.</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <select
                                value={selectedRemoteBranch}
                                onChange={(e) => setSelectedRemoteBranch(e.target.value)}
                                style={{ minWidth: '220px', background: 'var(--color-bg-main)', color: 'var(--color-text-main)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.7rem 0.9rem' }}
                            >
                                <option value="all">Todas las sucursales</option>
                                {branchSnapshots.map((snapshot) => (
                                    <option key={`${snapshot.branch_code}-${snapshot.id}`} value={snapshot.branch_code}>
                                        {snapshot.branch_code} - {snapshot.branch_name}
                                    </option>
                                ))}
                            </select>
                            <button onClick={() => navigate('/sucursales')} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.9rem' }}>Administrar sucursales</button>
                        </div>
                    </div>

                    {filteredBranchSnapshots.length === 0 ? (
                        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>Todavía no hay stock importado de otras sucursales.</p>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                            {filteredBranchSnapshots.map((snapshot, index) => (
                                <DashboardReveal
                                    key={snapshot.id}
                                    from={index % 2 === 0 ? 'left' : 'right'}
                                    delay={0.34 + (index * 0.04)}
                                    style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '1rem', background: 'rgba(255,255,255,0.03)' }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                        <div>
                                            <div style={{ fontSize: '0.78rem', color: '#93c5fd', fontWeight: 700 }}>{snapshot.branch_code}</div>
                                            <div style={{ fontSize: '1rem', fontWeight: 700 }}>{snapshot.branch_name}</div>
                                        </div>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                            {snapshot.snapshot_at ? new Date(snapshot.snapshot_at).toLocaleDateString('es-AR') : '-'}
                                        </span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.9rem' }}>
                                        <MiniMetric label="Items" value={toNumber(snapshot.items_count)} />
                                        <MiniMetric label="Kg" value={toNumber(snapshot.total_kg).toFixed(1)} />
                                        <MiniMetric label="Bajo" value={toNumber(snapshot.low_stock_count)} isWarning={toNumber(snapshot.low_stock_count) > 0} />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginBottom: '0.9rem' }}>
                                        <MiniMetric label="Ventas" value={formatCurrency(snapshot.sales_today_total)} />
                                        <MiniMetric label="Compras" value={formatCurrency(snapshot.purchases_month_total)} />
                                        <MiniMetric label="Caja" value={formatCurrency(snapshot.cash_in_drawer_total)} />
                                        <MiniMetric
                                            label="Mov. Caja"
                                            value={(toNumber(snapshot.cash_manual_incomes) > 0 || toNumber(snapshot.cash_manual_expenses) > 0)
                                                ? formatCurrency(toNumber(snapshot.cash_manual_incomes) - toNumber(snapshot.cash_manual_expenses))
                                                : '$0'}
                                            isWarning={toNumber(snapshot.cash_manual_expenses) > toNumber(snapshot.cash_manual_incomes)}
                                        />
                                    </div>
                                    <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>
                                        Archivo: {snapshot.source_file || 'Manual'}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        {(Array.isArray(snapshot.stock) ? snapshot.stock : []).slice(0, 5).map((item, idx) => (
                                            <div key={`${snapshot.id}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.88rem' }}>
                                                <span style={{ color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                                                <span style={{ color: toNumber(item.quantity) < 10 ? '#f59e0b' : 'var(--color-text-muted)', fontWeight: 600 }}>{toNumber(item.quantity).toFixed(1)} kg</span>
                                            </div>
                                        ))}
                                        {(Array.isArray(snapshot.stock) ? snapshot.stock.length : 0) > 5 && (
                                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>+ {(snapshot.stock || []).length - 5} productos más</span>
                                        )}
                                    </div>
                                </DashboardReveal>
                            ))}
                        </div>
                    )}
                </DashboardReveal>
            )}
        </div>
    );
};

const StatCard = ({ title, value, icon, trend, isNegative, isWarning, onClick, delay = 0, from = 'up' }) => (
    <DashboardReveal className="dashboard-stat-card" from={from} delay={delay}>
        <div onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{title}</span>
                <div className="dashboard-stat-icon">
                    {icon ? React.createElement(icon, { size: 20, color: isWarning ? '#f59e0b' : 'var(--color-primary)' }) : null}
                </div>
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: '700' }}>{value}</div>
            {trend && (
                <div style={{ fontSize: '0.85rem', color: isNegative ? '#ef4444' : (isWarning ? '#f59e0b' : '#22c55e') }}>
                    {trend}
                </div>
            )}
        </div>
    </DashboardReveal>
);

const QuickAction = ({ label, onClick, color }) => (
    <button
        onClick={onClick}
        className="dashboard-quick-action"
        style={{
            padding: '1.5rem',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${color}40`,
            color,
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center'
        }}
        onMouseOver={(e) => { e.currentTarget.style.backgroundColor = `${color}10`; }}
        onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-main)'; }}
    >
        {label}
    </button>
);

const MiniMetric = ({ label, value, isWarning }) => (
    <div className="dashboard-mini-metric" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: isWarning ? '#f59e0b' : 'var(--color-text-main)' }}>{value}</div>
    </div>
);

export default Dashboard;
