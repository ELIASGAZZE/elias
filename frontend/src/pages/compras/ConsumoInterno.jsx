// Registrar y ver consumo interno (producción, merma, degustación)
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const MOTIVOS = [
  { value: 'produccion', label: 'Producción (picadas, etc.)' },
  { value: 'degustacion', label: 'Degustación' },
  { value: 'merma', label: 'Merma' },
  { value: 'vencimiento', label: 'Vencimiento' },
  { value: 'rotura', label: 'Rotura' },
  { value: 'otro', label: 'Otro' },
]

const ConsumoInterno = () => {
  const [registros, setRegistros] = useState([])
  const [cargando, setCargando] = useState(true)
  const [busquedaArt, setBusquedaArt] = useState('')
  const [articulosDisp, setArticulosDisp] = useState([])
  const [form, setForm] = useState({ articulo_id: '', articulo_nombre: '', cantidad: '', motivo: 'produccion', notas: '', fecha: new Date().toISOString().split('T')[0] })
  const [guardando, setGuardando] = useState(false)

  const cargar = () => {
    setCargando(true)
    api.get('/api/compras/consumo-interno')
      .then(r => setRegistros(r.data))
      .catch(err => console.error(err))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargar() }, [])

  const buscarArticulos = async (q) => {
    setBusquedaArt(q)
    if (q.length < 2) { setArticulosDisp([]); return }
    try {
      const { data } = await api.get(`/api/articulos?busqueda=${encodeURIComponent(q)}&limit=8`)
      setArticulosDisp(data || [])
    } catch { setArticulosDisp([]) }
  }

  const seleccionarArticulo = (art) => {
    setForm({ ...form, articulo_id: art.id, articulo_nombre: art.nombre })
    setBusquedaArt(art.nombre)
    setArticulosDisp([])
  }

  const guardar = async () => {
    if (!form.articulo_id || !form.cantidad) return
    setGuardando(true)
    try {
      await api.post('/api/compras/consumo-interno', {
        articulo_id: form.articulo_id,
        cantidad: Number(form.cantidad),
        motivo: form.motivo,
        notas: form.notas,
        fecha: form.fecha,
      })
      setForm({ articulo_id: '', articulo_nombre: '', cantidad: '', motivo: 'produccion', notas: '', fecha: new Date().toISOString().split('T')[0] })
      setBusquedaArt('')
      cargar()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Consumo Interno" sinTabs volverA="/compras" />

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {/* Form registro */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Registrar consumo</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="relative col-span-2">
              <input placeholder="Buscar artículo..." value={busquedaArt} onChange={e => buscarArticulos(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-rose-400" />
              {articulosDisp.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {articulosDisp.map(a => (
                    <button key={a.id} onClick={() => seleccionarArticulo(a)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-rose-50 border-b border-gray-100">
                      {a.nombre} <span className="text-gray-400">{a.codigo}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input type="number" placeholder="Cantidad" value={form.cantidad} onChange={e => setForm({...form, cantidad: e.target.value})}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-rose-400" step="0.1" />
            <select value={form.motivo} onChange={e => setForm({...form, motivo: e.target.value})}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2">
              {MOTIVOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <input type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
            <input placeholder="Notas (opcional)" value={form.notas} onChange={e => setForm({...form, notas: e.target.value})}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2" />
          </div>
          <button onClick={guardar} disabled={guardando || !form.articulo_id || !form.cantidad}
            className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
            {guardando ? 'Registrando...' : 'Registrar'}
          </button>
        </div>

        {/* Lista */}
        {cargando ? (
          <div className="text-center py-10 text-gray-400">Cargando...</div>
        ) : registros.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No hay registros</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {registros.map(r => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-800">{r.articulo_id}</span>
                    <span className="ml-2 text-xs text-gray-400">{r.cantidad} uds</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                      r.motivo === 'merma' || r.motivo === 'vencimiento' ? 'bg-red-100 text-red-600' :
                      r.motivo === 'produccion' ? 'bg-blue-100 text-blue-600' :
                      'bg-gray-100 text-gray-600'
                    }`}>{MOTIVOS.find(m => m.value === r.motivo)?.label || r.motivo}</span>
                  </div>
                  <span className="text-xs text-gray-400">{r.fecha}</span>
                </div>
                {r.notas && <div className="text-xs text-gray-500 mt-1">{r.notas}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ConsumoInterno
