// Chat IA de compras — clon de ChatAuditoria adaptado
import React, { useState, useRef, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const ChatCompras = () => {
  const [mensajes, setMensajes] = useState([])
  const [input, setInput] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [guardandoRegla, setGuardandoRegla] = useState(null)
  const [reglaGuardada, setReglaGuardada] = useState(null)
  const chatEndRef = useRef(null)

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [mensajes])

  const enviar = async () => {
    const msg = input.trim()
    if (!msg || enviando) return
    setInput('')
    setMensajes(prev => [...prev, { rol: 'user', contenido: msg }])
    setEnviando(true)
    try {
      const historial = mensajes.map(m => ({ rol: m.rol, contenido: m.contenido }))
      const { data } = await api.post('/api/compras/chat', { mensaje: msg, historial })
      setMensajes(prev => [...prev, { rol: 'assistant', contenido: data.respuesta }])
    } catch (err) {
      setMensajes(prev => [...prev, { rol: 'assistant', contenido: 'Error: no se pudo obtener respuesta.' }])
    } finally {
      setEnviando(false)
    }
  }

  const guardarComoRegla = async (texto, idx) => {
    setGuardandoRegla(idx)
    try {
      await api.post('/api/compras/reglas-ia', { regla: texto })
      setReglaGuardada(idx)
      setTimeout(() => setReglaGuardada(null), 3000)
    } catch (err) {
      alert('Error al guardar regla')
    } finally {
      setGuardandoRegla(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar titulo="Chat Compras IA" sinTabs volverA="/compras" />

      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full">
        {/* Area de mensajes */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {mensajes.length === 0 && (
            <div className="text-center py-20 space-y-3">
              <div className="text-4xl text-amber-300">&#10022;</div>
              <p className="text-sm text-gray-500">
                Preguntale a la IA sobre compras, stock, proveedores, demanda...
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {[
                  'Que tengo que pedir esta semana?',
                  'Cuanto queso cremoso vendi este mes?',
                  'Conviene la promo 10+1 de fiambrin?',
                  'Que articulos estan en stock critico?',
                ].map((sugerencia) => (
                  <button
                    key={sugerencia}
                    onClick={() => setInput(sugerencia)}
                    className="text-xs border border-amber-200 text-amber-700 px-3 py-1.5 rounded-full hover:bg-amber-50 transition-colors"
                  >
                    {sugerencia}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mensajes.map((msg, idx) => (
            <div key={`msg-${idx}`} className={`flex ${msg.rol === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[85%]">
                <div className={`text-sm px-4 py-2.5 rounded-2xl whitespace-pre-wrap ${
                  msg.rol === 'user'
                    ? 'bg-emerald-100 text-emerald-900'
                    : 'bg-amber-100 text-amber-900'
                }`}>
                  {msg.contenido}
                </div>
                {msg.rol === 'assistant' && (
                  <div className="flex justify-start mt-0.5">
                    <button
                      onClick={() => guardarComoRegla(msg.contenido, idx)}
                      disabled={guardandoRegla === idx || reglaGuardada === idx}
                      className="text-[10px] text-amber-400 hover:text-amber-600 disabled:text-green-500 transition-colors"
                    >
                      {reglaGuardada === idx ? 'Guardada' : guardandoRegla === idx ? 'Guardando...' : 'Guardar como regla'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {enviando && (
            <div className="flex justify-start">
              <div className="bg-amber-100 text-amber-600 text-sm px-4 py-2.5 rounded-2xl">
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-amber-500" />
                  Analizando...
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input fijo abajo */}
        <div className="border-t border-gray-200 bg-white px-4 py-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') enviar() }}
              placeholder="Preguntale sobre compras..."
              className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-amber-400"
              disabled={enviando}
            />
            <button
              onClick={enviar}
              disabled={enviando || !input.trim()}
              className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
            >
              Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatCompras
