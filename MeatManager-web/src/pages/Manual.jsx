import React from 'react';
import {
    HelpCircle,
    Printer,
    ChevronRight,
    Scale,
    Banknote,
    Smartphone,
    Beef,
    Truck,
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
            title: 'Inicio Rápido: Cargar el Negocio',
            icon: <DownloadCloud size={24} />,
            color: '#3498db',
            content: [
                {
                    subtitle: 'Sincronizar Balanza (Systel Cuora)',
                    steps: [
                        'Conectá la balanza a la PC mediante el cable USB.',
                        'Entrá en el menú "Stock e Inventario".',
                        'Tocá el botón azul "Importar de Balanza".',
                        'Seleccioná el puerto (ej: COM3) y aceptá.',
                        '¡Listo! Se cargan Nombres, PLUs y Precios automáticamente.'
                    ]
                }
            ]
        },
        {
            id: 'ventas',
            title: 'Módulo de Ventas y Cobro',
            icon: <Banknote size={24} />,
            color: '#2ecc71',
            content: [
                {
                    subtitle: 'Realizar una Venta Directa',
                    steps: [
                        'Buscá el producto por nombre o usá el escáner.',
                        'Ingresá el peso (o se carga solo si la balanza está conectada).',
                        'Si la venta es para un cliente habitual, seleccioná el cliente antes de cobrar.',
                        'Tocá "Cobrar TICKET" (botón verde).',
                        'Elegí el medio de pago correspondiente: Efectivo, Tarjeta, Mercado Pago, Cuenta DNI u otros medios configurados.',
                        'Si el cliente paga después, podés registrar la operación en cuenta corriente.',
                        'Confirmá y escuchá la campana 🔔.'
                    ]
                }
            ]
        },
        {
            id: 'balanza',
            title: 'Balanza y Escáner',
            icon: <Scale size={24} />,
            color: '#f1c40f',
            content: [
                {
                    subtitle: 'Uso de Etiquetas Systel',
                    steps: [
                        'Si la balanza imprime etiquetas, no hace falta buscar el producto.',
                        'Simplemente escaneá el código de barras en la caja.',
                        'El sistema detecta automáticamente qué es y cuánto pesa.',
                        'Escucharás un "Beep" de confirmación.'
                    ]
                }
            ]
        },
        {
            id: 'caja',
            title: 'Caja, Apertura y Cierre',
            icon: <Calculator size={24} />,
            color: '#e67e22',
            content: [
                {
                    subtitle: 'Cuadrar el día',
                    steps: [
                        'En "Caja", registrá la apertura del día por cada medio de pago.',
                        'Cargá retiros, gastos, ingresos manuales y movimientos extraordinarios para que el saldo quede conciliado.',
                        'El sistema te muestra el saldo acumulado por cada medio de pago.',
                        'Revisá ventas y cobros antes de cerrar para detectar diferencias.',
                        'Hacé el arqueo físico y compará con el total del sistema antes de confirmar el cierre.'
                    ]
                }
            ]
        },
        {
            id: 'despostada',
            title: 'Despostada y Rinde',
            icon: <Beef size={24} />,
            color: '#e74c3c',
            content: [
                {
                    subtitle: 'De la media res al mostrador',
                    steps: [
                        'Cargá el peso total de la carne que entró.',
                        'Pesá cada corte (asado, vacío, etc.) y tcalo en el mapa de la vaca.',
                        'El sistema calcula automáticamente basura, hueso y grasa.',
                        'Al terminar, el stock se actualiza solo.'
                    ]
                }
            ]
        },
        {
            id: 'menu',
            title: 'Menú Digital y WhatsApp',
            icon: <Smartphone size={24} />,
            color: '#9b59b6',
            content: [
                {
                    subtitle: 'Vender mientras dormís',
                    steps: [
                        'Configurá tu Local y tu WhatsApp.',
                        'Completá el mensaje del Bot y copiá el texto sugerido en tu respuesta automática de WhatsApp.',
                        'Compartí el link del Portal de Clientes para que vean precios, stock y ofertas.',
                        'Cuando el cliente hace un pedido desde WhatsApp o el portal, podés importarlo directamente en Pedidos.',
                        'La vista previa del celular te muestra cómo verá el cliente el menú antes de publicarlo.'
                    ]
                }
            ]
        },
        {
            id: 'logistica',
            title: 'Logística y Reparto (PRO)',
            icon: <Truck size={24} />,
            color: '#34495e',
            content: [
                {
                    subtitle: 'Control total de envíos',
                    steps: [
                        'Asigná cada pedido a un repartidor.',
                        'Mirá en el mapa por dónde anda tu flota en tiempo real y seleccioná repartidores para centrar la vista.',
                        'Abrí un pedido para ver dirección, items, estado y datos del cliente.',
                        'Desde el detalle podés confirmar la entrega, llamar al repartidor e imprimir el ticket del pedido.'
                    ]
                }
            ]
        },
        {
            id: 'sucursales',
            title: 'Sucursales',
            icon: <ArrowLeftRight size={24} />,
            color: '#3498db',
            content: [
                {
                    subtitle: 'Consulta de sucursal asignada',
                    steps: [
                        'La gestión de sucursales se realiza desde la administración central.',
                        'En MeatManager solo se visualiza la sucursal asignada al usuario o al tenant.',
                        'Si necesitás cambiar nombre, dirección, código interno o estado de una sucursal, hacelo desde el panel de administración correspondiente.',
                        'Los datos visibles en esta pantalla se actualizan según la configuración central definida para tu cuenta.'
                    ]
                }
            ]
        },
        {
            id: 'mantenimiento',
            title: 'Mantenimiento y Seguridad',
            icon: <Database size={24} />,
            color: '#7f8c8d',
            content: [
                {
                    subtitle: 'Buenas prácticas operativas',
                    steps: [
                        'Verificá siempre que estés trabajando con conexión y sesión iniciada correctamente.',
                        'Antes de cerrar el día, revisá ventas, caja, pedidos y movimientos pendientes.',
                        'Si necesitás soporte, usá el acceso de ayuda o contactá al equipo técnico.',
                        'Las configuraciones sensibles y datos operativos deben mantenerse actualizados en el servidor y no depender de una PC puntual.'
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
                                {section.id === 'balanza' && (
                                    <div className="ui-mockup balance-mockup">
                                        <div className="mockup-label">SYSTEL CUORA MAX</div>
                                        <div className="mockup-display">0.525 kg</div>
                                        <div className="mockup-btn blue">Importar PLUs</div>
                                    </div>
                                )}
                                {section.id === 'menu' && (
                                    <div className="ui-mockup phone-mockup-mini">
                                        <div className="mockup-phone-header">🥩 Carnicería PRO</div>
                                        <div className="mockup-whatsapp-bubble">"Hola! Quiero 2kg de Asado..."</div>
                                        <div className="mockup-btn primary">Importar Pedido</div>
                                    </div>
                                )}
                                {section.id === 'mantenimiento' && (
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
