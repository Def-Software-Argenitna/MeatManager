import React from "react";
import { Menu } from "lucide-react";
import { useLocation } from "react-router-dom";
import "./TopBar.css";

const TopBar = ({ onToggleSidebar }) => {
    const location = useLocation();

    const getModuleName = () => {
        const path = location.pathname;
        if (path.includes("/ventas")) return "CENTRO DE VENTAS";
        if (path.includes("/stock")) return "STOCK E INVENTARIO";
        if (path.includes("/clientes")) return "GESTIÓN DE CLIENTES";
        if (path.includes("/usuarios") || path.includes("/seguridad")) return "SEGURIDAD Y USUARIOS";
        if (path.includes("/categorias")) return "CATEGORÍAS DE PRODUCTOS";
        if (path.includes("/precios") || path.includes("/formato")) return "FORMATO DE PRECIOS";
        if (path.includes("/cierre")) return "CIERRE DE CAJA";
        if (path.includes("/dashboard")) return "PANEL DE CONTROL";
        return "ADMINISTRACIÓN";
    };

    return (
        <header className="top-bar">
            <div className="top-bar-left">
                <button className="icon-btn sidebar-toggle" onClick={onToggleSidebar}>
                    <Menu size={24} />
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