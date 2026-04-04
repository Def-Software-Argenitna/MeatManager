import axios from 'axios';
import { db } from '../db';

const OLLAMA_URL = 'http://localhost:11434/api/chat';

/**
 * Gather context data for the AI to analyze.
 */
const getAppContext = async () => {
    // Dates for filtering today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // Get all records
    const allStockRecords = await db.stock.toArray();
    const ventasHoy = await db.ventas.where('date').between(startOfDay, endOfDay).toArray();
    const totalVentasSnapshot = await db.ventas.toArray();

    // Calculate Totals
    const totalRevenueToday = ventasHoy.reduce((acc, v) => acc + (parseFloat(v.total) || 0), 0);
    const totalRevenueHistorical = totalVentasSnapshot.reduce((acc, v) => acc + (parseFloat(v.total) || 0), 0);

    // Group Stock by Name to get actual balance (since they are movement logs)
    const stockBalanceMap = {};
    allStockRecords.forEach(item => {
        if (!stockBalanceMap[item.name]) {
            stockBalanceMap[item.name] = { name: item.name, quantity: 0, type: item.type };
        }
        stockBalanceMap[item.name].quantity += item.quantity;
    });

    const stockBalances = Object.values(stockBalanceMap);

    // Stats for AI
    const lowStock = stockBalances.filter(i => i.quantity < 10).map(i => `${i.name} (${i.quantity.toFixed(1)}kg)`);
    const topStock = [...stockBalances].sort((a, b) => b.quantity - a.quantity).slice(0, 5).map(i => `${i.name} (${i.quantity.toFixed(1)}kg)`);

    // Recent logs
    const recentLogs = await db.app_logs.orderBy('timestamp').reverse().limit(10).toArray();

    return {
        timestamp: new Date().toLocaleString(),
        business_status: {
            revenue_today: totalRevenueToday,
            revenue_total_historical: totalRevenueHistorical,
            total_unique_products: stockBalances.length,
            recent_sales_count_today: ventasHoy.length
        },
        inventory_details: {
            critical_stock_low: lowStock,
            available_stock_overview: stockBalances.map(i => ({ producto: i.name, cantidad: i.quantity.toFixed(1) })),
            top_stock_items: topStock
        },
        system_health: {
            recent_critical_errors: recentLogs.filter(l => l.level === 'error').map(l => l.message),
            last_logs: recentLogs.map(l => `${l.timestamp}: ${l.message}`)
        }
    };
};

/**
 * Handle a natural language query using local Ollama
 */
export const queryLocalAI = async (userPrompt, config = {}) => {
    const { model = 'llama3' } = config;

    try {
        const context = await getAppContext();
        const reportStr = `
INFORME DE CAJA (SOLO PARA PABLO):
- VENTAS_HOY: $${context.business_status.revenue_today}
- ACUMULADO_HISTORICO: $${context.business_status.revenue_total_historical}

INFORME DE STOCK:
- PRODUCTOS_BAJO_MINIMO: ${context.inventory_details.critical_stock_low.join(', ') || 'NINGUNO'}
- RESUMEN_TOTAL: ${context.business_status.total_unique_products} items.
`.trim();

        const response = await axios.post(OLLAMA_URL, {
            model: model,
            messages: [
                {
                    role: 'system',
                    content: 'Sos un secretario administrativo serio. Solo respondes con DATOS. No inventes historias. Si preguntan ventas de hoy, usa VENTAS_HOY. Si hay stock negativo, solo decí el numero, no inventes explicaciones.'
                },
                {
                    role: 'user',
                    content: `${reportStr}\n\nPREGUNTA: "${userPrompt}"\nRESPUESTA CORTA EN ESPAÑOL:`
                }
            ],
            stream: false,
            options: {
                temperature: 0,
                num_predict: 50,
                stop: ["INFORME:", "PREGUNTA:", "RESPUESTA:", "\n"]
            }
        });

        return response.data.message.content.trim();
    } catch (err) {
        console.error("AI Error:", err);
        return "Error de conexión con el cerebro local.";
    }
};

/**
 * Log an app event for AI analysis
 */
export const logAppEvent = async (level, message, details = '') => {
    try {
        await db.app_logs.add({
            level,
            message,
            details,
            timestamp: new Date().toISOString(),
            synced: 0
        });
    } catch (e) {
        console.error("Failed to log app event", e);
    }
};
