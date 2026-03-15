// Componente raíz de la aplicación
// Define las rutas y envuelve todo con el proveedor de autenticación
import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import RutaProtegida from './components/auth/RutaProtegida'

// Hub
import Hub from './pages/Hub'

// Páginas de la app Pedidos
import NuevoPedido from './pages/operario/NuevoPedido'
import Pedidos from './pages/admin/AdminPedidos'
import DetallePedido from './pages/DetallePedido'

// Páginas de la app Control de Cajas
import CajasHome from './pages/cajas/CajasHome'
import CerrarCaja from './pages/cajas/CerrarCaja'
import DetalleCierre from './pages/cajas/DetalleCierre'
import VerificarCierre from './pages/cajas/VerificarCierre'
import NuevoRetiro from './pages/cajas/NuevoRetiro'
import VerificarRetiro from './pages/cajas/VerificarRetiro'
import ChatAuditoria from './pages/cajas/ChatAuditoria'
import BatchAnalisis from './pages/cajas/BatchAnalisis'

// Páginas de la app Control Caja POS
import CajasPosHome from './pages/cajas-pos/CajasPosHome'
import CerrarCajaPos from './pages/cajas-pos/CerrarCajaPos'
import DetalleCierrePos from './pages/cajas-pos/DetalleCierrePos'
import VerificarCierrePos from './pages/cajas-pos/VerificarCierrePos'
import NuevoRetiroPos from './pages/cajas-pos/NuevoRetiroPos'
import VerificarRetiroPos from './pages/cajas-pos/VerificarRetiroPos'

// Páginas de la app POS
import POS from './pages/pos/POS'
import PedidosPOS from './pages/pos/PedidosPOS'

// Páginas de la app RRHH
import RRHHHome from './pages/rrhh/RRHHHome'

// Páginas de la app Ventas
import VentasHome from './pages/ventas/VentasHome'
import DetalleVenta from './pages/ventas/DetalleVenta'

// Páginas de la app Tareas
import TareasHome from './pages/tareas/TareasHome'
import TareasAdmin from './pages/tareas/TareasAdmin'
import TareasAnalytics from './pages/tareas/TareasAnalytics'
import TareasPanel from './pages/tareas/TareasPanel'
import TareasEquipo from './pages/tareas/TareasEquipo'

// Páginas de la app Auditoría
import AuditoriaHome from './pages/auditoria/AuditoriaHome'

// Páginas solo admin
import AdminArticulos from './pages/admin/AdminArticulos'
import AdminArticulosManuales from './pages/admin/AdminArticulosManuales'
import ConfiguracionHub from './pages/admin/ConfiguracionHub'
import AdminConfiguracion from './pages/admin/AdminConfiguracion'
import AdminApiLogs from './pages/admin/AdminApiLogs'

import Login from './pages/Login'

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
      <AuthProvider>
        <Routes>
          {/* Ruta pública */}
          <Route path="/login" element={<Login />} />

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
          <Route path="/admin/configuracion" element={
            <RutaProtegida soloAdmin>
              <ConfiguracionHub />
            </RutaProtegida>
          } />
          <Route path="/admin/configuracion/:seccion" element={
            <RutaProtegida soloAdmin>
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
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
