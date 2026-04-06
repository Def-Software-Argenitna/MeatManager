import React, { useState } from 'react';
import { Plus, Trash2, Package } from 'lucide-react';
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

    const loadPreElaborados = React.useCallback(async () => {
        const rows = await fetchTable('stock');
        const filtered = (Array.isArray(rows) ? rows : [])
            .filter((item) => item.type === 'pre-elaborado')
            .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
        setPreElaborados(filtered);
    }, []);

    React.useEffect(() => {
        loadPreElaborados().catch((error) => console.error('Error cargando pre-elaborados:', error));
    }, [loadPreElaborados]);

    const handleAddProduct = async () => {
        if (unitType === 'unidades' && (!quantity || quantity <= 0)) {
            alert('Por favor ingrese la cantidad de unidades');
            return;
        }
        if (unitType === 'peso' && (!weight || weight <= 0)) {
            alert('Por favor ingrese el peso');
            return;
        }

        const productType = PRODUCT_TYPES.find(p => p.id === selectedProductType);
        const meatType = MEAT_TYPES.find(m => m.id === selectedMeatType);

        const productName = `${productType.name} de ${meatType.name}`;

        try {
            await saveTableRecord('stock', 'insert', {
                name: productName,
                type: 'pre-elaborado',
                subtype: selectedProductType,
                meat_type: selectedMeatType,
                quantity: unitType === 'unidades' ? parseFloat(quantity) : parseFloat(weight),
                unit: unitType === 'unidades' ? 'unidades' : 'kg',
                updated_at: new Date().toISOString(),
            });

            // Reset form
            setQuantity('');
            setWeight('');
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
            <header className="page-header">
                <div className="page-header-main">
                    <h1 className="page-title">
                        <Package size={32} />
                        Alimentos Pre-elaborados
                    </h1>
                    <p className="page-description">Carga de productos preparados (milanesas, hamburguesas, etc.)</p>
                </div>
            </header>

            <div className="alimentos-workspace">

                {/* LEFT: Formulario de carga */}
                <div className="product-form-card">
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

                    {/* Preview del producto */}
                    <div className="product-preview">
                        <div className="preview-label">Vista previa:</div>
                        <div className="preview-content">
                            <span className="preview-icon">
                                {PRODUCT_TYPES.find(p => p.id === selectedProductType)?.icon}
                            </span>
                            <span className="preview-name">
                                {PRODUCT_TYPES.find(p => p.id === selectedProductType)?.name} de {MEAT_TYPES.find(m => m.id === selectedMeatType)?.name}
                            </span>
                            {(quantity || weight) && (
                                <span className="preview-quantity">
                                    {unitType === 'unidades' ? `${quantity} unidades` : `${weight} kg`}
                                </span>
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
                </div>

                {/* RIGHT: Lista de productos cargados */}
                <div className="products-list-card">
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
                </div>

            </div>
        </div>
    );
};

export default Alimentos;
