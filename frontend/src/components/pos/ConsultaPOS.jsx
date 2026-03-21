import React, { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../services/api'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

function calcPrecioBase(art) {
  let precio = art.precio || 0
  if (art.descuento1) precio *= (1 - art.descuento1 / 100)
  if (art.descuento2) precio *= (1 - art.descuento2 / 100)
  if (art.descuento3) precio *= (1 - art.descuento3 / 100)
  return precio
}

// Verificar si un artículo participa en una regla aplicar_a
function artMatcheaAplicarA(art, aplicarA) {
  if (!aplicarA || aplicarA.length === 0) return false // vacío = NO aplica (a diferencia del POS donde vacío = todos)
  for (const r of aplicarA) {
    if (r.tipo === 'todos') return true
    if (r.tipo === 'articulo' && art.id === r.id) return true
    if (r.tipo === 'rubro' && art.rubro?.id === r.id) return true
    if (r.tipo === 'subrubro' && art.subRubro?.id === r.id) return true
    if (r.tipo === 'atributo' && art.atributos?.some(a => a.id_valor === r.id_valor)) return true
    if (r.tipo === 'marca' && art.marca === r.nombre) return true
  }
  return false
}

// Verificar si artículo participa en una promo condicional y recibe descuento
function artEnCondicional(art, reglas) {
  const beneficios = reglas.articulos_beneficio || (reglas.articulo_beneficio ? [reglas.articulo_beneficio] : [])

  // ¿El artículo está en beneficios? (recibe el descuento)
  const enBeneficio = beneficios.some(b => condMatcheaArt(b, art))
  if (enBeneficio) return true

  // Si descuento_en_ambos, también mostrar si está en condición
  if (reglas.descuento_en_ambos) {
    const grupos = reglas.grupos_condicion
      || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
      || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion }]] : [])
    for (const grupo of (grupos || [])) {
      for (const cond of (grupo || [])) {
        if (condMatcheaArt(cond, art)) return true
      }
    }
  }
  return false
}

function condMatcheaArt(cond, art) {
  if (!cond) return false
  // Match por código (más fiable, las promos guardan IDs mixtos UUID/int)
  if (cond.codigo && String(cond.codigo) === String(art.codigo)) return true
  if (cond.id && cond.id === art.id) return true
  if (cond.tipo === 'atributo' && art.atributos?.some(a => a.id_valor === cond.id_valor)) return true
  if (cond.tipo === 'marca' && art.marca === cond.nombre) return true
  if (cond.tipo === 'rubro' && art.rubro?.id === cond.id) return true
  return false
}

function promoEnRango(promo) {
  const hoy = new Date().toISOString().split('T')[0]
  if (promo.fecha_desde && hoy < promo.fecha_desde) return false
  if (promo.fecha_hasta && hoy > promo.fecha_hasta) return false
  return true
}

// Generar texto describiendo qué debe llevar el cliente
function descCondicion(reglas, aplicarA) {
  const nombres = (aplicarA || []).map(r => r.nombre).filter(Boolean)
  return nombres.length ? nombres.join(', ') : ''
}

function descCondCondicional(reglas) {
  const partes = []
  for (const grupo of (reglas.grupos_condicion || [])) {
    const items = []
    for (const g of (grupo || [])) {
      const cant = g.cantidad || 1
      const nombre = g.nombre || g.codigo || ''
      items.push(`${cant} un. ${nombre}`)
    }
    if (items.length) partes.push(items.join(' o '))
  }

  let texto = ''
  if (partes.length) texto += `Comprando: ${partes.join(' + ')}`
  if (reglas.descuento_en_ambos) texto += ' (dto en todos)'
  return texto
}

// Obtener promos aplicables a un artículo + precio con promo
function getPromosParaArticulo(art, promociones) {
  const precioBase = calcPrecioBase(art)
  const resultado = []
  // Buscar % efectivo para calcular precio combinado
  let pctEfectivo = 0
  for (const p of promociones) {
    if (p.tipo === 'forma_pago' && p.activa && promoEnRango(p)) {
      const r = p.reglas || {}
      const forma = (r.forma_cobro_nombre || r.forma_pago || '').toLowerCase()
      if (forma === 'efectivo') {
        if (r.aplicar_a && r.aplicar_a.length > 0 && !artMatcheaAplicarA(art, r.aplicar_a)) continue
        pctEfectivo = r.valor || r.porcentaje || 0
        break
      }
    }
  }

  for (const promo of promociones) {
    if (!promo.activa || !promoEnRango(promo)) continue
    const reglas = promo.reglas || {}

    switch (promo.tipo) {
      case 'porcentaje': {
        if (!artMatcheaAplicarA(art, reglas.aplicar_a)) break
        const cantMin = reglas.cantidad_minima || 1
        const pct = reglas.valor || reglas.porcentaje || 0
        const precioPromo = precioBase * (1 - pct / 100)
        const aplicarNombres = descCondicion(reglas, reglas.aplicar_a)
        let condicion = aplicarNombres ? `Aplica a: ${aplicarNombres}` : ''
        if (cantMin > 1) condicion = `Llevar ${cantMin}+ un.${aplicarNombres ? ` de: ${aplicarNombres}` : ''}`
        resultado.push({
          id: promo.id, nombre: promo.nombre,
          desc: `${pct}% dto${cantMin > 1 ? ` (${cantMin}+ un.)` : ''}`,
          precioPromo, condicion,
          precioEfectivo: pctEfectivo > 0 ? precioPromo * (1 - pctEfectivo / 100) : null,
        })
        break
      }
      case 'monto_fijo': {
        if (!artMatcheaAplicarA(art, reglas.aplicar_a)) break
        const cantMin = reglas.cantidad_minima || 1
        const monto = reglas.valor || reglas.monto_descuento || 0
        const precioPromo = Math.max(precioBase - monto, 0)
        const aplicarNombres = descCondicion(reglas, reglas.aplicar_a)
        let condicion = aplicarNombres ? `Aplica a: ${aplicarNombres}` : ''
        if (cantMin > 1) condicion = `Llevar ${cantMin}+ un.${aplicarNombres ? ` de: ${aplicarNombres}` : ''}`
        resultado.push({
          id: promo.id, nombre: promo.nombre,
          desc: `-${formatPrecio(monto)}${cantMin > 1 ? ` (${cantMin}+ un.)` : ''}`,
          precioPromo, condicion,
          precioEfectivo: pctEfectivo > 0 ? precioPromo * (1 - pctEfectivo / 100) : null,
        })
        break
      }
      case 'nxm': {
        if (!artMatcheaAplicarA(art, reglas.aplicar_a)) break
        const llevar = reglas.llevar || 3
        const pagar = reglas.pagar || 2
        const precioPromo = precioBase * pagar / llevar
        const aplicarNombres = descCondicion(reglas, reglas.aplicar_a)
        const condicion = `Llevar ${llevar}, pagar ${pagar}${aplicarNombres ? ` — de: ${aplicarNombres}` : ''}`
        resultado.push({
          id: promo.id, nombre: promo.nombre,
          desc: `Llevá ${llevar} pagá ${pagar}`,
          precioPromo, condicion,
          precioEfectivo: pctEfectivo > 0 ? precioPromo * (1 - pctEfectivo / 100) : null,
        })
        break
      }
      case 'condicional': {
        if (!artEnCondicional(art, reglas)) break
        let precioPromo = null
        let descText = 'Condicional'
        const valor = reglas.valor || 0
        if (valor > 0) {
          if (reglas.tipo_descuento === 'porcentaje') {
            precioPromo = precioBase * (1 - valor / 100)
            descText = `${valor}% dto`
          } else if (reglas.tipo_descuento === 'monto') {
            precioPromo = precioBase - valor
            descText = `-${formatPrecio(valor)}`
          }
        }
        const condicion = descCondCondicional(reglas)
        resultado.push({
          id: promo.id, nombre: promo.nombre,
          desc: descText, condicion,
          precioPromo: precioPromo != null && precioPromo > 0 ? precioPromo : precioPromo,
          precioEfectivo: pctEfectivo > 0 && precioPromo != null ? precioPromo * (1 - pctEfectivo / 100) : null,
        })
        break
      }
      case 'combo': {
        const arts = reglas.articulos || []
        const esta = arts.some(a => a.id === art.id || (a.codigo && String(a.codigo) === String(art.codigo)))
        if (!esta) break
        const condicion = `Combo: ${arts.map(a => a.nombre || a.codigo).join(', ')}`
        resultado.push({
          id: promo.id, nombre: promo.nombre,
          desc: `Combo ${formatPrecio(reglas.precio_combo)}`,
          precioPromo: null, condicion,
          precioEfectivo: null,
        })
        break
      }
      case 'forma_pago': {
        if (reglas.aplicar_a && reglas.aplicar_a.length > 0 && !artMatcheaAplicarA(art, reglas.aplicar_a)) break
        const pct = reglas.valor || reglas.porcentaje || 0
        const formaNombre = reglas.forma_cobro_nombre || reglas.forma_pago || 'forma pago'
        const precioPromo = precioBase * (1 - pct / 100)
        resultado.push({
          id: promo.id, nombre: promo.nombre,
          desc: `${pct}% dto (${formaNombre})`,
          precioPromo, condicion: `Abonar en ${formaNombre}`,
          esFormaPago: true,
        })
        break
      }
    }
  }
  return resultado
}

export default function ConsultaPOS({ articulos, promociones }) {
  const [busqueda, setBusqueda] = useState('')
  const [sucursalesConsulta, setSucursalesConsulta] = useState([])
  const [stockMap, setStockMap] = useState({})
  const [cargando, setCargando] = useState(true)
  const [selId, setSelId] = useState(null)
  const inputRef = useRef(null)

  const cargarDatos = async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const { data } = await api.get('/api/pos/consulta-data')
      setSucursalesConsulta(data.sucursales || [])
      const map = {}
      for (const s of (data.stock || [])) {
        if (!map[s.id_centum]) map[s.id_centum] = {}
        map[s.id_centum][s.centum_sucursal_id] = s.existencias
      }
      setStockMap(map)
    } catch (err) {
      console.error('Error cargando datos consulta:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarDatos()
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const resultados = useMemo(() => {
    if (!busqueda.trim()) return []
    const terminos = busqueda.toLowerCase().trim().split(/\s+/)
    return articulos.filter(a => {
      const texto = `${a.codigo} ${a.nombre} ${a.rubro?.nombre || ''} ${a.subRubro?.nombre || ''} ${a.marca || ''}`.toLowerCase()
      return terminos.every(t => texto.includes(t))
    }).slice(0, 30)
  }, [articulos, busqueda])

  const tieneDescBase = (art) => art.descuento1 || art.descuento2 || art.descuento3

  return (
    <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden h-full">
      {/* Buscador */}
      <div className="bg-white border-b px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center gap-2 max-w-xl mx-auto">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={busqueda}
              onChange={(e) => { setBusqueda(e.target.value); setSelId(null) }}
              placeholder="Buscar por código, nombre, rubro, marca..."
              className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              autoComplete="off"
            />
          {busqueda && (
            <button
              onClick={() => { setBusqueda(''); setSelId(null); inputRef.current?.focus() }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          </div>
          <button
            onClick={() => cargarDatos(true)}
            title="Actualizar stock"
            className="p-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-violet-600 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 19.644l3.181-3.182" />
            </svg>
          </button>
        </div>
      </div>

      {cargando ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {!busqueda.trim() ? (
            <div className="text-center text-gray-400 mt-20">
              <svg className="w-12 h-12 mx-auto mb-2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <p className="text-sm">Escriba para buscar un artículo</p>
            </div>
          ) : resultados.length === 0 ? (
            <p className="text-center text-gray-400 mt-10 text-sm">Sin resultados para "{busqueda}"</p>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr className="text-[11px] text-gray-500 uppercase tracking-wider">
                  <th className="py-2 px-3 text-left w-20"></th>
                  <th className="py-2 px-2 text-left w-20">Código</th>
                  <th className="py-2 px-2 text-left">Artículo</th>
                  <th className="py-2 px-2 text-left w-28">Marca</th>
                  <th className="py-2 px-2 text-right w-28">Precio</th>
                  <th className="py-2 px-2 text-center w-16">Promos</th>
                  <th className="py-2 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {resultados.map(art => {
                  const promosArt = getPromosParaArticulo(art, promociones)
                  const isOpen = selId === art.id
                  const stockArt = stockMap[art.id] || {}
                  const precioFinal = calcPrecioBase(art)

                  return (
                    <React.Fragment key={art.id}>
                      <tr
                        onClick={() => setSelId(isOpen ? null : art.id)}
                        className={`cursor-pointer transition-colors ${isOpen ? 'bg-violet-50' : 'hover:bg-gray-50'}`}
                      >
                        <td className="py-1.5 px-3">
                          <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100">
                            <img
                              src={`${API_BASE}/api/articulos/${art.id}/imagen`}
                              alt=""
                              className="w-full h-full object-contain"
                              loading="lazy"
                            />
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <span className="text-xs font-mono text-gray-500">{art.codigo}</span>
                        </td>
                        <td className="py-1.5 px-2">
                          <p className="text-sm font-medium text-gray-800">{art.nombre}</p>
                          {art.rubro && <p className="text-[11px] text-gray-400">{art.rubro.nombre}{art.subRubro ? ` › ${art.subRubro.nombre}` : ''}</p>}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className="text-xs text-gray-500">{art.marca || '—'}</span>
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          {tieneDescBase(art) ? (
                            <>
                              <p className="text-[11px] text-gray-400 line-through">{formatPrecio(art.precio)}</p>
                              <p className="text-sm font-bold text-violet-700">{formatPrecio(precioFinal)}</p>
                            </>
                          ) : (
                            <p className="text-sm font-semibold text-gray-800">{formatPrecio(art.precio)}</p>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          {promosArt.length > 0 && (
                            <span className="bg-green-100 text-green-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                              {promosArt.length}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-center">
                          <svg className={`w-3.5 h-3.5 inline transition-transform ${isOpen ? 'rotate-180' : ''} text-gray-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={7} className="bg-violet-50/50 px-6 py-4">
                            <div className="flex gap-6 max-w-5xl mx-auto">
                              {/* Imagen grande */}
                              <div className="w-36 h-36 rounded-xl overflow-hidden bg-white border border-gray-200 flex-shrink-0">
                                <img
                                  src={`${API_BASE}/api/articulos/${art.id}/imagen`}
                                  alt={art.nombre}
                                  className="w-full h-full object-contain p-1"
                                />
                              </div>

                              <div className="flex-1 min-w-0 space-y-3">
                                {/* Promos con precio */}
                                {promosArt.filter(p => !p.esFormaPago).length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Promociones aplicables</p>
                                    <div className="space-y-1">
                                      {promosArt.filter(p => !p.esFormaPago).map(p => (
                                        <div key={p.id} className="bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 cursor-default" title={p.condicion || ''}>
                                          <div className="flex items-center justify-between">
                                            <div className="min-w-0">
                                              <span className="text-xs font-medium text-green-800">{p.nombre}</span>
                                              <span className="text-[11px] text-green-600 ml-2">{p.desc}</span>
                                            </div>
                                            <div className="flex items-center gap-3 ml-3 flex-shrink-0">
                                              {p.precioPromo != null && (
                                                <span className="text-sm font-bold text-green-700">
                                                  {formatPrecio(p.precioPromo)}
                                                </span>
                                              )}
                                              {p.precioEfectivo != null && (
                                                <span className="text-sm font-bold text-amber-600">
                                                  {formatPrecio(p.precioEfectivo)}
                                                  <span className="text-[9px] font-normal ml-0.5">ef.</span>
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                          {p.condicion && (
                                            <p className="text-[10px] text-green-600/70 mt-0.5 whitespace-pre-line">{p.condicion}</p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Precio con forma de pago (ej: efectivo) */}
                                {promosArt.filter(p => p.esFormaPago).length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Precio por forma de pago</p>
                                    <div className="space-y-1">
                                      {promosArt.filter(p => p.esFormaPago).map(p => (
                                        <div key={p.id} className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5" title={p.condicion || ''}>
                                          <div className="min-w-0">
                                            <span className="text-xs font-medium text-amber-800">{p.nombre}</span>
                                            <span className="text-[11px] text-amber-600 ml-2">{p.desc}</span>
                                          </div>
                                          {p.precioPromo != null && (
                                            <span className="text-sm font-bold text-amber-700 ml-3 flex-shrink-0">
                                              {formatPrecio(p.precioPromo)}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Stock */}
                                {sucursalesConsulta.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Stock por sucursal</p>
                                    <div className="flex flex-wrap gap-2">
                                      {sucursalesConsulta.map(suc => {
                                        const ex = stockArt[suc.centum_sucursal_id]
                                        const hay = typeof ex === 'number' && ex > 0
                                        return (
                                          <div key={suc.id} className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs border ${hay ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
                                            <span>{suc.nombre}</span>
                                            <span className="font-bold">{ex ?? '—'}</span>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Descuentos */}
                                {tieneDescBase(art) && (
                                  <div className="flex gap-3 text-[10px] text-gray-400">
                                    {art.descuento1 > 0 && <span>Desc1: {art.descuento1}%</span>}
                                    {art.descuento2 > 0 && <span>Desc2: {art.descuento2}%</span>}
                                    {art.descuento3 > 0 && <span>Desc3: {art.descuento3}%</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
