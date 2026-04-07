import React from "react";
import { useLocation } from "react-router-dom";
import "./TopBar.css";

const TopBar = ({ onToggleSidebar }) => {
    const location = useLocation();

    const getModuleName = () => {
        const path = location.pathname;
        if (path.includes("ventas")) return "CENTRO DE VENTAS";
        if (path.includes("cierre") || path.includes("caja")) return "CIERRE DE CAJA";
        if (path.includes("compras")) return "GESTIÓN DE COMPRAS";
        if (path.includes("productos-compra") || path.includes("catalogo")) return "CATÁLOGO DE COMPRAS";
        if (path.includes("stock")) return "STOCK E INVENTARIO";
        if (path.includes("clientes")) return "GESTIÓN DE CLIENTES";
        if (path.includes("proveedores")) return "PROVEEDORES";
        if (path.includes("licencia")) return "LICENCIA";
        if (path.includes("usuarios") || path.includes("seguridad")) return "SEGURIDAD Y USUARIOS";
        if (path.includes("categorias")) return "CATEGORÍAS";
        if (path.includes("precios") || path.includes("formato") || path.includes("precio")) return "FORMATO DE PRECIOS";
        if (path.includes("manual")) return "MANUAL DEL USUARIO";
        if (path.includes("logistica")) return "LOGÍSTICA";
        if (path.includes("pedidos")) return "PEDIDOS";
        if (path.includes("sucursales")) return "SUCURSALES";
        if (path.includes("despostada")) return "DESPOSTADA";
        if (path.includes("alimentos")) return "ALIMENTOS";
        if (path.includes("otros")) return "OTROS ÍTEMS";
        if (path.includes("informes")) return "INFORMES PRO";
        if (path.includes("dashboard") || path === "/") return "PANEL DE CONTROL";
        return "";
    };

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
                <div className="text-logo">
                    <h1 className="logo-main">{getModuleName()}</h1>
                </div>
            </div>
            <div className="top-bar-right">
            </div>
        </header>
    );
};

export default TopBar;
