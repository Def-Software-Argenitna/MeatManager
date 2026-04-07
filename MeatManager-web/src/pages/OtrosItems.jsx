import React, { useState } from 'react';
import { Package, Plus, Search, Trash2 } from 'lucide-react';
import DirectionalReveal from '../components/DirectionalReveal';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import './Stock.css'; // Reusing Stock styles for consistency

const OtrosItems = () => {
    const [items, setItems] = useState([]);

    const [newItem, setNewItem] = useState({ name: '', quantity: '' });

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

        await saveTableRecord('stock', 'insert', {
            name: newItem.name,
            quantity: parseFloat(newItem.quantity),
            type: 'insumo',
            updated_at: new Date().toISOString()
        });
        setNewItem({ name: '', quantity: '' });
        await loadItems();
    };

    const handleDelete = async (id) => {
        if (confirm('¿Borrar este ítem?')) {
            await saveTableRecord('stock', 'delete', null, id);
            await loadItems();
        }
    }

    return (
        <div className="stock-container animate-fade-in">
            <DirectionalReveal from="up" delay={0.04}>
            <header className="page-header">
                <div>
                    <h1 className="page-title">Otros Items e Insumos</h1>
                    <p className="page-description">Carbón, leña, especias y descartables</p>
                </div>
            </header>
            </DirectionalReveal>

            <DirectionalReveal className="neo-card" from="left" delay={0.1} style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>Agregar Nuevo Insumo</h3>
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
                    <button type="submit" className="neo-button">
                        <Plus size={18} /> Agregar
                    </button>
                </form>
            </DirectionalReveal>

            <div className="stock-grid">
                {items?.map((item, index) => (
                    <DirectionalReveal key={item.id} className="stock-card neo-card" from={index % 2 === 0 ? 'left' : 'right'} delay={0.16 + (index * 0.03)}>
                        <div className="stock-icon-wrapper" style={{ backgroundColor: 'var(--color-bg-main)' }}>
                            <Package size={24} color="var(--color-primary)" />
                        </div>
                        <div className="stock-info">
                            <h3>{item.name}</h3>
                            <div className="stock-quantity">
                                {item.quantity} <sub>unid.</sub>
                            </div>
                        </div>
                        <button
                            onClick={() => handleDelete(item.id)}
                            style={{ position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                        >
                            <Trash2 size={16} />
                        </button>
                    </DirectionalReveal>
                ))}
            </div>

            {(!items || items.length === 0) && (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                    No hay insumos registrados.
                </div>
            )}
        </div>
    );
};

export default OtrosItems;
