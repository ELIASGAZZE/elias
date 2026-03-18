// Página de login - mobile first
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const Login = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [modoEmergencia, setModoEmergencia] = useState(false)
  const [pin, setPin] = useState('')

  const { login, loginEmergencia } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setCargando(true)

    try {
      await login(username, password)
      navigate('/apps')
    } catch (err) {
      if (!err.response && (err.code === 'ERR_NETWORK' || err.message === 'Network Error')) {
        setError('Sin conexión al servidor. Usá el modo emergencia si necesitás operar.')
        setModoEmergencia(true)
      } else {
        setError('Usuario o contraseña incorrectos')
      }
    } finally {
      setCargando(false)
    }
  }

  const handleEmergencia = async (e) => {
    e.preventDefault()
    setError('')
    setCargando(true)
    try {
      await loginEmergencia(pin)
      navigate('/apps')
    } catch (err) {
      setError(err.response?.data?.error || 'Error al ingresar con PIN')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Branding */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">Padano SRL</h1>
          <p className="text-gray-500 mt-1">Gestiones Operativas</p>
        </div>

        {/* Formulario */}
        <div className="tarjeta">
          <form onSubmit={handleSubmit} className="space-y-4">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Usuario
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="campo-form"
                placeholder="tu usuario"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="campo-form"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg border border-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={cargando}
              className="btn-primario"
            >
              {cargando ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>

          {/* Modo emergencia */}
          {modoEmergencia && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <form onSubmit={handleEmergencia} className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <span className="text-sm font-semibold text-amber-700">Modo Emergencia</span>
                </div>
                <p className="text-xs text-gray-500">Ingresá el PIN para operar sin conexión. Las ventas se sincronizarán cuando vuelva internet.</p>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="campo-form text-center text-2xl tracking-[0.5em]"
                  placeholder="PIN"
                  required
                  maxLength={6}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={cargando || !pin}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white font-semibold py-2.5 rounded-lg transition-colors"
                >
                  {cargando ? 'Ingresando...' : 'Ingresar en modo emergencia'}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Acceso a fichaje */}
        <div className="text-center mt-6">
          <a
            href="/fichaje"
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Registrar asistencia
          </a>
        </div>
      </div>
    </div>
  )
}

export default Login
