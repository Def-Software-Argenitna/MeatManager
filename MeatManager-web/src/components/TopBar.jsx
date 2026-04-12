import React from "react";
import { useLocation } from "react-router-dom";
import { Beef } from "lucide-react";
import "./TopBar.css";

const TopBar = ({ onToggleSidebar }) => {
    const location = useLocation();

    const getModuleNameParts = () => {
        const path = String(location.pathname || '').toLowerCase();
        let name = "";
        
        if (path.includes("ventas")) name = "CENTRO DE VENTAS";
        else if (path.includes("cierre") || path.includes("caja")) name = "CIERRE DE CAJA";
        else if (path.includes("compras")) name = "GESTIÓN DE COMPRAS";
        else if (path.includes("productos-compra") || path.includes("catalogo")) name = "ARTÍCULOS";
        else if (path.includes("stock")) name = "STOCK E INVENTARIO";
        else if (path.includes("clientes")) name = "GESTIÓN DE CLIENTES";
        else if (path.includes("proveedores")) name = "PROVEEDORES";
        else if (path.includes("licencia")) name = "LICENCIA";
        else if (path.includes("usuarios") || path.includes("seguridad")) name = "SEGURIDAD Y USUARIOS";
        else if (path.includes("categorias")) name = "CATEGORÍAS";
        else if (path.includes("precios") || path.includes("formato") || path.includes("precio")) name = "FORMATO DE PRECIOS";
        else if (path.includes("manual")) name = "MANUAL DEL USUARIO";
        else if (path.includes("logistica")) name = "LOGÍSTICA";
        else if (path.includes("pedidos")) name = "PEDIDOS";
        else if (path.includes("sucursales")) name = "SUCURSALES";
        else if (path.includes("despostada")) name = "DESPOSTADA";
        else if (path.includes("alimentos")) name = "ALIMENTOS";
        else if (path.includes("otros")) name = "OTROS ÍTEMS";
        else if (path.includes("informes")) name = "INFORMES PRO";
        else if (path.includes("menu-digital") || path.includes("menudigital") || path.includes("menu")) name = "MENÚ DIGITAL";
        else if (path.includes("dashboard") || path === "/") name = "PANEL DE CONTROL";

        if (!name) {
            const cleaned = path
                .replace(/^\/+/, '')
                .split('/')
                .filter(Boolean)
                .slice(-2)
                .join(' ');
            if (cleaned) {
                name = cleaned
                    .replace(/-/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toUpperCase();
            }
        }

        if (!name) return { prefix: "", lastWord: "MÓDULO" };

        const words = name.split(" ");
        if (words.length <= 1) return { prefix: "", lastWord: name };

        const lastWord = words.pop();
        const prefix = words.join(" ");

        return { prefix, lastWord };
    };

    const { prefix, lastWord } = getModuleNameParts();

    return (
        <header className="top-bar">
            <div className="top-bar-left">
                <button className="sidebar-toggle" onClick={onToggleSidebar} style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: '20px', height: '2px', backgroundColor: '#fff', borderRadius: '2px' }}></div>
                    <div style={{ width: '20px', height: '2px', backgroundColor: '#fff', borderRadius: '2px' }}></div>
                    <div style={{ width: '20px', height: '2px', backgroundColor: '#fff', borderRadius: '2px' }}></div>
                </button>
            </div>
            <div className="top-bar-center">
                <div className="text-logo" style={{ flexDirection: 'row', gap: '0.65rem' }}>
                    <div className="module-icon">
                        <Beef size={18} strokeWidth={2.5} color="#000" />
                    </div>
                    <h1 className="logo-main">
                        {prefix && <span style={{ marginRight: '0.35em' }}>{prefix}</span>}
                        <span style={{ color: "var(--color-primary)" }}>{lastWord}</span>
                    </h1>
                </div>
            </div>
            <div className="top-bar-right">
            </div>
        </header>
    );
};

export default TopBar;
