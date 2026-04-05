import React, { useState } from 'react';
import { Folder, FolderPlus, ChevronRight, X, Edit2, Trash2, Save } from 'lucide-react';
import { fetchTable, saveTableRecord } from '../utils/apiClient';

const Categorias = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingNode, setEditingNode] = useState(null);
    const [newItem, setNewItem] = useState({ name: '', parent_id: null });
    const [categories, setCategories] = useState([]);

    const loadCategories = React.useCallback(async () => {
        const rows = await fetchTable('categories');
        setCategories(Array.isArray(rows) ? rows : []);
    }, []);

    React.useEffect(() => {
        loadCategories().catch((error) => console.error('Error cargando categorías:', error));
    }, [loadCategories]);

    // Tree Builder: Convert flat list to tree
    const categoryTree = React.useMemo(() => {
        if (!categories) return [];
        const roots = categories.filter(c => !c.parent_id);
        const mapChildren = (parent) => {
            const children = categories.filter(c => c.parent_id === parent.id);
            return { ...parent, children: children.map(mapChildren) };
        };
        return roots.map(mapChildren);
    }, [categories]);

    const handleSave = async (e) => {
        e.preventDefault();
        if (!newItem.name) return;

        if (editingNode) {
            await saveTableRecord('categories', 'update', { name: newItem.name }, editingNode.id);
            setEditingNode(null);
        } else {
            await saveTableRecord('categories', 'insert', {
                name: newItem.name,
                parent_id: newItem.parent_id || null
            });
        }

        await loadCategories();
        setIsModalOpen(false);
        setNewItem({ name: '', parent_id: null });
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Seguro que deseas eliminar esta categoría?')) {
            // Check for children
            const hasChildren = categories.some(c => c.parent_id === id);
            if (hasChildren) {
                alert("No se puede eliminar una categoría que contiene sub-categorías.");
                return;
            }
            await saveTableRecord('categories', 'delete', null, id);
            await loadCategories();
        }
    };

    const openForSub = (parentId) => {
        setEditingNode(null);
        setNewItem({ name: '', parent_id: parentId });
        setIsModalOpen(true);
    };

    const openForEdit = (node) => {
        setEditingNode(node);
        setNewItem({ name: node.name, parent_id: node.parent_id });
        setIsModalOpen(true);
    };

    const CategoryItem = ({ node, level = 0 }) => (
        <div style={{ marginLeft: level * 20 + 'px', marginBottom: '0.5rem' }}>
            <div className="neo-card" style={{ padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderLeft: level === 0 ? '4px solid var(--color-primary)' : '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {level === 0 ? <Folder size={20} color="var(--color-primary)" /> : <ChevronRight size={16} color="var(--color-text-muted)" />}
                    <span style={{ fontWeight: level === 0 ? '700' : '400', fontSize: level === 0 ? '1rem' : '0.95rem' }}>
                        {node.name}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-main)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                        ID: {node.id}
                    </span>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {level === 0 && (
                        <button title="Agregar Sub-categoría" onClick={() => openForSub(node.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-main)' }}>
                            <FolderPlus size={16} />
                        </button>
                    )}
                    <button title="Editar" onClick={() => openForEdit(node)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6' }}>
                        <Edit2 size={16} />
                    </button>
                    <button title="Eliminar" onClick={() => handleDelete(node.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>
            {node.children && node.children.map(child => (
                <CategoryItem key={child.id} node={child} level={level + 1} />
            ))}
        </div>
    );

    return (
        <div className="animate-fade-in">
            <header className="page-header">
                <div className="page-header-main">
                    <h1 className="page-title">Categorías</h1>
                    <p className="page-description">Estructura de productos (Rubros y Sub-rubros)</p>
                </div>
                <div className="page-header-actions">
                    <button className="neo-button" onClick={() => { setEditingNode(null); setNewItem({ name: '', parent_id: null }); setIsModalOpen(true); }}>
                        <PlusIcon size={20} />
                        Nueva Categoría Principal
                    </button>
                </div>
            </header>

            <div style={{ maxWidth: '800px' }}>
                {categoryTree.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
                        <Folder size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                        <p>No hay categorías definidas.</p>
                        <p>Crea una "Principal" (ej: Carnes) y luego agrega sub-categorías dentro.</p>
                    </div>
                ) : categoryTree.map(root => (
                    <CategoryItem key={root.id} node={root} />
                ))}
            </div>

            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-content neo-card" onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                                {editingNode ? 'Editar Categoría' : (newItem.parent_id ? 'Nueva Sub-categoría' : 'Nueva Categoría Principal')}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={24} /></button>
                        </div>

                        <form onSubmit={handleSave}>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Nombre</label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="neo-input"
                                    placeholder={newItem.parent_id ? "Ej: Vaca, Pollo..." : "Ej: Carnes, Bebidas..."}
                                    value={newItem.name}
                                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                />
                            </div>

                            {newItem.parent_id && (
                                <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                                    Pertenece a la categoría padre ID: {newItem.parent_id}
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                <button type="button" onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.5rem 1rem', color: 'var(--color-text-main)', cursor: 'pointer' }}>Cancel</button>
                                <button type="submit" className="neo-button">Guardar</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

// Helper component for the Plus icon which was missing in imports
const PlusIcon = ({ size }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
);

export default Categorias;
