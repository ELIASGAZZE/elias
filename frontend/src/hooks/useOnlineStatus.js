// Hook de conectividad — retorna { isOnline, ventasPendientes }
import { useState, useEffect, useCallback } from 'react'
import { contarVentasPendientes } from '../services/offlineDB'

export default function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [ventasPendientes, setVentasPendientes] = useState(0)

  const actualizarPendientes = useCallback(async () => {
    try {
      const count = await contarVentasPendientes()
      setVentasPendientes(count)
    } catch {
      // IndexedDB no disponible
    }
  }, [])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Polling de ventas pendientes cada 5s
    actualizarPendientes()
    const interval = setInterval(actualizarPendientes, 5000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(interval)
    }
  }, [actualizarPendientes])

  return { isOnline, ventasPendientes, actualizarPendientes }
}
