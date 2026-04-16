import { useState, useEffect, useRef, useCallback } from 'react'
import api, { isNetworkError } from '../../../services/api'
import { getClientes } from '../../../services/offlineDB'
import { formatPrecio } from '../utils/promotionEngine'

// Cuando el cobro anticipado incluye vuelto (efectivo recibido > total),
// persistimos el NETO que queda en caja — no lo que entregó el cliente.
// Si no se hiciera, al entregar el sistema creería que hay un saldo a favor falso
// y la caja acabaría con un faltante igual al vuelto.
function aplicarVueltoAPagoAnticipado(datosPago) {
  const vuelto = parseFloat(datosPago?.vuelto) || 0
  const montoPagado = parseFloat(datosPago?.monto_pagado) || 0
  const pagos = Array.isArray(datosPago?.pagos) ? datosPago.pagos : []
  if (vuelto <= 0 || pagos.length === 0) {
    return { pagos, montoPagadoNeto: montoPagado }
  }
  // El vuelto siempre se devuelve en efectivo — restarlo del primer pago tipo Efectivo
  const idxEfectivo = pagos.findIndex(p => (p.tipo || '').toLowerCase() === 'efectivo')
  if (idxEfectivo < 0) {
    // Sin efectivo no debería haber vuelto, pero por las dudas no tocamos
    return { pagos, montoPagadoNeto: montoPagado }
  }
  const pagosNeto = pagos.map((p, i) => {
    if (i !== idxEfectivo) return p
    const montoNeto = Math.round(((parseFloat(p.monto) || 0) - vuelto) * 100) / 100
    return { ...p, monto: Math.max(0, montoNeto) }
  }).filter(p => (parseFloat(p.monto) || 0) > 0)
  return {
    pagos: pagosNeto,
    montoPagadoNeto: Math.round((montoPagado - vuelto) * 100) / 100,
  }
}

export function usePedidoWizard({
  carrito,
  cliente,
  setCliente,
  terminalConfig,
  total,
  subtotal,
  descuentoTotal,
  promosAplicadas,
  limpiarVenta,
  precioConDescEmpleado,
  isOnline,
  cierreActivo,
  pedidoEnProceso,
  saldoCliente,
  actualizarPendientes,
  setPedidosRefreshKey,
  setVistaActiva,
  turnoPedidoProp, // alias for external reference to turnoPedido
}) {
  // --- State ---
  const [cargandoPedidos, setCargandoPedidos] = useState(false)
  const [guardandoPedido, setGuardandoPedido] = useState(false)

  const [mostrarBuscarClientePedido, setMostrarBuscarClientePedido] = useState(false)
  const [pasoPedido, setPasoPedido] = useState(0)
  const [fechaEntregaPedido, setFechaEntregaPedido] = useState('')
  const [turnoPedido, setTurnoPedido] = useState('')
  const [observacionEntregaPedido, setObservacionEntregaPedido] = useState('')
  const [tarjetaRegaloPedido, setTarjetaRegaloPedido] = useState('')
  const [observacionesPedidoTexto, setObservacionesPedidoTexto] = useState('')
  const [bloqueosFecha, setBloqueosFecha] = useState([])
  const [mostrarCobrarPedido, setMostrarCobrarPedido] = useState(false)
  const [cobrarPedidoExistente, setCobrarPedidoExistente] = useState(null)
  const pedidoWizardDataRef = useRef(null)
  const [clientePedido, setClientePedido] = useState(null)
  const [busquedaClientePedido, setBusquedaClientePedido] = useState('')
  const [clientesPedido, setClientesPedido] = useState([])
  const [buscandoClientePedido, setBuscandoClientePedido] = useState(false)
  const [mostrarCrearClientePedido, setMostrarCrearClientePedido] = useState(false)
  const inputClientePedidoRef = useRef(null)

  const [tipoPedidoSeleccionado, setTipoPedidoSeleccionado] = useState(null)
  const [direccionesPedido, setDireccionesPedido] = useState([])
  const [direccionSeleccionadaPedido, setDireccionSeleccionadaPedido] = useState(null)
  const [sucursalesPedido, setSucursalesPedido] = useState([])
  const [sucursalSeleccionadaPedido, setSucursalSeleccionadaPedido] = useState(null)
  const [cargandoDetallePedido, setCargandoDetallePedido] = useState(false)
  const [mostrarNuevaDirPedido, setMostrarNuevaDirPedido] = useState(false)
  const [nuevaDirPedido, setNuevaDirPedido] = useState({ direccion: '', localidad: '' })
  const [guardandoDirPedido, setGuardandoDirPedido] = useState(false)
  const [editandoDirPedido, setEditandoDirPedido] = useState(null)
  const [guardandoEditDirPedido, setGuardandoEditDirPedido] = useState(false)

  // --- Buscar cliente para pedido (debounced) ---
  useEffect(() => {
    if (!mostrarBuscarClientePedido) return
    const termino = busquedaClientePedido.trim()
    if (termino.length < 2) { setClientesPedido([]); return }

    const timeout = setTimeout(async () => {
      setBuscandoClientePedido(true)
      try {
        if (isOnline) {
          const { data } = await api.get('/api/clientes', { params: { buscar: termino, limit: 15, solo_dni: true } })
          setClientesPedido(data.clientes || data.data || [])
        } else {
          const cached = await getClientes(termino)
          setClientesPedido(cached.slice(0, 15))
        }
      } catch (err) {
        console.error('Error buscando clientes para pedido:', err)
        if (isNetworkError(err)) {
          try {
            const cached = await getClientes(termino)
            setClientesPedido(cached.slice(0, 15))
          } catch {}
        }
      } finally {
        setBuscandoClientePedido(false)
      }
    }, 350)

    return () => clearTimeout(timeout)
  }, [busquedaClientePedido, mostrarBuscarClientePedido, isOnline])

  // Focus input al abrir modal cliente pedido
  useEffect(() => {
    if (mostrarBuscarClientePedido) {
      setTimeout(() => inputClientePedidoRef.current?.focus(), 100)
    }
  }, [mostrarBuscarClientePedido])

  // --- Functions ---
  function cerrarWizardPedido() {
    setMostrarBuscarClientePedido(false)
    setMostrarCobrarPedido(false)
    setPasoPedido(0)
    setClientePedido(null)
    setFechaEntregaPedido('')
    setTurnoPedido('')
    setBloqueosFecha([])
    setBusquedaClientePedido('')
    setClientesPedido([])
    setMostrarCrearClientePedido(false)
    setTipoPedidoSeleccionado(null)
    setDireccionesPedido([])
    setDireccionSeleccionadaPedido(null)
    setSucursalesPedido([])
    setSucursalSeleccionadaPedido(null)
    setMostrarNuevaDirPedido(false)
    setNuevaDirPedido({ direccion: '', localidad: '' })
    setObservacionEntregaPedido('')
    setTarjetaRegaloPedido('')
    setObservacionesPedidoTexto('')
  }

  function seleccionarClienteParaPedido(cli) {
    if (!cli.id_centum) return
    setClientePedido(cli)
    setPasoPedido(2)
  }

  function onClientePedidoCreado(clienteNuevo) {
    setMostrarCrearClientePedido(false)
    if (clienteNuevo?.id_centum) {
      seleccionarClienteParaPedido(clienteNuevo)
    }
  }

  async function seleccionarTipoPedido(tipo) {
    if (!clientePedido) return
    setTipoPedidoSeleccionado(tipo)
    setPasoPedido(3)
    setCargandoDetallePedido(true)
    try {
      if (clientePedido.id_centum) {
        api.put(`/api/clientes/contacto/${clientePedido.id_centum}`, {
          email: clientePedido.email || null,
          celular: clientePedido.celular || null,
        }).catch(err => console.warn('Error guardando contacto:', err.message))
      }
      if (tipo === 'delivery') {
        const { data } = await api.get(`/api/clientes/${clientePedido.id}/direcciones`)
        setDireccionesPedido(data || [])
        if (data && data.length > 0) setDireccionSeleccionadaPedido(data[0].id)
      } else {
        const { data } = await api.get('/api/sucursales')
        const conPedidos = (data || []).filter(s => s.permite_pedidos)
        setSucursalesPedido(conPedidos)
        if (conPedidos.length > 0) setSucursalSeleccionadaPedido(conPedidos[0].id)
      }
    } catch (err) {
      console.error('Error cargando datos paso 2:', err)
    } finally {
      setCargandoDetallePedido(false)
    }
  }

  async function guardarNuevaDirPedido() {
    if (!nuevaDirPedido.direccion.trim()) return
    setGuardandoDirPedido(true)
    try {
      const { data } = await api.post(`/api/clientes/${clientePedido.id}/direcciones`, {
        direccion: nuevaDirPedido.direccion.trim(),
        localidad: nuevaDirPedido.localidad.trim() || null,
      })
      setDireccionesPedido(prev => [...prev, data])
      setDireccionSeleccionadaPedido(data.id)
      setMostrarNuevaDirPedido(false)
      setNuevaDirPedido({ direccion: '', localidad: '' })
    } catch (err) {
      console.error('Error guardando dirección:', err)
      alert('Error al guardar dirección: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoDirPedido(false)
    }
  }

  async function guardarEditDirPedido() {
    if (!editandoDirPedido || !editandoDirPedido.direccion.trim()) return
    setGuardandoEditDirPedido(true)
    try {
      const { data } = await api.put(`/api/clientes/${clientePedido.id}/direcciones/${editandoDirPedido.id}`, {
        direccion: editandoDirPedido.direccion.trim(),
        localidad: editandoDirPedido.localidad.trim() || null,
      })
      setDireccionesPedido(prev => prev.map(d => d.id === data.id ? data : d))
      setEditandoDirPedido(null)
    } catch (err) {
      console.error('Error editando dirección:', err)
      alert('Error al editar dirección: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoEditDirPedido(false)
    }
  }

  function confirmarPedidoWizard() {
    setPasoPedido(4)
  }

  function finalizarPedidoWizard(modo) {
    if (!clientePedido || !tipoPedidoSeleccionado) return
    const cli = {
      id_centum: clientePedido.id_centum,
      razon_social: clientePedido.razon_social,
      lista_precio_id: clientePedido.lista_precio_id || 1,
    }
    const dirObj = tipoPedidoSeleccionado === 'delivery' && direccionSeleccionadaPedido
      ? direccionesPedido.find(d => d.id === direccionSeleccionadaPedido)
      : null
    const sucObj = tipoPedidoSeleccionado === 'retiro' && sucursalSeleccionadaPedido
      ? sucursalesPedido.find(s => s.id === sucursalSeleccionadaPedido)
      : null
    setCliente(cli)

    if (modo === 'cobrar') {
      setMostrarBuscarClientePedido(false)
      setMostrarCobrarPedido(true)
      const extras = { observacionEntrega: observacionEntregaPedido.trim() || null, tarjetaRegalo: tarjetaRegaloPedido.trim() || null, observacionesPedido: observacionesPedidoTexto.trim() || null }
      pedidoWizardDataRef.current = { cli, tipo: tipoPedidoSeleccionado, dirObj, sucObj, fecha: fechaEntregaPedido, ...extras }
    } else if (modo === 'efectivo_entrega') {
      const extras = { observacionEntrega: observacionEntregaPedido.trim() || null, tarjetaRegalo: tarjetaRegaloPedido.trim() || null, observacionesPedido: observacionesPedidoTexto.trim() || null }
      cerrarWizardPedido()
      guardarComoPedidoConCliente(cli, tipoPedidoSeleccionado, dirObj, sucObj, false, fechaEntregaPedido, null, 'PAGO EN ENTREGA: EFECTIVO', extras)
    } else if (modo === 'link_pago') {
      const extras = { observacionEntrega: observacionEntregaPedido.trim() || null, tarjetaRegalo: tarjetaRegaloPedido.trim() || null, observacionesPedido: observacionesPedidoTexto.trim() || null }
      cerrarWizardPedido()
      guardarPedidoYGenerarLink(cli, tipoPedidoSeleccionado, dirObj, sucObj, fechaEntregaPedido, extras)
    } else {
      const extras = { observacionEntrega: observacionEntregaPedido.trim() || null, tarjetaRegalo: tarjetaRegaloPedido.trim() || null, observacionesPedido: observacionesPedidoTexto.trim() || null }
      cerrarWizardPedido()
      guardarComoPedidoConCliente(cli, tipoPedidoSeleccionado, dirObj, sucObj, false, fechaEntregaPedido, null, null, extras)
    }
  }

  async function guardarPedidoYGenerarLink(cli, tipo, direccion, sucursal, fechaEntrega, extras) {
    if (carrito.length === 0) return
    setGuardandoPedido(true)
    try {
      const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
      const itemsPayload = carrito.map(i => ({
        id: i.articulo.id,
        codigo: i.articulo.codigo,
        nombre: i.articulo.nombre,
        precio: i.precioOverride != null ? i.precioOverride : precioConDescEmpleado(i.articulo),
        cantidad: i.cantidad,
        esPesable: i.articulo.esPesable || false,
        rubro: i.articulo.rubro?.nombre || null,
      }))

      if (fechaEntrega) {
        const manana = new Date()
        manana.setDate(manana.getDate() + 1)
        const mananaISO = manana.toISOString().split('T')[0]
        const tienePerecedor = carrito.some(i => {
          const rubro = (i.articulo.rubro?.nombre || '').toLowerCase()
          return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
        })
        if (tienePerecedor && fechaEntrega > mananaISO) {
          alert('Los pedidos con productos de Fiambres, Quesos o Frescos no pueden tener fecha de entrega mayor a mañana.')
          setGuardandoPedido(false)
          return
        }
      }

      const payload = {
        id_cliente_centum: cli.id_centum,
        nombre_cliente: cli.razon_social,
        items: itemsPayload,
        total,
        tipo: tipo || 'retiro',
        observaciones: 'PAGO PENDIENTE: LINK TALO',
      }
      if (direccion) {
        payload.direccion_entrega = direccion.direccion + (direccion.localidad ? `, ${direccion.localidad}` : '')
      }
      if (sucursal) {
        payload.sucursal_retiro = sucursal.nombre
        payload.sucursal_id = sucursal.id
      }
      if (fechaEntrega) {
        payload.fecha_entrega = fechaEntrega
      }
      if (extras?.observacionEntrega) {
        payload.observaciones = `${payload.observaciones} | ENTREGA: ${extras.observacionEntrega}`
      }
      if (extras?.tarjetaRegalo) payload.tarjeta_regalo = extras.tarjetaRegalo
      if (extras?.observacionesPedido) payload.observaciones_pedido = extras.observacionesPedido
      if (tipo === 'delivery') {
        payload.turno_entrega = turnoPedido || null
        payload.sucursal_id = 'c254cac8-4c6e-4098-9119-485d7172f281' // Fisherton
      }

      const { data } = await api.post('/api/pos/pedidos', payload)
      const pedidoId = data.pedido?.id

      // Generar link MP
      if (pedidoId) {
        try {
          const { data: linkData } = await api.post(`/api/pos/pedidos/${pedidoId}/link-pago`)
          if (linkData.link) {
            const textoCompleto = `Importante!! por favor transferir al cbu que figura en el link y el importe del link para que su pago se regitre de forma correcta. Si usted realiza la transferencia a un cbu viejo el pago no impactara.\n${linkData.link}`
            try {
              await navigator.clipboard.writeText(textoCompleto)
            } catch {
              const ta = document.createElement('textarea')
              ta.value = textoCompleto
              ta.style.position = 'fixed'
              ta.style.opacity = '0'
              document.body.appendChild(ta)
              ta.focus()
              ta.select()
              document.execCommand('copy')
              document.body.removeChild(ta)
            }
            alert('Link de pago copiado al portapapeles')
          }
        } catch (linkErr) {
          console.error('Error generando link MP:', linkErr)
          alert('Pedido guardado pero hubo un error al generar el link: ' + (linkErr.response?.data?.error || linkErr.message))
        }
      }

      limpiarVenta()
    } catch (err) {
      console.error('Error guardando pedido:', err)
      alert('Error al guardar pedido: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoPedido(false)
    }
  }

  function handleEsPedido() {
    if (carrito.length === 0) return
    const manana = new Date()
    manana.setDate(manana.getDate() + 1)
    setFechaEntregaPedido(manana.toISOString().split('T')[0])
    setPasoPedido(0)
    setMostrarBuscarClientePedido(true)
  }

  async function guardarComoPedidoConCliente(cli, tipo, direccion, sucursal, pagado, fechaEntrega, datosPago, observacionExtra, extras) {
    if (carrito.length === 0) return
    if (!cli.id_centum || cli.id_centum === 0) return
    setGuardandoPedido(true)
    try {
      const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
      const itemsPayload = carrito.map(i => ({
        id: i.articulo.id,
        codigo: i.articulo.codigo,
        nombre: i.articulo.nombre,
        precio: i.precioOverride != null ? i.precioOverride : precioConDescEmpleado(i.articulo),
        cantidad: i.cantidad,
        esPesable: i.articulo.esPesable || false,
        rubro: i.articulo.rubro?.nombre || null,
      }))

      if (fechaEntrega) {
        const manana = new Date()
        manana.setDate(manana.getDate() + 1)
        const mananaISO = manana.toISOString().split('T')[0]
        const tienePerecedor = carrito.some(i => {
          const rubro = (i.articulo.rubro?.nombre || '').toLowerCase()
          return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
        })
        if (tienePerecedor && fechaEntrega > mananaISO) {
          alert('Los pedidos con productos de Fiambres, Quesos o Frescos no pueden tener fecha de entrega mayor a mañana.')
          setGuardandoPedido(false)
          return
        }
      }
      const payload = {
        id_cliente_centum: cli.id_centum,
        nombre_cliente: cli.razon_social,
        items: itemsPayload,
        total,
        tipo: tipo || 'retiro',
      }
      if (direccion) {
        payload.direccion_entrega = direccion.direccion + (direccion.localidad ? `, ${direccion.localidad}` : '')
        payload.direccion_entrega_id = direccion.id
      }
      if (sucursal) {
        payload.sucursal_retiro = sucursal.nombre
        payload.sucursal_retiro_id = sucursal.id
        payload.sucursal_id = sucursal.id
      }
      if (pagado) {
        if (datosPago?.pagos) {
          const { pagos: pagosNeto, montoPagadoNeto } = aplicarVueltoAPagoAnticipado(datosPago)
          const vueltoDado = parseFloat(datosPago?.vuelto) || 0
          const resumenPago = pagosNeto.map(p => `${p.tipo}: $${p.monto}`).join(', ')
          payload.observaciones = vueltoDado > 0
            ? `PAGO ANTICIPADO: ${resumenPago} (se dio $${vueltoDado} de vuelto al cobrar)`
            : `PAGO ANTICIPADO: ${resumenPago}`
          payload.pagos_anticipado = pagosNeto
          payload.caja_cobro_id = terminalConfig?.caja_id || null
          if (datosPago.descuento_forma_pago) {
            payload.descuento_forma_pago = datosPago.descuento_forma_pago
          }
          payload.total_pagado = montoPagadoNeto || total
        } else {
          payload.observaciones = 'PAGO ANTICIPADO'
          payload.total_pagado = datosPago?.monto_pagado || total
        }
      } else if (observacionExtra) {
        payload.observaciones = observacionExtra
      }
      if (extras?.observacionEntrega) {
        payload.observaciones = payload.observaciones
          ? `${payload.observaciones} | ENTREGA: ${extras.observacionEntrega}`
          : `ENTREGA: ${extras.observacionEntrega}`
      }
      if (extras?.tarjetaRegalo) payload.tarjeta_regalo = extras.tarjetaRegalo
      if (extras?.observacionesPedido) payload.observaciones_pedido = extras.observacionesPedido
      if (fechaEntrega) {
        payload.fecha_entrega = fechaEntrega
      }
      if (tipo === 'delivery') {
        payload.turno_entrega = turnoPedido || null
        payload.sucursal_id = 'c254cac8-4c6e-4098-9119-485d7172f281' // Fisherton
      }
      // Enviar nombre del empleado (cajero real) para mostrar en pedidos
      if (cierreActivo?.empleado?.nombre) {
        payload.cajero_nombre = cierreActivo.empleado.nombre
      }
      await api.post('/api/pos/pedidos', payload)
      limpiarVenta()
    } catch (err) {
      console.error('Error guardando pedido:', err)
      alert('Error al guardar pedido: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoPedido(false)
    }
  }

  function handleCobroPedidoExitoso(datosPago) {
    const wd = pedidoWizardDataRef.current
    setMostrarCobrarPedido(false)

    // Cobro de pedido existente (desde tab Pedidos)
    if (cobrarPedidoExistente) {
      const pedido = cobrarPedidoExistente
      setCobrarPedidoExistente(null);
      (async () => {
        try {
          const { pagos: pagosNeto, montoPagadoNeto } = aplicarVueltoAPagoAnticipado(datosPago)
          const vueltoDado = parseFloat(datosPago?.vuelto) || 0
          const resumenPago = pagosNeto.map(p => `${p.tipo}: $${p.monto}`).join(', ')
          const observaciones = vueltoDado > 0
            ? `PAGO ANTICIPADO: ${resumenPago} (se dio $${vueltoDado} de vuelto al cobrar)`
            : `PAGO ANTICIPADO: ${resumenPago}`
          await api.put(`/api/pos/pedidos/${pedido.id}/pago`, {
            total_pagado: montoPagadoNeto || pedido.total,
            observaciones,
            pagos_anticipado: pagosNeto,
            caja_cobro_id: terminalConfig?.caja_id || null,
            descuento_forma_pago: datosPago?.descuento_forma_pago || null,
          })
          setPedidosRefreshKey(k => k + 1)
        } catch (err) {
          console.error('Error actualizando pago pedido:', err)
          alert('Error al registrar pago: ' + (err.response?.data?.error || err.message))
        }
      })()
      return
    }

    if (wd) {
      guardarComoPedidoConCliente(wd.cli, wd.tipo, wd.dirObj, wd.sucObj, true, wd.fecha, datosPago, null, { observacionEntrega: wd.observacionEntrega, tarjetaRegalo: wd.tarjetaRegalo, observacionesPedido: wd.observacionesPedido })
      pedidoWizardDataRef.current = null
    }
    // Limpiar wizard state
    setPasoPedido(0)
    setClientePedido(null)
    setTipoPedidoSeleccionado(null)
    setDireccionesPedido([])
    setDireccionSeleccionadaPedido(null)
    setSucursalesPedido([])
    setSucursalSeleccionadaPedido(null)
  }

  function handleCobrarPedidoEnCaja(pedido) {
    setCobrarPedidoExistente(pedido)
    setMostrarCobrarPedido(true)
  }

  return {
    // State
    cargandoPedidos,
    guardandoPedido,
    mostrarBuscarClientePedido,
    pasoPedido,
    setPasoPedido,
    fechaEntregaPedido,
    setFechaEntregaPedido,
    turnoPedido,
    setTurnoPedido,
    observacionEntregaPedido,
    setObservacionEntregaPedido,
    tarjetaRegaloPedido,
    setTarjetaRegaloPedido,
    observacionesPedidoTexto,
    setObservacionesPedidoTexto,
    bloqueosFecha,
    setBloqueosFecha,
    mostrarCobrarPedido,
    setMostrarCobrarPedido,
    cobrarPedidoExistente,
    setCobrarPedidoExistente,
    pedidoWizardDataRef,
    pedidosRefreshKey: undefined, // managed externally via setPedidosRefreshKey
    clientePedido,
    setClientePedido,
    busquedaClientePedido,
    setBusquedaClientePedido,
    clientesPedido,
    buscandoClientePedido,
    mostrarCrearClientePedido,
    setMostrarCrearClientePedido,
    inputClientePedidoRef,
    tipoPedidoSeleccionado,
    setTipoPedidoSeleccionado,
    direccionesPedido,
    direccionSeleccionadaPedido,
    setDireccionSeleccionadaPedido,
    sucursalesPedido,
    sucursalSeleccionadaPedido,
    setSucursalSeleccionadaPedido,
    cargandoDetallePedido,
    mostrarNuevaDirPedido,
    setMostrarNuevaDirPedido,
    nuevaDirPedido,
    setNuevaDirPedido,
    guardandoDirPedido,
    editandoDirPedido,
    setEditandoDirPedido,
    guardandoEditDirPedido,
    // Functions
    cerrarWizardPedido,
    seleccionarClienteParaPedido,
    onClientePedidoCreado,
    seleccionarTipoPedido,
    guardarNuevaDirPedido,
    guardarEditDirPedido,
    confirmarPedidoWizard,
    finalizarPedidoWizard,
    guardarPedidoYGenerarLink,
    handleEsPedido,
    guardarComoPedidoConCliente,
    handleCobroPedidoExitoso,
    handleCobrarPedidoEnCaja,
    setGuardandoPedido,
  }
}
