import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Banknote,
  ShoppingCart,
  PackageSearch,
  Utensils,
  UtensilsCrossed,
  Grid,
  LogOut,
  ChevronDown,
  ChevronRight,
  Beef,
  Fish,
  Egg,
  Wifi,
  WifiOff,
  Users,
  FolderOpen,
  Settings,
  Truck,
  ShieldCheck,
  Crown,
  BarChart3,
  ShoppingBag,
  Smartphone,
  MapPin,
  ArrowLeftRight,
  Calculator,
  Lock,
  HelpCircle
} from 'lucide-react';
import { useLicense } from '../context/LicenseContext';
import { useUser } from '../context/UserContext';
import { useTenant } from '../context/TenantContext';
import { getRemoteSetting } from '../utils/apiClient';
import './Sidebar.css';

const Sidebar = ({ isCollapsed }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isPro, hasModule } = useLicense();
  const { currentUser, hasAccess, logout } = useUser();
  const { tenant, logout: tenantLogout } = useTenant();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [branchNotif, setBranchNotif] = useState(0);
  const [isMasterNode, setIsMasterNode] = useState(false);
  const [isDespostadaOpen, setDespostadaOpen] = useState(true);
  const [openGroups, setOpenGroups] = useState({
    operacion: true,
    comercial: true,
    produccion: true,
    configuracion: false,
  });

  React.useEffect(() => {
    const checkMaster = async () => {
      const setting = await getRemoteSetting('is_master_node');
      if (setting !== null) setIsMasterNode(Boolean(setting));
    };
    checkMaster();

    const checkNotifs = () => {
      const count = parseInt(localStorage.getItem('branch_notif_count') || '0', 10);
      setBranchNotif(count);
    };

    const interval = setInterval(checkNotifs, 5000);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    const handleStatusChange = () => setIsOnline(navigator.onLine);

    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);

    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);

  const isActive = (path) => location.pathname === path;

  const handleLogout = async () => {
    await tenantLogout();
    logout();
    navigate('/login');
  };

  const toggleGroup = (groupKey) => {
    if (isCollapsed) return;
    setOpenGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const displayName = currentUser?.username || tenant?.empresa || 'Usuario';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  const operationItems = [
    { title: 'Dashboard', path: '/', icon: LayoutDashboard },
    { title: 'Ventas', path: '/ventas', icon: Banknote },
    { title: 'Caja', path: '/caja', icon: Calculator },
    { title: 'Compras', path: '/compras', icon: ShoppingCart },
    { title: 'Stock', path: '/stock', icon: PackageSearch },
  ];

  const commercialItems = [
    { title: 'Clientes', path: '/clientes', icon: Users },
    { title: 'Pedidos', path: '/pedidos', icon: ShoppingBag },
    { title: 'Logística', path: '/logistica', icon: MapPin, module: 'logistica' },
    { title: 'Sucursales', path: '/sucursales', icon: ArrowLeftRight },
    { title: 'Menú Digital', path: '/menu-digital', icon: Smartphone, module: 'menu-digital' },
  ];

  const productionItems = [
    { title: 'Pre-elaborados', path: '/alimentos', icon: UtensilsCrossed },
    { title: 'Otros Items', path: '/otros', icon: Grid },
    { title: 'Rendimiento PRO', path: '/informes-pro', icon: BarChart3, module: 'informes-pro' },
  ];

  const configItems = [
    { title: 'Medios de Pago', path: '/config/pagos', icon: Settings },
    { title: 'Categorías', path: '/config/categorias', icon: FolderOpen },
    { title: 'Catálogo Compras', path: '/config/productos-compra', icon: PackageSearch },
    { title: 'Proveedores', path: '/config/proveedores', icon: Truck },
    { title: 'Formato de Precio', path: '/config/precio', icon: Calculator },
    { title: 'Licencia', path: '/config/licencia', icon: ShieldCheck },
    { title: 'Usuarios / Seguridad', path: '/config/seguridad', icon: Lock },
    { title: 'Manual de Usuario', path: '/manual', icon: HelpCircle }
  ];

  const despostadaItems = [
    { title: 'Vaca', path: '/despostada/vaca', icon: Beef, module: 'despostada' },
    { title: 'Cerdo', path: '/despostada/cerdo', icon: Beef, module: 'despostada' },
    { title: 'Pollo', path: '/despostada/pollo', icon: Egg, module: 'despostada' },
    { title: 'Pescado', path: '/despostada/pescado', icon: Fish, module: 'despostada' },
  ];

  const hasModuleAccess = (item) => !item.module || hasModule(item.module);

  const renderNavItem = (item, options = {}) => {
    const isLocked = item.module && !hasModuleAccess(item);

    return (
      <button
        key={item.path}
        className={`nav-item ${isActive(item.path) ? 'active' : ''} ${isLocked ? 'locked' : ''} ${options.compact ? 'compact' : ''}`}
        onClick={() => {
          if (isLocked) {
            navigate('/config/licencia');
          } else {
            navigate(item.path);
          }
        }}
      >
        <div className="nav-icon-wrapper" style={{ position: 'relative' }}>
          <item.icon className="nav-icon" size={options.iconSize || 20} title={item.title} />
          {item.title === 'Sucursales' && branchNotif > 0 && (
            <div className="nav-badge animate-pulse">{branchNotif}</div>
          )}
          {isLocked && (
            <Crown
              size={isCollapsed ? 12 : 10}
              style={{
                position: 'absolute',
                top: isCollapsed ? -4 : -2,
                right: isCollapsed ? -4 : -2,
                color: 'gold',
                filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.5))'
              }}
            />
          )}
        </div>
        {!isCollapsed && <span>{item.title}</span>}
        {isLocked && !isCollapsed && !options.compact && <Crown size={12} style={{ marginLeft: 'auto', color: 'gold' }} />}
      </button>
    );
  };

  const renderDespostadaBlock = () => {
    const hasVisibleItems = despostadaItems.some((item) => hasAccess(item.path));

    if (!hasModule('despostada')) {
      return (
        <button
          className="nav-item locked"
          style={{ opacity: 0.5, cursor: 'not-allowed' }}
          onClick={() => navigate('/config/licencia')}
        >
          <Utensils className="nav-icon" title="Despostada" />
          {!isCollapsed && <span>Despostada</span>}
          {!isCollapsed && <ShieldCheck size={14} style={{ marginLeft: 'auto', color: 'var(--color-primary)' }} />}
        </button>
      );
    }

    if (!hasVisibleItems) return null;

    return (
      <div className="nav-group">
        <button
          className={`nav-item nav-group-trigger ${location.pathname.includes('/despostada') ? 'active' : ''}`}
          onClick={() => !isCollapsed && setDespostadaOpen(!isDespostadaOpen)}
        >
          <Utensils className="nav-icon" title="Despostada" />
          {!isCollapsed && <span style={{ flex: 1 }}>Despostada</span>}
          {!isCollapsed && (isDespostadaOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
        </button>

        <div className={`nav-group-wrapper ${(!isCollapsed ? isDespostadaOpen : true) ? 'open' : ''}`}>
          <div className="sub-menu">
            {despostadaItems.filter((item) => hasAccess(item.path)).map((item) =>
              renderNavItem(item, { compact: true, iconSize: 18 })
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderGroup = (groupKey, title, GroupIcon, items, extraContent = null) => {
    const visibleItems = items.filter((item) => hasAccess(item.path));
    const hasVisibleContent = visibleItems.length > 0 || extraContent;

    if (!hasVisibleContent) return null;

    const isGroupActive = visibleItems.some((item) => isActive(item.path)) ||
      (groupKey === 'produccion' && location.pathname.includes('/despostada'));

    return (
      <div className="nav-group" key={groupKey}>
        <button
          className={`nav-item nav-group-trigger ${isGroupActive ? 'active' : ''}`}
          onClick={() => toggleGroup(groupKey)}
        >
          <GroupIcon className="nav-icon" title={title} />
          {!isCollapsed && <span style={{ flex: 1 }}>{title}</span>}
          {!isCollapsed && (openGroups[groupKey] ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
        </button>

        <div className={`nav-group-wrapper ${(!isCollapsed ? openGroups[groupKey] : true) ? 'open' : ''}`}>
          <div className="nav-group-content">
            {visibleItems.map((item) => renderNavItem(item))}
            {extraContent}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header" style={{ borderBottom: (isPro || isMasterNode) ? "1.5px solid gold" : "1px solid var(--glass-border)", paddingBottom: "1.25rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
           {(isPro || isMasterNode) ? <Crown className="logo-icon" style={{ color: "gold" }} /> : <Beef className="logo-icon" />}
           {!isCollapsed && <span className="brand-name" style={{ fontSize: "1.2rem", fontWeight: 950, letterSpacing: "-0.02em", background: "linear-gradient(to bottom, #fff, #999)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>MeatManager</span>}
        </div>
        {!isCollapsed && (isPro || isMasterNode) && (
          <span style={{ display: "block", marginTop: "0.4rem", color: "gold", fontSize: "0.6rem", fontWeight: 950, textTransform: "uppercase", letterSpacing: "0.15rem", opacity: 0.8 }}>{isMasterNode ? "CONTROL CENTER" : "PREMIUM PRO"}</span>
        )}
      </div>

      <nav className="sidebar-nav">
        {renderGroup('operacion', 'Operación', LayoutDashboard, operationItems)}
        {renderGroup('comercial', 'Comercial', ShoppingBag, commercialItems)}
        {renderGroup('produccion', 'Producción', Utensils, productionItems, renderDespostadaBlock())}
        {renderGroup('configuracion', 'Configuración', Settings, configItems)}
      </nav>

      <div className="sidebar-footer">
        {isCollapsed ? (
          <div className="status-indicator-mini" title={isOnline ? 'Online' : 'Offline'}>
            {isOnline ? <Wifi size={16} color="#22c55e" /> : <WifiOff size={16} color="#ef4444" />}
          </div>
        ) : (
          <div style={{
            marginBottom: '1rem',
            padding: '0.5rem',
            borderRadius: 'var(--radius-md)',
            backgroundColor: isOnline ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            color: isOnline ? '#22c55e' : '#ef4444',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.85rem',
            fontWeight: '500'
          }}>
            {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span>{isOnline ? 'Sistema Online' : 'Modo Offline'}</span>
          </div>
        )}

        <div className="user-profile">
          <div className="user-avatar" style={{ background: 'var(--color-primary)', color: '#000', fontWeight: '900' }}>
            {avatarInitial}
          </div>
          {!isCollapsed && (
            <div className="user-info">
              <span
                className="user-name"
                title={displayName}
                style={{ fontSize: '0.85rem', fontWeight: '800', color: '#fff' }}
              >
                {displayName}
              </span>
              <span className="user-role" style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {currentUser?.role === 'admin' ? 'Administrador' : currentUser ? 'Operador' : 'Empresa'}
              </span>
            </div>
          )}
          <button
            style={{ marginLeft: isCollapsed ? '0' : 'auto', flexShrink: 0, padding: '0.4rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', color: 'var(--color-text-main)' }}
            onClick={handleLogout}
            title="Cerrar Sesion"
          >
            <LogOut size={18} />
          </button>
        </div>
        {!isCollapsed && (
          <div style={{ marginTop: '0.75rem', textAlign: 'center', opacity: 0.3, fontSize: '0.55rem', letterSpacing: '0.1em', fontWeight: '700' }}>
            © 2026 MEATMANAGER · TODOS LOS DERECHOS RESERVADOS · DEF-SOFTWARE
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
