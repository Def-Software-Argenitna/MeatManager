import React, { useState } from 'react';
import { Edit2, Package, Plus, Trash2 } from 'lucide-react';
import DirectionalReveal from '../components/DirectionalReveal';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import { Button, EmptyState } from '../components/ui';
import './Stock.css'; // Reusing Stock styles for consistency
import './OtrosItems.css';

const PRESENTATION_OPTIONS = [
    { value: 'unidades', label: 'Unidades' },
    { value: 'kg', label: 'Kilos' },
    { value: 'l', label: 'Litros' },
    { value: 'caja', label: 'Caja' },
    { value: 'bolsa', label: 'Bolsa' },
    { value: 'pack', label: 'Pack' },
    { value: 'botella', label: 'Botella' },
];
const USAGE_OPTIONS = [
    { value: 'venta', label: 'Para vender' },
    { value: 'interno', label: 'Consumo interno' },
];

const OtrosItems = () => {
    const [items, setItems] = useState([]);
    const [editingItemId, setEditingItemId] = useState(null);

    const [newItem, setNewItem] = useState({ name: '', quantity: '', presentation: 'unidades', barcode: '', usage: 'venta' });

    const loadItems = React.useCallback(async () => {
        const rows = await fetchTable('stock');
        setItems((Array.isArray(rows) ? rows : []).filter((item) => item.type === 'insumo'));
    }, []);

    React.useEffect(() => {
        loadItems().catch((error) => console.error('Error cargando insumos:', error));
    }, [loadItems]);

    const handleAddItem = async (e) => {
        e.preventDefault();
        if (!newItem.name || !newItem.quantity) return;

        const payload = {
            name: newItem.name,
            quantity: parseFloat(newItem.quantity),
            type: 'insumo',
            usage: newItem.usage || 'venta',
            unit: newItem.presentation,
            presentation: newItem.presentation,
            barcode: newItem.barcode.trim() || null,
            updated_at: new Date().toISOString()
        };

        if (editingItemId) {
            await saveTableRecord('stock', 'update', payload, editingItemId);
        } else {
            await saveTableRecord('stock', 'insert', payload);
        }

        setNewItem({ name: '', quantity: '', presentation: 'unidades', barcode: '', usage: 'venta' });
        setEditingItemId(null);
        await loadItems();
    };

    const handleEdit = (item) => {
        setEditingItemId(item.id);
        setNewItem({
            name: String(item.name || ''),
            quantity: String(item.quantity ?? ''),
            presentation: String(item.presentation || item.unit || 'unidades'),
            barcode: String(item.barcode || ''),
            usage: String(item.usage || 'venta'),
        });
    };

    const handleCancelEdit = () => {
        setEditingItemId(null);
        setNewItem({ name: '', quantity: '', presentation: 'unidades', barcode: '', usage: 'venta' });
    };

    const handleDelete = async (id) => {
        if (confirm('¿Borrar este ítem?')) {
            await saveTableRecord('stock', 'delete', null, id);
            await loadItems();
        }
    }

    return (
        <div className="stock-container animate-fade-in">
            <DirectionalReveal className="neo-card" from="left" delay={0.1} style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>{editingItemId ? 'Editar Insumo' : 'Agregar Nuevo Insumo'}</h3>
                <form onSubmit={handleAddItem} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <input
                        type="text"
                        placeholder="Nombre (ej: Bolsa Carbón 5kg)"
                        className="neo-input"
                        style={{ flex: 2, marginBottom: 0 }}
                        value={newItem.name}
                        onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                    />
                    <input
                        type="number"
                        placeholder="Cant."
                        className="neo-input"
                        style={{ flex: 1, marginBottom: 0 }}
                        value={newItem.quantity}
                        onChange={e => setNewItem({ ...newItem, quantity: e.target.value })}
                    />
                    <select
                        className="neo-input"
                        style={{ flex: 1, marginBottom: 0 }}
                        value={newItem.presentation}
                        onChange={e => setNewItem({ ...newItem, presentation: e.target.value })}
                    >
                        {PRESENTATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    <input
                        type="text"
                        placeholder="Código de barra (opcional)"
                        className="neo-input"
                        style={{ flex: 2, marginBottom: 0 }}
                        value={newItem.barcode}
                        onChange={e => setNewItem({ ...newItem, barcode: e.target.value })}
                    />
                    <select
                        className="neo-input"
                        style={{ flex: 1, marginBottom: 0 }}
                        value={newItem.usage}
                        onChange={e => setNewItem({ ...newItem, usage: e.target.value })}
                    >
                        {USAGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    <Button type="submit" variant="primary" icon={editingItemId ? <Edit2 size={18} /> : <Plus size={18} />}>
                        {editingItemId ? 'Guardar cambios' : 'Agregar'}
                    </Button>
                    {editingItemId && (
                        <Button variant="secondary" onClick={handleCancelEdit}>
                            Cancelar
                        </Button>
                    )}
                </form>
            </DirectionalReveal>

            <div className="otros-items-grid">
                {items?.map((item, index) => (
                    <DirectionalReveal key={item.id} className="otros-item-card neo-card" from={index % 2 === 0 ? 'left' : 'right'} delay={0.16 + (index * 0.03)}>
                        <div className="otros-item-icon" style={{ backgroundColor: 'var(--color-bg-main)' }}>
                            <Package size={24} color="var(--color-primary)" />
                        </div>
                        <div className="otros-item-info">
                            <h3>{item.name}</h3>
                            <div className="otros-item-quantity">
                                {item.quantity} <sub>{item.presentation || item.unit || 'unid.'}</sub>
                            </div>
                            <div className="otros-item-usage">
                                {String(item.usage || 'venta').toLowerCase() === 'interno' ? 'Consumo interno' : 'Para vender'}
                            </div>
                            {item.barcode && (
                                <div className="otros-item-barcode">
                                    Cod. barra: {item.barcode}
                                </div>
                            )}
                        </div>
                        <div className="otros-item-actions">
                            <Button variant="ghost" size="sm" icon={<Edit2 size={16} />} onClick={() => handleEdit(item)} title="Editar ítem" />
                            <Button variant="ghost" size="sm" icon={<Trash2 size={16} color="#ef4444" />} onClick={() => handleDelete(item.id)} title="Eliminar ítem" />
                        </div>
                    </DirectionalReveal>
                ))}
            </div>

            {(!items || items.length === 0) && (
                <EmptyState icon={Package} title="Sin insumos" description="No hay insumos registrados todavía." />
            )}
        </div>
    );
};

export default OtrosItems;
