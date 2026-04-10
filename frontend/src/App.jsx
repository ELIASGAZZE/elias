// Componente raíz de la aplicación
// Define las rutas y envuelve todo con el proveedor de autenticación
import React, { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import RutaProtegida from './components/auth/RutaProtegida'
import ErrorBoundary from './components/ErrorBoundary'

// Spinner de carga para lazy loading
const LoadingSpinner = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primario-600" />
  </div>
)

// Login y Hub se cargan eager (rutas principales)
import Login from './pages/Login'
import Hub from './pages/Hub'

// Página de fichaje (ruta pública, carga rápida)
import Fichaje from './pages/fichaje/Fichaje'

// ── Lazy loading por módulo ──────────────────────────────────────────────────

// Pedidos
const NuevoPedido = lazy(() => import('./pages/operario/NuevoPedido'))
const Pedidos = lazy(() => import('./pages/admin/AdminPedidos'))
const DetallePedido = lazy(() => import('./pages/DetallePedido'))

// Control de Cajas
const CajasHome = lazy(() => import('./pages/cajas/CajasHome'))
const CerrarCaja = lazy(() => import('./pages/cajas/CerrarCaja'))
const DetalleCierre = lazy(() => import('./pages/cajas/DetalleCierre'))
const VerificarCierre = lazy(() => import('./pages/cajas/VerificarCierre'))
const NuevoRetiro = lazy(() => import('./pages/cajas/NuevoRetiro'))
const VerificarRetiro = lazy(() => import('./pages/cajas/VerificarRetiro'))
const ChatAuditoria = lazy(() => import('./pages/cajas/ChatAuditoria'))
const BatchAnalisis = lazy(() => import('./pages/cajas/BatchAnalisis'))

// Control Caja POS
const CajasPosHome = lazy(() => import('./pages/cajas-pos/CajasPosHome'))
const CerrarCajaPos = lazy(() => import('./pages/cajas-pos/CerrarCajaPos'))
const DetalleCierrePos = lazy(() => import('./pages/cajas-pos/DetalleCierrePos'))
const VerificarCierrePos = lazy(() => import('./pages/cajas-pos/VerificarCierrePos'))
const NuevoRetiroPos = lazy(() => import('./pages/cajas-pos/NuevoRetiroPos'))
const VerificarRetiroPos = lazy(() => import('./pages/cajas-pos/VerificarRetiroPos'))

// POS
const POS = lazy(() => import('./pages/pos/POS'))
const PedidosPOS = lazy(() => import('./pages/pos/PedidosPOS'))

// RRHH
const RRHHHome = lazy(() => import('./pages/rrhh/RRHHHome'))

// Ventas
const VentasHome = lazy(() => import('./pages/ventas/VentasHome'))
const DetalleVenta = lazy(() => import('./pages/ventas/DetalleVenta'))
const ReportesPromociones = lazy(() => import('./pages/ventas/ReportesPromociones'))
const VentasAuditoriaCentum = lazy(() => import('./pages/ventas/VentasAuditoriaCentum'))
const DetalleVentaCentum = lazy(() => import('./pages/ventas/DetalleVentaCentum'))

// Tareas
const TareasHome = lazy(() => import('./pages/tareas/TareasHome'))
const TareasAdmin = lazy(() => import('./pages/tareas/TareasAdmin'))
const TareasAnalytics = lazy(() => import('./pages/tareas/TareasAnalytics'))
const TareasPanel = lazy(() => import('./pages/tareas/TareasPanel'))
const TareasEquipo = lazy(() => import('./pages/tareas/TareasEquipo'))

// Auditoría
const AuditoriaHome = lazy(() => import('./pages/auditoria/AuditoriaHome'))

// Traspasos
const TraspasosHome = lazy(() => import('./pages/traspasos/TraspasosHome'))
const OrdenesTraspasos = lazy(() => import('./pages/traspasos/OrdenesTraspasos'))
const NuevaOrdenTraspaso = lazy(() => import('./pages/traspasos/NuevaOrden'))
const OrdenDetalleTraspaso = lazy(() => import('./pages/traspasos/OrdenDetalle'))
const Preparacion = lazy(() => import('./pages/traspasos/Preparacion'))
const PreparacionAuto = lazy(() => import('./pages/traspasos/PreparacionAuto'))
const Recepcion = lazy(() => import('./pages/traspasos/Recepcion'))
const Reparto = lazy(() => import('./pages/traspasos/Reparto'))
const RecepcionScan = lazy(() => import('./pages/traspasos/RecepcionScan'))

// Compras
const ComprasHome = lazy(() => import('./pages/compras/ComprasHome'))
const Proveedores = lazy(() => import('./pages/compras/Proveedores'))
const ProveedorDetalle = lazy(() => import('./pages/compras/ProveedorDetalle'))
const DemandaProveedor = lazy(() => import('./pages/compras/DemandaProveedor'))
const OrdenesCompra = lazy(() => import('./pages/compras/OrdenesCompra'))
const OrdenDetalle = lazy(() => import('./pages/compras/OrdenDetalle'))
const NuevaOrden = lazy(() => import('./pages/compras/NuevaOrden'))
const ChatCompras = lazy(() => import('./pages/compras/ChatCompras'))
const ConsumoInterno = lazy(() => import('./pages/compras/ConsumoInterno'))
const PedidosExtra = lazy(() => import('./pages/compras/PedidosExtra'))

// Mercado Libre
const MercadoLibreHome = lazy(() => import('./pages/mercadolibre/MercadoLibreHome'))
const MLVentas = lazy(() => import('./pages/mercadolibre/MLVentas'))

// Admin
const AdminArticulos = lazy(() => import('./pages/admin/AdminArticulos'))
const AdminArticulosManuales = lazy(() => import('./pages/admin/AdminArticulosManuales'))
const AdminArticulosCombos = lazy(() => import('./pages/admin/AdminArticulosCombos'))
const ConfiguracionHub = lazy(() => import('./pages/admin/ConfiguracionHub'))
const AdminConfiguracion = lazy(() => import('./pages/admin/AdminConfiguracion'))
const AdminApiLogs = lazy(() => import('./pages/admin/AdminApiLogs'))

// Redirige al home según si está logueado
const RedirigirHome = () => {
  const { estaLogueado, cargando } = useAuth()

  if (cargando) return null
  if (!estaLogueado) return <Navigate to="/login" replace />
  return <Navigate to="/apps" replace />
}

const App = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
      <AuthProvider>
        <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          {/* Ruta pública */}
          <Route path="/login" element={<Login />} />

          {/* Ruta pública: fichaje */}
          <Route path="/fichaje" element={<Fichaje />} />

          {/* Redirige la raíz */}
          <Route path="/" element={<RedirigirHome />} />

          {/* Hub de aplicaciones */}
          <Route path="/apps" element={
            <RutaProtegida>
              <Hub />
            </RutaProtegida>
          } />

          {/* App: Pedidos Internos */}
          <Route path="/pedidos/nuevo" element={
            <RutaProtegida>
              <NuevoPedido />
            </RutaProtegida>
          } />
          <Route path="/pedidos" element={
            <RutaProtegida>
              <Pedidos />
            </RutaProtegida>
          } />
          <Route path="/pedidos/:id" element={
            <RutaProtegida>
              <DetallePedido />
            </RutaProtegida>
          } />

          {/* App: Control de Cajas */}
          <Route path="/cajas" element={
            <RutaProtegida>
              <CajasHome />
            </RutaProtegida>
          } />
          <Route path="/cajas/chat" element={
            <RutaProtegida rolesPermitidos={['gestor', 'admin']}>
              <ChatAuditoria />
            </RutaProtegida>
          } />
          <Route path="/cajas/batch" element={
            <RutaProtegida rolesPermitidos={['gestor', 'admin']}>
              <BatchAnalisis />
            </RutaProtegida>
          } />
          <Route path="/cajas/cierre/:id/cerrar" element={
            <RutaProtegida rolesPermitidos={['operario', 'admin']}>
              <CerrarCaja />
            </RutaProtegida>
          } />
          <Route path="/cajas/cierre/:id/editar" element={
            <RutaProtegida>
              <CerrarCaja />
            </RutaProtegida>
          } />
          <Route path="/cajas/cierre/:id/retiro" element={
            <RutaProtegida rolesPermitidos={['operario', 'admin']}>
              <NuevoRetiro />
            </RutaProtegida>
          } />
          <Route path="/cajas/retiro/:id/verificar" element={
            <RutaProtegida rolesPermitidos={['gestor', 'admin']}>
              <VerificarRetiro />
            </RutaProtegida>
          } />
          <Route path="/cajas/cierre/:id" element={
            <RutaProtegida>
              <DetalleCierre />
            </RutaProtegida>
          } />
          <Route path="/cajas/verificar/:id" element={
            <RutaProtegida rolesPermitidos={['gestor', 'admin']}>
              <VerificarCierre />
            </RutaProtegida>
          } />

          {/* App: Control Caja POS */}
          <Route path="/cajas-pos" element={
            <RutaProtegida>
              <CajasPosHome />
            </RutaProtegida>
          } />
          <Route path="/cajas-pos/cierre/:id/cerrar" element={
            <RutaProtegida rolesPermitidos={['operario', 'admin']}>
              <CerrarCajaPos />
            </RutaProtegida>
          } />
          <Route path="/cajas-pos/cierre/:id/editar" element={
            <RutaProtegida>
              <CerrarCajaPos />
            </RutaProtegida>
          } />
          <Route path="/cajas-pos/cierre/:id/retiro" element={
            <RutaProtegida rolesPermitidos={['operario', 'admin']}>
              <NuevoRetiroPos />
            </RutaProtegida>
          } />
          <Route path="/cajas-pos/retiro/:id/verificar" element={
            <RutaProtegida rolesPermitidos={['gestor', 'admin']}>
              <VerificarRetiroPos />
            </RutaProtegida>
          } />
          <Route path="/cajas-pos/cierre/:id" element={
            <RutaProtegida>
              <DetalleCierrePos />
            </RutaProtegida>
          } />
          <Route path="/cajas-pos/verificar/:id" element={
            <RutaProtegida rolesPermitidos={['gestor', 'admin']}>
              <VerificarCierrePos />
            </RutaProtegida>
          } />

          {/* App: POS */}
          <Route path="/pos" element={
            <RutaProtegida>
              <POS />
            </RutaProtegida>
          } />
          <Route path="/pos/pedidos" element={
            <RutaProtegida>
              <PedidosPOS />
            </RutaProtegida>
          } />

          {/* App: RRHH */}
          <Route path="/rrhh" element={
            <RutaProtegida rolesPermitidos={['admin', 'gestor']}>
              <RRHHHome />
            </RutaProtegida>
          } />

          {/* App: Ventas */}
          <Route path="/ventas" element={
            <RutaProtegida>
              <VentasHome />
            </RutaProtegida>
          } />
          <Route path="/ventas/reportes/promociones" element={
            <RutaProtegida rolesPermitidos={['admin', 'gestor']}>
              <ReportesPromociones />
            </RutaProtegida>
          } />
          <Route path="/ventas/auditoria" element={<RutaProtegida soloAdmin><VentasAuditoriaCentum /></RutaProtegida>} />
          <Route path="/ventas/auditoria/:ventaId" element={<RutaProtegida soloAdmin><DetalleVentaCentum /></RutaProtegida>} />
          <Route path="/ventas/:id" element={
            <RutaProtegida>
              <DetalleVenta />
            </RutaProtegida>
          } />

          {/* App: Auditoría */}
          <Route path="/auditoria" element={
            <RutaProtegida soloAdmin>
              <AuditoriaHome />
            </RutaProtegida>
          } />

          {/* App: Traspasos */}
          <Route path="/traspasos" element={<RutaProtegida rolesPermitidos={['admin', 'gestor']}><TraspasosHome /></RutaProtegida>} />
          <Route path="/traspasos/ordenes" element={<RutaProtegida rolesPermitidos={['admin', 'gestor']}><OrdenesTraspasos /></RutaProtegida>} />
          <Route path="/traspasos/nueva" element={<RutaProtegida rolesPermitidos={['admin', 'gestor']}><NuevaOrdenTraspaso /></RutaProtegida>} />
          <Route path="/traspasos/ordenes/:id" element={<RutaProtegida rolesPermitidos={['admin', 'gestor']}><OrdenDetalleTraspaso /></RutaProtegida>} />
          <Route path="/traspasos/ordenes/:id/preparar" element={<RutaProtegida><Preparacion /></RutaProtegida>} />
          <Route path="/preparacion" element={<RutaProtegida><PreparacionAuto /></RutaProtegida>} />
          <Route path="/traspasos/recibir/:id" element={<RutaProtegida><Recepcion /></RutaProtegida>} />
          <Route path="/reparto" element={<RutaProtegida><Reparto /></RutaProtegida>} />
          <Route path="/recepcion" element={<RutaProtegida><RecepcionScan /></RutaProtegida>} />

          {/* App: Compras */}
          <Route path="/compras" element={<RutaProtegida soloAdmin><ComprasHome /></RutaProtegida>} />
          <Route path="/compras/proveedores" element={<RutaProtegida soloAdmin><Proveedores /></RutaProtegida>} />
          <Route path="/compras/proveedores/:id" element={<RutaProtegida soloAdmin><ProveedorDetalle /></RutaProtegida>} />
          <Route path="/compras/demanda/:id" element={<RutaProtegida soloAdmin><DemandaProveedor /></RutaProtegida>} />
          <Route path="/compras/ordenes" element={<RutaProtegida soloAdmin><OrdenesCompra /></RutaProtegida>} />
          <Route path="/compras/ordenes/:id" element={<RutaProtegida soloAdmin><OrdenDetalle /></RutaProtegida>} />
          <Route path="/compras/nueva-orden" element={<RutaProtegida soloAdmin><NuevaOrden /></RutaProtegida>} />
          <Route path="/compras/chat" element={<RutaProtegida soloAdmin><ChatCompras /></RutaProtegida>} />
          <Route path="/compras/consumo-interno" element={<RutaProtegida soloAdmin><ConsumoInterno /></RutaProtegida>} />
          <Route path="/compras/pedidos-extra" element={<RutaProtegida soloAdmin><PedidosExtra /></RutaProtegida>} />

          {/* App: Tareas */}
          <Route path="/tareas" element={
            <RutaProtegida>
              <TareasHome />
            </RutaProtegida>
          } />
          <Route path="/tareas/equipo" element={
            <RutaProtegida>
              <TareasEquipo />
            </RutaProtegida>
          } />
          <Route path="/tareas/admin" element={
            <RutaProtegida soloAdmin>
              <TareasAdmin />
            </RutaProtegida>
          } />
          <Route path="/tareas/panel" element={
            <RutaProtegida rolesPermitidos={['admin', 'gestor']}>
              <TareasPanel />
            </RutaProtegida>
          } />
          <Route path="/tareas/analytics" element={
            <RutaProtegida rolesPermitidos={['admin', 'gestor']}>
              <TareasAnalytics />
            </RutaProtegida>
          } />

          {/* App: Mercado Libre */}
          <Route path="/mercadolibre" element={<RutaProtegida soloAdmin><MercadoLibreHome /></RutaProtegida>} />
          <Route path="/mercadolibre/ventas" element={<RutaProtegida soloAdmin><MLVentas /></RutaProtegida>} />

          {/* Rutas admin */}
          <Route path="/admin/articulos" element={
            <RutaProtegida rolesPermitidos={['admin', 'gestor']}>
              <AdminArticulos />
            </RutaProtegida>
          } />
          <Route path="/admin/articulos-manuales" element={
            <RutaProtegida rolesPermitidos={['admin', 'gestor']}>
              <AdminArticulosManuales />
            </RutaProtegida>
          } />
          <Route path="/admin/articulos-combos" element={
            <RutaProtegida rolesPermitidos={['admin', 'gestor']}>
              <AdminArticulosCombos />
            </RutaProtegida>
          } />
          <Route path="/admin/configuracion" element={
            <RutaProtegida rolesPermitidos={['admin', 'gestor']}>
              <ConfiguracionHub />
            </RutaProtegida>
          } />
          <Route path="/admin/configuracion/:seccion" element={
            <RutaProtegida rolesPermitidos={['admin', 'gestor']}>
              <AdminConfiguracion />
            </RutaProtegida>
          } />
          <Route path="/admin/api" element={
            <RutaProtegida soloAdmin>
              <AdminApiLogs />
            </RutaProtegida>
          } />

          {/* Redirects de compatibilidad */}
          <Route path="/operario" element={<Navigate to="/pedidos/nuevo" replace />} />
          <Route path="/operario/pedidos" element={<Navigate to="/pedidos" replace />} />
          <Route path="/admin" element={<Navigate to="/pedidos" replace />} />
          <Route path="/admin/pedidos" element={<Navigate to="/pedidos" replace />} />
          <Route path="/pedidos/historial" element={<Navigate to="/pedidos" replace />} />

          {/* Cualquier ruta desconocida */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
