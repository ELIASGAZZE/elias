import React, { useState, useEffect, useCallback } from 'react'
import api from '../../services/api'

const TIPOS = [
  { value: 'porcentaje', label: 'Porcentaje' },
  { value: 'monto_fijo', label: 'Monto fijo' },
  { value: 'nxm', label: 'NxM' },
  { value: 'combo', label: 'Combo' },
  { value: 'forma_pago', label: 'Desc. forma de pago' },
  { value: 'condicional', label: 'Condicional (A → B)' },
]

const TIPO_BADGE_COLORS = {
  porcentaje: 'bg-blue-50 text-blue-700',
  monto_fijo: 'bg-amber-50 text-amber-700',
  nxm: 'bg-purple-50 text-purple-700',
  combo: 'bg-emerald-50 text-emerald-700',
  forma_pago: 'bg-cyan-50 text-cyan-700',
  condicional: 'bg-pink-50 text-pink-700',
}

const TIPO_ENTIDAD = [
  { value: 'articulo', label: 'Artículo' },
  { value: 'rubro', label: 'Rubro' },
  { value: 'subrubro', label: 'Sub Rubro' },
  { value: 'atributo', label: 'Atributo' },
  { value: 'todos', label: 'Todos los artículos' },
]

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

const AdminPromociones = () => {
  const [promociones, setPromociones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [mensaje, setMensaje] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editandoId, setEditandoId] = useState(null)
  const [guardando, setGuardando] = useState(false)

  // Formas de cobro para tipo forma_pago
  const [formasCobro, setFormasCobro] = useState([])

  // Form state
  const [form, setForm] = useState({
    nombre: '',
    tipo: 'porcentaje',
    fecha_desde: '',
    fecha_hasta: '',
    // porcentaje / monto_fijo
    valor: '',
    cantidad_minima: '1',
    aplicar_a: [], // [{ tipo, id, nombre }]
    // nxm
    llevar: '3',
    pagar: '2',
    // combo
    precio_combo: '',
    articulos_combo: [], // [{ id, nombre, cantidad }]
    // forma_pago
    forma_cobro_nombre: '',
    // condicional
    grupos_condicion: [[]], // array de grupos, cada grupo es array de artículos {id, nombre, codigo, cantidad}
    grupo_activo: 0,
    articulos_beneficio: [], // [{ id, nombre, codigo }]
    tipo_descuento: 'porcentaje',
    descuento_en_ambos: false,
    buscando_campo: null, // 'condicion' | 'beneficio'
    descuento_en: 'mas_barato', // 'mas_barato' | 'mas_caro' (solo NxM)
  })

  // Buscador de artículos
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [tipoEntidad, setTipoEntidad] = useState('articulo')

  // Rubros, subrubros y atributos de Centum
  const [rubros, setRubros] = useState([])
  const [subrubros, setSubrubros] = useState([])
  const [atributosDisponibles, setAtributosDisponibles] = useState([])

  const cargar = async () => {
    try {
      const { data } = await api.get('/api/pos/promociones?todas=1')
      setPromociones(data.promociones || [])
    } catch (err) {
      console.error('Error cargando promos:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
    cargarFormasCobro()
    cargarRubrosSubrubros()
  }, [])

  async function cargarRubrosSubrubros() {
    try {
      const [resR, resS, resA] = await Promise.all([
        api.get('/api/pos/rubros'),
        api.get('/api/pos/subrubros'),
        api.get('/api/pos/atributos-articulo'),
      ])
      setRubros(resR.data.rubros || [])
      setSubrubros(resS.data.subrubros || [])
      setAtributosDisponibles(resA.data.atributos || [])
    } catch (err) {
      console.error('Error cargando rubros/subrubros/atributos:', err)
    }
  }

  async function cargarFormasCobro() {
    try {
      const { data } = await api.get('/api/formas-cobro')
      const fcs = (data.formas_cobro || data || []).filter(f => f.activo !== false)
      // Incluir Efectivo manualmente si no está
      const nombres = fcs.map(f => (f.nombre || '').toLowerCase())
      const lista = nombres.includes('efectivo') ? fcs : [{ id: 'efectivo', nombre: 'Efectivo' }, ...fcs]
      setFormasCobro(lista)
    } catch (err) {
      console.error('Error cargando formas de cobro:', err)
      setFormasCobro([{ id: 'efectivo', nombre: 'Efectivo' }])
    }
  }

  // Buscar artículos con debounce
  useEffect(() => {
    if (!busqueda.trim() || busqueda.trim().length < 2) {
      setResultados([])
      return
    }

    const timeout = setTimeout(async () => {
      setBuscando(true)
      try {
        const { data } = await api.get('/api/pos/articulos', { params: { buscar: busqueda.trim() } })
        const items = data.articulos || []
        const terminos = busqueda.toLowerCase().trim().split(/\s+/)
        let filtrados = items.filter(a => {
          const texto = `${a.codigo} ${a.nombre} ${a.rubro?.nombre || ''} ${a.subRubro?.nombre || ''}`.toLowerCase()
          return terminos.every(t => texto.includes(t))
        })
        // En modo rubro/subrubro: filtrar los que tienen dato y deduplicar
        if (tipoEntidad === 'rubro') {
          const vistos = new Set()
          filtrados = filtrados.filter(a => {
            if (!a.rubro?.id || vistos.has(a.rubro.id)) return false
            vistos.add(a.rubro.id)
            return true
          })
        } else if (tipoEntidad === 'subrubro') {
          const vistos = new Set()
          filtrados = filtrados.filter(a => {
            if (!a.subRubro?.id || vistos.has(a.subRubro.id)) return false
            vistos.add(a.subRubro.id)
            return true
          })
        }
        setResultados(filtrados.slice(0, 20))
      } catch (err) {
        console.error('Error buscando artículos:', err)
      } finally {
        setBuscando(false)
      }
    }, 500)

    return () => clearTimeout(timeout)
  }, [busqueda, tipoEntidad])

  const resetForm = () => {
    setForm({
      nombre: '', tipo: 'porcentaje', fecha_desde: '', fecha_hasta: '',
      valor: '', cantidad_minima: '1', aplicar_a: [],
      llevar: '3', pagar: '2',
      precio_combo: '', articulos_combo: [],
      forma_cobro_nombre: '',
      grupos_condicion: [[]], grupo_activo: 0, articulos_beneficio: [], tipo_descuento: 'porcentaje', descuento_en_ambos: false, buscando_campo: null,
      descuento_en: 'mas_barato',
    })
    setBusqueda('')
    setResultados([])
    setTipoEntidad('articulo')
    setEditandoId(null)
    setMostrarForm(false)
    setMensaje('')
  }

  const abrirNueva = () => {
    resetForm()
    setMostrarForm(true)
  }

  const abrirEditar = (promo) => {
    const reglas = promo.reglas || {}
    setForm({
      nombre: promo.nombre,
      tipo: promo.tipo,
      fecha_desde: promo.fecha_desde || '',
      fecha_hasta: promo.fecha_hasta || '',
      valor: reglas.valor != null ? String(reglas.valor) : '',
      cantidad_minima: reglas.cantidad_minima != null ? String(reglas.cantidad_minima) : '1',
      aplicar_a: reglas.aplicar_a || [],
      llevar: reglas.llevar != null ? String(reglas.llevar) : '3',
      pagar: reglas.pagar != null ? String(reglas.pagar) : '2',
      precio_combo: reglas.precio_combo != null ? String(reglas.precio_combo) : '',
      articulos_combo: reglas.articulos || [],
      forma_cobro_nombre: reglas.forma_cobro_nombre || '',
      grupos_condicion: reglas.grupos_condicion
        || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
        || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion, cantidad: reglas.cantidad_minima || 1 }]] : [[]]),
      grupo_activo: 0,
      articulos_beneficio: reglas.articulos_beneficio || (reglas.articulo_beneficio ? [reglas.articulo_beneficio] : []),
      tipo_descuento: reglas.tipo_descuento || 'porcentaje',
      descuento_en_ambos: reglas.descuento_en_ambos || false,
      buscando_campo: null,
      descuento_en: reglas.descuento_en || 'mas_barato',
    })
    setEditandoId(promo.id)
    setMostrarForm(true)
    setMensaje('')
  }

  const construirReglas = () => {
    const { tipo, valor, cantidad_minima, aplicar_a, llevar, pagar, precio_combo, articulos_combo, forma_cobro_nombre } = form

    switch (tipo) {
      case 'porcentaje':
        return {
          valor: parseFloat(valor) || 0,
          cantidad_minima: parseInt(cantidad_minima) || 1,
          aplicar_a: aplicar_a.length > 0 ? aplicar_a : [{ tipo: 'todos' }],
        }
      case 'monto_fijo':
        return {
          valor: parseFloat(valor) || 0,
          cantidad_minima: parseInt(cantidad_minima) || 1,
          aplicar_a: aplicar_a.length > 0 ? aplicar_a : [{ tipo: 'todos' }],
        }
      case 'nxm':
        return {
          llevar: parseInt(llevar) || 3,
          pagar: parseInt(pagar) || 2,
          aplicar_a: aplicar_a.length > 0 ? aplicar_a : [{ tipo: 'todos' }],
          descuento_en: form.descuento_en || 'mas_barato',
        }
      case 'combo':
        return {
          precio_combo: parseFloat(precio_combo) || 0,
          articulos: articulos_combo,
        }
      case 'forma_pago':
        return {
          forma_cobro_nombre,
          valor: parseFloat(valor) || 0,
        }
      case 'condicional':
        return {
          grupos_condicion: form.grupos_condicion.filter(g => g.length > 0),
          articulos_beneficio: form.articulos_beneficio,
          tipo_descuento: form.tipo_descuento,
          descuento_en_ambos: form.descuento_en_ambos,
          valor: parseFloat(valor) || 0,
        }
      default:
        return {}
    }
  }

  const guardar = async (e) => {
    e.preventDefault()
    if (!form.nombre.trim()) {
      setMensaje('El nombre es requerido')
      return
    }

    const reglas = construirReglas()

    // Validaciones
    if ((form.tipo === 'porcentaje' || form.tipo === 'monto_fijo') && (!reglas.valor || reglas.valor <= 0)) {
      setMensaje('El valor debe ser mayor a 0')
      return
    }
    if (form.tipo === 'nxm' && (reglas.llevar <= reglas.pagar)) {
      setMensaje('"Llevar" debe ser mayor a "Pagar"')
      return
    }
    if (form.tipo === 'combo') {
      if (reglas.articulos.length < 2) {
        setMensaje('El combo necesita al menos 2 artículos')
        return
      }
      if (!reglas.precio_combo || reglas.precio_combo <= 0) {
        setMensaje('El precio del combo debe ser mayor a 0')
        return
      }
    }
    if (form.tipo === 'forma_pago') {
      if (!reglas.forma_cobro_nombre) {
        setMensaje('Seleccioná una forma de cobro')
        return
      }
      if (!reglas.valor || reglas.valor <= 0) {
        setMensaje('El porcentaje debe ser mayor a 0')
        return
      }
    }
    if (form.tipo === 'condicional') {
      if (!reglas.grupos_condicion || reglas.grupos_condicion.length === 0 || reglas.grupos_condicion.every(g => g.length === 0)) {
        setMensaje('Seleccioná al menos un artículo condición')
        return
      }
      if (!reglas.articulos_beneficio || reglas.articulos_beneficio.length === 0) {
        setMensaje('Seleccioná al menos un artículo beneficio')
        return
      }
      if (!reglas.valor || reglas.valor <= 0) {
        setMensaje('El valor del descuento debe ser mayor a 0')
        return
      }
    }

    setGuardando(true)
    setMensaje('')
    try {
      const payload = {
        nombre: form.nombre.trim(),
        tipo: form.tipo,
        fecha_desde: form.fecha_desde || null,
        fecha_hasta: form.fecha_hasta || null,
        reglas,
      }

      if (editandoId) {
        await api.put(`/api/pos/promociones/${editandoId}`, payload)
      } else {
        await api.post('/api/pos/promociones', payload)
      }

      await cargar()
      resetForm()
      setMensaje('')
    } catch (err) {
      setMensaje(err.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const toggleActiva = async (promo) => {
    try {
      await api.put(`/api/pos/promociones/${promo.id}`, { activa: !promo.activa })
      await cargar()
    } catch (err) {
      console.error('Error toggling promo:', err)
    }
  }

  const eliminar = async (promo) => {
    if (!confirm(`¿Desactivar "${promo.nombre}"?`)) return
    try {
      await api.delete(`/api/pos/promociones/${promo.id}`)
      await cargar()
    } catch (err) {
      console.error('Error eliminando promo:', err)
    }
  }

  // Agregar entidad a aplicar_a
  const agregarEntidad = (item) => {
    if (form.tipo === 'combo') {
      // Para combo, agregar al array de artículos
      if (form.articulos_combo.find(a => a.id === item.id)) return
      setForm(prev => ({
        ...prev,
        articulos_combo: [...prev.articulos_combo, { id: item.id, nombre: item.nombre, cantidad: 1 }],
      }))
    } else {
      if (tipoEntidad === 'todos') {
        setForm(prev => ({ ...prev, aplicar_a: [{ tipo: 'todos' }] }))
      } else if (tipoEntidad === 'articulo') {
        if (form.aplicar_a.find(a => a.tipo === 'articulo' && a.id === item.id)) return
        setForm(prev => ({
          ...prev,
          aplicar_a: [...prev.aplicar_a.filter(a => a.tipo !== 'todos'), { tipo: 'articulo', id: item.id, nombre: item.nombre }],
        }))
      } else if (tipoEntidad === 'rubro') {
        if (!item.rubro) return
        if (form.aplicar_a.find(a => a.tipo === 'rubro' && a.id === item.rubro.id)) return
        setForm(prev => ({
          ...prev,
          aplicar_a: [...prev.aplicar_a.filter(a => a.tipo !== 'todos'), { tipo: 'rubro', id: item.rubro.id, nombre: item.rubro.nombre }],
        }))
      } else if (tipoEntidad === 'subrubro') {
        if (!item.subRubro) return
        if (form.aplicar_a.find(a => a.tipo === 'subrubro' && a.id === item.subRubro.id)) return
        setForm(prev => ({
          ...prev,
          aplicar_a: [...prev.aplicar_a.filter(a => a.tipo !== 'todos'), { tipo: 'subrubro', id: item.subRubro.id, nombre: item.subRubro.nombre }],
        }))
      } else if (tipoEntidad === 'atributo') {
        // item here is { id_valor, nombre_attr, valor } from atributo selector
        if (form.aplicar_a.find(a => a.tipo === 'atributo' && a.id_valor === item.id_valor)) return
        setForm(prev => ({
          ...prev,
          aplicar_a: [...prev.aplicar_a.filter(a => a.tipo !== 'todos'), { tipo: 'atributo', id_valor: item.id_valor, nombre: `${item.nombre_attr}: ${item.valor}` }],
        }))
      }
    }
    setBusqueda('')
    setResultados([])
  }

  const quitarEntidad = (idx) => {
    setForm(prev => ({
      ...prev,
      aplicar_a: prev.aplicar_a.filter((_, i) => i !== idx),
    }))
  }

  const quitarArticuloCombo = (idx) => {
    setForm(prev => ({
      ...prev,
      articulos_combo: prev.articulos_combo.filter((_, i) => i !== idx),
    }))
  }

  const cambiarCantidadCombo = (idx, cant) => {
    setForm(prev => ({
      ...prev,
      articulos_combo: prev.articulos_combo.map((a, i) => i === idx ? { ...a, cantidad: Math.max(1, cant) } : a),
    }))
  }

  if (cargando) {
    return (
      <div className="flex justify-center py-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
      </div>
    )
  }

  return (
    <div className="pt-4">
      {/* Botón nueva */}
      <div className="flex justify-end mb-3">
        <button
          onClick={abrirNueva}
          className="bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Nueva promoción
        </button>
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <form onSubmit={guardar} className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-4 space-y-3">
          <h3 className="font-semibold text-gray-700 text-sm">
            {editandoId ? 'Editar promoción' : 'Nueva promoción'}
          </h3>

          {/* Nombre */}
          <input
            type="text"
            value={form.nombre}
            onChange={e => setForm(prev => ({ ...prev, nombre: e.target.value }))}
            placeholder="Nombre (ej: 15% Vinos Tintos 6+)"
            className="campo-form text-sm"
          />

          {/* Tipo */}
          <select
            value={form.tipo}
            onChange={e => setForm(prev => ({ ...prev, tipo: e.target.value }))}
            className="campo-form text-sm"
          >
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-500">Desde (opcional)</label>
              <input
                type="date"
                value={form.fecha_desde}
                onChange={e => setForm(prev => ({ ...prev, fecha_desde: e.target.value }))}
                className="campo-form text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Hasta (opcional)</label>
              <input
                type="date"
                value={form.fecha_hasta}
                onChange={e => setForm(prev => ({ ...prev, fecha_hasta: e.target.value }))}
                className="campo-form text-sm"
              />
            </div>
          </div>

          {/* Campos dinámicos por tipo */}
          {(form.tipo === 'porcentaje' || form.tipo === 'monto_fijo') && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500">
                  {form.tipo === 'porcentaje' ? 'Porcentaje (%)' : 'Monto ($)'}
                </label>
                <input
                  type="number"
                  min="0"
                  step={form.tipo === 'porcentaje' ? '1' : '0.01'}
                  value={form.valor}
                  onChange={e => setForm(prev => ({ ...prev, valor: e.target.value }))}
                  placeholder={form.tipo === 'porcentaje' ? 'Ej: 15' : 'Ej: 500'}
                  className="campo-form text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Cantidad mínima</label>
                <input
                  type="number"
                  min="1"
                  value={form.cantidad_minima}
                  onChange={e => setForm(prev => ({ ...prev, cantidad_minima: e.target.value }))}
                  className="campo-form text-sm"
                />
              </div>
            </div>
          )}

          {form.tipo === 'nxm' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500">Llevar (N)</label>
                <input
                  type="number"
                  min="2"
                  value={form.llevar}
                  onChange={e => setForm(prev => ({ ...prev, llevar: e.target.value }))}
                  className="campo-form text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Pagar (M)</label>
                <input
                  type="number"
                  min="1"
                  value={form.pagar}
                  onChange={e => setForm(prev => ({ ...prev, pagar: e.target.value }))}
                  className="campo-form text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">Descontar al</label>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, descuento_en: 'mas_barato' }))}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                      form.descuento_en !== 'mas_caro' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border'
                    }`}
                  >
                    Más barato
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, descuento_en: 'mas_caro' }))}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                      form.descuento_en === 'mas_caro' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border'
                    }`}
                  >
                    Más caro
                  </button>
                </div>
              </div>
            </div>
          )}

          {form.tipo === 'forma_pago' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500">Forma de cobro</label>
                <select
                  value={form.forma_cobro_nombre}
                  onChange={e => setForm(prev => ({ ...prev, forma_cobro_nombre: e.target.value }))}
                  className="campo-form text-sm"
                >
                  <option value="">Seleccionar...</option>
                  {formasCobro.map(fc => (
                    <option key={fc.id} value={fc.nombre}>{fc.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Porcentaje (%)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.valor}
                  onChange={e => setForm(prev => ({ ...prev, valor: e.target.value }))}
                  placeholder="Ej: 10"
                  className="campo-form text-sm"
                />
              </div>
            </div>
          )}

          {form.tipo === 'combo' && (
            <div>
              <label className="text-xs text-gray-500">Precio del combo ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.precio_combo}
                onChange={e => setForm(prev => ({ ...prev, precio_combo: e.target.value }))}
                placeholder="Ej: 5000"
                className="campo-form text-sm"
              />
            </div>
          )}

          {form.tipo === 'condicional' && (
            <div className="space-y-3">
              {/* Grupos condición (OR entre grupos, AND dentro) */}
              <div>
                <label className="text-xs text-gray-500 font-medium">Condiciones (los que debe comprar)</label>
                {/* Tabs de grupos */}
                <div className="flex items-center gap-1 mt-1 mb-2 flex-wrap">
                  {form.grupos_condicion.map((grupo, gi) => (
                    <div key={gi} className="flex items-center gap-1">
                      {gi > 0 && <span className="text-xs font-bold text-orange-500 mx-1">O</span>}
                      <button
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, grupo_activo: gi }))}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${form.grupo_activo === gi ? 'bg-pink-500 text-white border-pink-500' : 'bg-white text-gray-600 border-gray-300 hover:border-pink-300'}`}
                      >
                        Grupo {gi + 1} ({grupo.length})
                      </button>
                      {form.grupos_condicion.length > 1 && (
                        <button type="button" onClick={() => setForm(prev => {
                          const nuevos = prev.grupos_condicion.filter((_, i) => i !== gi)
                          return { ...prev, grupos_condicion: nuevos, grupo_activo: Math.min(prev.grupo_activo, nuevos.length - 1) }
                        })} className="text-gray-400 hover:text-red-500 text-xs" title="Eliminar grupo">&times;</button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setForm(prev => ({ ...prev, grupos_condicion: [...prev.grupos_condicion, []], grupo_activo: prev.grupos_condicion.length }))} className="px-2 py-1 rounded-full text-xs font-medium border border-dashed border-orange-300 text-orange-500 hover:bg-orange-50">
                    + Agregar O
                  </button>
                </div>
                {/* Artículos del grupo activo */}
                {(() => {
                  const gi = form.grupo_activo
                  const grupo = form.grupos_condicion[gi] || []
                  return (
                    <div className="border border-pink-200 rounded-lg p-2 bg-pink-50/30">
                      {(() => {
                        // Separar en secciones visuales: obligatorios y alternativas
                        const obligatorios = grupo.filter((_, i) => i === 0 || !grupo[i].o)
                        const alternativas = grupo.filter((_, i) => i > 0 && grupo[i].o)
                        const hayAmbos = obligatorios.length > 0 && alternativas.length > 0
                        return grupo.length > 0 && (
                        <div className="mb-2">
                          {/* Obligatorios */}
                          {obligatorios.length > 0 && (
                            <div className="space-y-1">
                              {hayAmbos && <div className="text-xs font-semibold text-pink-500 mb-1">Obligatorio(s):</div>}
                              {grupo.map((ac, idx) => {
                                if (idx > 0 && ac.o) return null
                                return (
                                  <div key={ac.id}>
                                    {idx > 0 && <div className="text-center text-xs font-bold text-pink-400 py-0.5">Y</div>}
                                    <div className="flex items-center gap-2 bg-white border border-pink-200 rounded-lg px-3 py-2">
                                      {idx > 0 && (
                                        <button type="button" onClick={() => setForm(prev => {
                                          const nuevosGrupos = prev.grupos_condicion.map((g, i) =>
                                            i === gi ? g.map((item, j) => j === idx ? { ...item, o: true } : item) : g
                                          )
                                          return { ...prev, grupos_condicion: nuevosGrupos }
                                        })} className="px-1.5 py-0.5 rounded text-xs font-bold border bg-pink-100 border-pink-300 text-pink-600 hover:opacity-80" title="Cambiar a alternativa (O)">
                                          Y
                                        </button>
                                      )}
                                      <span className="flex-1 text-sm text-gray-700 truncate">{ac.nombre}</span>
                                      <input type="number" min="1" value={ac.cantidad}
                                        onChange={e => setForm(prev => {
                                          const nuevosGrupos = prev.grupos_condicion.map((g, i) =>
                                            i === gi ? g.map((item, j) => j === idx ? { ...item, cantidad: parseInt(e.target.value) || 1 } : item) : g
                                          )
                                          return { ...prev, grupos_condicion: nuevosGrupos }
                                        })}
                                        className="w-14 text-center border rounded px-1 py-0.5 text-xs" title="Cantidad requerida"
                                      />
                                      <button type="button" onClick={() => setForm(prev => {
                                        const nuevosGrupos = prev.grupos_condicion.map((g, i) => i === gi ? g.filter((_, j) => j !== idx) : g)
                                        return { ...prev, grupos_condicion: nuevosGrupos }
                                      })} className="text-pink-400 hover:text-pink-600">&times;</button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          {/* Separador + Alternativas */}
                          {alternativas.length > 0 && (
                            <div className="mt-2">
                              {hayAmbos && <div className="text-center text-xs font-bold text-gray-400 py-1">+</div>}
                              <div className="text-xs font-semibold text-orange-500 mb-1">{hayAmbos ? 'Cualquiera de estos:' : 'Cualquiera de estos (al menos 1):'}</div>
                              <div className="space-y-1 border border-orange-200 rounded-lg p-2 bg-orange-50/30">
                                {grupo.map((ac, idx) => {
                                  if (idx === 0 || !ac.o) return null
                                  const orIdx = grupo.slice(0, idx).filter((_, i) => i > 0 && grupo[i].o).length
                                  return (
                                    <div key={ac.id}>
                                      {orIdx > 0 && <div className="text-center text-xs font-bold text-orange-400 py-0.5">o</div>}
                                      <div className="flex items-center gap-2 bg-white border border-orange-200 rounded-lg px-3 py-2">
                                        <button type="button" onClick={() => setForm(prev => {
                                          const nuevosGrupos = prev.grupos_condicion.map((g, i) =>
                                            i === gi ? g.map((item, j) => j === idx ? { ...item, o: false } : item) : g
                                          )
                                          return { ...prev, grupos_condicion: nuevosGrupos }
                                        })} className="px-1.5 py-0.5 rounded text-xs font-bold border bg-orange-100 border-orange-300 text-orange-600 hover:opacity-80" title="Cambiar a obligatorio (Y)">
                                          O
                                        </button>
                                        <span className="flex-1 text-sm text-gray-700 truncate">{ac.nombre}</span>
                                        <input type="number" min="1" value={ac.cantidad}
                                          onChange={e => setForm(prev => {
                                            const nuevosGrupos = prev.grupos_condicion.map((g, i) =>
                                              i === gi ? g.map((item, j) => j === idx ? { ...item, cantidad: parseInt(e.target.value) || 1 } : item) : g
                                            )
                                            return { ...prev, grupos_condicion: nuevosGrupos }
                                          })}
                                          className="w-14 text-center border rounded px-1 py-0.5 text-xs" title="Cantidad requerida"
                                        />
                                        <button type="button" onClick={() => setForm(prev => {
                                          const nuevosGrupos = prev.grupos_condicion.map((g, i) => i === gi ? g.filter((_, j) => j !== idx) : g)
                                          return { ...prev, grupos_condicion: nuevosGrupos }
                                        })} className="text-pink-400 hover:text-pink-600">&times;</button>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {/* Si no hay alternativas, mostrar todos como items normales con toggle */}
                          {alternativas.length === 0 && obligatorios.length > 0 && (
                            <div className="text-xs text-gray-400 mt-1">Todos obligatorios. Click <b>Y</b> en un artículo para hacerlo alternativa.</div>
                          )}
                        </div>
                        )
                      })()}
                      {grupo.length === 0 && <div className="text-xs text-gray-400 mb-1">Grupo vacío — agregá artículos abajo</div>}
                      <div className="relative">
                        <input
                          type="text"
                          value={form.buscando_campo === 'condicion' ? busqueda : ''}
                          onFocus={() => setForm(prev => ({ ...prev, buscando_campo: 'condicion' }))}
                          onChange={e => { setForm(prev => ({ ...prev, buscando_campo: 'condicion' })); setBusqueda(e.target.value) }}
                          placeholder="Buscar artículo condición..."
                          className="campo-form text-sm"
                        />
                        {form.buscando_campo === 'condicion' && resultados.length > 0 && (
                          <div className="absolute z-20 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                            {resultados.map(item => (
                              <button key={item.id} type="button" onClick={() => {
                                const grupoActual = form.grupos_condicion[gi] || []
                                if (grupoActual.find(c => c.id === item.id)) return
                                setForm(prev => {
                                  const nuevosGrupos = prev.grupos_condicion.map((g, i) =>
                                    i === gi ? [...g, { id: item.id, nombre: item.nombre, codigo: item.codigo, cantidad: 1 }] : g
                                  )
                                  return { ...prev, grupos_condicion: nuevosGrupos, buscando_campo: null }
                                })
                                setBusqueda(''); setResultados([])
                              }} className="w-full text-left px-3 py-2 hover:bg-pink-50 text-sm border-b last:border-b-0">
                                <span className="font-medium">{item.nombre}</span>
                                <span className="text-gray-400 text-xs ml-2">{item.codigo}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Artículos beneficio */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-500 font-medium">Artículo(s) beneficio (a los que se aplica el descuento)</label>
                  {form.grupos_condicion.some(g => g.length > 0) && (
                    <button type="button" onClick={() => {
                      const todos = form.grupos_condicion.flat()
                      const nuevos = todos.filter(c => !form.articulos_beneficio.find(b => b.id === c.id && b.codigo === c.codigo))
                        .map(c => ({ id: c.id, nombre: c.nombre, codigo: c.codigo }))
                      if (nuevos.length > 0) setForm(prev => ({ ...prev, articulos_beneficio: [...prev.articulos_beneficio, ...nuevos] }))
                    }} className="text-xs text-green-600 hover:text-green-700 font-medium">
                      Copiar de condición
                    </button>
                  )}
                </div>
                {form.articulos_beneficio.length > 0 && (
                  <div className="space-y-1 mt-1 mb-2">
                    {form.articulos_beneficio.map((ab, idx) => (
                      <div key={ab.id} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                        <span className="flex-1 text-sm text-gray-700">{ab.nombre}</span>
                        <button type="button" onClick={() => setForm(prev => ({ ...prev, articulos_beneficio: prev.articulos_beneficio.filter((_, i) => i !== idx) }))} className="text-green-400 hover:text-green-600">&times;</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="relative mt-1">
                  <input
                    type="text"
                    value={form.buscando_campo === 'beneficio' ? busqueda : ''}
                    onFocus={() => setForm(prev => ({ ...prev, buscando_campo: 'beneficio' }))}
                    onChange={e => { setForm(prev => ({ ...prev, buscando_campo: 'beneficio' })); setBusqueda(e.target.value) }}
                    placeholder="Buscar artículo beneficio..."
                    className="campo-form text-sm"
                  />
                  {form.buscando_campo === 'beneficio' && resultados.length > 0 && (
                    <div className="absolute z-20 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {resultados.map(item => (
                        <button key={item.id} type="button" onClick={() => {
                          if (form.articulos_beneficio.find(b => b.id === item.id)) return
                          setForm(prev => ({ ...prev, articulos_beneficio: [...prev.articulos_beneficio, { id: item.id, nombre: item.nombre, codigo: item.codigo }], buscando_campo: null }))
                          setBusqueda(''); setResultados([])
                        }} className="w-full text-left px-3 py-2 hover:bg-green-50 text-sm border-b last:border-b-0">
                          <span className="font-medium">{item.nombre}</span>
                          <span className="text-gray-400 text-xs ml-2">{item.codigo}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Tipo y valor de descuento */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-gray-500">Tipo descuento</label>
                  <select
                    value={form.tipo_descuento}
                    onChange={e => setForm(prev => ({ ...prev, tipo_descuento: e.target.value }))}
                    className="campo-form text-sm"
                  >
                    <option value="porcentaje">Porcentaje (%)</option>
                    <option value="monto_fijo">Monto ($)</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-gray-500">Valor</label>
                  <input
                    type="number"
                    min="0"
                    step={form.tipo_descuento === 'porcentaje' ? '1' : '0.01'}
                    value={form.valor}
                    onChange={e => setForm(prev => ({ ...prev, valor: e.target.value }))}
                    placeholder={form.tipo_descuento === 'porcentaje' ? 'Ej: 50' : 'Ej: 500'}
                    className="campo-form text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Buscador de entidades / artículos (no aplica a forma_pago ni condicional) */}
          {form.tipo !== 'forma_pago' && form.tipo !== 'condicional' && <div className="border-t border-violet-200 pt-3">
            <label className="text-xs text-gray-500 font-medium">
              {form.tipo === 'combo' ? 'Artículos del combo' : 'Aplica a'}
            </label>

            {form.tipo !== 'combo' && (
              <div className="flex gap-2 mt-1 mb-2">
                {TIPO_ENTIDAD.map(te => (
                  <button
                    key={te.value}
                    type="button"
                    onClick={() => {
                      setTipoEntidad(te.value)
                      setResultados([])
                      if (te.value === 'todos') {
                        setForm(prev => ({ ...prev, aplicar_a: [{ tipo: 'todos' }] }))
                      }
                    }}
                    className={`text-xs px-2 py-1 rounded-lg transition-colors ${
                      tipoEntidad === te.value ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border'
                    }`}
                  >
                    {te.label}
                  </button>
                ))}
              </div>
            )}

            {/* Chips de entidades seleccionadas */}
            {form.tipo !== 'combo' && form.aplicar_a.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.aplicar_a.map((ent, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 bg-violet-100 text-violet-700 text-xs px-2 py-1 rounded-lg">
                    <span className="text-violet-400 capitalize">{ent.tipo}:</span>
                    {ent.tipo === 'todos' ? 'Todos' : ent.nombre}
                    <button type="button" onClick={() => quitarEntidad(idx)} className="text-violet-400 hover:text-violet-600 ml-0.5">&times;</button>
                  </span>
                ))}
              </div>
            )}

            {/* Chips de artículos combo */}
            {form.tipo === 'combo' && form.articulos_combo.length > 0 && (
              <div className="space-y-1.5 mb-2 mt-2">
                {form.articulos_combo.map((art, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-white border rounded-lg px-2 py-1.5 text-sm">
                    <span className="flex-1 truncate text-gray-700">{art.nombre}</span>
                    <input
                      type="number"
                      min="1"
                      value={art.cantidad}
                      onChange={e => cambiarCantidadCombo(idx, parseInt(e.target.value) || 1)}
                      className="w-14 text-center border rounded px-1 py-0.5 text-xs"
                    />
                    <button type="button" onClick={() => quitarArticuloCombo(idx)} className="text-red-400 hover:text-red-600">&times;</button>
                  </div>
                ))}
              </div>
            )}

            {/* Dropdown de rubros */}
            {tipoEntidad === 'rubro' && form.tipo !== 'combo' && (
              <select
                className="campo-form text-sm"
                value=""
                onChange={e => {
                  const r = rubros.find(r => String(r.id) === e.target.value)
                  if (!r) return
                  if (form.aplicar_a.find(a => a.tipo === 'rubro' && a.id === r.id)) return
                  setForm(prev => ({
                    ...prev,
                    aplicar_a: [...prev.aplicar_a.filter(a => a.tipo !== 'todos'), { tipo: 'rubro', id: r.id, nombre: r.nombre }],
                  }))
                }}
              >
                <option value="">Seleccionar rubro...</option>
                {rubros.map(r => (
                  <option key={r.id} value={r.id}>{r.nombre}</option>
                ))}
              </select>
            )}

            {/* Dropdown de subrubros */}
            {tipoEntidad === 'subrubro' && form.tipo !== 'combo' && (
              <select
                className="campo-form text-sm"
                value=""
                onChange={e => {
                  const s = subrubros.find(s => String(s.id) === e.target.value)
                  if (!s) return
                  if (form.aplicar_a.find(a => a.tipo === 'subrubro' && a.id === s.id)) return
                  setForm(prev => ({
                    ...prev,
                    aplicar_a: [...prev.aplicar_a.filter(a => a.tipo !== 'todos'), { tipo: 'subrubro', id: s.id, nombre: s.nombre }],
                  }))
                }}
              >
                <option value="">Seleccionar sub rubro...</option>
                {subrubros.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            )}

            {/* Dropdown de atributos */}
            {tipoEntidad === 'atributo' && form.tipo !== 'combo' && (
              <select
                className="campo-form text-sm"
                value=""
                onChange={e => {
                  const [attrId, valId] = e.target.value.split('|')
                  const attr = atributosDisponibles.find(a => String(a.id) === attrId)
                  if (!attr) return
                  const val = attr.valores.find(v => String(v.id_valor) === valId)
                  if (!val) return
                  if (form.aplicar_a.find(a => a.tipo === 'atributo' && a.id_valor === val.id_valor)) return
                  setForm(prev => ({
                    ...prev,
                    aplicar_a: [...prev.aplicar_a.filter(a => a.tipo !== 'todos'), { tipo: 'atributo', id_valor: val.id_valor, nombre: `${attr.nombre}: ${val.valor}` }],
                  }))
                }}
              >
                <option value="">Seleccionar atributo...</option>
                {atributosDisponibles.map(attr => (
                  <optgroup key={attr.id} label={attr.nombre}>
                    {attr.valores.map(v => (
                      <option key={v.id_valor} value={`${attr.id}|${v.id_valor}`}>{v.valor}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}

            {/* Input búsqueda de artículos (solo para tipo articulo o combo) */}
            {((tipoEntidad === 'articulo' && form.tipo !== 'combo') || form.tipo === 'combo') && (
              <div className="relative">
                <input
                  type="text"
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  placeholder={tipoEntidad === 'rubro' ? 'Buscar por nombre de rubro o artículo...' : tipoEntidad === 'subrubro' ? 'Buscar por nombre de subrubro o artículo...' : 'Buscar artículo por nombre o código...'}
                  className="campo-form text-sm"
                />
                {buscando && <span className="absolute right-3 top-2.5 text-xs text-gray-400">Buscando...</span>}

                {resultados.length > 0 && (
                  <div className="absolute z-20 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {resultados.map(item => (
                      <button
                        key={tipoEntidad === 'rubro' ? `r-${item.rubro?.id}` : tipoEntidad === 'subrubro' ? `sr-${item.subRubro?.id}` : item.id}
                        type="button"
                        onClick={() => agregarEntidad(item)}
                        className="w-full text-left px-3 py-2 hover:bg-violet-50 text-sm border-b last:border-b-0"
                      >
                        {tipoEntidad === 'rubro' ? (
                          <span className="font-medium">{item.rubro?.nombre}</span>
                        ) : tipoEntidad === 'subrubro' ? (
                          <>
                            <span className="font-medium">{item.subRubro?.nombre}</span>
                            <span className="text-gray-400 text-xs ml-2">(Rubro: {item.rubro?.nombre || '—'})</span>
                          </>
                        ) : (
                          <>
                            <span className="font-medium">{item.nombre}</span>
                            {item.rubro?.nombre && (
                              <span className="text-gray-400 text-xs ml-2">
                                {item.rubro.nombre}
                                {item.subRubro?.nombre && ` / ${item.subRubro.nombre}`}
                              </span>
                            )}
                            <span className="text-gray-400 text-xs ml-2">{formatPrecio(item.precio)}</span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>}

          {mensaje && <p className="text-sm text-red-600">{mensaje}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="flex-1 text-sm py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {guardando ? 'Guardando...' : editandoId ? 'Guardar cambios' : 'Crear promoción'}
            </button>
          </div>
        </form>
      )}

      {/* Lista de promociones */}
      {promociones.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-4">No hay promociones creadas</p>
      ) : (
        <div className="space-y-0 divide-y divide-gray-100">
          {promociones.map(promo => {
            const reglas = promo.reglas || {}
            let detalle = ''
            if (promo.tipo === 'porcentaje') detalle = `${reglas.valor}% off${reglas.cantidad_minima > 1 ? ` (min ${reglas.cantidad_minima})` : ''}`
            else if (promo.tipo === 'monto_fijo') detalle = `${formatPrecio(reglas.valor)} off${reglas.cantidad_minima > 1 ? ` (min ${reglas.cantidad_minima})` : ''}`
            else if (promo.tipo === 'nxm') detalle = `${reglas.llevar}x${reglas.pagar}${reglas.descuento_en === 'mas_caro' ? ' (más caro gratis)' : ''}`
            else if (promo.tipo === 'combo') detalle = `Combo ${formatPrecio(reglas.precio_combo)}`
            else if (promo.tipo === 'forma_pago') detalle = `${reglas.valor}% off en ${reglas.forma_cobro_nombre}`
            else if (promo.tipo === 'condicional') {
              const benefNombres = (reglas.articulos_beneficio || (reglas.articulo_beneficio ? [reglas.articulo_beneficio] : [])).map(b => b.nombre).join(' / ')
              const grupos = reglas.grupos_condicion
                || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
                || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion, cantidad: reglas.cantidad_minima || 1 }]] : [])
              const condNombres = grupos.map(g => {
                const parts = g.map((c, i) => {
                  const conn = i > 0 ? (c.o ? ' o ' : ' + ') : ''
                  return `${conn}${c.cantidad || 1}x ${c.nombre}`
                }).join('')
                return grupos.length > 1 ? `(${parts})` : parts
              }).join(' o ')
              detalle = `${condNombres} → ${reglas.valor}${reglas.tipo_descuento === 'porcentaje' ? '%' : '$'} off${reglas.descuento_en_ambos ? ' en ambos' : ` en ${benefNombres || '?'}`}`
            }

            const entidades = promo.tipo === 'combo'
              ? (reglas.articulos || []).map(a => a.nombre).join(', ')
              : promo.tipo === 'forma_pago'
              ? reglas.forma_cobro_nombre || ''
              : promo.tipo === 'condicional'
              ? `${(reglas.grupos_condicion || (reglas.articulos_condicion ? [reglas.articulos_condicion] : [[reglas.articulo_condicion || {}]])).map(g => g.map((c, i) => `${i > 0 ? (c.o ? ' o ' : ' + ') : ''}${c.nombre}`).join('')).join(' | ')} → ${(reglas.articulos_beneficio || (reglas.articulo_beneficio ? [reglas.articulo_beneficio] : [])).map(b => b.nombre).join(' / ') || '?'}`
              : (reglas.aplicar_a || []).map(a => a.tipo === 'todos' ? 'Todos' : a.nombre).join(', ')

            return (
              <div key={promo.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => abrirEditar(promo)}>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-800 truncate">{promo.nombre}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TIPO_BADGE_COLORS[promo.tipo] || 'bg-gray-100 text-gray-600'}`}>
                      {promo.tipo === 'monto_fijo' ? '$ Fijo' : promo.tipo === 'nxm' ? 'NxM' : promo.tipo === 'forma_pago' ? 'F. Pago' : promo.tipo === 'condicional' ? 'A→B' : promo.tipo.charAt(0).toUpperCase() + promo.tipo.slice(1)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{detalle} — {entidades || 'Sin destino'}</p>
                  {(promo.fecha_desde || promo.fecha_hasta) && (
                    <p className="text-[10px] text-gray-300">
                      {promo.fecha_desde && `Desde: ${promo.fecha_desde}`}
                      {promo.fecha_desde && promo.fecha_hasta && ' · '}
                      {promo.fecha_hasta && `Hasta: ${promo.fecha_hasta}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleActiva(promo)}
                    className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${
                      promo.activa ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-red-50 text-red-600 hover:bg-red-100'
                    }`}
                  >
                    {promo.activa ? 'Activa' : 'Inactiva'}
                  </button>
                  <button onClick={() => eliminar(promo)} className="text-gray-300 hover:text-red-500 text-lg">&times;</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default AdminPromociones
