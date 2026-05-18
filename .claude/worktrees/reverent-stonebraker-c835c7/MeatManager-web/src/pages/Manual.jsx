import React from 'react';
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
    ArrowLeftRight
} from 'lucide-react';
import './Manual.css';

const Manual = () => {
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

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="manual-page animate-fade-in no-print-bg">
            <header className="manual-header">
                <div className="header-left">
                    <HelpCircle size={42} className="header-icon" />
                    <div>
                        <h1>Manual de Usuario Premium</h1>
                        <p>MeatManager PRO - Gestión Integral de Carnicerías</p>
                    </div>
                </div>
                <button className="print-btn" onClick={handlePrint}>
                    <Printer size={20} /> Imprimir / Guardar PDF
                </button>
            </header>

            <div className="manual-layout">
                <aside className="manual-side-nav no-print">
                    <h3>Tabla de Contenidos</h3>
                    {sections.map(s => (
                        <a key={s.id} href={`#${s.id}`} className="nav-link">
                            <span className="nav-dot" style={{ background: s.color }}></span>
                            {s.title}
                        </a>
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
                        <h2>¡Hola de nuevo!</h2>
                        <p>Esta guía está diseñada para que saques el máximo provecho a <strong>MeatManager</strong>.
                            Desde el mostrador hasta el desposte, acá tenés todo para profesionalizar tu carnicería.</p>
                    </div>

                    {sections.map(section => (
                        <section key={section.id} id={section.id} className="manual-section rich-card">
                            <div className="section-header" style={{ borderLeft: `6px solid ${section.color}` }}>
                                <div className="section-icon" style={{ background: `${section.color}20`, color: section.color }}>
                                    {section.icon}
                                </div>
                                <h2>{section.title}</h2>
                            </div>

                            <div className="section-body">
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

                                {/* Visual Mockup per Section */}
                                {section.id === 'ventas' && (
                                    <div className="ui-mockup pos-mockup">
                                        <div className="mockup-btn green">COBRAR TICKET (F12)</div>
                                        <div className="mockup-search">🔍 Buscar...</div>
                                    </div>
                                )}
                                {section.id === 'config-balanza' && (
                                    <div className="ui-mockup balance-mockup">
                                        <div className="mockup-label">SYSTEL CUORA MAX</div>
                                        <div className="mockup-display">0.525 kg</div>
                                        <div className="mockup-btn blue">Importar PLUs</div>
                                    </div>
                                )}
                                {section.id === 'menu-digital' && (
                                    <div className="ui-mockup phone-mockup-mini">
                                        <div className="mockup-phone-header">🥩 Carnicería PRO</div>
                                        <div className="mockup-whatsapp-bubble">"Hola! Quiero 2kg de Asado..."</div>
                                        <div className="mockup-btn primary">Importar Pedido</div>
                                    </div>
                                )}
                                {section.id === 'seguridad' && (
                                    <div className="ui-mockup backup-mockup">
                                        <div className="mockup-label">SEGURIDAD DE DATOS</div>
                                        <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                                            <div className="mockup-btn blue" style={{ flex: 1 }}>📥 Exportar</div>
                                            <div className="mockup-btn primary" style={{ flex: 1, background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-main)' }}>📤 Importar</div>
                                        </div>
                                        <div className="mockup-status-cloud">☁️ Nube Sincronizada (Modo PRO)</div>
                                    </div>
                                )}
                            </div>
                        </section>
                    ))}

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
