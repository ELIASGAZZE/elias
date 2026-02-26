// Componente raíz de la aplicación
// Define las rutas y envuelve todo con el proveedor de autenticación
import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import RutaProtegida from './components/auth/RutaProtegida'

// Páginas comunes (todos los roles)
import NuevoPedido from './pages/operario/NuevoPedido'
import Pedidos from './pages/admin/AdminPedidos'

// Páginas solo admin
import AdminArticulos from './pages/admin/AdminArticulos'
import AdminArticulosManuales from './pages/admin/AdminArticulosManuales'
import AdminConfiguracion from './pages/admin/AdminConfiguracion'

import Login from './pages/Login'

// Redirige al home según si está logueado
const RedirigirHome = () => {
  const { estaLogueado, cargando } = useAuth()

  if (cargando) return null
  if (!estaLogueado) return <Navigate to="/login" replace />
  return <Navigate to="/pedidos/nuevo" replace />
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

          {/* Rutas comunes — cualquier usuario logueado */}
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

          {/* Rutas admin — requieren rol admin */}
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

          {/* Redirects de compatibilidad con rutas viejas */}
          <Route path="/operario" element={<Navigate to="/pedidos/nuevo" replace />} />
          <Route path="/operario/pedidos" element={<Navigate to="/pedidos" replace />} />
          <Route path="/admin" element={<Navigate to="/pedidos" replace />} />
          <Route path="/admin/pedidos" element={<Navigate to="/pedidos" replace />} />
          <Route path="/pedidos/historial" element={<Navigate to="/pedidos" replace />} />

          {/* Cualquier ruta desconocida redirige al inicio */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
