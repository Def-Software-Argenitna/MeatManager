import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { UserProvider, useUser } from './context/UserContext';
import { TenantProvider, useTenant } from './context/TenantContext';
import { LicenseProvider } from './context/LicenseContext';
import DashboardLayout from './layouts/DashboardLayout';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const HistorialVentas = lazy(() => import('./pages/HistorialVentas'));
const DespostadaVaca = lazy(() => import('./pages/DespostadaVaca'));
const DespostadaCerdo = lazy(() => import('./pages/DespostadaCerdo'));
const DespostadaPollo = lazy(() => import('./pages/DespostadaPollo'));
const DespostadaPescado = lazy(() => import('./pages/DespostadaPescado'));
const Ventas = lazy(() => import('./pages/Ventas'));
const Alimentos = lazy(() => import('./pages/Alimentos'));
const Stock = lazy(() => import('./pages/Stock'));
const ConfiguracionPagos = lazy(() => import('./pages/ConfiguracionPagos'));
const Compras = lazy(() => import('./pages/Compras'));
const OtrosItems = lazy(() => import('./pages/OtrosItems'));
const Clientes = lazy(() => import('./pages/Clientes'));
const Categorias = lazy(() => import('./pages/Categorias'));
const ProductosCompra = lazy(() => import('./pages/ProductosCompra'));
const Proveedores = lazy(() => import('./pages/Proveedores'));
const Licencia = lazy(() => import('./pages/Licencia'));
const InformesPro = lazy(() => import('./pages/InformesPro'));
const Pedidos = lazy(() => import('./pages/Pedidos'));
const MenuDigital = lazy(() => import('./pages/MenuDigital'));
const CustomerPortal = lazy(() => import('./pages/CustomerPortal'));
const Logistica = lazy(() => import('./pages/Logistica'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const Sucursales = lazy(() => import('./pages/Sucursales'));
const CierreCaja = lazy(() => import('./pages/CierreCaja'));
const Maintenance = lazy(() => import('./pages/Maintenance'));
const Manual = lazy(() => import('./pages/Manual'));
const Security = lazy(() => import('./pages/Security'));
const ConfiguracionPrecio = lazy(() => import('./pages/ConfiguracionPrecio'));

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
                <Route path="config/licencia" element={lazyElement(Licencia)} />
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
