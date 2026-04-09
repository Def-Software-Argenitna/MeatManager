import React, { useMemo, useState } from 'react';
import { TrendingUp, Users, Target, Calendar, ArrowRight, ShieldCheck, Crown, Filter, Download } from 'lucide-react';
import { useLicense } from '../context/LicenseContext';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { fetchTable } from '../utils/apiClient';
import DirectionalReveal from '../components/DirectionalReveal';
import './InformesPro.css';

const formatKg = (value) => `${(Number(value) || 0).toFixed(2)} kg`;
const formatPercent = (value) => `${(Number(value) || 0).toFixed(1)}%`;
const formatCurrency = (value) => `$${(Number(value) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
const TARGET_YIELD_BY_TYPE = {
    vaca: 74,
    cerdo: 78,
    pollo: 82,
    pescado: 68
};

const InformesPro = () => {
    const { hasModule } = useLicense();
    const [filterDays, setFilterDays] = useState('30');
    const [searchParams, setSearchParams] = useSearchParams();
    const [logs, setLogs] = useState([]);
    const [animalLots, setAnimalLots] = useState([]);
    const [compras, setCompras] = useState([]);
    const [prices, setPrices] = useState([]);

    React.useEffect(() => {
        const loadReportData = async () => {
            const [logsRows, lotRows, comprasRows, pricesRows] = await Promise.all([
                fetchTable('despostada_logs', { orderBy: 'date', direction: 'desc' }),
                fetchTable('animal_lots'),
                fetchTable('compras'),
                fetchTable('prices'),
            ]);
            setLogs(Array.isArray(logsRows) ? logsRows : []);
            setAnimalLots(Array.isArray(lotRows) ? lotRows : []);
            setCompras(Array.isArray(comprasRows) ? comprasRows : []);
            setPrices(Array.isArray(pricesRows) ? pricesRows : []);
        };

        loadReportData().catch((error) => console.error('Error cargando informes PRO:', error));
    }, []);

    const hasInformesProModule = hasModule('informes-pro');

    const filteredLogs = useMemo(() => {
        const days = parseInt(filterDays, 10);
        if (!logs || Number.isNaN(days)) return logs || [];
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        since.setDate(since.getDate() - days);
        return logs.filter((log) => new Date(log.date) >= since);
    }, [filterDays, logs]);

    const selectedLogId = Number(searchParams.get('log'));
    const selectedLog = useMemo(
        () => filteredLogs.find((log) => log.id === selectedLogId) || null,
        [filteredLogs, selectedLogId]
    );
    const selectedLot = useMemo(
        () => animalLots?.find((lot) => lot.id === selectedLog?.lot_id) || null,
        [animalLots, selectedLog]
    );
    const selectedPurchase = useMemo(
        () => compras?.find((purchase) => purchase.id === selectedLot?.purchase_id) || null,
        [compras, selectedLot]
    );
    const selectedCuts = useMemo(
        () => Array.isArray(selectedLog?.cuts) ? selectedLog.cuts : [],
        [selectedLog]
    );
    const selectedCategoryTotals = useMemo(() => {
        if (Array.isArray(selectedLog?.category_totals) && selectedLog.category_totals.length > 0) {
            return selectedLog.category_totals;
        }
        return Object.values(
            selectedCuts.reduce((acc, cut) => {
                const key = cut.cutCategory || 'sin_categoria';
                if (!acc[key]) {
                    acc[key] = { category: key, weight: 0, count: 0 };
                }
                acc[key].weight += Number(cut.weight) || 0;
                acc[key].count += 1;
                return acc;
            }, {})
        );
    }, [selectedCuts, selectedLog]);
    const selectedProcessedWeight = Number(selectedLog?.processed_weight)
        || selectedCuts.reduce((acc, cut) => acc + (Number(cut.weight) || 0), 0);
    const selectedInitialWeight = Number(selectedLog?.total_weight) || 0;
    const selectedMermaWeight = Number.isFinite(Number(selectedLog?.merma_weight))
        ? Number(selectedLog?.merma_weight)
        : Math.max(selectedInitialWeight - selectedProcessedWeight, 0);
    const selectedMermaPercentage = Number.isFinite(Number(selectedLog?.merma_percentage))
        ? Number(selectedLog?.merma_percentage)
        : (selectedInitialWeight > 0 ? (selectedMermaWeight / selectedInitialWeight) * 100 : 0);
    const selectedCostPerKg = Number(selectedLog?.cost_per_kg) || 0;
    const selectedEstimatedTotalCost = Number(selectedLog?.estimated_total_cost) || (selectedInitialWeight * selectedCostPerKg);
    const selectedEstimatedCostPerOutputKg = Number(selectedLog?.estimated_cost_per_output_kg)
        || (selectedProcessedWeight > 0 ? selectedEstimatedTotalCost / selectedProcessedWeight : 0);
    const selectedTargetYield = TARGET_YIELD_BY_TYPE[selectedLog?.type] || 74;
    const heaviestCut = useMemo(() => {
        if (!selectedCuts.length) return null;
        return [...selectedCuts].sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0))[0];
    }, [selectedCuts]);
    const bestCategory = useMemo(() => {
        if (!selectedCategoryTotals.length) return null;
        return [...selectedCategoryTotals].sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0))[0];
    }, [selectedCategoryTotals]);
    const priceLookup = useMemo(() => {
        const map = new Map();
        (prices || []).forEach((price) => {
            const rawKey = String(price.product_id || '').split('-')[0];
            const normalized = normalizeKey(rawKey);
            const current = map.get(normalized);
            if (!current || new Date(price.updated_at || 0) > new Date(current.updated_at || 0)) {
                map.set(normalized, price);
            }
        });
        return map;
    }, [prices]);
    const selectedCutsWithCommercials = useMemo(() => {
        return selectedCuts.map((cut) => {
            const priceRecord = priceLookup.get(normalizeKey(cut.cutName));
            const salePricePerKg = Number(priceRecord?.price) || 0;
            const estimatedRevenue = salePricePerKg > 0 ? salePricePerKg * (Number(cut.weight) || 0) : 0;
            const costShare = selectedInitialWeight > 0
                ? ((Number(cut.weight) || 0) / selectedInitialWeight) * selectedEstimatedTotalCost
                : 0;
            const estimatedMargin = estimatedRevenue - costShare;
            return {
                ...cut,
                salePricePerKg,
                estimatedRevenue,
                costShare,
                estimatedMargin,
                hasCommercialData: salePricePerKg > 0
            };
        });
    }, [priceLookup, selectedCuts, selectedEstimatedTotalCost, selectedInitialWeight]);
    const totalEstimatedRevenue = selectedCutsWithCommercials.reduce((acc, cut) => acc + (cut.estimatedRevenue || 0), 0);
    const totalEstimatedMargin = totalEstimatedRevenue - selectedEstimatedTotalCost;
    const commercialCoverage = selectedCuts.length > 0
        ? (selectedCutsWithCommercials.filter((cut) => cut.hasCommercialData).length / selectedCuts.length) * 100
        : 0;
    const missingCommercialCoverage = Math.max(0, 100 - commercialCoverage);
    const topRevenueCut = useMemo(() => {
        if (!selectedCutsWithCommercials.length) return null;
        return [...selectedCutsWithCommercials].sort((a, b) => (b.estimatedRevenue || 0) - (a.estimatedRevenue || 0))[0];
    }, [selectedCutsWithCommercials]);
    const selectedCategoryDonut = useMemo(() => {
        if (!selectedCategoryTotals.length) return [];
        const palette = ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444', '#14b8a6', '#a855f7', '#eab308', '#f97316'];
        let cursor = 0;
        const total = selectedCategoryTotals.reduce((acc, entry) => acc + (Number(entry.weight) || 0), 0) || 1;
        return selectedCategoryTotals
            .filter((entry) => Number(entry.weight) > 0)
            .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0))
            .map((entry, index) => {
                const percentage = ((Number(entry.weight) || 0) / total) * 100;
                const segment = {
                    ...entry,
                    color: palette[index % palette.length],
                    start: cursor,
                    end: cursor + percentage,
                    percentage
                };
                cursor += percentage;
                return segment;
            });
    }, [selectedCategoryTotals]);
    const selectedCategoryDonutStyle = useMemo(() => {
        if (!selectedCategoryDonut.length) return {};
        const gradient = selectedCategoryDonut
            .map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`)
            .join(', ');
        return { background: `conic-gradient(${gradient})` };
    }, [selectedCategoryDonut]);
    const commercialCoverageStyle = useMemo(() => ({
        background: `conic-gradient(#22c55e 0% ${commercialCoverage}%, rgba(255,255,255,0.08) ${commercialCoverage}% 100%)`
    }), [commercialCoverage]);
    const supplierHistorical = useMemo(() => {
        if (!selectedLog?.supplier) return [];
        return (logs || []).filter((log) => log.supplier === selectedLog.supplier && log.type === selectedLog.type);
    }, [logs, selectedLog]);
    const supplierHistoricalAvg = supplierHistorical.length > 0
        ? supplierHistorical.reduce((acc, log) => acc + (Number(log.yield_percentage) || 0), 0) / supplierHistorical.length
        : 0;
    const yieldDeltaVsTarget = Number(selectedLog?.yield_percentage || 0) - selectedTargetYield;
    const yieldDeltaVsSupplier = Number(selectedLog?.yield_percentage || 0) - supplierHistoricalAvg;
    const monthlyComparative = useMemo(() => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const previousMonthDate = new Date(currentYear, currentMonth - 1, 1);
        const previousMonth = previousMonthDate.getMonth();
        const previousYear = previousMonthDate.getFullYear();

        const bucket = {};
        (logs || []).forEach((log) => {
            const logDate = new Date(log.date);
            const logMonth = logDate.getMonth();
            const logYear = logDate.getFullYear();
            const isCurrent = logMonth === currentMonth && logYear === currentYear;
            const isPrevious = logMonth === previousMonth && logYear === previousYear;
            if (!isCurrent && !isPrevious) return;

            const supplier = log.supplier || 'Proveedor desconocido';
            const species = log.type || 'general';
            const key = `${supplier}__${species}`;
            if (!bucket[key]) {
                bucket[key] = {
                    supplier,
                    species,
                    currentCount: 0,
                    currentYieldTotal: 0,
                    currentWeightTotal: 0,
                    previousCount: 0,
                    previousYieldTotal: 0,
                    previousWeightTotal: 0
                };
            }

            if (isCurrent) {
                bucket[key].currentCount += 1;
                bucket[key].currentYieldTotal += Number(log.yield_percentage) || 0;
                bucket[key].currentWeightTotal += Number(log.total_weight) || 0;
            }

            if (isPrevious) {
                bucket[key].previousCount += 1;
                bucket[key].previousYieldTotal += Number(log.yield_percentage) || 0;
                bucket[key].previousWeightTotal += Number(log.total_weight) || 0;
            }
        });

        return Object.values(bucket)
            .map((entry) => {
                const currentAvgYield = entry.currentCount > 0 ? entry.currentYieldTotal / entry.currentCount : 0;
                const previousAvgYield = entry.previousCount > 0 ? entry.previousYieldTotal / entry.previousCount : 0;
                return {
                    ...entry,
                    currentAvgYield,
                    previousAvgYield,
                    yieldDelta: currentAvgYield - previousAvgYield,
                    currentAvgWeight: entry.currentCount > 0 ? entry.currentWeightTotal / entry.currentCount : 0,
                    previousAvgWeight: entry.previousCount > 0 ? entry.previousWeightTotal / entry.previousCount : 0
                };
            })
            .filter((entry) => entry.currentCount > 0 || entry.previousCount > 0)
            .sort((a, b) => Math.abs(b.yieldDelta) - Math.abs(a.yieldDelta));
    }, [logs]);
    const categoryRecovery = useMemo(() => {
        const bucket = {};
        filteredLogs.forEach((log) => {
            const totalWeight = Number(log.total_weight) || 0;
            const categories = Array.isArray(log.category_totals) ? log.category_totals : [];
            categories.forEach((category) => {
                const key = category.category || 'sin_categoria';
                if (!bucket[key]) {
                    bucket[key] = { category: key, weight: 0, lotCount: 0, shareTotal: 0 };
                }
                bucket[key].weight += Number(category.weight) || 0;
                bucket[key].lotCount += 1;
                if (totalWeight > 0) {
                    bucket[key].shareTotal += ((Number(category.weight) || 0) / totalWeight) * 100;
                }
            });
        });

        return Object.values(bucket)
            .map((entry) => ({
                ...entry,
                avgShare: entry.lotCount > 0 ? entry.shareTotal / entry.lotCount : 0
            }))
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 8);
    }, [filteredLogs]);
    const cutRecovery = useMemo(() => {
        const bucket = {};
        filteredLogs.forEach((log) => {
            const totalWeight = Number(log.total_weight) || 0;
            const cuts = Array.isArray(log.cuts) ? log.cuts : [];
            cuts.forEach((cut) => {
                const key = cut.cutName || 'Sin nombre';
                if (!bucket[key]) {
                    bucket[key] = { cutName: key, weight: 0, count: 0, shareTotal: 0 };
                }
                bucket[key].weight += Number(cut.weight) || 0;
                bucket[key].count += 1;
                if (totalWeight > 0) {
                    bucket[key].shareTotal += ((Number(cut.weight) || 0) / totalWeight) * 100;
                }
            });
        });

        return Object.values(bucket)
            .map((entry) => ({
                ...entry,
                avgShare: entry.count > 0 ? entry.shareTotal / entry.count : 0
            }))
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 10);
    }, [filteredLogs]);
    const alerts = useMemo(() => {
        const nextAlerts = [];

        filteredLogs.forEach((log) => {
            const targetYield = TARGET_YIELD_BY_TYPE[log.type] || 74;
            const yieldValue = Number(log.yield_percentage) || 0;
            const mermaPercentage = Number(log.merma_percentage) || 0;
            const revenue = Array.isArray(log.cuts)
                ? log.cuts.reduce((acc, cut) => {
                    const priceRecord = priceLookup.get(normalizeKey(cut.cutName));
                    const salePricePerKg = Number(priceRecord?.price) || 0;
                    return acc + (salePricePerKg > 0 ? salePricePerKg * (Number(cut.weight) || 0) : 0);
                }, 0)
                : 0;
            const estimatedTotalCost = Number(log.estimated_total_cost) || 0;
            const estimatedMargin = revenue - estimatedTotalCost;

            if (yieldValue < targetYield - 3) {
                nextAlerts.push({
                    severity: 'danger',
                    title: `Rinde bajo en ${log.supplier || 'proveedor desconocido'}`,
                    message: `${log.type?.toUpperCase() || 'Lote'} del ${new Date(log.date).toLocaleDateString()} cerró en ${formatPercent(yieldValue)}, ${formatPercent(targetYield - yieldValue)} por debajo del objetivo.`
                });
            }

            if (mermaPercentage > 12) {
                nextAlerts.push({
                    severity: 'warning',
                    title: `Merma alta detectada`,
                    message: `${log.supplier || 'Proveedor desconocido'} tuvo ${formatPercent(mermaPercentage)} de merma en ${log.type}. Revisar manipulación, enfriado y toma de peso inicial.`
                });
            }

            if (revenue > 0 && estimatedTotalCost > 0 && estimatedMargin < 0) {
                nextAlerts.push({
                    severity: 'danger',
                    title: `Margen estimado negativo`,
                    message: `El lote ${log.type} de ${log.supplier || 'N/D'} proyecta ${formatCurrency(estimatedMargin)}. Revisá costo de compra o precios de salida.`
                });
            }
        });

        monthlyComparative.forEach((entry) => {
            if (entry.previousCount > 0 && entry.yieldDelta <= -2) {
                nextAlerts.push({
                    severity: 'warning',
                    title: `Caída mensual en ${entry.supplier}`,
                    message: `${entry.species} cayó ${formatPercent(Math.abs(entry.yieldDelta))} contra el mes anterior. Actual: ${formatPercent(entry.currentAvgYield)}.`
                });
            }
        });

        return nextAlerts.slice(0, 6);
    }, [filteredLogs, monthlyComparative, priceLookup]);
    const openLogDetail = (logId) => {
        setSearchParams({ log: String(logId) });
    };

    const closeLogDetail = () => {
        setSearchParams({});
    };

    const handleExport = () => {
        const rows = filteredLogs.map((log) => {
            const lot = animalLots?.find((candidate) => candidate.id === log.lot_id);
                        const purchase = compras?.find((candidate) => candidate.id === lot?.purchase_id);
                        return {
                            id: log.id,
                fecha: new Date(log.date).toLocaleDateString(),
                tipo: log.type,
                proveedor: log.supplier || lot?.supplier || '',
                pesoInicialKg: Number(log.total_weight) || 0,
                rendimiento: Number(log.yield_percentage) || 0,
                            loteId: log.lot_id || '',
                            compraId: lot?.purchase_id || '',
                            factura: purchase?.invoice_num || '',
                            fechaCompra: purchase?.date ? new Date(purchase.date).toLocaleDateString() : '',
                            pesoProcesadoKg: Number(log.processed_weight) || 0,
                            mermaKg: Number(log.merma_weight) || 0,
                            mermaPorcentaje: Number(log.merma_percentage) || 0,
                            costoEstimadoTotal: Number(log.estimated_total_cost) || 0,
                            costoSalidaKg: Number(log.estimated_cost_per_output_kg) || 0
                        };
                    });

        if (rows.length === 0) {
            window.alert('No hay despostadas para exportar en el rango seleccionado.');
            return;
        }

        const summaryRows = rows.map((row) => ({
            ID: row.id,
            Fecha: row.fecha,
            Tipo: row.tipo,
            Proveedor: row.proveedor,
            PesoInicialKg: row.pesoInicialKg,
            PesoProcesadoKg: row.pesoProcesadoKg,
            Rendimiento: row.rendimiento,
            MermaKg: row.mermaKg,
            MermaPorcentaje: row.mermaPorcentaje,
            LoteId: row.loteId,
            CompraId: row.compraId,
            Factura: row.factura,
            FechaCompra: row.fechaCompra,
            CostoEstimadoTotal: row.costoEstimadoTotal,
            CostoSalidaKg: row.costoSalidaKg
        }));

        const cutBreakdownRows = filteredLogs.flatMap((log) =>
            (Array.isArray(log.cuts) ? log.cuts : []).map((cut) => ({
                LogId: log.id,
                Fecha: new Date(log.date).toLocaleDateString(),
                Tipo: log.type,
                Proveedor: log.supplier || '',
                LoteId: log.lot_id || '',
                CorteNumero: cut.cutNumber || '',
                Corte: cut.cutName || '',
                Categoria: cut.cutCategory || '',
                PesoKg: Number(cut.weight) || 0,
                PorcentajeLote: Number(log.total_weight) > 0 ? Number((((Number(cut.weight) || 0) / Number(log.total_weight)) * 100).toFixed(1)) : 0,
                Hora: cut.timestamp ? new Date(cut.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
            }))
        );

        const monthlyRows = monthlyComparative.map((row) => ({
            Proveedor: row.supplier,
            Especie: row.species,
            CantidadMesActual: row.currentCount,
            RindePromedioMesActual: Number(row.currentAvgYield.toFixed(1)),
            PesoPromedioMesActualKg: Number(row.currentAvgWeight.toFixed(2)),
            CantidadMesAnterior: row.previousCount,
            RindePromedioMesAnterior: Number(row.previousAvgYield.toFixed(1)),
            PesoPromedioMesAnteriorKg: Number(row.previousAvgWeight.toFixed(2)),
            DeltaRinde: Number(row.yieldDelta.toFixed(1))
        }));

        const worksheet = XLSX.utils.json_to_sheet(summaryRows);
        const cutsWorksheet = XLSX.utils.json_to_sheet(cutBreakdownRows.length > 0 ? cutBreakdownRows : [{ Info: 'No hay desglose por pieza en el rango seleccionado.' }]);
        const monthlyWorksheet = XLSX.utils.json_to_sheet(monthlyRows.length > 0 ? monthlyRows : [{ Info: 'No hay suficiente histórico para comparar mes contra mes.' }]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Resumen');
        XLSX.utils.book_append_sheet(workbook, cutsWorksheet, 'Desglose por pieza');
        XLSX.utils.book_append_sheet(workbook, monthlyWorksheet, 'Comparativo mensual');
        XLSX.writeFile(workbook, `rendimientos_pro_${filterDays}d_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    // Calculations for Supplier Ranking
    const supplierStats = {};
    filteredLogs?.forEach(log => {
        if (!log.supplier) return;
        if (!supplierStats[log.supplier]) {
            supplierStats[log.supplier] = { name: log.supplier, totalYield: 0, count: 0, bestYield: 0, worstYield: 100, avgWeight: 0 };
        }
        const stats = supplierStats[log.supplier];
        stats.totalYield += log.yield_percentage;
        stats.count += 1;
        stats.bestYield = Math.max(stats.bestYield, log.yield_percentage);
        stats.worstYield = Math.min(stats.worstYield, log.yield_percentage);
        stats.avgWeight += log.total_weight;
    });

    const ranking = Object.values(supplierStats).map(s => ({
        ...s,
        avgYield: (s.totalYield / s.count).toFixed(1),
        avgWeight: (s.avgWeight / s.count).toFixed(1)
    })).sort((a, b) => b.avgYield - a.avgYield);

    const executiveMetrics = useMemo(() => {
        const totalLots = filteredLogs.length;
        const avgYield = totalLots > 0
            ? filteredLogs.reduce((acc, log) => acc + (Number(log.yield_percentage) || 0), 0) / totalLots
            : 0;
        const avgMerma = totalLots > 0
            ? filteredLogs.reduce((acc, log) => acc + (Number(log.merma_percentage) || 0), 0) / totalLots
            : 0;
        const margins = filteredLogs
            .map((log) => {
                const estimatedTotalCost = Number(log.estimated_total_cost) || 0;
                const revenue = Array.isArray(log.cuts)
                    ? log.cuts.reduce((acc, cut) => {
                        const priceRecord = priceLookup.get(normalizeKey(cut.cutName));
                        const salePricePerKg = Number(priceRecord?.price) || 0;
                        return acc + (salePricePerKg > 0 ? salePricePerKg * (Number(cut.weight) || 0) : 0);
                    }, 0)
                    : 0;
                return revenue > 0 && estimatedTotalCost > 0 ? revenue - estimatedTotalCost : null;
            })
            .filter((value) => typeof value === 'number');
        const avgEstimatedMargin = margins.length > 0
            ? margins.reduce((acc, value) => acc + value, 0) / margins.length
            : 0;

        return {
            totalLots,
            avgYield,
            avgMerma,
            avgEstimatedMargin,
            alertCount: alerts.length
        };
    }, [alerts.length, filteredLogs, priceLookup]);

    const executiveHighlights = useMemo(() => {
        const bestSupplierEntry = ranking[0] || null;
        const monthlyDrop = monthlyComparative.find((entry) => entry.previousCount > 0 && entry.yieldDelta < 0) || null;
        const topCategory = categoryRecovery[0] || null;
        const topCut = cutRecovery[0] || null;
        const notes = [];

        if (bestSupplierEntry) {
            notes.push({
                title: 'Proveedor más consistente',
                value: `${bestSupplierEntry.name} · ${formatPercent(bestSupplierEntry.avgYield)}`,
                tone: 'success'
            });
        }

        if (monthlyDrop) {
            notes.push({
                title: 'Proveedor a revisar',
                value: `${monthlyDrop.supplier} · ${monthlyDrop.species} · ${monthlyDrop.yieldDelta.toFixed(1)} pts`,
                tone: 'warning'
            });
        }

        if (topCategory) {
            notes.push({
                title: 'Categoría dominante',
                value: `${topCategory.category} · ${formatPercent(topCategory.avgShare)}`,
                tone: 'neutral'
            });
        }

        if (topCut) {
            notes.push({
                title: 'Corte más recurrente',
                value: `${topCut.cutName} · ${formatPercent(topCut.avgShare)}`,
                tone: 'neutral'
            });
        }

        return notes.slice(0, 4);
    }, [categoryRecovery, cutRecovery, monthlyComparative, ranking]);

    const worstSupplier = ranking.length > 0 ? ranking[ranking.length - 1] : null;
    const avgCowYield = ranking.length > 0 ? (ranking.reduce((acc, r) => acc + parseFloat(r.avgYield), 0) / ranking.length).toFixed(1) : 0;

    if (!hasInformesProModule) {
        return (
            <div className="pro-locked-container animate-fade-in">
                <Crown size={64} color="gold" />
                <h2>Módulo de Informes Avanzados</h2>
                <p>El análisis de rendimiento y costos es exclusivo para usuarios **PRO**.</p>
                <button className="neo-button pro-btn" onClick={() => window.location.hash = '#/config/licencia'}>
                    Ver Planes de Activación
                </button>
            </div>
        );
    }

    return (
        <div className="informes-pro-container animate-fade-in">
            <DirectionalReveal from="up" delay={0.04}>
            <header className="page-header">
                
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <select className="neo-input" style={{ width: 'auto' }} value={filterDays} onChange={e => setFilterDays(e.target.value)}>
                        <option value="7">Últimos 7 días</option>
                        <option value="30">Últimos 30 días</option>
                        <option value="90">Últimos 90 días</option>
                    </select>
                    <button className="neo-button" onClick={handleExport} style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-main)' }}>
                        <Download size={18} /> Exportar
                    </button>
                </div>
            </header>
            </DirectionalReveal>

            <DirectionalReveal className="executive-grid" from="left" delay={0.1}>
                <div className="neo-card executive-card">
                    <span className="executive-label">Lotes Analizados</span>
                    <strong className="executive-value">{executiveMetrics.totalLots}</strong>
                    <span className="executive-meta">en el rango seleccionado</span>
                </div>
                <div className="neo-card executive-card">
                    <span className="executive-label">Rinde Promedio</span>
                    <strong className="executive-value" style={{ color: executiveMetrics.avgYield >= 72 ? '#22c55e' : '#f59e0b' }}>{formatPercent(executiveMetrics.avgYield)}</strong>
                    <span className="executive-meta">lectura general del período</span>
                </div>
                <div className="neo-card executive-card">
                    <span className="executive-label">Merma Promedio</span>
                    <strong className="executive-value" style={{ color: executiveMetrics.avgMerma <= 8 ? '#22c55e' : '#ef4444' }}>{formatPercent(executiveMetrics.avgMerma)}</strong>
                    <span className="executive-meta">control de pérdida</span>
                </div>
                <div className="neo-card executive-card">
                    <span className="executive-label">Alertas</span>
                    <strong className="executive-value" style={{ color: executiveMetrics.alertCount === 0 ? '#22c55e' : '#f59e0b' }}>{executiveMetrics.alertCount}</strong>
                    <span className="executive-meta">cosas para revisar hoy</span>
                </div>
            </DirectionalReveal>

            <DirectionalReveal className="neo-card" from="right" delay={0.16} style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
                <div className="card-header" style={{ marginBottom: '1rem' }}>
                    <ShieldCheck size={20} color="var(--color-primary)" />
                    <h3>Resumen Ejecutivo</h3>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                    {executiveHighlights.length === 0 ? (
                        <div style={{ color: 'var(--color-text-muted)' }}>Todavía no hay suficiente información para armar recomendaciones ejecutivas.</div>
                    ) : (
                        executiveHighlights.map((item, index) => (
                            <div key={`${item.title}-${index}`} className={`summary-pill ${item.tone}`}>
                                <div className="summary-pill-title">{item.title}</div>
                                <div className="summary-pill-value">{item.value}</div>
                            </div>
                        ))
                    )}
                </div>
                {executiveMetrics.avgEstimatedMargin !== 0 && (
                    <div style={{ marginTop: '1rem', color: 'var(--color-text-muted)' }}>
                        Margen bruto estimado promedio del período: <strong style={{ color: executiveMetrics.avgEstimatedMargin >= 0 ? '#22c55e' : '#ef4444' }}>{formatCurrency(executiveMetrics.avgEstimatedMargin)}</strong>
                    </div>
                )}
            </DirectionalReveal>

            {selectedLog && (
                <div className="neo-card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'start', marginBottom: '1rem' }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                                Dashboard de despostada
                            </div>
                            <h3 style={{ margin: 0 }}>{selectedLog.supplier || selectedLot?.supplier || 'Proveedor Desconocido'}</h3>
                            <div style={{ color: 'var(--color-text-muted)', marginTop: '0.35rem' }}>
                                {new Date(selectedLog.date).toLocaleString()} · {selectedLog.type?.toUpperCase()} · Lote #{selectedLog.lot_id || 'N/D'}
                            </div>
                        </div>
                        <button className="neo-button" type="button" onClick={closeLogDetail} style={{ background: 'transparent', border: '1px solid var(--color-border)' }}>
                            Cerrar detalle
                        </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                        <div className="log-stat">
                            <span>Peso Inicial</span>
                            <strong>{formatKg(selectedInitialWeight)}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Rendimiento</span>
                            <strong style={{ color: selectedLog.yield_percentage > 70 ? '#22c55e' : '#ef4444' }}>{formatPercent(selectedLog.yield_percentage)}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Peso procesado</span>
                            <strong>{formatKg(selectedProcessedWeight)}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Merma estimada</span>
                            <strong>{formatKg(selectedMermaWeight)} · {formatPercent(selectedMermaPercentage)}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Proveedor</span>
                            <strong>{selectedLog.supplier || selectedLot?.supplier || 'N/D'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Compra origen</span>
                            <strong>{selectedPurchase?.invoice_num || `#${selectedLot?.purchase_id || 'N/D'}`}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Fecha compra</span>
                            <strong>{selectedPurchase?.date ? new Date(selectedPurchase.date).toLocaleDateString() : 'N/D'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Estado lote</span>
                            <strong>{selectedLot?.status || 'despostado'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Cortes registrados</span>
                            <strong>{selectedLog.cuts_count || selectedCuts.length || 0}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Costo estimado x kg vivo</span>
                            <strong>{selectedCostPerKg > 0 ? formatCurrency(selectedCostPerKg) : 'N/D'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Costo estimado total</span>
                            <strong>{selectedEstimatedTotalCost > 0 ? formatCurrency(selectedEstimatedTotalCost) : 'N/D'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Costo estimado por kg de salida</span>
                            <strong>{selectedEstimatedCostPerOutputKg > 0 ? formatCurrency(selectedEstimatedCostPerOutputKg) : 'N/D'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Objetivo por especie</span>
                            <strong>{formatPercent(selectedTargetYield)}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Desvío vs objetivo</span>
                            <strong style={{ color: yieldDeltaVsTarget >= 0 ? '#22c55e' : '#ef4444' }}>
                                {yieldDeltaVsTarget >= 0 ? '+' : ''}{formatPercent(yieldDeltaVsTarget)}
                            </strong>
                        </div>
                        <div className="log-stat">
                            <span>Promedio histórico proveedor</span>
                            <strong>{supplierHistorical.length > 0 ? formatPercent(supplierHistoricalAvg) : 'N/D'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Desvío vs proveedor</span>
                            <strong style={{ color: yieldDeltaVsSupplier >= 0 ? '#22c55e' : '#ef4444' }}>
                                {supplierHistorical.length > 0 ? `${yieldDeltaVsSupplier >= 0 ? '+' : ''}${formatPercent(yieldDeltaVsSupplier)}` : 'N/D'}
                            </strong>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                        <div className="log-stat">
                            <span>Corte más pesado</span>
                            <strong>{heaviestCut ? `${heaviestCut.cutName} · ${formatKg(heaviestCut.weight)}` : 'Sin detalle de cortes'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Categoría dominante</span>
                            <strong>{bestCategory ? `${bestCategory.category} · ${formatKg(bestCategory.weight)}` : 'Sin categorías'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Factura / Remito</span>
                            <strong>{selectedPurchase?.invoice_num || 'Sin comprobante'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Origen de compra</span>
                            <strong>{selectedLot?.purchase_id ? `Compra #${selectedLot.purchase_id}` : 'Ingreso manual / N/D'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Valorización estimada de salida</span>
                            <strong>{totalEstimatedRevenue > 0 ? formatCurrency(totalEstimatedRevenue) : 'N/D'}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Margen bruto estimado</span>
                            <strong style={{ color: totalEstimatedMargin >= 0 ? '#22c55e' : '#ef4444' }}>
                                {totalEstimatedRevenue > 0 ? formatCurrency(totalEstimatedMargin) : 'N/D'}
                            </strong>
                        </div>
                        <div className="log-stat">
                            <span>Cobertura comercial</span>
                            <strong>{formatPercent(commercialCoverage)}</strong>
                        </div>
                        <div className="log-stat">
                            <span>Corte con mayor valor</span>
                            <strong>{topRevenueCut?.estimatedRevenue > 0 ? `${topRevenueCut.cutName} · ${formatCurrency(topRevenueCut.estimatedRevenue)}` : 'N/D'}</strong>
                        </div>
                    </div>

                    <div style={{ marginTop: '1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                        <div className="neo-card" style={{ padding: '1rem', border: '1px solid var(--color-border)' }}>
                            <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '0.75rem', fontWeight: 700 }}>
                                Distribución del lote
                            </div>
                            {selectedCategoryDonut.length === 0 ? (
                                <div style={{ color: 'var(--color-text-muted)' }}>Sin categorías suficientes para graficar.</div>
                            ) : (
                                <div className="donut-card-layout">
                                    <div className="donut-chart" style={selectedCategoryDonutStyle}>
                                        <div className="donut-chart-center">
                                            <strong>{selectedCategoryDonut.length}</strong>
                                            <span>categorías</span>
                                        </div>
                                    </div>
                                    <div className="donut-legend">
                                        {selectedCategoryDonut.map((segment) => (
                                            <div key={segment.category} className="donut-legend-item">
                                                <span className="donut-legend-color" style={{ background: segment.color }}></span>
                                                <div>
                                                    <strong style={{ textTransform: 'capitalize' }}>{segment.category}</strong>
                                                    <div style={{ color: 'var(--color-text-muted)' }}>{formatKg(segment.weight)} · {formatPercent(segment.percentage)}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="neo-card" style={{ padding: '1rem', border: '1px solid var(--color-border)' }}>
                            <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '0.75rem', fontWeight: 700 }}>
                                Cobertura de precios
                            </div>
                            <div className="donut-card-layout">
                                <div className="donut-chart" style={commercialCoverageStyle}>
                                    <div className="donut-chart-center">
                                        <strong>{formatPercent(commercialCoverage)}</strong>
                                        <span>con precio</span>
                                    </div>
                                </div>
                                <div className="donut-legend">
                                    <div className="donut-legend-item">
                                        <span className="donut-legend-color" style={{ background: '#22c55e' }}></span>
                                        <div>
                                            <strong>Con precio cargado</strong>
                                            <div style={{ color: 'var(--color-text-muted)' }}>{selectedCutsWithCommercials.filter((cut) => cut.hasCommercialData).length} cortes · {formatPercent(commercialCoverage)}</div>
                                        </div>
                                    </div>
                                    <div className="donut-legend-item">
                                        <span className="donut-legend-color" style={{ background: 'rgba(255,255,255,0.18)' }}></span>
                                        <div>
                                            <strong>Sin precio</strong>
                                            <div style={{ color: 'var(--color-text-muted)' }}>{selectedCutsWithCommercials.filter((cut) => !cut.hasCommercialData).length} cortes · {formatPercent(missingCommercialCoverage)}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="neo-card" style={{ padding: '1rem', border: '1px solid var(--color-border)' }}>
                            <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '0.75rem', fontWeight: 700 }}>
                                Resumen de categorías
                            </div>
                            {selectedCategoryTotals.length === 0 ? (
                                <div style={{ color: 'var(--color-text-muted)' }}>Todavía no hay pesos por categoría guardados para esta despostada.</div>
                            ) : (
                                <div style={{ display: 'grid', gap: '0.6rem' }}>
                                    {[...selectedCategoryTotals]
                                        .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0))
                                        .map((category) => (
                                            <div key={category.category} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{category.category}</div>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{category.count || 0} cortes</div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontWeight: 700 }}>{formatKg(category.weight)}</div>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                                        {selectedInitialWeight > 0 ? formatPercent((Number(category.weight) || 0) / selectedInitialWeight * 100) : '0.0%'}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>

                        <div className="neo-card" style={{ padding: '1rem', border: '1px solid var(--color-border)' }}>
                            <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '0.75rem', fontWeight: 700 }}>
                                Trazabilidad del lote
                            </div>
                            <div style={{ display: 'grid', gap: '0.6rem', color: 'var(--color-text-main)' }}>
                                <div><strong>Especie:</strong> {selectedLot?.species || selectedLog.type || 'N/D'}</div>
                                <div><strong>Proveedor:</strong> {selectedLog.supplier || selectedLot?.supplier || 'N/D'}</div>
                                <div><strong>Fecha lote:</strong> {selectedLot?.date ? new Date(selectedLot.date).toLocaleDateString() : 'N/D'}</div>
                                <div><strong>Peso lote origen:</strong> {selectedLot?.weight ? formatKg(selectedLot.weight) : formatKg(selectedInitialWeight)}</div>
                                <div><strong>Estado actual:</strong> {selectedLot?.status || 'despostado'}</div>
                            </div>
                        </div>

                        <div className="neo-card" style={{ padding: '1rem', border: '1px solid var(--color-border)' }}>
                            <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '0.75rem', fontWeight: 700 }}>
                                Lectura comercial
                            </div>
                            <div style={{ display: 'grid', gap: '0.6rem', color: 'var(--color-text-main)' }}>
                                <div><strong>Facturación potencial:</strong> {totalEstimatedRevenue > 0 ? formatCurrency(totalEstimatedRevenue) : 'Sin precios suficientes'}</div>
                                <div><strong>Margen bruto:</strong> {totalEstimatedRevenue > 0 ? formatCurrency(totalEstimatedMargin) : 'N/D'}</div>
                                <div><strong>Cobertura de precios:</strong> {formatPercent(commercialCoverage)}</div>
                                <div><strong>Señal de merma:</strong> {selectedMermaPercentage > 12 ? 'Alta' : selectedMermaPercentage > 8 ? 'Media' : 'Controlada'}</div>
                                <div><strong>Lectura del rinde:</strong> {yieldDeltaVsTarget >= 0 ? 'Por encima del objetivo' : 'Por debajo del objetivo'}</div>
                            </div>
                        </div>
                    </div>

                    <div className="neo-card" style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '0.75rem', fontWeight: 700 }}>
                            Desglose por pieza
                        </div>
                        {selectedCuts.length === 0 ? (
                            <div style={{ color: 'var(--color-text-muted)' }}>
                                Este lote no tiene piezas detalladas guardadas. Los próximos cierres de despostada ya van a registrar el detalle completo.
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table className="pro-table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Corte</th>
                                            <th>Categoría</th>
                                            <th>Peso</th>
                                            <th>% del lote</th>
                                            <th>Precio/kg</th>
                                            <th>Valor estimado</th>
                                            <th>Margen estimado</th>
                                            <th>Hora</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...selectedCutsWithCommercials]
                                            .sort((a, b) => (Number(b.estimatedRevenue) || Number(b.weight) || 0) - (Number(a.estimatedRevenue) || Number(a.weight) || 0))
                                            .map((cut, index) => (
                                                <tr key={`${cut.cutId}-${index}`}>
                                                    <td>{cut.cutNumber || index + 1}</td>
                                                    <td style={{ fontWeight: 'bold' }}>{cut.cutName}</td>
                                                    <td style={{ textTransform: 'capitalize' }}>{cut.cutCategory || 'sin categoria'}</td>
                                                    <td>{formatKg(cut.weight)}</td>
                                                    <td>{selectedInitialWeight > 0 ? formatPercent((Number(cut.weight) || 0) / selectedInitialWeight * 100) : '0.0%'}</td>
                                                    <td>{cut.salePricePerKg > 0 ? formatCurrency(cut.salePricePerKg) : 'N/D'}</td>
                                                    <td>{cut.estimatedRevenue > 0 ? formatCurrency(cut.estimatedRevenue) : 'N/D'}</td>
                                                    <td style={{ color: cut.estimatedRevenue > 0 ? (cut.estimatedMargin >= 0 ? '#22c55e' : '#ef4444') : 'var(--color-text-muted)' }}>
                                                        {cut.estimatedRevenue > 0 ? formatCurrency(cut.estimatedMargin) : 'N/D'}
                                                    </td>
                                                    <td>{cut.timestamp ? new Date(cut.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/D'}</td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <DirectionalReveal className="pro-grid" from="left" delay={0.22}>
                {/* SUPPLIER RANKING CARD */}
                <div className="neo-card ranking-card" style={{ padding: '1.5rem' }}>
                    <div className="card-header">
                        <Users size={20} color="var(--color-primary)" />
                        <h3>Ranking de Proveedores (Mejor Rinde)</h3>
                    </div>
                    <div className="ranking-table-container">
                        <table className="pro-table">
                            <thead>
                                <tr>
                                    <th>Proveedor</th>
                                    <th>Cant.</th>
                                    <th>Peso Prom.</th>
                                    <th>Rinde Avg.</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ranking.map((s) => (
                                    <tr key={s.name}>
                                        <td style={{ fontWeight: 'bold' }}>{s.name}</td>
                                        <td>{s.count}</td>
                                        <td>{s.avgWeight} kg</td>
                                        <td style={{ color: parseFloat(s.avgYield) > 70 ? '#22c55e' : '#ef4444' }}>
                                            {s.avgYield}%
                                        </td>
                                        <td>
                                            <span className={`badge ${parseFloat(s.avgYield) > 72 ? 'success' : (parseFloat(s.avgYield) > 68 ? 'warning' : 'danger')}`}>
                                                {parseFloat(s.avgYield) > 72 ? 'Excelente' : (parseFloat(s.avgYield) > 68 ? 'Aceptable' : 'Pobre')}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                                {ranking.length === 0 && (
                                    <tr>
                                        <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>No hay datos de despostada aún.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* YIELD PERFORMANCE TREND */}
                <div className="neo-card trend-card" style={{ padding: '1.5rem' }}>
                    <div className="card-header">
                        <Target size={20} color="var(--color-primary)" />
                        <h3>Objetivos de Rendimiento</h3>
                    </div>
                    <div className="target-progress-area">
                        <div className="target-item">
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <span>Media Res Vaca (Optimum: 74%)</span>
                                <span>Promedio: {avgCowYield}%</span>
                            </div>
                            <div className="progress-bar-bg">
                                <div className="progress-bar-fill" style={{ width: `${Math.min((avgCowYield / 74) * 100, 100)}%` }}></div>
                            </div>
                        </div>
                    </div>
                    {worstSupplier && worstSupplier.avgYield < 70 && (
                        <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '10px', border: '1px solid #ef4444' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: '#b91c1c', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                                <TrendingUp size={18} /> Alerta PRO:
                            </div>
                            <p style={{ fontSize: '0.85rem', color: '#b91c1c', margin: 0 }}>
                                El rinde promedio del proveedor **"{worstSupplier.name}"** ({worstSupplier.avgYield}%) está por debajo del estándar aceptable. Considerá renegociar precios por merma excesiva.
                            </p>
                        </div>
                    )}
                </div>
            </DirectionalReveal>

            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
                <div className="neo-card" style={{ padding: '1.25rem' }}>
                    <div className="card-header" style={{ marginBottom: '1rem' }}>
                        <TrendingUp size={20} color="var(--color-primary)" />
                        <h3>Recovery por Categoría</h3>
                    </div>
                    {categoryRecovery.length === 0 ? (
                        <div style={{ color: 'var(--color-text-muted)' }}>Todavía no hay categorías suficientes para graficar.</div>
                    ) : (
                        <div style={{ display: 'grid', gap: '0.85rem' }}>
                            {categoryRecovery.map((entry) => (
                                <div key={entry.category}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.35rem' }}>
                                        <strong style={{ textTransform: 'capitalize' }}>{entry.category}</strong>
                                        <span style={{ color: 'var(--color-text-muted)' }}>{formatKg(entry.weight)} · {formatPercent(entry.avgShare)}</span>
                                    </div>
                                    <div className="progress-bar-bg" style={{ height: '12px' }}>
                                        <div className="progress-bar-fill" style={{ width: `${Math.min(entry.avgShare, 100)}%` }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="neo-card" style={{ padding: '1.25rem' }}>
                    <div className="card-header" style={{ marginBottom: '1rem' }}>
                        <ArrowRight size={20} color="var(--color-primary)" />
                        <h3>Recovery por Corte</h3>
                    </div>
                    {cutRecovery.length === 0 ? (
                        <div style={{ color: 'var(--color-text-muted)' }}>Todavía no hay cortes suficientes para graficar.</div>
                    ) : (
                        <div style={{ display: 'grid', gap: '0.85rem' }}>
                            {cutRecovery.slice(0, 6).map((entry) => (
                                <div key={entry.cutName}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.35rem' }}>
                                        <strong>{entry.cutName}</strong>
                                        <span style={{ color: 'var(--color-text-muted)' }}>{formatKg(entry.weight)} · {formatPercent(entry.avgShare)}</span>
                                    </div>
                                    <div className="progress-bar-bg" style={{ height: '12px' }}>
                                        <div className="progress-bar-fill" style={{ width: `${Math.min(entry.avgShare, 100)}%`, background: 'linear-gradient(90deg, #f59e0b, #f97316)' }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="neo-card" style={{ marginTop: '1.5rem', padding: '1.25rem' }}>
                <div className="card-header" style={{ marginBottom: '1rem' }}>
                    <ShieldCheck size={20} color="var(--color-primary)" />
                    <h3>Alertas Automáticas</h3>
                </div>
                {alerts.length === 0 ? (
                    <div style={{ color: 'var(--color-text-muted)' }}>No se detectaron alertas críticas en el rango analizado.</div>
                ) : (
                    <div style={{ display: 'grid', gap: '0.9rem' }}>
                        {alerts.map((alert, index) => (
                            <div
                                key={`${alert.title}-${index}`}
                                style={{
                                    padding: '0.95rem 1rem',
                                    borderRadius: '12px',
                                    border: `1px solid ${alert.severity === 'danger' ? 'rgba(239,68,68,0.45)' : 'rgba(245,158,11,0.45)'}`,
                                    background: alert.severity === 'danger' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)'
                                }}
                            >
                                <div style={{ fontWeight: 700, marginBottom: '0.35rem', color: alert.severity === 'danger' ? '#f87171' : '#f59e0b' }}>
                                    {alert.title}
                                </div>
                                <div style={{ color: 'var(--color-text-main)', lineHeight: 1.45 }}>
                                    {alert.message}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="neo-card" style={{ marginTop: '1.5rem', padding: '1.25rem' }}>
                <div className="card-header" style={{ marginBottom: '1rem' }}>
                    <Calendar size={20} color="var(--color-primary)" />
                    <h3>Comparativo Mes vs Mes</h3>
                </div>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                    Comparación del rinde promedio del mes actual contra el mes anterior por proveedor y especie.
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table className="pro-table">
                        <thead>
                            <tr>
                                <th>Proveedor</th>
                                <th>Especie</th>
                                <th>Mes actual</th>
                                <th>Mes anterior</th>
                                <th>Delta</th>
                                <th>Lectura</th>
                            </tr>
                        </thead>
                        <tbody>
                            {monthlyComparative.length === 0 ? (
                                <tr>
                                    <td colSpan="6" style={{ textAlign: 'center', padding: '1.5rem' }}>
                                        No hay suficiente histórico para comparar meses.
                                    </td>
                                </tr>
                            ) : (
                                monthlyComparative.slice(0, 12).map((row) => (
                                    <tr key={`${row.supplier}-${row.species}`}>
                                        <td style={{ fontWeight: 'bold' }}>{row.supplier}</td>
                                        <td style={{ textTransform: 'capitalize' }}>{row.species}</td>
                                        <td>
                                            {row.currentCount > 0
                                                ? `${formatPercent(row.currentAvgYield)} · ${row.currentCount} lotes`
                                                : 'Sin datos'}
                                        </td>
                                        <td>
                                            {row.previousCount > 0
                                                ? `${formatPercent(row.previousAvgYield)} · ${row.previousCount} lotes`
                                                : 'Sin datos'}
                                        </td>
                                        <td style={{ color: row.yieldDelta >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                                            {row.previousCount > 0 || row.currentCount > 0
                                                ? `${row.yieldDelta >= 0 ? '+' : ''}${formatPercent(row.yieldDelta)}`
                                                : 'N/D'}
                                        </td>
                                        <td>
                                            {row.previousCount === 0
                                                ? 'Sin base comparativa'
                                                : row.yieldDelta >= 2
                                                    ? 'Mejora fuerte'
                                                    : row.yieldDelta >= 0
                                                        ? 'Mejora leve'
                                                        : row.yieldDelta <= -2
                                                            ? 'Caída fuerte'
                                                            : 'Caída leve'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* RECENT DETAILED LOGS */}
            <h2 style={{ marginTop: '2.5rem', marginBottom: '1rem', fontSize: '1.2rem' }}>Últimas Despostadas Detalladas</h2>
            <DirectionalReveal className="logs-grid" from="down" delay={0.28}>
                {filteredLogs?.slice(0, 10).map(log => (
                    <button
                        key={log.id}
                        type="button"
                        className="neo-card log-report-card"
                        onClick={() => openLogDetail(log.id)}
                        style={{ textAlign: 'left', width: '100%', background: 'var(--color-bg-card)', cursor: 'pointer' }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <span className="log-type-tag">{log.type.toUpperCase()}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{new Date(log.date).toLocaleDateString()}</span>
                        </div>
                        <h4 style={{ marginBottom: '0.5rem' }}>{log.supplier || 'Proveedor Desconocido'}</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="log-stat">
                                <span>Peso Inicial</span>
                                <strong>{log.total_weight} kg</strong>
                            </div>
                            <div className="log-stat">
                                <span>Rendimiento</span>
                                <strong style={{ color: log.yield_percentage > 70 ? '#22c55e' : '#ef4444' }}>{log.yield_percentage}%</strong>
                            </div>
                        </div>
                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Análisis de Costo Real</span>
                            <ArrowRight size={16} />
                        </div>
                    </button>
                ))}
            </DirectionalReveal>
        </div>
    );
};

export default InformesPro;
