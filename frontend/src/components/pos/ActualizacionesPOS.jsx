// Modal de actualizaciones de artículos — últimos 7 días con generación de PDF
import React, { useState } from 'react'
import api from '../../services/api'

function obtenerUltimos7Dias() {
  const dias = []
  for (let i = 0; i < 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dias.push({
      fecha: d.toISOString().split('T')[0],
      label: i === 0 ? 'Hoy' : i === 1 ? 'Ayer' : d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' }),
    })
  }
  return dias
}

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

async function generarPDF(fecha, articulos) {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  const fechaLabel = new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // Header
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Actualizaciones de Articulos', 14, 20)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(fechaLabel, 14, 28)
  doc.text(`Total: ${articulos.length} articulos`, 14, 35)

  // Tabla
  let y = 45
  const colX = { codigo: 14, nombre: 40, rubro: 120, precio: 170 }

  // Header de tabla
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setFillColor(100, 80, 160)
  doc.setTextColor(255, 255, 255)
  doc.rect(12, y - 5, 186, 8, 'F')
  doc.text('Codigo', colX.codigo, y)
  doc.text('Nombre', colX.nombre, y)
  doc.text('Rubro', colX.rubro, y)
  doc.text('Precio', colX.precio, y)

  y += 8
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(8)

  let rubroActual = null

  for (const art of articulos) {
    if (y > 280) {
      doc.addPage()
      y = 20
      // Re-dibujar header
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setFillColor(100, 80, 160)
      doc.setTextColor(255, 255, 255)
      doc.rect(12, y - 5, 186, 8, 'F')
      doc.text('Codigo', colX.codigo, y)
      doc.text('Nombre', colX.nombre, y)
      doc.text('Rubro', colX.rubro, y)
      doc.text('Precio', colX.precio, y)
      y += 8
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(0, 0, 0)
      doc.setFontSize(8)
      rubroActual = null
    }

    // Separador de rubro
    if (art.rubro && art.rubro !== rubroActual) {
      rubroActual = art.rubro
      doc.setFillColor(240, 237, 250)
      doc.rect(12, y - 4, 186, 6, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(80, 60, 140)
      doc.text(rubroActual, 14, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(0, 0, 0)
      y += 6
    }

    // Calcular precio con descuentos
    let precio = art.precio || 0
    if (art.descuento1) precio *= (1 - art.descuento1 / 100)
    if (art.descuento2) precio *= (1 - art.descuento2 / 100)
    if (art.descuento3) precio *= (1 - art.descuento3 / 100)

    // Fila par/impar
    const esPar = articulos.indexOf(art) % 2 === 0
    if (esPar) {
      doc.setFillColor(248, 248, 252)
      doc.rect(12, y - 4, 186, 6, 'F')
    }

    doc.text(String(art.codigo || ''), colX.codigo, y)
    doc.text((art.nombre || '').substring(0, 45), colX.nombre, y)
    doc.text((art.rubro || '').substring(0, 25), colX.rubro, y)
    doc.text(formatPrecio(precio), colX.precio, y)

    y += 6
  }

  // Footer
  doc.setFontSize(7)
  doc.setTextColor(150, 150, 150)
  const totalPages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.text(`Pagina ${i} de ${totalPages} — Generado ${new Date().toLocaleString('es-AR')}`, 14, 290)
  }

  doc.save(`actualizaciones_${fecha}.pdf`)
}

export default function ActualizacionesPOS({ onCerrar }) {
  const [cargando, setCargando] = useState(null) // fecha que se está cargando
  const [error, setError] = useState('')
  const dias = obtenerUltimos7Dias()

  const handleDia = async (fecha) => {
    setCargando(fecha)
    setError('')
    try {
      const { data } = await api.get(`/api/articulos/actualizaciones?fecha=${fecha}`)
      if (data.cantidad === 0) {
        setError(`No hubo actualizaciones el ${fecha}`)
        setCargando(null)
        return
      }
      await generarPDF(fecha, data.articulos)
      setCargando(null)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
      setCargando(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCerrar}>
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-violet-600 px-5 py-4 flex items-center justify-between">
          <h2 className="text-white font-semibold text-base">Actualizaciones de Precios</h2>
          <button onClick={onCerrar} className="text-violet-200 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Lista de días */}
        <div className="p-4 space-y-2">
          <p className="text-xs text-gray-500 mb-3">Selecciona un dia para descargar el PDF con los articulos actualizados</p>
          {dias.map(dia => (
            <button
              key={dia.fecha}
              onClick={() => handleDia(dia.fecha)}
              disabled={cargando !== null}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-violet-400 hover:bg-violet-50 transition-all disabled:opacity-50"
            >
              <div className="text-left">
                <span className="text-sm font-medium text-gray-800 capitalize">{dia.label}</span>
                <span className="text-xs text-gray-400 ml-2">{dia.fecha}</span>
              </div>
              {cargando === dia.fecha ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-violet-600" />
              ) : (
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              )}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 pb-4">
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
