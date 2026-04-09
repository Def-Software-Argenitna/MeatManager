import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { UserProvider, useUser } from './context/UserContext';
import { TenantProvider, useTenant } from './context/TenantContext';
import { LicenseProvider } from './context/LicenseContext';
import DashboardLayout from './layouts/DashboardLayout';

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

function App() {
  return (
    <TenantProvider>
      <UserProvider>
        <LicenseProvider>
          <Routes>
            <Route path="/login" element={lazyElement(Login)} />

            <Route element={<RequireAuth />}>
              <Route path="/" element={<DashboardLayout />}>
                <Route index element={lazyElement(Dashboard)} />
                <Route path="ventas" element={lazyElement(Ventas)} />
                <Route path="ventas/historial" element={lazyElement(HistorialVentas)} />
                <Route path="caja" element={lazyElement(CierreCaja)} />
                <Route path="cierre-caja" element={lazyElement(CierreCaja)} />
                <Route path="compras" element={lazyElement(Compras)} />
                <Route path="stock" element={lazyElement(Stock)} />
                <Route path="clientes" element={lazyElement(Clientes)} />
                <Route path="config/categorias" element={lazyElement(Categorias)} />
                <Route path="config/productos-compra" element={lazyElement(ProductosCompra)} />
                <Route path="config/proveedores" element={lazyElement(Proveedores)} />
                <Route path="config/pagos" element={lazyElement(ConfiguracionPagos)} />
                <Route path="config/licencia" element={<Navigate to="/config/seguridad" replace />} />
                <Route path="config/mantenimiento" element={lazyElement(Maintenance)} />
                <Route path="config/seguridad" element={lazyElement(Security)} />
                <Route path="informes-pro" element={lazyElement(InformesPro)} />
                <Route path="pedidos" element={lazyElement(Pedidos)} />
                <Route path="logistica" element={lazyElement(Logistica)} />
                <Route path="admin-pablo-control-master" element={lazyElement(AdminPanel)} />
                <Route path="menu-digital" element={lazyElement(MenuDigital)} />
                <Route path="sucursales" element={lazyElement(Sucursales)} />
                <Route path="catalogo" element={lazyElement(CustomerPortal)} />
                <Route path="manual" element={lazyElement(Manual)} />
                <Route path="inicio" element={<Navigate to="/" replace />} />
                <Route path="despostada/vaca" element={lazyElement(DespostadaVaca)} />
                <Route path="despostada/cerdo" element={lazyElement(DespostadaCerdo)} />
                <Route path="despostada/pollo" element={lazyElement(DespostadaPollo)} />
                <Route path="despostada/pescado" element={lazyElement(DespostadaPescado)} />
                <Route path="alimentos" element={lazyElement(Alimentos)} />
                <Route path="otros" element={lazyElement(OtrosItems)} />
                <Route path="config/precios" element={lazyElement(ConfiguracionPrecio)} />
                <Route path="config/precio" element={lazyElement(ConfiguracionPrecio)} />
              </Route>
            </Route>
          </Routes>
        </LicenseProvider>
      </UserProvider>
    </TenantProvider>
  );
}

export default App;
