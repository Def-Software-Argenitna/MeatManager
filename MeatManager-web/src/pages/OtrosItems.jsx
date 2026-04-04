import React, { useState } from 'react';
import { Package, Plus, Search, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import './Stock.css'; // Reusing Stock styles for consistency

const OtrosItems = () => {
    // We might need a separate table for 'otros' or just use 'stock' with type='other'
    // For now, let's assume we use the main stock table but filter by type

    // Check if we need to add 'other' items to stock table or if they are already there
    const items = useLiveQuery(
        () => db.stock?.where('type').equals('insumo').toArray()
    );

    const [newItem, setNewItem] = useState({ name: '', quantity: '' });

    const handleAddItem = async (e) => {
        e.preventDefault();
        if (!newItem.name || !newItem.quantity) return;

        await db.stock.add({
            name: newItem.name,
            quantity: parseFloat(newItem.quantity),
            type: 'insumo',
            updated_at: new Date() // Fixed: using Date object handling in Dexie or string if needed, sticking to object or simple string
        });
        setNewItem({ name: '', quantity: '' });
    };

    const handleDelete = (id) => {
        if (confirm('¿Borrar este ítem?')) {
            db.stock.delete(id);
        }
    }

    return (
        <div className="stock-container animate-fade-in">
            <header className="page-header">
                <div>
                    <h1 className="page-title">Otros Items e Insumos</h1>
                    <p className="page-description">Carbón, leña, especias y descartables</p>
                </div>
            </header>

            <div className="neo-card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
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
            </div>

            <div className="stock-grid">
                {items?.map(item => (
                    <div key={item.id} className="stock-card neo-card">
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
                    </div>
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
