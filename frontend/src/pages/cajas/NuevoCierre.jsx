// Wizard de 3 pasos para crear un nuevo cierre de caja
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import ContadorDenominacion from '../../components/cajas/ContadorDenominacion'
import api from '../../services/api'

const DENOMINACIONES_BILLETES = [20000, 10000, 5000, 2000, 1000, 500, 200, 100]
const DENOMINACIONES_MONEDAS = [500, 200, 100, 50, 20, 10, 5, 2, 1]

const formatMonto = (monto) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)
}

const CampoMedio = ({ label, monto, onMontoChange, cantidad, onCantidadChange }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
    <span className="text-sm font-medium text-gray-700">{label}</span>
    <div className="flex gap-2">
      <div className="flex-1">
        <label className="text-xs text-gray-400">Monto total</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={monto || ''}
          onChange={(e) => onMontoChange(parseFloat(e.target.value) || 0)}
          className="campo-form text-sm"
          placeholder="$0.00"
        />
      </div>
      <div className="w-24">
        <label className="text-xs text-gray-400">Cantidad</label>
        <input
          type="number"
          min="0"
          value={cantidad || ''}
          onChange={(e) => onCantidadChange(parseInt(e.target.value) || 0)}
          className="campo-form text-sm"
          placeholder="0"
        />
      </div>
    </div>
  </div>
)

const NuevoCierre = () => {
  const navigate = useNavigate()
  const { usuario } = useAuth()
  const [paso, setPaso] = useState(1)
  const [cajas, setCajas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  // Paso 1
  const [cajaId, setCajaId] = useState('')
  const [fondoFijo, setFondoFijo] = useState(0)

  // Paso 2
  const [billetes, setBilletes] = useState({})
  const [monedas, setMonedas] = useState({})

  // Paso 3
  const [cheques, setCheques] = useState(0)
  const [chequesCantidad, setChequesCantidad] = useState(0)
  const [vouchersTc, setVouchersTc] = useState(0)
  const [vouchersTcCant, setVouchersTcCant] = useState(0)
  const [vouchersTd, setVouchersTd] = useState(0)
  const [vouchersTdCant, setVouchersTdCant] = useState(0)
  const [transferencias, setTransferencias] = useState(0)
  const [transferenciasCant, setTransferenciasCant] = useState(0)
  const [pagosDigitales, setPagosDigitales] = useState(0)
  const [pagosDigitalesCant, setPagosDigitalesCant] = useState(0)
  const [otros, setOtros] = useState(0)
  const [otrosDetalle, setOtrosDetalle] = useState('')
  const [observaciones, setObservaciones] = useState('')

  useEffect(() => {
    const cargarCajas = async () => {
      try {
        const { data } = await api.get('/api/cajas')
        setCajas(data)
      } catch (err) {
        console.error('Error al cargar cajas:', err)
      } finally {
        setCargando(false)
      }
    }
    cargarCajas()
  }, [])

  const totalBilletes = DENOMINACIONES_BILLETES.reduce(
    (sum, d) => sum + d * (billetes[d] || 0), 0
  )
  const totalMonedas = DENOMINACIONES_MONEDAS.reduce(
    (sum, d) => sum + d * (monedas[d] || 0), 0
  )
  const totalEfectivo = totalBilletes + totalMonedas
  const totalOtrosMedios = cheques + vouchersTc + vouchersTd + transferencias + pagosDigitales + otros
  const totalGeneral = totalEfectivo + totalOtrosMedios

  const enviarCierre = async () => {
    setEnviando(true)
    setError('')
    try {
      const { data } = await api.post('/api/cierres', {
        caja_id: cajaId,
        billetes,
        monedas,
        total_efectivo: totalEfectivo,
        cheques,
        cheques_cantidad: chequesCantidad,
        vouchers_tc: vouchersTc,
        vouchers_tc_cantidad: vouchersTcCant,
        vouchers_td: vouchersTd,
        vouchers_td_cantidad: vouchersTdCant,
        transferencias,
        transferencias_cantidad: transferenciasCant,
        pagos_digitales: pagosDigitales,
        pagos_digitales_cantidad: pagosDigitalesCant,
        otros,
        otros_detalle: otrosDetalle,
        total_general: totalGeneral,
        fondo_fijo: fondoFijo,
        observaciones,
      })
      navigate(`/cajas/cierre/${data.id}`)
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear cierre')
    } finally {
      setEnviando(false)
    }
  }

  const cajaSeleccionada = cajas.find(c => c.id === cajaId)

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Nuevo Cierre" sinTabs volverA="/cajas" />

      <div className="px-4 py-4 max-w-lg mx-auto">

        {/* Indicador de pasos */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map(p => (
            <div key={p} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                paso === p ? 'bg-emerald-600 text-white' : paso > p ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-200 text-gray-400'
              }`}>
                {paso > p ? '✓' : p}
              </div>
              {p < 3 && <div className={`w-8 h-0.5 ${paso > p ? 'bg-emerald-400' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {/* Paso 1: Seleccionar caja */}
        {paso === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Seleccionar caja</h2>

            {cargando ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
              </div>
            ) : cajas.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No hay cajas disponibles. Contactá al administrador.</p>
            ) : (
              <div className="space-y-2">
                {cajas.map(caja => (
                  <button
                    key={caja.id}
                    type="button"
                    onClick={() => setCajaId(caja.id)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      cajaId === caja.id
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <span className="text-sm font-semibold text-gray-800">{caja.nombre}</span>
                    <span className="text-xs text-gray-400 ml-2">{caja.sucursales?.nombre}</span>
                  </button>
                ))}
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Fondo fijo</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={fondoFijo || ''}
                onChange={(e) => setFondoFijo(parseFloat(e.target.value) || 0)}
                className="campo-form text-sm"
                placeholder="$0.00"
              />
            </div>

            <button
              onClick={() => setPaso(2)}
              disabled={!cajaId}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition-colors"
            >
              Siguiente
            </button>
          </div>
        )}

        {/* Paso 2: Conteo de efectivo */}
        {paso === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">Conteo de efectivo</h2>
              <span className="text-sm font-bold text-emerald-600">{formatMonto(totalEfectivo)}</span>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Billetes</h3>
              <div className="space-y-1.5">
                {DENOMINACIONES_BILLETES.map(d => (
                  <ContadorDenominacion
                    key={`b-${d}`}
                    valor={d}
                    cantidad={billetes[d] || 0}
                    onChange={(val) => setBilletes(prev => ({ ...prev, [d]: val }))}
                  />
                ))}
              </div>
              <div className="text-right mt-2">
                <span className="text-sm font-medium text-gray-600">Subtotal billetes: {formatMonto(totalBilletes)}</span>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Monedas</h3>
              <div className="space-y-1.5">
                {DENOMINACIONES_MONEDAS.map(d => (
                  <ContadorDenominacion
                    key={`m-${d}`}
                    valor={d}
                    cantidad={monedas[d] || 0}
                    onChange={(val) => setMonedas(prev => ({ ...prev, [d]: val }))}
                  />
                ))}
              </div>
              <div className="text-right mt-2">
                <span className="text-sm font-medium text-gray-600">Subtotal monedas: {formatMonto(totalMonedas)}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setPaso(1)}
                className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl font-medium transition-colors hover:bg-gray-50"
              >
                Atrás
              </button>
              <button
                onClick={() => setPaso(3)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-medium transition-colors"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}

        {/* Paso 3: Otros medios + Resumen */}
        {paso === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-800">Otros medios de pago</h2>

            <div className="space-y-2">
              <CampoMedio label="Cheques" monto={cheques} onMontoChange={setCheques} cantidad={chequesCantidad} onCantidadChange={setChequesCantidad} />
              <CampoMedio label="Vouchers TC (crédito)" monto={vouchersTc} onMontoChange={setVouchersTc} cantidad={vouchersTcCant} onCantidadChange={setVouchersTcCant} />
              <CampoMedio label="Vouchers TD (débito)" monto={vouchersTd} onMontoChange={setVouchersTd} cantidad={vouchersTdCant} onCantidadChange={setVouchersTdCant} />
              <CampoMedio label="Transferencias" monto={transferencias} onMontoChange={setTransferencias} cantidad={transferenciasCant} onCantidadChange={setTransferenciasCant} />
              <CampoMedio label="Pagos digitales" monto={pagosDigitales} onMontoChange={setPagosDigitales} cantidad={pagosDigitalesCant} onCantidadChange={setPagosDigitalesCant} />

              <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
                <span className="text-sm font-medium text-gray-700">Otros</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={otros || ''}
                  onChange={(e) => setOtros(parseFloat(e.target.value) || 0)}
                  className="campo-form text-sm"
                  placeholder="Monto $0.00"
                />
                <input
                  type="text"
                  value={otrosDetalle}
                  onChange={(e) => setOtrosDetalle(e.target.value)}
                  className="campo-form text-sm"
                  placeholder="Detalle..."
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Observaciones</label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                className="campo-form text-sm"
                rows={2}
                placeholder="Observaciones opcionales..."
              />
            </div>

            {/* Resumen */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-emerald-800">Resumen del cierre</h3>
              <div className="text-sm space-y-1">
                <div className="flex justify-between text-gray-600">
                  <span>Caja:</span>
                  <span className="font-medium">{cajaSeleccionada?.nombre}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Fondo fijo:</span>
                  <span className="font-medium">{formatMonto(fondoFijo)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Total efectivo:</span>
                  <span className="font-medium">{formatMonto(totalEfectivo)}</span>
                </div>
                {totalOtrosMedios > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>Otros medios:</span>
                    <span className="font-medium">{formatMonto(totalOtrosMedios)}</span>
                  </div>
                )}
                <div className="flex justify-between text-emerald-800 font-bold pt-1 border-t border-emerald-200">
                  <span>Total general:</span>
                  <span>{formatMonto(totalGeneral)}</span>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded-xl">{error}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setPaso(2)}
                className="flex-1 border border-gray-300 text-gray-600 py-3 rounded-xl font-medium transition-colors hover:bg-gray-50"
              >
                Atrás
              </button>
              <button
                onClick={enviarCierre}
                disabled={enviando}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition-colors"
              >
                {enviando ? 'Enviando...' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default NuevoCierre
