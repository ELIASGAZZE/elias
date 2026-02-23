// Componente raíz de la aplicación
// Define las rutas y envuelve todo con el proveedor de autenticación
import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import RutaProtegida from './components/auth/RutaProtegida'

// Páginas
import Login from './pages/Login'
import NuevoPedido from './pages/operario/NuevoPedido'
import MisPedidos from './pages/operario/MisPedidos'
import AdminPedidos from './pages/admin/AdminPedidos'
import AdminArticulos from './pages/admin/AdminArticulos'

// Redirige al home correcto según el rol del usuario
const RedirigirSegunRol = () => {
  const { esAdmin, estaLogueado, cargando } = useAuth()

  if (cargando) return null
  if (!estaLogueado) return <Navigate to="/login" replace />
  return <Navigate to={esAdmin ? '/admin' : '/operario'} replace />
}

const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Ruta pública */}
          <Route path="/login" element={<Login />} />

          {/* Redirige la raíz según rol */}
          <Route path="/" element={<RedirigirSegunRol />} />

          {/* Rutas del operario */}
          <Route path="/operario" element={
            <RutaProtegida>
              <NuevoPedido />
            </RutaProtegida>
          } />
          <Route path="/operario/pedidos" element={
            <RutaProtegida>
              <MisPedidos />
            </RutaProtegida>
          } />

          {/* Rutas del administrador */}
          <Route path="/admin" element={
            <RutaProtegida soloAdmin>
              <AdminPedidos />
            </RutaProtegida>
          } />
          <Route path="/admin/articulos" element={
            <RutaProtegida soloAdmin>
              <AdminArticulos />
            </RutaProtegida>
          } />

          {/* Cualquier ruta desconocida redirige al inicio */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
