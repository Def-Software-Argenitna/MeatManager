import React, { useState } from 'react';
import { Folder, FolderPlus, ChevronRight, Edit2, Trash2, Plus } from 'lucide-react';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import { Button, Modal, useToast } from '../components/ui';

const Categorias = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingNode, setEditingNode] = useState(null);
    const [newItem, setNewItem] = useState({ name: '', parent_id: null });
    const [categories, setCategories] = useState([]);
    const [saving, setSaving] = useState(false);
    const toast = useToast();

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

        setSaving(true);
        try {
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
            toast.success(editingNode ? 'Categoría actualizada' : 'Categoría creada');
        } catch (error) {
            console.error('Error guardando categoría:', error);
            toast.error('No se pudo guardar la categoría. Probá de nuevo.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Seguro que deseas eliminar esta categoría?')) {
            // Check for children
            const hasChildren = categories.some(c => c.parent_id === id);
            if (hasChildren) {
                toast.warning('No se puede eliminar una categoría que contiene sub-categorías.');
                return;
            }
            try {
                await saveTableRecord('categories', 'delete', null, id);
                await loadCategories();
                toast.success('Categoría eliminada');
            } catch (error) {
                console.error('Error eliminando categoría:', error);
                toast.error('No se pudo eliminar la categoría.');
            }
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

                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {level === 0 && (
                        <Button variant="ghost" size="sm" title="Agregar Sub-categoría" icon={<FolderPlus size={16} />} onClick={() => openForSub(node.id)} />
                    )}
                    <Button variant="ghost" size="sm" title="Editar" icon={<Edit2 size={16} color="#3b82f6" />} onClick={() => openForEdit(node)} />
                    <Button variant="ghost" size="sm" title="Eliminar" icon={<Trash2 size={16} color="#ef4444" />} onClick={() => handleDelete(node.id)} />
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

                <div className="page-header-actions">
                    <Button
                        variant="primary"
                        icon={<Plus size={20} />}
                        onClick={() => { setEditingNode(null); setNewItem({ name: '', parent_id: null }); setIsModalOpen(true); }}
                    >
                        Nueva Categoría Principal
                    </Button>
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

            <Modal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                size="sm"
                title={editingNode ? 'Editar Categoría' : (newItem.parent_id ? 'Nueva Sub-categoría' : 'Nueva Categoría Principal')}
            >
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
                            Pertenece a la categoría padre: <strong>{categories.find(c => c.id === newItem.parent_id)?.name || newItem.parent_id}</strong>
                        </div>
                    )}

                    <div className="ui-modal__footer" style={{ marginTop: '0.5rem' }}>
                        <Button variant="ghost" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                        <Button variant="primary" type="submit" loading={saving}>Guardar</Button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default Categorias;
