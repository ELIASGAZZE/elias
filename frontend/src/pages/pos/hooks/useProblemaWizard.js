import { useState, useRef, useCallback } from 'react'
import api from '../../../services/api'

/**
 * Custom hook que encapsula todo el estado y la lógica del wizard "Problema" (devolución/NC).
 *
 * @param {Object} deps - Dependencias externas del POS principal
 * @param {Object|null} deps.terminalConfig - Configuración de terminal/caja
 */
export default function useProblemaWizard({ terminalConfig } = {}) {
  // --- State ---
  const [mostrarProblema, setMostrarProblema] = useState(false)
  const [problemaSeleccionado, setProblemaSeleccionado] = useState(null)
  const [problemaPaso, setProblemaPaso] = useState(0) // 0=tipo, 1=buscar factura, 2=seleccionar productos
  const [problemaBusqueda, setProblemaBusqueda] = useState('')
  const [problemaBusFactura, setProblemaBusFactura] = useState('')
  const [problemaFecha, setProblemaFecha] = useState('')
  const [problemaBusArticulo, setProblemaBusArticulo] = useState('')
  const [problemaSucursal, setProblemaSucursal] = useState('')
  const [problemaSucursales, setProblemaSucursales] = useState([])
  const [problemaVentas, setProblemaVentas] = useState([])
  const [problemaBuscando, setProblemaBuscando] = useState(false)
  const [problemaVentaSel, setProblemaVentaSel] = useState(null)
  const [problemaItemsSel, setProblemaItemsSel] = useState({}) // { idx: cantDevolver }
  const [problemaDescripciones, setProblemaDescripciones] = useState({}) // { idx: 'texto' }
  const [problemaYaDevuelto, setProblemaYaDevuelto] = useState({}) // { idx: cantDevueltaPrevia }
  const [problemaCliente, setProblemaCliente] = useState(null) // cliente identificado
  const [problemaBusCliente, setProblemaBusCliente] = useState('')
  const [problemaClientesRes, setProblemaClientesRes] = useState([])
  const [problemaBuscandoCli, setProblemaBuscandoCli] = useState(false)
  const [problemaCrearCliente, setProblemaCrearCliente] = useState(false)
  const [problemaConfirmando, setProblemaConfirmando] = useState(false)
  const [problemaObservacion, setProblemaObservacion] = useState('')
  const [problemaPreciosCorregidos, setProblemaPreciosCorregidos] = useState({}) // { idx: precioCorregido }
  const [problemaEmailCliente, setProblemaEmailCliente] = useState('')

  const problemaTimerRef = useRef(null)
  const problemaCliTimerRef = useRef(null)

  // --- Handlers ---

  const cerrarModalProblema = useCallback(() => {
    setMostrarProblema(false)
    setProblemaSeleccionado(null)
    setProblemaPaso(0)
    setProblemaBusqueda('')
    setProblemaBusFactura('')
    setProblemaBusArticulo('')
    setProblemaSucursal('')
    setProblemaFecha('')
    setProblemaVentas([])
    setProblemaVentaSel(null)
    setProblemaItemsSel({})
    setProblemaDescripciones({})
    setProblemaCliente(null)
    setProblemaBusCliente('')
    setProblemaClientesRes([])
    setProblemaCrearCliente(false)
    setProblemaObservacion('')
    setProblemaPreciosCorregidos({})
    setProblemaYaDevuelto({})
    setProblemaEmailCliente('')
  }, [])

  async function buscarVentasProblema(overrides = {}) {
    const cliente = overrides.buscar ?? problemaBusqueda
    const fecha = overrides.fecha ?? problemaFecha
    const articulo = overrides.articulo ?? problemaBusArticulo
    const sucId = overrides.sucursal_id ?? problemaSucursal
    const numFactura = overrides.numero_factura ?? problemaBusFactura
    setProblemaBuscando(true)
    try {
      const params = {}
      if (numFactura && numFactura.trim().length >= 1) {
        params.numero_factura = numFactura.trim()
      } else {
        if (fecha) params.fecha = fecha
        if (cliente && cliente.trim().length >= 2) params.buscar = cliente.trim()
        if (articulo && articulo.trim().length >= 2) params.articulo = articulo.trim()
        if (sucId) params.sucursal_id = sucId
      }
      params.problema = 1
      const { data } = await api.get('/api/pos/ventas', { params })
      setProblemaVentas(data.ventas || [])
    } catch {
      setProblemaVentas([])
    } finally {
      setProblemaBuscando(false)
    }
  }

  function buscarVentasProblemaDebounced(overrides = {}) {
    clearTimeout(problemaTimerRef.current)
    problemaTimerRef.current = setTimeout(() => {
      buscarVentasProblema(overrides)
    }, 300)
  }

  const abrirProblema = useCallback(() => {
    setMostrarProblema(true)
  }, [])

  return {
    // State
    mostrarProblema,
    setMostrarProblema,
    problemaSeleccionado,
    setProblemaSeleccionado,
    problemaPaso,
    setProblemaPaso,
    problemaBusqueda,
    setProblemaBusqueda,
    problemaBusFactura,
    setProblemaBusFactura,
    problemaFecha,
    setProblemaFecha,
    problemaBusArticulo,
    setProblemaBusArticulo,
    problemaSucursal,
    setProblemaSucursal,
    problemaSucursales,
    setProblemaSucursales,
    problemaVentas,
    setProblemaVentas,
    problemaBuscando,
    problemaVentaSel,
    setProblemaVentaSel,
    problemaItemsSel,
    setProblemaItemsSel,
    problemaDescripciones,
    setProblemaDescripciones,
    problemaYaDevuelto,
    setProblemaYaDevuelto,
    problemaCliente,
    setProblemaCliente,
    problemaBusCliente,
    setProblemaBusCliente,
    problemaClientesRes,
    setProblemaClientesRes,
    problemaBuscandoCli,
    setProblemaBuscandoCli,
    problemaCrearCliente,
    setProblemaCrearCliente,
    problemaConfirmando,
    setProblemaConfirmando,
    problemaObservacion,
    setProblemaObservacion,
    problemaPreciosCorregidos,
    setProblemaPreciosCorregidos,
    problemaEmailCliente,
    setProblemaEmailCliente,
    problemaTimerRef,
    problemaCliTimerRef,

    // Handlers
    cerrarModalProblema,
    buscarVentasProblema,
    buscarVentasProblemaDebounced,
    abrirProblema,

    // External deps forwarded for component use
    terminalConfig,
  }
}
