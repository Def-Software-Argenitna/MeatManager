import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { UserProvider, useUser } from './context/UserContext';
import { TenantProvider, useTenant } from './context/TenantContext';
import { LicenseProvider } from './context/LicenseContext';
import DashboardLayout from './layouts/DashboardLayout';
import { useHiddenDigitalPaymentShortcuts } from './hooks/useHiddenDigitalPayments';

const CHUNK_RELOAD_KEY = 'mm-chunk-reload-attempted';

function lazyWithRecovery(importer) {
  return lazy(async () => {
    try {
      const module = await importer();
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return module;
    } catch (error) {
      const message = String(error?.message || error || '');
      const isChunkLoadError =
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Importing a module script failed') ||
        message.includes('Unable to preload CSS') ||
        message.includes('ChunkLoadError');

      if (isChunkLoadError && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        window.location.reload();
        return new Promise(() => {});
      }

      throw error;
    }
  });
}

const Login = lazyWithRecovery(() => import('./pages/Login'));
const Dashboard = lazyWithRecovery(() => import('./pages/Dashboard'));
const HistorialVentas = lazyWithRecovery(() => import('./pages/HistorialVentas'));
const DespostadaVaca = lazyWithRecovery(() => import('./pages/DespostadaVaca'));
const DespostadaCerdo = lazyWithRecovery(() => import('./pages/DespostadaCerdo'));
const DespostadaPollo = lazyWithRecovery(() => import('./pages/DespostadaPollo'));
const DespostadaPescado = lazyWithRecovery(() => import('./pages/DespostadaPescado'));
const Ventas = lazyWithRecovery(() => import('./pages/Ventas'));
const Alimentos = lazyWithRecovery(() => import('./pages/Alimentos'));
const Stock = lazyWithRecovery(() => import('./pages/Stock'));
const ConfiguracionPagos = lazyWithRecovery(() => import('./pages/ConfiguracionPagos'));
const Compras = lazyWithRecovery(() => import('./pages/Compras'));
const OtrosItems = lazyWithRecovery(() => import('./pages/OtrosItems'));
const Clientes = lazyWithRecovery(() => import('./pages/Clientes'));
const Categorias = lazyWithRecovery(() => import('./pages/Categorias'));
const ProductosCompra = lazyWithRecovery(() => import('./pages/ProductosCompra'));
const Proveedores = lazyWithRecovery(() => import('./pages/Proveedores'));
const InformesPro = lazyWithRecovery(() => import('./pages/InformesPro'));
const Pedidos = lazyWithRecovery(() => import('./pages/Pedidos'));
const MenuDigital = lazyWithRecovery(() => import('./pages/MenuDigital'));
const CustomerPortal = lazyWithRecovery(() => import('./pages/CustomerPortal'));
const Logistica = lazyWithRecovery(() => import('./pages/Logistica'));
const AdminPanel = lazyWithRecovery(() => import('./pages/AdminPanel'));
const Sucursales = lazyWithRecovery(() => import('./pages/Sucursales'));
const CierreCaja = lazyWithRecovery(() => import('./pages/CierreCaja'));
const Maintenance = lazyWithRecovery(() => import('./pages/Maintenance'));
const Manual = lazyWithRecovery(() => import('./pages/Manual'));
const Security = lazyWithRecovery(() => import('./pages/Security'));
const ConfiguracionPrecio = lazyWithRecovery(() => import('./pages/ConfiguracionPrecio'));
const ConfiguracionSucursales = lazyWithRecovery(() => import('./pages/ConfiguracionSucursales'));
const ConfiguracionPromociones = lazyWithRecovery(() => import('./pages/ConfiguracionPromociones'));
const ConfiguracionWhatsAppMarketing = lazyWithRecovery(() => import('./pages/ConfiguracionWhatsAppMarketing'));
const ConfiguracionBalanza = lazyWithRecovery(() => import('./pages/ConfiguracionBalanza'));

const PUBLIC_PATHS = ['/catalogo'];

const RouteLoader = () => (
  <div style={{
    minHeight: '40vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-text-muted)',
    fontWeight: 600,
    letterSpacing: '0.03em',
  }}>
    Cargando modulo...
  </div>
);

const lazyElement = (lazyComponent) => (
  <Suspense fallback={<RouteLoader />}>
    {React.createElement(lazyComponent)}
  </Suspense>
);

function RequireAuth() {
  const { tenant, loading } = useTenant();
  const { currentUser, loadingUser } = useUser();
  const location = useLocation();
  const isPublic = PUBLIC_PATHS.some(p => location.pathname.startsWith(p));
  if (loading) {
    return <RouteLoader />;
  }
  if (!isPublic && tenant && loadingUser) {
    return <RouteLoader />;
  }
  if (!currentUser && !isPublic) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (!tenant && !isPublic) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}

function RequirePermission({ path, children }) {
  const { currentUser, hasAccess, userPerms } = useUser();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (hasAccess(path)) {
    return children;
  }

  const fallbackPath = Array.isArray(userPerms) && userPerms.length > 0 ? userPerms[0] : '/';
  if (location.pathname !== fallbackPath) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <RouteLoader />;
}

function App() {
  return (
    <TenantProvider>
      <UserProvider>
        <LicenseProvider>
          <AppRoutes />
        </LicenseProvider>
      </UserProvider>
    </TenantProvider>
  );
}

function AppRoutes() {
  useHiddenDigitalPaymentShortcuts();

  const { tenant } = useTenant();
  const location = useLocation();
  const tenantRenderKey = tenant?.clientId || tenant?.uid || 'anonymous';
  const protect = (path, element) => (
    <RequirePermission path={path}>
      {element}
    </RequirePermission>
  );

  return (
          <Routes key={location.pathname}>
            <Route path="/login" element={lazyElement(Login)} />

            <Route element={<RequireAuth />}>
              <Route path="/" element={<DashboardLayout />}>
                <Route index element={protect('/', lazyElement(Dashboard))} />
                <Route path="ventas" element={protect('/ventas', lazyElement(Ventas))} />
                <Route path="ventas/historial" element={protect('/ventas/historial', lazyElement(HistorialVentas))} />
                <Route path="caja" element={protect('/caja', lazyElement(CierreCaja))} />
                <Route path="cierre-caja" element={protect('/cierre-caja', lazyElement(CierreCaja))} />
                <Route path="compras" element={protect('/compras', lazyElement(Compras))} />
                <Route path="stock" element={protect('/stock', lazyElement(Stock))} />
                <Route path="clientes" element={protect('/clientes', lazyElement(Clientes))} />
                <Route path="config/categorias" element={protect('/config/categorias', lazyElement(Categorias))} />
                <Route path="config/productos-compra" element={protect('/config/productos-compra', lazyElement(ProductosCompra))} />
                <Route path="config/proveedores" element={protect('/config/proveedores', lazyElement(Proveedores))} />
                <Route path="config/pagos" element={protect('/config/pagos', lazyElement(ConfiguracionPagos))} />
                <Route path="config/licencia" element={<Navigate to="/config/seguridad" replace />} />
                <Route path="config/mantenimiento" element={protect('/config/seguridad', lazyElement(Maintenance))} />
                <Route path="config/seguridad" element={protect('/config/seguridad', lazyElement(Security))} />
                <Route path="informes-pro" element={protect('/informes-pro', lazyElement(InformesPro))} />
                <Route path="pedidos" element={protect('/pedidos', lazyElement(Pedidos))} />
                <Route path="logistica" element={protect('/logistica', lazyElement(Logistica))} />
                <Route path="admin-pablo-control-master" element={protect('/config/seguridad', lazyElement(AdminPanel))} />
                <Route path="menu-digital" element={protect('/menu-digital', lazyElement(MenuDigital))} />
                <Route path="sucursales" element={protect('/sucursales', lazyElement(Sucursales))} />
                <Route path="catalogo" element={lazyElement(CustomerPortal)} />
                <Route path="manual" element={protect('/manual', lazyElement(Manual))} />
                <Route path="inicio" element={protect('/', <Navigate to="/" replace />)} />
                <Route path="despostada/vaca" element={protect('/despostada/vaca', lazyElement(DespostadaVaca))} />
                <Route path="despostada/cerdo" element={protect('/despostada/cerdo', lazyElement(DespostadaCerdo))} />
                <Route path="despostada/pollo" element={protect('/despostada/pollo', lazyElement(DespostadaPollo))} />
                <Route path="despostada/pescado" element={protect('/despostada/pescado', lazyElement(DespostadaPescado))} />
                <Route path="alimentos" element={protect('/alimentos', lazyElement(Alimentos))} />
                <Route path="otros" element={protect('/otros', lazyElement(OtrosItems))} />
                <Route path="config/precios" element={protect('/config/precio', lazyElement(ConfiguracionPrecio))} />
                <Route path="config/precio" element={protect('/config/precio', lazyElement(ConfiguracionPrecio))} />
                <Route path="config/sucursales-transfer" element={protect('/config/sucursales-transfer', lazyElement(ConfiguracionSucursales))} />
                <Route path="config/promociones" element={protect('/config/promociones', lazyElement(ConfiguracionPromociones))} />
                <Route path="config/whatsapp-marketing" element={protect('/config/whatsapp-marketing', lazyElement(ConfiguracionWhatsAppMarketing))} />
                <Route path="config/balanza" element={protect('/config/balanza', lazyElement(ConfiguracionBalanza))} />
              </Route>
            </Route>
          </Routes>
  );
}

export default App;
