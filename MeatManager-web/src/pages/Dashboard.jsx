import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, formatReceiptCode } from '../db';
import { useNavigate } from 'react-router-dom';
import { useLicense } from '../context/LicenseContext';
import { useUser } from '../context/UserContext';
import { Banknote, ShoppingCart, TrendingUp, AlertTriangle, Wallet, Crown, BarChart3 } from 'lucide-react';
import './Dashboard.css';

const toNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const Dashboard = () => {
    const navigate = useNavigate();
    const { currentUser } = useUser();
    const isAdmin = currentUser?.role === 'admin';
    const [selectedRemoteBranch, setSelectedRemoteBranch] = useState('all');

    // Queries
    const ventasDia = useLiveQuery(() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        return db.ventas.where('date').between(start, end).toArray();
    });

    const allVentas = useLiveQuery(async () => {
        const sales = await db.ventas.orderBy('date').reverse().limit(5).toArray();
        return Promise.all(sales.map(async v => {
            if (v.items) return v;
            const items = await db.ventas_items.where('venta_id').equals(v.id).toArray();
            return { ...v, items };
        }));
    });

    // Generate local date string for Compras filtering (YYYY-MM-DD)
    const _sm = new Date();
    _sm.setDate(1);
    const dateStr = `${_sm.getFullYear()}-${String(_sm.getMonth() + 1).padStart(2, '0')}-01`;

    const comprasMes = useLiveQuery(
        () => db.compras.where('date').aboveOrEqual(dateStr).toArray(),
        [dateStr]
    );

    const stockItems = useLiveQuery(
        () => db.stock.toArray()
    );

    const clients = useLiveQuery(
        () => db.clients.toArray()
    );

    const proLogs = useLiveQuery(
        () => db.despostada_logs.toArray()
    );

    const branchSnapshots = useLiveQuery(
        () => db.branch_stock_snapshots?.orderBy('snapshot_at').reverse().toArray() || [],
        [],
        []
    );

    const { hasModule } = useLicense();

    // Calculations
    const totalVentasDia = ventasDia?.reduce((acc, v) => acc + (parseFloat(v.total) || 0), 0) || 0;

    const totalComprasMes = comprasMes?.reduce((acc, c) => acc + (parseFloat(c.total) || 0), 0) || 0;

    const totalStockKg = stockItems?.reduce((acc, item) => {
        return item.unit === 'kg' ? acc + toNumber(item.quantity) : acc;
    }, 0) || 0;

    const lowStockCount = stockItems?.filter(item => item.quantity < 10).length || 0; // Warning threshold < 10

    // Calculate Total Debts (Negative balances)
    const totalDeudaCalle = clients?.reduce((acc, client) => {
        const balance = toNumber(client.balance);
        return balance < 0 ? acc + Math.abs(balance) : acc;
    }, 0) || 0;

    const avgYield = proLogs?.length > 0
        ? (proLogs.reduce((acc, log) => acc + toNumber(log.yield_percentage), 0) / proLogs.length).toFixed(1)
        : 0;

    const filteredBranchSnapshots = (branchSnapshots || []).filter((snapshot) => selectedRemoteBranch === 'all' || snapshot.branch_code === selectedRemoteBranch);
    const remoteBranchCount = filteredBranchSnapshots.length || 0;
    const remoteTotalKg = filteredBranchSnapshots.reduce((acc, snapshot) => acc + (Number(snapshot.total_kg) || 0), 0) || 0;
    const remoteLowStock = filteredBranchSnapshots.reduce((acc, snapshot) => acc + (Number(snapshot.low_stock_count) || 0), 0) || 0;
    const remoteSalesToday = filteredBranchSnapshots.reduce((acc, snapshot) => acc + (Number(snapshot.sales_today_total) || 0), 0) || 0;
    const remotePurchasesMonth = filteredBranchSnapshots.reduce((acc, snapshot) => acc + (Number(snapshot.purchases_month_total) || 0), 0) || 0;
    const remoteCashInDrawer = filteredBranchSnapshots.reduce((acc, snapshot) => acc + (Number(snapshot.cash_in_drawer_total) || 0), 0) || 0;

    // Formatters
    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount);
    };

    return (
        <div className="dashboard-page animate-fade-in">
            <header className="page-header">
                <h1 className="page-title">Dashboard</h1>
                <p className="page-description">Resumen en tiempo real de tu carnicería</p>
            </header>

            <div className="dashboard-stats-grid">
                <StatCard
                    title="Ventas del Día"
                    value={formatCurrency(totalVentasDia)}
                    icon={Banknote}
                    trend="Hoy"
                />
                <StatCard
                    title="Compras (Mes)"
                    value={formatCurrency(totalComprasMes)}
                    icon={ShoppingCart}
                    trend="Mensual"
                    isNegative
                />
                <StatCard
                    title="Fiado en Calle"
                    value={formatCurrency(totalDeudaCalle)}
                    icon={Wallet}
                    trend="Por Cobrar"
                    isWarning={totalDeudaCalle > 0}
                    onClick={() => navigate('/clientes')}
                />
                <StatCard
                    title="Stock Kilos"
                    value={`${totalStockKg.toFixed(1)} kg`}
                    icon={TrendingUp}
                    trend="Total Carne"
                />
                <StatCard
                    title="Alertas Stock"
                    value={`${lowStockCount} Items`}
                    icon={AlertTriangle}
                    isWarning={lowStockCount > 0}
                    trend="Stock Bajo (<10)"
                    isNegative={lowStockCount > 5}
                />
                {hasModule('informes-pro') && (
                    <StatCard
                        title="Rendimiento Avg"
                        value={`${avgYield}%`}
                        icon={Crown}
                        trend="Análisis PRO"
                        isWarning={avgYield < 70}
                        onClick={() => navigate('/informes-pro')}
                    />
                )}
                {isAdmin && remoteBranchCount > 0 && (
                    <StatCard
                        title="Sucursales Remotas"
                        value={`${remoteBranchCount}`}
                        icon={BarChart3}
                        trend={`${remoteTotalKg.toFixed(1)} kg informados`}
                        isWarning={remoteLowStock > 0}
                    />
                )}
                {isAdmin && remoteBranchCount > 0 && (
                    <StatCard
                        title="Ventas Remotas"
                        value={formatCurrency(remoteSalesToday)}
                        icon={Banknote}
                        trend="Informadas por archivo"
                    />
                )}
                {isAdmin && remoteBranchCount > 0 && (
                    <StatCard
                        title="Compras Remotas"
                        value={formatCurrency(remotePurchasesMonth)}
                        icon={ShoppingCart}
                        trend="Informadas por archivo"
                        isNegative
                    />
                )}
                {isAdmin && remoteBranchCount > 0 && (
                    <StatCard
                        title="Caja Remota"
                        value={formatCurrency(remoteCashInDrawer)}
                        icon={Wallet}
                        trend="Cierre informado"
                    />
                )}
            </div>

            <div className="dashboard-main-grid">
                <div className="dashboard-panel">
                    <div className="dashboard-panel-header">
                        <h3 className="dashboard-section-title">Últimas Ventas</h3>
                        <button onClick={() => navigate('/ventas/historial')} className="dashboard-link-btn">Ver todas</button>
                    </div>

                    {(!allVentas || allVentas.length === 0) ? (
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
                                {allVentas.map(venta => (
                                    <tr key={venta.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '0.75rem 0' }}>
                                            {(() => {
                                                const d = new Date(venta.date);
                                                const hoy = new Date();
                                                const esHoy = d.getDate() === hoy.getDate() && d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear();
                                                const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                                                if (esHoy) return hora;
                                                const fecha = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
                                                return <span>{fecha}<br /><span style={{fontSize:'0.78rem',color:'var(--color-text-muted)'}}>{hora}</span></span>;
                                            })()}
                                        </td>
                                        <td style={{ padding: '0.75rem 0' }}>
                                            <div style={{ fontWeight: '600', color: 'var(--color-text-primary)' }}>
                                                Venta {venta.receipt_code || formatReceiptCode(1, venta.receipt_number || venta.id)}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                                {venta.items.length} productos
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
                </div>

                <div className="dashboard-panel">
                    <h3 className="dashboard-section-title" style={{ marginBottom: '1rem' }}>Accesos Rápidos</h3>
                    <div className="dashboard-actions-grid">
                        <QuickAction
                            label="Nueva Venta"
                            onClick={() => navigate('/ventas')}
                            color="var(--color-primary)"
                        />
                        <QuickAction
                            label="Registrar Compra"
                            onClick={() => navigate('/compras')}
                            color="#f59e0b"
                        />
                        <QuickAction
                            label="Ver Clientes"
                            onClick={() => navigate('/clientes')}
                            color="#ec4899"
                        />
                        <QuickAction
                            label="Caja"
                            onClick={() => navigate('/caja')}
                            color="#22c55e"
                        />
                        <QuickAction
                            label="Ver Inventario"
                            onClick={() => navigate('/stock')}
                            color="#8b5cf6"
                        />
                    </div>
                </div>
            </div>

            {isAdmin && (
                <div className="dashboard-panel dashboard-remote-panel">
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
                                {(branchSnapshots || []).map((snapshot) => (
                                    <option key={`${snapshot.branch_code}-${snapshot.id}`} value={snapshot.branch_code}>
                                        {snapshot.branch_code} - {snapshot.branch_name}
                                    </option>
                                ))}
                            </select>
                            <button onClick={() => navigate('/sucursales')} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.9rem' }}>Administrar sucursales</button>
                        </div>
                    </div>

                    {!filteredBranchSnapshots?.length ? (
                        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>Todavía no hay stock importado de otras sucursales.</p>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                            {filteredBranchSnapshots.map((snapshot) => (
                                <div key={snapshot.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
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
                                        <MiniMetric label="Items" value={snapshot.items_count || 0} />
                                        <MiniMetric label="Kg" value={(Number(snapshot.total_kg) || 0).toFixed(1)} />
                                        <MiniMetric label="Bajo" value={snapshot.low_stock_count || 0} isWarning={(snapshot.low_stock_count || 0) > 0} />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginBottom: '0.9rem' }}>
                                        <MiniMetric label="Ventas" value={formatCurrency(Number(snapshot.sales_today_total) || 0)} />
                                        <MiniMetric label="Compras" value={formatCurrency(Number(snapshot.purchases_month_total) || 0)} />
                                        <MiniMetric label="Caja" value={formatCurrency(Number(snapshot.cash_in_drawer_total) || 0)} />
                                        <MiniMetric label="Mov. Caja" value={`${Number(snapshot.cash_manual_incomes || 0) > 0 || Number(snapshot.cash_manual_expenses || 0) > 0 ? formatCurrency(Number(snapshot.cash_manual_incomes || 0) - Number(snapshot.cash_manual_expenses || 0)) : '$0'}`} isWarning={Number(snapshot.cash_manual_expenses || 0) > Number(snapshot.cash_manual_incomes || 0)} />
                                    </div>
                                    <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>
                                        Archivo: {snapshot.source_file || 'Manual'}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        {(snapshot.stock || []).slice(0, 5).map((item, idx) => (
                                            <div key={`${snapshot.id}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.88rem' }}>
                                                <span style={{ color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                                                <span style={{ color: Number(item.quantity) < 10 ? '#f59e0b' : 'var(--color-text-muted)', fontWeight: 600 }}>{Number(item.quantity || 0).toFixed(1)} kg</span>
                                            </div>
                                        ))}
                                        {(snapshot.stock || []).length > 5 && (
                                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>+ {(snapshot.stock || []).length - 5} productos más</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const StatCard = ({ title, value, icon, trend, isNegative, isWarning }) => (
    <div className="dashboard-stat-card">
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
);

const QuickAction = ({ label, onClick, color }) => (
    <button
        onClick={onClick}
        className="dashboard-quick-action"
        style={{
            padding: '1.5rem',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${color}40`,
            color: color,
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center'
        }}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = `${color}10`}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-main)'}
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
