// Vista de equipo: fichas de empleados con ranking y score
import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import TareasNav from '../../components/tareas/TareasNav'
import api from '../../services/api'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function cumpleProximo(fecha) {
  if (!fecha) return null
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const [, m, d] = fecha.split('-')
  const cumple = new Date(hoy.getFullYear(), parseInt(m) - 1, parseInt(d))
  cumple.setHours(0, 0, 0, 0)
  if (cumple < hoy) cumple.setFullYear(cumple.getFullYear() + 1)
  const diff = Math.floor((cumple - hoy) / (1000 * 60 * 60 * 24))
  return diff
}

function formatCumple(fecha) {
  if (!fecha) return null
  const [, m, d] = fecha.split('-')
  return `${parseInt(d)} de ${MESES[parseInt(m) - 1]}`
}

const StarDisplay = ({ valor }) => {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <svg
          key={s}
          className={`w-4 h-4 ${s <= Math.round(valor) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200 fill-gray-200'}`}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1}
        >
          <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
      ))}
    </div>
  )
}

const TareasEquipo = () => {
  const { esAdmin, esGestor } = useAuth()
  const [ranking, setRanking] = useState([])
  const [etiqueta, setEtiqueta] = useState('')
  const [periodo, setPeriodo] = useState('mensual')
  const [mesSeleccionado, setMesSeleccionado] = useState(() => {
    const h = new Date()
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`
  })
  const [cargando, setCargando] = useState(true)

  const cargar = async () => {
    setCargando(true)
    try {
      const { data } = await api.get(`/api/tareas/ranking?periodo=${periodo}&mes=${mesSeleccionado}`)
      setRanking(data.ranking)
      setEtiqueta(data.etiqueta)
    } catch (err) {
      console.error('Error cargando ranking:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [periodo, mesSeleccionado])

  // Generar opciones de meses (últimos 12)
  const opcionesMes = []
  const hoy = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${MESES[d.getMonth()]} ${d.getFullYear()}`
    opcionesMes.push({ val, label })
  }

  // Opciones de año
  const opcionesAnio = []
  for (let a = hoy.getFullYear(); a >= hoy.getFullYear() - 2; a--) {
    opcionesAnio.push(String(a))
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar titulo="Tareas" sinTabs />
      <TareasNav />

      {/* Nav tabs */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2">
        <Link
          to="/tareas"
          className="text-sm px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors font-medium"
        >
          Pendientes
        </Link>
        <span className="text-sm px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg font-medium">
          Equipo
        </span>
        {(esAdmin || esGestor) && (
          <>
            <Link
              to="/tareas/panel"
              className="text-sm px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors font-medium"
            >
              Panel general
            </Link>
            <Link
              to="/tareas/analytics"
              className="text-sm px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors font-medium"
            >
              Analisis
            </Link>
          </>
        )}
        {esAdmin && (
          <Link
            to="/tareas/admin"
            className="text-sm px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors font-medium"
          >
            Configurar
          </Link>
        )}
      </div>

      <div className="w-full px-6 py-6">
        {/* Filtros */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-800">Ranking del equipo</h2>
          <div className="flex items-center gap-3">
            <div className="flex bg-gray-200 rounded-lg p-0.5">
              <button
                onClick={() => setPeriodo('mensual')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  periodo === 'mensual' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                }`}
              >
                Mensual
              </button>
              <button
                onClick={() => setPeriodo('anual')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  periodo === 'anual' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                }`}
              >
                Anual
              </button>
            </div>

            {periodo === 'mensual' ? (
              <select
                value={mesSeleccionado}
                onChange={e => setMesSeleccionado(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              >
                {opcionesMes.map(o => (
                  <option key={o.val} value={o.val}>{o.label}</option>
                ))}
              </select>
            ) : (
              <select
                value={mesSeleccionado.split('-')[0]}
                onChange={e => setMesSeleccionado(`${e.target.value}-01`)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              >
                {opcionesAnio.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <p className="text-sm text-gray-500 mb-6">{etiqueta}</p>

        {cargando ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : ranking.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No hay empleados cargados</p>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-4">
            {ranking.map((emp) => {
              const tieneScore = emp.score > 0
              const diasCumple = cumpleProximo(emp.fecha_cumpleanos)
              const esCumpleHoy = diasCumple === 0
              const cumpleSemana = diasCumple !== null && diasCumple > 0 && diasCumple <= 7

              const borderColor = 'border-gray-200'

              const avatarBg = tieneScore ? 'bg-orange-100 text-orange-600'
                : 'bg-gray-100 text-gray-400'

              return (
                <div
                  key={emp.id}
                  className={`relative bg-white rounded-2xl border-2 ${borderColor} p-5 text-center transition-shadow hover:shadow-lg ${!tieneScore ? 'opacity-50' : ''}`}
                >
                  {/* Cumpleaños */}
                  {esCumpleHoy && (
                    <div className="absolute -top-3 right-2 bg-pink-100 text-pink-600 text-xs font-bold px-2 py-0.5 rounded-full">
                      🎂 Hoy cumple!
                    </div>
                  )}
                  {cumpleSemana && (
                    <div className="absolute -top-3 right-2 bg-purple-100 text-purple-600 text-xs font-bold px-2 py-0.5 rounded-full">
                      🎂 {diasCumple}d
                    </div>
                  )}

                  {/* Avatar */}
                  <div className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center text-xl font-bold mt-2 ${avatarBg}`}>
                    {emp.nombre.charAt(0).toUpperCase()}
                  </div>

                  {/* Nombre */}
                  <h3 className="font-bold text-gray-800 mt-3 text-sm truncate">{emp.nombre}</h3>

                  {/* Cumpleaños fecha */}
                  {emp.fecha_cumpleanos && (
                    <p className="text-xs text-gray-400 mt-0.5">{formatCumple(emp.fecha_cumpleanos)}</p>
                  )}

                  {/* Estrellas */}
                  {tieneScore && (
                    <div className="mt-3 flex items-center justify-center gap-1">
                      <StarDisplay valor={emp.promedio_calificacion} />
                      <span className="text-xs text-gray-500 ml-1">{emp.promedio_calificacion}</span>
                    </div>
                  )}

                  {/* Score */}
                  <div className={`mt-2 text-2xl font-bold ${tieneScore ? 'text-orange-600' : 'text-gray-300'}`}>
                    {emp.score}
                  </div>
                  <p className="text-xs text-gray-400">
                    {tieneScore ? `${emp.tareas} tarea${emp.tareas !== 1 ? 's' : ''}` : 'Sin actividad'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default TareasEquipo
