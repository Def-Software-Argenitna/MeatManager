import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    HelpCircle,
    Printer,
    ChevronRight,
    LayoutDashboard,
    ShoppingCart,
    PackageSearch,
    Users,
    ShoppingBag,
    Scale,
    Banknote,
    Smartphone,
    UtensilsCrossed,
    Grid,
    Beef,
    BarChart3,
    Truck,
    CreditCard,
    FolderOpen,
    Package,
    Tag,
    MessageCircle,
    ShieldCheck,
    Calculator,
    DownloadCloud,
    Database,
    ArrowLeftRight,
    Search,
    X,
    BookOpen,
    ExternalLink,
    ChevronDown,
    Percent,
    ReceiptText
} from 'lucide-react';
import './Manual.css';

const Manual = () => {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [activeArea, setActiveArea] = useState('Todos');
    const [openSections, setOpenSections] = useState(() => new Set(['inicio']));

    const sections = [
        {
            id: 'inicio',
            title: 'Inicio Rápido del Sistema',
            icon: <DownloadCloud size={24} />,
            color: '#3498db',
            content: [
                {
                    subtitle: 'Checklist de puesta en marcha',
                    steps: [
                        'Ingresá con un usuario administrador y verificá la sucursal activa.',
                        'Revisá que estén cargados productos, precios y medios de pago.',
                        'Si usás balanza, importá artículos antes de empezar a vender.',
                        'Configurá seguridad (usuarios, permisos y código maestro de borrado).',
                        'Hacé una venta de prueba y validá ticket, stock y caja.'
                    ]
                }
            ]
        },
        {
            id: 'dashboard',
            title: 'Módulo Dashboard',
            icon: <LayoutDashboard size={24} />,
            color: '#2f80ed',
            content: [
                {
                    subtitle: 'Qué controlás en un vistazo',
                    steps: [
                        'Vas a ver métricas de ventas, stock y movimientos del día.',
                        'Usalo como tablero de control para detectar desvíos rápido.',
                        'Si una métrica no carga, revisá conexión o permisos del usuario.',
                        'Tomá decisiones operativas desde este resumen antes de abrir cada módulo.'
                    ]
                }
            ]
        },
        {
            id: 'ventas',
            title: 'Módulo Ventas',
            icon: <Banknote size={24} />,
            color: '#2ecc71',
            content: [
                {
                    subtitle: 'Flujo de venta en mostrador',
                    steps: [
                        'Buscá producto por nombre, PLU o código de barras.',
                        'Cargá kilos/unidades y verificá precio por línea.',
                        'Asigná cliente cuando corresponda (ej: cuenta corriente).',
                        'Aplicá promociones por kg o total de kg según configuración.',
                        'Cobrá ticket con el medio de pago elegido.',
                        'Usá “Eliminar ticket” con código maestro si necesitás anular.'
                    ]
                }
            ]
        },
        {
            id: 'caja',
            title: 'Módulo Caja',
            icon: <Calculator size={24} />,
            color: '#e67e22',
            content: [
                {
                    subtitle: 'Apertura, movimientos y cierre',
                    steps: [
                        'En "Caja", registrá la apertura del día por cada medio de pago.',
                        'Cargá ingresos, egresos y retiros durante la jornada.',
                        'Controlá diferencias entre lo físico y el sistema.',
                        'Cerrá caja solo cuando todos los movimientos estén conciliados.',
                        'Usá los reportes de cierre para auditoría interna.'
                    ]
                }
            ]
        },
        {
            id: 'informes-caja',
            title: 'Informes de Caja',
            icon: <ReceiptText size={24} />,
            color: '#fb923c',
            content: [
                {
                    subtitle: 'Auditoría de movimientos',
                    steps: [
                        'Elegí la fecha y la sucursal que querés analizar.',
                        'Revisá aperturas, ventas, cobros, ingresos, egresos, retiros y transferencias por medio de pago.',
                        'Compará el acumulado esperado con el dinero contado para detectar diferencias.',
                        'Usá el detalle de movimientos para identificar el origen de cada importe.',
                        'Exportá o imprimí el informe cuando necesites respaldar el cierre.'
                    ]
                }
            ]
        },
        {
            id: 'kilos-vendidos',
            title: 'Informe de Kilos Vendidos',
            icon: <Scale size={24} />,
            color: '#38bdf8',
            content: [
                {
                    subtitle: 'Control de balanza y cortes',
                    steps: [
                        'Seleccioná el período y la sucursal para limitar el análisis.',
                        'Compará los kilos pesados en balanza con los kilos efectivamente cobrados.',
                        'Abrí la solapa Ranking de Cortes para ordenar productos por kilos vendidos.',
                        'Filtrá por especie y por día para encontrar los cortes con mayor rotación.',
                        'Investigá diferencias importantes: pueden indicar tickets pendientes, anulados o carga manual.'
                    ]
                }
            ]
        },
        {
            id: 'informes-descuentos',
            title: 'Informe de Descuentos',
            icon: <Percent size={24} />,
            color: '#f472b6',
            content: [
                {
                    subtitle: 'Seguimiento de descuentos aplicados',
                    steps: [
                        'Elegí fecha y sucursal antes de consultar.',
                        'El informe muestra descuentos asociados a operaciones de cuenta corriente.',
                        'Revisá cliente, venta, importe original y descuento para validar cada caso.',
                        'Usá el total del período como control comercial y de autorización.',
                        'Si no aparecen resultados, verificá que existan descuentos en la sucursal y período seleccionados.'
                    ]
                }
            ]
        },
        {
            id: 'detalle-ventas-balanza',
            title: 'Detalle de Ventas de Balanza',
            icon: <Scale size={24} />,
            color: '#a78bfa',
            content: [
                {
                    subtitle: 'Trazabilidad de tickets',
                    steps: [
                        'Ingresá desde Configuración de Balanza y abrí Detalle de Ventas.',
                        'Filtrá por fecha, estado o sucursal para encontrar un ticket.',
                        'Diferenciá ventas originadas en balanza de las ventas cargadas manualmente.',
                        'Abrí un ticket para revisar artículos, kilos, vendedor, total y estado de cobro.',
                        'Anulá únicamente cuando corresponda: si ya estaba cobrado, el sistema revierte la venta relacionada.'
                    ]
                }
            ]
        },
        {
            id: 'compras',
            title: 'Módulo Compras',
            icon: <ShoppingCart size={24} />,
            color: '#16a085',
            content: [
                {
                    subtitle: 'Ingreso de mercadería',
                    steps: [
                        'Registrá proveedor, comprobante, forma de pago y detalle de compra.',
                        'Validá cantidades y costos antes de confirmar.',
                        'Al guardar, el stock se actualiza según los ítems cargados.',
                        'Usá el historial para comparar costos por proveedor.'
                    ]
                }
            ]
        },
        {
            id: 'stock',
            title: 'Módulo Stock',
            icon: <PackageSearch size={24} />,
            color: '#f39c12',
            content: [
                {
                    subtitle: 'Inventario y precios',
                    steps: [
                        'Visualizá stock consolidado por producto y categoría.',
                        'Confirmá cantidad disponible, precio y PLU por artículo.',
                        'Importá productos desde balanza cuando sea necesario.',
                        'Hacé ajustes manuales de stock con motivo de operación.',
                        'Exportá el listado para control externo o auditorías.'
                    ]
                }
            ]
        },
        {
            id: 'clientes',
            title: 'Módulo Clientes',
            icon: <Users size={24} />,
            color: '#8e44ad',
            content: [
                {
                    subtitle: 'Gestión comercial de clientes',
                    steps: [
                        'Creá y editá fichas con datos de contacto.',
                        'Gestioná cuenta corriente según política del negocio.',
                        'Revisá historial de compras para seguimiento.',
                        'Mantené los datos actualizados para pedidos y cobranza.'
                    ]
                }
            ]
        },
        {
            id: 'pedidos',
            title: 'Módulo Pedidos',
            icon: <ShoppingBag size={24} />,
            color: '#27ae60',
            content: [
                {
                    subtitle: 'Pedidos internos y de canal digital',
                    steps: [
                        'Registrá pedidos manuales o importados desde canal digital.',
                        'Actualizá estado del pedido (pendiente, en preparación, entregado).',
                        'Asigná cliente, dirección y forma de cobro.',
                        'Coordiná la salida con logística cuando aplique.'
                    ]
                }
            ]
        },
        {
            id: 'logistica',
            title: 'Módulo Logística (PRO)',
            icon: <Truck size={24} />,
            color: '#34495e',
            content: [
                {
                    subtitle: 'Distribución y reparto',
                    steps: [
                        'Asigná pedidos a repartidores y unidades de entrega.',
                        'Seguí recorridos y estado de entregas.',
                        'Confirmá entregas y resolvé incidencias desde el detalle.',
                        'Usá esta vista para optimizar tiempos de reparto.'
                    ]
                }
            ]
        },
        {
            id: 'sucursales',
            title: 'Módulo Sucursales',
            icon: <ArrowLeftRight size={24} />,
            color: '#3498db',
            content: [
                {
                    subtitle: 'Operación multi-sucursal',
                    steps: [
                        'Verificá la sucursal activa del usuario antes de operar.',
                        'Emití remitos/facturas internas para transferir mercadería entre sucursales.',
                        'Asegurate de que ventas, caja y promos queden en la sucursal correcta.',
                        'Evitá cargar datos sin sucursal para no mezclar reportes.'
                    ]
                }
            ]
        },
        {
            id: 'menu-digital',
            title: 'Módulo Menú Digital',
            icon: <Smartphone size={24} />,
            color: '#9b59b6',
            content: [
                {
                    subtitle: 'Publicación para clientes',
                    steps: [
                        'Configurá nombre comercial, datos del local y contacto.',
                        'Publicá catálogo con precios y disponibilidad.',
                        'Compartí enlace con clientes para pedidos y consultas.',
                        'Revisá vista previa móvil antes de habilitar cambios.'
                    ]
                }
            ]
        },
        {
            id: 'preelaborados',
            title: 'Módulo Pre-elaborados',
            icon: <UtensilsCrossed size={24} />,
            color: '#d35400',
            content: [
                {
                    subtitle: 'Producción y control',
                    steps: [
                        'Registrá elaboraciones con cantidad y costo.',
                        'Asociá insumos y salida de stock de materias primas.',
                        'Actualizá precios finales según costo de producción.',
                        'Controlá margen y rotación del producto terminado.'
                    ]
                }
            ]
        },
        {
            id: 'otros-items',
            title: 'Módulo Otros Ítems',
            icon: <Grid size={24} />,
            color: '#7f8c8d',
            content: [
                {
                    subtitle: 'Productos complementarios',
                    steps: [
                        'Cargá productos que no entran en despostada/pre-elaborado.',
                        'Definí unidad, precio y categoría comercial.',
                        'Incluilos en stock y ventas como cualquier otro artículo.',
                        'Mantené consistencia de nombres y PLU para evitar duplicados.'
                    ]
                }
            ]
        },
        {
            id: 'despostada',
            title: 'Módulo Despostada (Vaca/Cerdo/Pollo/Pescado)',
            icon: <Beef size={24} />,
            color: '#c0392b',
            content: [
                {
                    subtitle: 'Rendimiento por especie',
                    steps: [
                        'Ingresá peso inicial del lote/canal.',
                        'Distribuí kilos en cortes resultantes.',
                        'Controlá merma y rendimiento final por especie.',
                        'El sistema impacta automáticamente en stock disponible.'
                    ]
                }
            ]
        },
        {
            id: 'rendimiento-pro',
            title: 'Módulo Rendimiento PRO',
            icon: <BarChart3 size={24} />,
            color: '#2c3e50',
            content: [
                {
                    subtitle: 'Análisis avanzado',
                    steps: [
                        'Compará rendimiento por lote, fecha y categoría.',
                        'Detectá pérdidas, desvíos y oportunidades de mejora.',
                        'Usá reportes para ajustar compra y producción.',
                        'Tomá decisiones con datos reales del negocio.'
                    ]
                }
            ]
        },
        {
            id: 'config-pagos',
            title: 'Configuración · Medios de Pago',
            icon: <CreditCard size={24} />,
            color: '#1abc9c',
            content: [
                {
                    subtitle: 'Parámetros de cobro',
                    steps: [
                        'Activá/desactivá medios disponibles en caja.',
                        'Definí recargos/comisiones por medio de pago.',
                        'Validá comportamiento en venta de prueba.',
                        'Alineá estos valores con cierre de caja.'
                    ]
                }
            ]
        },
        {
            id: 'config-categorias',
            title: 'Configuración · Categorías',
            icon: <FolderOpen size={24} />,
            color: '#2980b9',
            content: [
                {
                    subtitle: 'Orden del catálogo',
                    steps: [
                        'Creá categorías por línea de producto.',
                        'Asigná nombres claros para venta y stock.',
                        'Evitá duplicar categorías con diferencias menores.',
                        'Mantené estructura simple para operación diaria.'
                    ]
                }
            ]
        },
        {
            id: 'config-articulos',
            title: 'Configuración · Artículos',
            icon: <Package size={24} />,
            color: '#f39c12',
            content: [
                {
                    subtitle: 'Alta y mantenimiento de productos',
                    steps: [
                        'Definí nombre, categoría, unidad y PLU.',
                        'Verificá que cada PLU sea único por tenant.',
                        'Evitá crear duplicados por diferencia de escritura.',
                        'Revisá precio base antes de habilitar venta.'
                    ]
                }
            ]
        },
        {
            id: 'config-promociones',
            title: 'Configuración · Promociones',
            icon: <Tag size={24} />,
            color: '#e67e22',
            content: [
                {
                    subtitle: 'Promos por niveles (P1, P2, P3...)',
                    steps: [
                        'Seleccioná artículo y definí tipo de promo (por kg o por total de kg).',
                        'Configurá escalas mínimas con precio para cada nivel.',
                        'Validá que cada nivel tenga PLU promo único.',
                        'Al guardar, confirmá resumen de códigos generados.',
                        'En edición verificá sucursal de aplicación antes de activar.'
                    ]
                }
            ]
        },
        {
            id: 'config-whatsapp',
            title: 'Configuración · Marketing WhatsApp',
            icon: <MessageCircle size={24} />,
            color: '#27ae60',
            content: [
                {
                    subtitle: 'Difusión comercial',
                    steps: [
                        'Configurá canal y datos de envío.',
                        'Definí mensaje de difusión para promociones activas.',
                        'Revisá vista previa del texto antes de publicar.',
                        'Usá envíos con criterio para no saturar clientes.'
                    ]
                }
            ]
        },
        {
            id: 'config-proveedores',
            title: 'Configuración · Proveedores',
            icon: <Truck size={24} />,
            color: '#8e44ad',
            content: [
                {
                    subtitle: 'Base de abastecimiento',
                    steps: [
                        'Cargá datos fiscales y contacto de cada proveedor.',
                        'Asociá artículos de compra para acelerar ingreso.',
                        'Mantené historial de costos y condiciones.',
                        'Actualizá estado de proveedores inactivos.'
                    ]
                }
            ]
        },
        {
            id: 'config-precio',
            title: 'Configuración · Formato de Precio',
            icon: <Calculator size={24} />,
            color: '#d35400',
            content: [
                {
                    subtitle: 'Visualización y redondeo',
                    steps: [
                        'Definí formato de visualización en toda la app.',
                        'Alineá el criterio con balanza y ticket de venta.',
                        'Evitá mezclar reglas distintas entre sucursales.',
                        'Probá una venta real luego de cada cambio.'
                    ]
                }
            ]
        },
        {
            id: 'config-transferencias',
            title: 'Configuración · Transferencias de Sucursales',
            icon: <ArrowLeftRight size={24} />,
            color: '#3498db',
            content: [
                {
                    subtitle: 'Movimiento entre sucursales',
                    steps: [
                        'Elegí tipo de comprobante interno (Remito o Factura interna) antes de enviar.',
                        'Creá transferencia origen/destino con detalle de ítems y documento interno.',
                        'Cada tipo de comprobante maneja numeración independiente.',
                        'Al confirmar recepción, el sistema descuenta stock en origen y acredita en destino.',
                        'Usá remitos y estados para trazabilidad.',
                        'No cierres transferencias sin validar cantidades.'
                    ]
                }
            ]
        },
        {
            id: 'config-balanza',
            title: 'Configuración · Balanza',
            icon: <Scale size={24} />,
            color: '#f1c40f',
            content: [
                {
                    subtitle: 'Integración Systel',
                    steps: [
                        'Conectá por USB y seleccioná puerto correcto.',
                        'Importá PLU/descripcion/precio desde balanza.',
                        'Validá lectura de etiquetas en Ventas.',
                        'Si falla conexión, revisá puerto, driver y cable.'
                    ]
                }
            ]
        },
        {
            id: 'seguridad',
            title: 'Configuración · Usuarios, Licencias y Seguridad',
            icon: <ShieldCheck size={24} />,
            color: '#7f8c8d',
            content: [
                {
                    subtitle: 'Control de acceso y operación segura',
                    steps: [
                        'Creá usuarios por rol (admin/operador) y permisos.',
                        'Asigná licencias y alcance por sucursal.',
                        'Configurá código maestro para borrado de tickets.',
                        'Revisá actividad y estado de sincronización periódicamente.',
                        'Mantené políticas de contraseña y acceso administrativo.'
                    ]
                }
            ]
        }
    ];

    const sectionMeta = {
        inicio: { area: 'Primeros pasos' },
        dashboard: { area: 'Operación', path: '/' },
        ventas: { area: 'Operación', path: '/ventas' },
        caja: { area: 'Operación', path: '/caja' },
        'informes-caja': { area: 'Informes', path: '/informes-caja' },
        'kilos-vendidos': { area: 'Informes', path: '/informes-kilos' },
        'informes-descuentos': { area: 'Informes', path: '/informes-descuentos' },
        'detalle-ventas-balanza': { area: 'Informes', path: '/config/balanza' },
        compras: { area: 'Operación', path: '/compras' },
        stock: { area: 'Operación', path: '/stock' },
        clientes: { area: 'Comercial', path: '/clientes' },
        pedidos: { area: 'Comercial', path: '/pedidos' },
        logistica: { area: 'Comercial', path: '/logistica' },
        sucursales: { area: 'Comercial', path: '/sucursales' },
        'menu-digital': { area: 'Comercial', path: '/menu-digital' },
        preelaborados: { area: 'Producción', path: '/alimentos' },
        'otros-items': { area: 'Producción', path: '/otros' },
        despostada: { area: 'Producción', path: '/despostada/vaca' },
        'rendimiento-pro': { area: 'Producción', path: '/informes-pro' },
        'config-pagos': { area: 'Configuración', path: '/config/pagos' },
        'config-categorias': { area: 'Configuración', path: '/config/categorias' },
        'config-articulos': { area: 'Configuración', path: '/config/productos-compra' },
        'config-promociones': { area: 'Configuración', path: '/config/promociones' },
        'config-whatsapp': { area: 'Configuración', path: '/config/whatsapp-marketing' },
        'config-proveedores': { area: 'Configuración', path: '/config/proveedores' },
        'config-precio': { area: 'Configuración', path: '/config/precio' },
        'config-transferencias': { area: 'Configuración', path: '/config/sucursales-transfer' },
        'config-balanza': { area: 'Configuración', path: '/config/balanza' },
        seguridad: { area: 'Configuración', path: '/config/seguridad' }
    };

    const areas = ['Todos', 'Primeros pasos', 'Operación', 'Comercial', 'Producción', 'Informes', 'Configuración'];
    const normalizedQuery = query.trim().toLocaleLowerCase('es');
    const filteredSections = sections.filter((section) => {
        const area = sectionMeta[section.id]?.area || 'Otros';
        const matchesArea = activeArea === 'Todos' || area === activeArea;
        const searchableText = [
            section.title,
            area,
            ...section.content.flatMap((block) => [block.subtitle, ...block.steps])
        ].join(' ').toLocaleLowerCase('es');
        return matchesArea && (!normalizedQuery || searchableText.includes(normalizedQuery));
    });

    const toggleSection = (sectionId) => {
        setOpenSections((current) => {
            const next = new Set(current);
            if (next.has(sectionId)) next.delete(sectionId);
            else next.add(sectionId);
            return next;
        });
    };

    const openAllResults = () => setOpenSections(new Set(filteredSections.map((section) => section.id)));
    const clearFilters = () => {
        setQuery('');
        setActiveArea('Todos');
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="manual-page animate-fade-in no-print-bg">
            <header className="manual-header">
                <div className="header-left">
                    <BookOpen size={42} className="header-icon" />
                    <div>
                        <h1>Centro de ayuda</h1>
                        <p>Encontrá respuestas y aprendé a usar cada módulo de MeatManager.</p>
                    </div>
                </div>
                <button className="print-btn" onClick={handlePrint}>
                    <Printer size={20} /> Imprimir / Guardar PDF
                </button>
            </header>

            <section className="manual-search-panel no-print" aria-label="Buscar en el manual">
                <div className="manual-search-box">
                    <Search size={22} />
                    <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Buscá un tema: anular ticket, cierre de caja, balanza..."
                        aria-label="Buscar temas en el manual"
                        autoComplete="off"
                    />
                    {query && (
                        <button type="button" className="manual-clear-search" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
                            <X size={18} />
                        </button>
                    )}
                </div>
                <div className="manual-area-filters" aria-label="Filtrar por área">
                    {areas.map((area) => (
                        <button
                            key={area}
                            type="button"
                            className={activeArea === area ? 'active' : ''}
                            onClick={() => setActiveArea(area)}
                        >
                            {area}
                        </button>
                    ))}
                </div>
            </section>

            <div className="manual-layout">
                <aside className="manual-side-nav no-print">
                    <div className="manual-nav-heading">
                        <h3>Temas encontrados</h3>
                        <span>{filteredSections.length}</span>
                    </div>
                    {filteredSections.map((section) => (
                        <button
                            type="button"
                            key={section.id}
                            className="nav-link"
                            onClick={() => {
                                setOpenSections((current) => new Set(current).add(section.id));
                                requestAnimationFrame(() => document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                            }}
                        >
                            <span className="nav-dot" style={{ background: section.color }} />
                            <span>{section.title}</span>
                        </button>
                    ))}
                    <div className="support-card-manual">
                        <ShieldCheck size={20} />
                        <p>¿Necesitás ayuda?</p>
                        <button onClick={() => window.open('https://wa.me/5491131065171', '_blank')}>
                            Contactar Soporte
                        </button>
                    </div>
                </aside>

                <main className="manual-content-rich">
                    <div className="welcome-banner">
                        <div>
                            <span className="welcome-eyebrow">Manual interactivo</span>
                            <h2>{normalizedQuery ? `Resultados para “${query.trim()}”` : '¿Qué necesitás hacer?'}</h2>
                            <p>{filteredSections.length} {filteredSections.length === 1 ? 'tema disponible' : 'temas disponibles'} en esta selección.</p>
                        </div>
                        {filteredSections.length > 0 && (
                            <button type="button" className="manual-expand-all no-print" onClick={openAllResults}>
                                Ver todas las respuestas
                            </button>
                        )}
                    </div>

                    {filteredSections.length === 0 && (
                        <div className="manual-empty-state">
                            <Search size={36} />
                            <h2>No encontramos ese tema</h2>
                            <p>Probá con otra palabra, por ejemplo “ticket”, “stock”, “cliente” o “balanza”.</p>
                            <button type="button" onClick={clearFilters}>Ver todos los temas</button>
                        </div>
                    )}

                    {filteredSections.map((section) => {
                        const isOpen = openSections.has(section.id) || Boolean(normalizedQuery);
                        const meta = sectionMeta[section.id] || {};
                        return (
                        <section key={section.id} id={section.id} className={`manual-section rich-card ${isOpen ? 'open' : ''}`}>
                            <button
                                type="button"
                                className="section-header"
                                style={{ borderLeftColor: section.color }}
                                onClick={() => toggleSection(section.id)}
                                aria-expanded={isOpen}
                            >
                                <div className="section-icon" style={{ background: `${section.color}20`, color: section.color }}>
                                    {section.icon}
                                </div>
                                <div className="section-heading-copy">
                                    <span>{meta.area}</span>
                                    <h2>{section.title}</h2>
                                </div>
                                <ChevronDown className="section-chevron" size={22} />
                            </button>

                            {isOpen && <div className="section-body">
                                {section.content.map((block, i) => (
                                    <div key={i} className="content-block">
                                        <h3><ChevronRight size={18} /> {block.subtitle}</h3>
                                        <ul className="step-list">
                                            {block.steps.map((step, si) => (
                                                <li key={si}>
                                                    <span className="step-number">{si + 1}</span>
                                                    <span className="step-text">{step}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                                {meta.path && (
                                    <button type="button" className="manual-module-link no-print" onClick={() => navigate(meta.path)}>
                                        Ir al módulo <ExternalLink size={16} />
                                    </button>
                                )}
                            </div>}
                        </section>
                    )})}

                    <footer className="manual-footer no-print">
                        <p>© 2026 MeatManager Premium Software. Todos los derechos reservados.</p>
                        <p>ID de Instalación: {localStorage.getItem('meatmanager_install_id') || 'CARNICERIA-MASTER'}</p>
                    </footer>
                </main>
            </div>
        </div>
    );
};

export default Manual;
