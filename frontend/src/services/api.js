// Cliente HTTP configurado para comunicarse con el backend
import axios from 'axios'

// Creamos una instancia de axios con la URL base del backend
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
})

// Flag para evitar múltiples refreshes simultáneos
let isRefreshing = false
let failedQueue = []

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

// Interceptor de request: adjunta el token JWT automáticamente en cada request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Interceptor de response: si el token expiró, intenta renovar con refresh token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Si es 401 y no es un retry ni un request de auth
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest._skipAuthRedirect &&
      !originalRequest.url?.includes('/api/auth/refresh') &&
      !originalRequest.url?.includes('/api/auth/login')
    ) {
      const refreshToken = localStorage.getItem('refresh_token')

      if (!refreshToken) {
        // Sin refresh token: cerrar sesión
        localStorage.removeItem('token')
        localStorage.removeItem('refresh_token')
        localStorage.removeItem('usuario')
        window.location.href = '/login'
        return Promise.reject(error)
      }

      if (isRefreshing) {
        // Ya hay un refresh en curso: encolar este request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        }).catch(err => Promise.reject(err))
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const { data } = await axios.post(
          `${api.defaults.baseURL}/api/auth/refresh`,
          { refresh_token: refreshToken }
        )

        localStorage.setItem('token', data.token)
        localStorage.setItem('refresh_token', data.refresh_token)

        processQueue(null, data.token)

        originalRequest.headers.Authorization = `Bearer ${data.token}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        // Refresh falló: cerrar sesión
        localStorage.removeItem('token')
        localStorage.removeItem('refresh_token')
        localStorage.removeItem('usuario')
        window.location.href = '/login'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)

// Refresh preventivo cada 45 minutos (token expira en 1 hora)
// Se guarda el ID para evitar duplicados con HMR
let _refreshIntervalId = null
function iniciarRefreshPreventivo() {
  if (_refreshIntervalId) return
  _refreshIntervalId = setInterval(async () => {
    const refreshToken = localStorage.getItem('refresh_token')
    const token = localStorage.getItem('token')
    if (!refreshToken || !token) return

    try {
      const { data } = await axios.post(
        `${api.defaults.baseURL}/api/auth/refresh`,
        { refresh_token: refreshToken }
      )
      localStorage.setItem('token', data.token)
      localStorage.setItem('refresh_token', data.refresh_token)
    } catch {
      // Si falla el refresh preventivo, no hacemos nada — el interceptor lo maneja después
    }
  }, 45 * 60 * 1000)
}
iniciarRefreshPreventivo()

// Refresh inmediato al cargar la app (tras reinicio de PC, el token puede haber expirado)
;(async () => {
  const refreshToken = localStorage.getItem('refresh_token')
  if (!refreshToken) return
  try {
    const { data } = await axios.post(
      `${api.defaults.baseURL}/api/auth/refresh`,
      { refresh_token: refreshToken }
    )
    localStorage.setItem('token', data.token)
    localStorage.setItem('refresh_token', data.refresh_token)
  } catch {
    // Si falla, el interceptor de 401 se encargará
  }
})()

export function isNetworkError(err) {
  return !err.response && (err.code === 'ERR_NETWORK' || err.message === 'Network Error')
}

export default api
