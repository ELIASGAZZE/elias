// Lista de proveedores
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const Proveedores = () => {
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [form, setForm] = useState({ nombre: '', cuit: '', codigo: '', lead_time_dias: 1, contacto: '', telefono: '', email: '', whatsapp: '', monto_minimo: 0, notas: '' })
  const [guardando, setGuardando] = useState(false)

  const cargar = () => {
    setCargando(true)
    api.get('/api/compras/proveedores')
      .then(r => setProveedores(r.data))
      .catch(err => console.error(err))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargar() }, [])

  const filtrados = proveedores.filter(p =>
    !busqueda || p.nombre?.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.cuit?.includes(busqueda) || p.codigo?.toLowerCase().includes(busqueda.toLowerCase())
  )

  const guardar = async () => {
    if (!form.nombre.trim()) return
    setGuardando(true)
    try {
      await api.post('/api/compras/proveedores', form)
      setMostrarForm(false)
      setForm({ nombre: '', cuit: '', codigo: '', lead_time_dias: 1, contacto: '', telefono: '', email: '', whatsapp: '', monto_minimo: 0, notas: '' })
      cargar()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Proveedores" sinTabs volverA="/compras" />

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* Barra superior */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Buscar proveedor..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
          />
          <button
            onClick={() => setMostrarForm(!mostrarForm)}
            className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            + Nuevo
          </button>
        </div>

        {/* Form nuevo proveedor */}
        {mostrarForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Nuevo proveedor</h3>
            <div className="grid grid-cols-2 gap-3">
              <input placeholder="Nombre *" value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
              <input placeholder="CUIT" value={form.cuit} onChange={e => setForm({...form, cuit: e.target.value})}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
              <input placeholder="Código" value={form.codigo} onChange={e => setForm({...form, codigo: e.target.value})}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
              <input placeholder="Lead time (días)" type="number" value={form.lead_time_dias} onChange={e => setForm({...form, lead_time_dias: Number(e.target.value)})}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
              <input placeholder="Contacto" value={form.contacto} onChange={e => setForm({...form, contacto: e.target.value})}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
              <input placeholder="Teléfono" value={form.telefono} onChange={e => setForm({...form, telefono: e.target.value})}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
              <input placeholder="Email" value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
              <input placeholder="WhatsApp" value={form.whatsapp} onChange={e => setForm({...form, whatsapp: e.target.value})}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
              <input placeholder="Monto mínimo" type="number" value={form.monto_minimo} onChange={e => setForm({...form, monto_minimo: Number(e.target.value)})}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" />
            </div>
            <textarea placeholder="Notas" value={form.notas} onChange={e => setForm({...form, notas: e.target.value})}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" rows={2} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setMostrarForm(false)} className="text-sm text-gray-500 px-3 py-1.5">Cancelar</button>
              <button onClick={guardar} disabled={guardando || !form.nombre.trim()}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        )}

        {/* Lista */}
        {cargando ? (
          <div className="text-center py-10 text-gray-400">Cargando...</div>
        ) : filtrados.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No hay proveedores{busqueda ? ' que coincidan' : ''}</div>
        ) : (
          <div className="space-y-2">
            {filtrados.map(p => (
              <Link key={p.id} to={`/compras/proveedores/${p.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-800">{p.nombre}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {p.cuit && <span className="mr-3">CUIT: {p.cuit}</span>}
                      {p.codigo && <span className="mr-3">Cód: {p.codigo}</span>}
                      {p.lead_time_dias && <span>Lead time: {p.lead_time_dias}d</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                      {p.total_articulos} art.
                    </span>
                    {!p.activo && <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full">Inactivo</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Proveedores
