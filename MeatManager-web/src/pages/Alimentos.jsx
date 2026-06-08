import React, { useState } from 'react';
import { Plus, Trash2, Package } from 'lucide-react';
import DirectionalReveal from '../components/DirectionalReveal';
import { fetchTable, saveTableRecord } from '../utils/apiClient';
import './Alimentos.css';

// Tipos de productos pre-elaborados
const PRODUCT_TYPES = [
    { id: 'milanesa', name: 'Milanesa', icon: '🍖' },
    { id: 'hamburguesa', name: 'Hamburguesa', icon: '🍔' },
];

// Tipos de carne disponibles
const MEAT_TYPES = [
    { id: 'pollo', name: 'Pollo', color: '#f59e0b' },
    { id: 'vaca', name: 'Vaca', color: '#dc2626' },
    { id: 'cerdo', name: 'Cerdo', color: '#ec4899' },
    { id: 'pescado', name: 'Pescado', color: '#3b82f6' },
];

const Alimentos = () => {
    const [selectedProductType, setSelectedProductType] = useState('milanesa');
    const [selectedMeatType, setSelectedMeatType] = useState('pollo');
    const [quantity, setQuantity] = useState('');
    const [weight, setWeight] = useState('');
    const [unitType, setUnitType] = useState('unidades'); // 'unidades' o 'peso'
    const [preElaborados, setPreElaborados] = useState([]);
    const [stockRows, setStockRows] = useState([]);
    const [purchaseItems, setPurchaseItems] = useState([]);
    const [recipeItems, setRecipeItems] = useState([]);
    const [recipeDraft, setRecipeDraft] = useState({ stockKey: '', quantity: '' });

    const loadPreElaborados = React.useCallback(async () => {
        const [rows, purchaseRows] = await Promise.all([
            fetchTable('stock'),
            fetchTable('purchase_items'),
        ]);
        const stockList = Array.isArray(rows) ? rows : [];
        const filtered = stockList
            .filter((item) => item.type === 'pre-elaborado')
            .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
        setPreElaborados(filtered);
        setStockRows(stockList);
        setPurchaseItems(Array.isArray(purchaseRows) ? purchaseRows : []);
    }, []);

    React.useEffect(() => {
        loadPreElaborados().catch((error) => console.error('Error cargando pre-elaborados:', error));
    }, [loadPreElaborados]);

    const eligibleStockOptions = React.useMemo(() => {
        const allowedByProductId = new Set(
            purchaseItems
                .filter((item) => Number(item.is_preelaborable || 0) === 1 && Number(item.product_id || 0) > 0)
                .map((item) => Number(item.product_id))
        );
        const allowedByName = new Set(
            purchaseItems
                .filter((item) => Number(item.is_preelaborable || 0) === 1)
                .map((item) => String(item.name || '').trim().toLowerCase())
        );

        const grouped = new Map();
        stockRows.forEach((row) => {
            if (row.type === 'pre-elaborado') return;
            const matches =
                (Number(row.product_id || 0) > 0 && allowedByProductId.has(Number(row.product_id))) ||
                allowedByName.has(String(row.name || '').trim().toLowerCase());
            if (!matches) return;

            const key = `${row.product_id || 0}:${String(row.name || '').trim().toLowerCase()}:${row.unit || 'kg'}`;
            const current = grouped.get(key) || {
                key,
                product_id: row.product_id || null,
                name: row.name,
                type: row.type,
                unit: row.unit || 'kg',
                quantity: 0,
            };
            current.quantity += Number(row.quantity || 0);
            grouped.set(key, current);
        });

        return [...grouped.values()]
            .filter((item) => item.quantity > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [purchaseItems, stockRows]);

    const selectedDraftItem = React.useMemo(
        () => eligibleStockOptions.find((item) => item.key === recipeDraft.stockKey) || null,
        [eligibleStockOptions, recipeDraft.stockKey]
    );

    const addRecipeItem = () => {
        const selected = selectedDraftItem;
        const qty = Number(recipeDraft.quantity || 0);
        if (!selected || qty <= 0) return;

        const alreadyUsed = recipeItems
            .filter((item) => item.key === selected.key)
            .reduce((acc, item) => acc + Number(item.quantity || 0), 0);
        if ((alreadyUsed + qty) > Number(selected.quantity || 0)) {
            alert('La cantidad supera el stock disponible para ese insumo.');
            return;
        }

        setRecipeItems((prev) => [...prev, {
            key: selected.key,
            product_id: selected.product_id,
            name: selected.name,
            type: selected.type,
            unit: selected.unit,
            quantity: qty,
        }]);
        setRecipeDraft({ stockKey: '', quantity: '' });
    };

    const removeRecipeItem = (indexToRemove) => {
        setRecipeItems((prev) => prev.filter((_, index) => index !== indexToRemove));
    };

    const handleAddProduct = async () => {
        if (unitType === 'unidades' && (!quantity || quantity <= 0)) {
            alert('Por favor ingrese la cantidad de unidades');
            return;
        }
        if (unitType === 'peso' && (!weight || weight <= 0)) {
            alert('Por favor ingrese el peso');
            return;
        }
        if (recipeItems.length === 0) {
            alert('Seleccioná al menos un producto de stock para armar el pre-elaborado.');
            return;
        }

        const productType = PRODUCT_TYPES.find(p => p.id === selectedProductType);
        const meatType = MEAT_TYPES.find(m => m.id === selectedMeatType);

        const productName = `${productType.name} de ${meatType.name}`;

        try {
            for (const item of recipeItems) {
                await saveTableRecord('stock', 'insert', {
                    product_id: item.product_id || null,
                    name: item.name,
                    type: item.type,
                    quantity: -Math.abs(Number(item.quantity || 0)),
                    unit: item.unit,
                    updated_at: new Date().toISOString(),
                    reference: `preelaborado:${productName}`.slice(0, 100),
                });
            }

            await saveTableRecord('stock', 'insert', {
                name: productName,
                type: 'pre-elaborado',
                quantity: unitType === 'unidades' ? parseFloat(quantity) : parseFloat(weight),
                unit: unitType === 'unidades' ? 'unidades' : 'kg',
                updated_at: new Date().toISOString(),
                reference: `preelaborado:${selectedProductType}:${selectedMeatType}`.slice(0, 100),
            });

            // Reset form
            setQuantity('');
            setWeight('');
            setRecipeItems([]);
            setRecipeDraft({ stockKey: '', quantity: '' });
            await loadPreElaborados();

            alert(`✅ ${productName} agregado correctamente`);
        } catch (error) {
            console.error('Error al agregar producto:', error);
            alert('Error al agregar el producto');
        }
    };

    const handleDeleteProduct = async (id) => {
        if (confirm('¿Está seguro de eliminar este producto?')) {
            await saveTableRecord('stock', 'delete', null, id);
            await loadPreElaborados();
        }
    };

    return (
        <div className="alimentos-container animate-fade-in">
            <DirectionalReveal from="up" delay={0.04}>
            <header className="page-header">
                
            </header>
            </DirectionalReveal>

            <div className="alimentos-workspace">

                {/* LEFT: Formulario de carga */}
                <DirectionalReveal className="product-form-card" from="left" delay={0.1}>
                    <h2 className="card-title">Nuevo Producto</h2>

                    {/* Selector de tipo de producto */}
                    <div className="form-section">
                        <label className="form-label">Tipo de Producto</label>
                        <div className="product-type-grid">
                            {PRODUCT_TYPES.map(type => (
                                <button
                                    key={type.id}
                                    type="button"
                                    className={`product-type-btn ${selectedProductType === type.id ? 'active' : ''}`}
                                    onClick={() => setSelectedProductType(type.id)}
                                    aria-pressed={selectedProductType === type.id}
                                >
                                    <span className="product-icon">{type.icon}</span>
                                    <span>{type.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Selector de tipo de carne */}
                    <div className="form-section">
                        <label className="form-label">Tipo de Carne</label>
                        <div className="meat-type-grid">
                            {MEAT_TYPES.map(meat => (
                                <button
                                    key={meat.id}
                                    type="button"
                                    className={`meat-type-btn ${selectedMeatType === meat.id ? 'active' : ''}`}
                                    onClick={() => setSelectedMeatType(meat.id)}
                                    style={{
                                        borderColor: selectedMeatType === meat.id ? meat.color : 'var(--color-border)',
                                        backgroundColor: selectedMeatType === meat.id ? `${meat.color}15` : 'transparent'
                                    }}
                                >
                                    {meat.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Selector de unidad */}
                    <div className="form-section">
                        <label className="form-label">Unidad de Medida</label>
                        <div className="unit-toggle">
                            <button
                                type="button"
                                className={`unit-btn ${unitType === 'unidades' ? 'active' : ''}`}
                                onClick={() => setUnitType('unidades')}
                            >
                                Unidades
                            </button>
                            <button
                                type="button"
                                className={`unit-btn ${unitType === 'peso' ? 'active' : ''}`}
                                onClick={() => setUnitType('peso')}
                            >
                                Peso (kg)
                            </button>
                        </div>
                    </div>

                    {/* Input de cantidad/peso */}
                    <div className="form-section">
                        <label className="form-label">
                            {unitType === 'unidades' ? 'Cantidad de Unidades' : 'Peso Total'}
                        </label>
                        {unitType === 'unidades' ? (
                            <input
                                type="number"
                                className="quantity-input"
                                placeholder="Ej: 12"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                min="0"
                                step="1"
                            />
                        ) : (
                            <div className="weight-input-wrapper">
                                <input
                                    type="number"
                                    className="quantity-input"
                                    placeholder="Ej: 2.5"
                                    value={weight}
                                    onChange={(e) => setWeight(e.target.value)}
                                    min="0"
                                    step="0.1"
                                />
                                <span className="input-suffix">kg</span>
                            </div>
                        )}
                    </div>

                    <div className="form-section">
                        <label className="form-label">Productos desde stock</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr auto', gap: '0.75rem', marginBottom: '0.9rem' }}>
                            <select
                                className="quantity-input"
                                value={recipeDraft.stockKey}
                                onChange={(e) => setRecipeDraft((prev) => ({ ...prev, stockKey: e.target.value }))}
                            >
                                <option value="">Seleccionar insumo habilitado...</option>
                                {eligibleStockOptions.map((item) => (
                                    <option key={item.key} value={item.key}>
                                        {item.name} · {Number(item.quantity || 0).toFixed(item.unit === 'kg' ? 3 : 0)} {item.unit}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="number"
                                className="quantity-input"
                                placeholder="Cant."
                                min="0"
                                step={selectedDraftItem?.unit === 'kg' ? '0.001' : '1'}
                                value={recipeDraft.quantity}
                                onChange={(e) => setRecipeDraft((prev) => ({ ...prev, quantity: e.target.value }))}
                            />
                            <button type="button" className="action-btn" style={{ marginBottom: 0, paddingInline: '1rem' }} onClick={addRecipeItem}>
                                <Plus size={18} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {recipeItems.length === 0 ? (
                                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                                    Todavía no agregaste insumos para este pre-elaborado.
                                </div>
                            ) : (
                                recipeItems.map((item, index) => (
                                    <div key={`${item.key}-${index}`} className="product-item" style={{ padding: '0.85rem 1rem' }}>
                                        <div className="product-item-info">
                                            <div className="product-item-name">{item.name}</div>
                                            <div className="product-item-meta">
                                                <span>{Number(item.quantity).toFixed(item.unit === 'kg' ? 3 : 0)} {item.unit}</span>
                                            </div>
                                        </div>
                                        <button className="delete-btn" type="button" onClick={() => removeRecipeItem(index)} title="Quitar insumo">
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Botón de agregar */}
                    <button
                        className="action-btn"
                        onClick={handleAddProduct}
                        disabled={unitType === 'unidades' ? !quantity : !weight}
                    >
                        <Plus size={20} />
                        Agregar Producto
                    </button>
                </DirectionalReveal>

                {/* RIGHT: Lista de productos cargados */}
                <DirectionalReveal className="products-list-card" from="right" delay={0.16}>
                    <h2 className="card-title">
                        Productos Cargados
                        <span className="products-count">
                            {preElaborados?.length || 0} items
                        </span>
                    </h2>

                    <div className="products-list">
                        {!preElaborados || preElaborados.length === 0 ? (
                            <div className="empty-state">
                                <Package size={48} style={{ opacity: 0.3 }} />
                                <p>No hay productos cargados</p>
                                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                                    Comienza agregando productos desde el formulario
                                </p>
                            </div>
                        ) : (
                            preElaborados.map(product => {
                                const meatType = MEAT_TYPES.find(m => m.id === product.meat_type);
                                const productType = PRODUCT_TYPES.find(p => p.id === product.subtype);

                                return (
                                    <div key={product.id} className="product-item animate-fade-in">
                                        <div className="product-item-icon">
                                            {productType?.icon}
                                        </div>
                                        <div className="product-item-info">
                                            <div className="product-item-name">{product.name}</div>
                                            <div className="product-item-meta">
                                                <span
                                                    className="meat-badge"
                                                    style={{
                                                        backgroundColor: `${meatType?.color}20`,
                                                        color: meatType?.color
                                                    }}
                                                >
                                                    {meatType?.name}
                                                </span>
                                                <span className="product-date">
                                                    {new Date(product.updated_at).toLocaleDateString('es-AR')}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="product-item-quantity">
                                            <span className="quantity-value">
                                                {product.quantity}
                                            </span>
                                            <span className="quantity-unit">
                                                {product.unit}
                                            </span>
                                        </div>
                                        <button
                                            className="delete-btn"
                                            onClick={() => handleDeleteProduct(product.id)}
                                            title="Eliminar producto"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </DirectionalReveal>
            </div>
        </div>
    );
};

export default Alimentos;
