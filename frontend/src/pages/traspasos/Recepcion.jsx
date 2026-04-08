// Vista de recepción de una orden de traspaso (pesaje ciego + verificación)
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const Recepcion = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [orden, setOrden] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [pesosDestino, setPesosDestino] = useState({})
  const [verificando, setVerificando] = useState(null)
  const [diferencias, setDiferencias] = useState([])
  const [conteoCiego, setConteoCiego] = useState({}) // { canastoId: { articulo_id: cantidad } }
  const [bultosPallet, setBultosPallet] = useState({}) // { canastoId: cantidad }
  const [recibiendoId, setRecibiendoId] = useState(null)

  const cargar = () => {
    api.get(`/api/traspasos/ordenes/${id}`)
      .then(r => {
        setOrden(r.data)
        if (!['despacho_parcial', 'despachado', 'recibido', 'con_diferencia'].includes(r.data.estado)) {
          alert('Esta orden no está lista para recepción')
          navigate(`/traspasos/ordenes/${id}`)
        }
      })
      .catch(err => console.error(err))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargar() }, [id])

  const recibirEnDestino = async (canastoId) => {
    setRecibiendoId(canastoId)
    try {
      await api.put(`/api/traspasos/canastos/${canastoId}/recibir-en-destino`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al recibir en destino')
    } finally {
      setRecibiendoId(null)
    }
  }

  const recibirTodosEnDestino = async () => {
    const enTransito = (orden?.canastos || []).filter(c => c.estado === 'en_transito')
    for (const c of enTransito) {
      try {
        await api.put(`/api/traspasos/canastos/${c.id}/recibir-en-destino`)
      } catch (err) {
        console.error(`Error recibiendo canasto ${c.id}:`, err)
      }
    }
    cargar()
  }

  const pesarCanasto = async (canastoId) => {
    const peso = pesosDestino[canastoId]
    if (!peso || parseFloat(peso) <= 0) return alert('Ingresá un peso válido')

    try {
      const r = await api.put(`/api/traspasos/canastos/${canastoId}/pesar-destino`, {
        peso_destino: parseFloat(peso),
      })
      if (!r.data.dentro_tolerancia) {
        alert('Peso fuera de tolerancia. Se registró como diferencia.')
      }
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al pesar canasto')
    }
  }

  const verificarPallet = async (canastoId) => {
    const bultos = bultosPallet[canastoId]
    if (!bultos || parseInt(bultos) <= 0) return alert('Ingresá la cantidad de bultos')

    try {
      const r = await api.put(`/api/traspasos/canastos/${canastoId}/verificar-pallet`, {
        cantidad_bultos_destino: parseInt(bultos),
      })
      if (!r.data.bultos_coinciden) {
        alert('La cantidad de bultos no coincide. Se registró como diferencia.')
      }
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al verificar pallet')
    }
  }

  const iniciarVerificacion = (canasto) => {
    setVerificando(canasto.id)
    const items = (canasto.items && canasto.items.length > 0) ? canasto.items : (orden.items || [])
    setDiferencias(items.map(i => ({
      articulo_id: i.articulo_id,
      nombre: i.nombre,
      codigo: i.codigo,
      cantidad_esperada: i.cantidad || i.cantidad_solicitada || 0,
      cantidad_real: i.cantidad || i.cantidad_solicitada || 0,
      tipo: 'ok',
      nota: '',
    })))
  }

  const actualizarDiferencia = (idx, campo, valor) => {
    const nuevas = [...diferencias]
    nuevas[idx][campo] = valor
    if (campo === 'cantidad_real') {
      nuevas[idx].tipo = parseFloat(valor) === nuevas[idx].cantidad_esperada ? 'ok' : 'diferencia'
    }
    setDiferencias(nuevas)
  }

  const confirmarVerificacion = async (canastoId) => {
    try {
      await api.put(`/api/traspasos/canastos/${canastoId}/verificar`, { diferencias })
      setVerificando(null)
      setDiferencias([])
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al verificar')
    }
  }

  const confirmarConteoCiego = async (canastoId) => {
    const cantidades = conteoCiego[canastoId] || {}
    const canasto = (orden.canastos || []).find(c => c.id === canastoId)
    if (!canasto) return

    const items = (canasto.items || []).map(i => ({
      articulo_id: i.articulo_id,
      nombre: i.nombre,
      cantidad_recibida: parseFloat(cantidades[i.articulo_id]) || 0,
    }))

    try {
      const r = await api.put(`/api/traspasos/canastos/${canastoId}/conteo-ciego`, { items })
      if (r.data.hay_diferencias) {
        alert('Se encontraron diferencias en el conteo.')
      }
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al confirmar conteo')
    }
  }

  const confirmarRecepcion = async () => {
    if (!window.confirm('¿Confirmar recepción? Se realizará el ajuste de stock en destino.')) return
    try {
      await api.put(`/api/traspasos/ordenes/${id}/recibir`)
      navigate(`/traspasos/ordenes/${id}`)
    } catch (err) {
      alert(err.response?.data?.error || 'Error al confirmar recepción')
    }
  }

  if (cargando) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Recepción" sinTabs volverA={`/traspasos/ordenes/${id}`} />
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
      </div>
    </div>
  )

  if (!orden) return null

  const canastos = orden.canastos || []
  const estadosFinales = ['controlado', 'con_diferencia']
  const todosVerificados = canastos.length > 0 && canastos.every(c => estadosFinales.includes(c.estado))
  const hayEnTransito = canastos.some(c => c.estado === 'en_transito')

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo={`Recepción ${orden.numero}`} sinTabs volverA={`/traspasos/ordenes/${id}`} />

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {/* Info */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">
          {orden.sucursal_origen_nombre} → {orden.sucursal_destino_nombre}
          <div className="text-xs mt-1 text-emerald-500">
            Primero recibí cada bulto, luego pesá los canastos y verificá pallets y bultos.
          </div>
        </div>

        {/* Recibir todos en destino */}
        {hayEnTransito && (
          <button onClick={recibirTodosEnDestino}
            className="w-full bg-cyan-600 hover:bg-cyan-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">
            Recibir todos en destino ({canastos.filter(c => c.estado === 'en_transito').length} bultos)
          </button>
        )}

        {/* Canastos */}
        {canastos.map(canasto => {
          const esBulto = canasto.tipo === 'bulto'
          const esPallet = canasto.tipo === 'pallet'
          const esEnTransito = canasto.estado === 'en_transito'
          const esEnDestino = canasto.estado === 'en_destino'
          const esControlado = canasto.estado === 'controlado'
          const esDiferencia = canasto.estado === 'con_diferencia'

          return (
            <div key={canasto.id} className={`bg-white rounded-xl border p-4 ${
              esControlado ? 'border-green-300' : esDiferencia ? 'border-red-300' : esEnDestino ? 'border-cyan-300' : esEnTransito ? 'border-purple-300' : 'border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">
                    {esPallet ? (canasto.numero_pallet || canasto.precinto) : esBulto ? (canasto.nombre || 'Bulto') : `Precinto: ${canasto.precinto}`}
                  </span>
                  {esBulto && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">Bulto</span>}
                  {esPallet && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">Pallet</span>}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    esControlado ? 'bg-green-100 text-green-600' :
                    esDiferencia ? 'bg-red-100 text-red-600' :
                    esEnDestino ? 'bg-cyan-100 text-cyan-600' :
                    esEnTransito ? 'bg-purple-100 text-purple-600' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {canasto.estado === 'en_transito' ? 'En tránsito' :
                     canasto.estado === 'en_destino' ? 'En destino' :
                     canasto.estado === 'controlado' ? 'Controlado' :
                     canasto.estado === 'con_diferencia' ? 'Con diferencia' :
                     canasto.estado.replace(/_/g, ' ')}
                  </span>
                </div>
                {!esBulto && !esPallet && (
                  <div className="text-xs text-gray-400">
                    Peso origen: <span className="font-medium text-gray-600">{canasto.peso_origen} kg</span>
                  </div>
                )}
                {esPallet && canasto.cantidad_bultos_destino != null && (
                  <div className="text-xs text-gray-400">
                    Bultos recibidos: <span className="font-medium text-gray-600">{canasto.cantidad_bultos_destino}</span>
                  </div>
                )}
              </div>

              {/* Recibir en destino (canastos en tránsito) */}
              {esEnTransito && (
                <button onClick={() => recibirEnDestino(canasto.id)}
                  disabled={recibiendoId === canasto.id}
                  className="w-full bg-cyan-600 hover:bg-cyan-700 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {recibiendoId === canasto.id ? 'Recibiendo...' : 'Recibir en destino'}
                </button>
              )}

              {/* Pesaje (solo canastos normales en destino, no pallets ni bultos) */}
              {esEnDestino && !esBulto && !esPallet && (
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="Peso destino (kg)"
                    value={pesosDestino[canasto.id] || ''}
                    onChange={e => setPesosDestino({ ...pesosDestino, [canasto.id]: e.target.value })}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                  <button onClick={() => pesarCanasto(canasto.id)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                    Pesar
                  </button>
                </div>
              )}

              {/* Verificación pallet (solo pallets en destino) */}
              {esEnDestino && esPallet && (
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    placeholder="Cantidad de bultos recibidos"
                    value={bultosPallet[canasto.id] || ''}
                    onChange={e => setBultosPallet({ ...bultosPallet, [canasto.id]: e.target.value })}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                  <button onClick={() => verificarPallet(canasto.id)}
                    className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                    Verificar bultos
                  </button>
                </div>
              )}

              {/* Conteo ciego (solo bultos en destino) */}
              {esEnDestino && esBulto && (
                <div className="space-y-2 border-t border-gray-100 pt-2 mt-1">
                  <div className="bg-orange-50 rounded-lg p-2 text-xs text-orange-700">
                    Conteo ciego: ingresá la cantidad recibida de cada artículo sin ver lo enviado.
                  </div>
                  {(canasto.items || []).map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg p-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-800 truncate">{item.nombre}</div>
                        <div className="text-xs text-gray-400">{item.codigo}</div>
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        placeholder="Cant."
                        value={conteoCiego[canasto.id]?.[item.articulo_id] ?? ''}
                        onChange={e => setConteoCiego(prev => ({
                          ...prev,
                          [canasto.id]: {
                            ...(prev[canasto.id] || {}),
                            [item.articulo_id]: e.target.value,
                          }
                        }))}
                        className="w-20 border border-gray-200 rounded px-2 py-1 text-sm text-center"
                      />
                    </div>
                  ))}
                  <button onClick={() => confirmarConteoCiego(canasto.id)}
                    disabled={(canasto.items || []).some(i => (conteoCiego[canasto.id]?.[i.articulo_id] ?? '') === '')}
                    className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                      (canasto.items || []).every(i => (conteoCiego[canasto.id]?.[i.articulo_id] ?? '') !== '')
                        ? 'bg-orange-500 hover:bg-orange-600 text-white'
                        : 'bg-gray-200 text-gray-400'
                    }`}>
                    Confirmar conteo
                  </button>
                </div>
              )}

              {/* Diferencia - opción de verificación manual */}
              {esDiferencia && verificando !== canasto.id && (
                <div className="space-y-2">
                  <div className="bg-red-50 rounded-lg p-2 text-xs text-red-700">
                    {esPallet
                      ? `Cantidad de bultos no coincide (recibidos: ${canasto.cantidad_bultos_destino}). Verificá los artículos de la orden.`
                      : esBulto && canasto.diferencias
                      ? 'Se encontraron diferencias en el conteo ciego.'
                      : `Peso fuera de tolerancia (origen: ${canasto.peso_origen} kg, destino: ${canasto.peso_destino} kg, diferencia: ${Math.round(Math.abs(parseFloat(canasto.peso_destino || 0) - parseFloat(canasto.peso_origen || 0)) * 1000)}g). Verificá artículo por artículo.`
                    }
                  </div>
                  <button onClick={() => iniciarVerificacion(canasto)}
                    className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                    Verificar manualmente
                  </button>

                  {canasto.diferencias && (
                    <div className="bg-red-50 rounded-lg p-2 text-xs text-red-600 mt-1">
                      <div className="font-medium mb-1">Diferencias reportadas:</div>
                      {canasto.diferencias.filter(d => d.cantidad_esperada !== d.cantidad_real).map((d, idx) => (
                        <div key={idx}>
                          {d.nombre}: esperado {d.cantidad_esperada}, real {d.cantidad_real}
                          {d.nota && ` — ${d.nota}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Formulario de verificación */}
              {verificando === canasto.id && (
                <div className="space-y-2 border-t border-gray-100 pt-2 mt-2">
                  <div className="text-xs font-medium text-gray-600 mb-2">Verificar cantidades reales:</div>
                  {diferencias.map((d, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg p-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-800 truncate">{d.nombre}</div>
                        <div className="text-xs text-gray-400">{d.codigo} — Esperado: {d.cantidad_esperada}</div>
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={d.cantidad_real}
                        onChange={e => actualizarDiferencia(idx, 'cantidad_real', parseFloat(e.target.value) || 0)}
                        className={`w-20 border rounded px-2 py-1 text-sm text-center ${
                          d.cantidad_real !== d.cantidad_esperada ? 'border-red-300 bg-red-50' : 'border-gray-200'
                        }`}
                      />
                      <input
                        type="text"
                        placeholder="Nota..."
                        value={d.nota}
                        onChange={e => actualizarDiferencia(idx, 'nota', e.target.value)}
                        className="w-28 border border-gray-200 rounded px-2 py-1 text-xs"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setVerificando(null); setDiferencias([]) }}
                      className="text-gray-500 hover:text-gray-700 px-3 py-1.5 text-sm">
                      Cancelar
                    </button>
                    <button onClick={() => confirmarVerificacion(canasto.id)}
                      className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">
                      Confirmar Verificación
                    </button>
                  </div>
                </div>
              )}

              {/* Estado final — Controlado */}
              {esControlado && (
                <div className="bg-green-50 rounded-lg p-2 text-xs text-green-600 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {esPallet
                    ? `Controlado — ${canasto.cantidad_bultos_destino} bultos verificados`
                    : esBulto
                    ? 'Controlado — Conteo verificado'
                    : (() => {
                        const difG = canasto.peso_destino && canasto.peso_origen
                          ? Math.round(Math.abs(parseFloat(canasto.peso_destino) - parseFloat(canasto.peso_origen)) * 1000)
                          : 0
                        return `Controlado — ${canasto.peso_destino} kg (diferencia: ${difG}g)`
                      })()
                  }
                </div>
              )}
            </div>
          )
        })}

        {/* Confirmar recepción */}
        {todosVerificados && orden.estado === 'despachado' && (
          <button onClick={confirmarRecepcion}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-medium transition-colors">
            Confirmar Recepción Completa
          </button>
        )}
      </div>
    </div>
  )
}

export default Recepcion
