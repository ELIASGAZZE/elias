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

// Páginas solo admin
import AdminArticulos from './pages/admin/AdminArticulos'
import AdminArticulosManuales from './pages/admin/AdminArticulosManuales'
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
          <Route path="/cajas/cierre/:id/cerrar" element={
            <RutaProtegida rolesPermitidos={['operario', 'admin']}>
              <CerrarCaja />
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

          {/* Rutas admin */}
          <Route path="/admin/articulos" element={
            <RutaProtegida soloAdmin>
              <AdminArticulos />
            </RutaProtegida>
          } />
          <Route path="/admin/articulos-manuales" element={
            <RutaProtegida soloAdmin>
              <AdminArticulosManuales />
            </RutaProtegida>
          } />
          <Route path="/admin/configuracion" element={
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
