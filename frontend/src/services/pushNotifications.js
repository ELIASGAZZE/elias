import api from './api'

/**
 * Registra push notifications para el admin actual.
 * Pide permiso al browser, obtiene la VAPID key del backend,
 * suscribe al pushManager y envía la suscripción al servidor.
 */
export async function registrarPushAdmin() {
  // Verificar soporte del browser
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push notifications no soportadas en este browser')
    return
  }

  // Pedir permiso
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') {
    console.log('Permiso de notificaciones denegado')
    return
  }

  try {
    // Obtener la VAPID public key del backend
    const { data } = await api.get('/api/push/vapid-public-key')
    const vapidPublicKey = data.publicKey

    if (!vapidPublicKey) {
      console.log('VAPID key no configurada en el servidor')
      return
    }

    // Convertir la key a Uint8Array
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)

    // Esperar a que el service worker esté listo
    const registration = await navigator.serviceWorker.ready

    // Verificar si ya existe una suscripción
    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      // Crear nueva suscripción
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
    }

    // Enviar la suscripción al backend
    await api.post('/api/push/subscribe', subscription.toJSON())
    console.log('Push notification registrada correctamente')
  } catch (err) {
    console.error('Error al registrar push notification:', err)
  }
}

// Helper: convierte base64url a Uint8Array (requerido por pushManager.subscribe)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
