import qz from 'qz-tray'

// ─── Estado de conexión ───
let conectado = false
let impresoraZebra = null

// Nombre por defecto — configurable desde admin
const ZEBRA_PRINTER_KEY = 'zebra_printer_name'

function getNombreImpresora() {
  return localStorage.getItem(ZEBRA_PRINTER_KEY) || 'ZDesigner GK420t (EPL)'
}

export function setNombreImpresora(nombre) {
  localStorage.setItem(ZEBRA_PRINTER_KEY, nombre)
  impresoraZebra = nombre
}

// ─── Conexión ───

export async function conectar() {
  if (conectado && qz.websocket.isActive()) return true

  try {
    // QZ Tray no requiere firma en desarrollo
    qz.security.setCertificatePromise(() => Promise.resolve(''))
    qz.security.setSignaturePromise(() => Promise.resolve(''))

    await qz.websocket.connect()
    conectado = true
    impresoraZebra = getNombreImpresora()
    return true
  } catch (err) {
    // Si ya está conectado, no es error
    if (err.message?.includes('already active')) {
      conectado = true
      impresoraZebra = getNombreImpresora()
      return true
    }
    console.error('Error conectando QZ Tray:', err)
    throw new Error('No se pudo conectar con QZ Tray. Verificá que esté instalado y corriendo.')
  }
}

export async function desconectar() {
  if (qz.websocket.isActive()) {
    await qz.websocket.disconnect()
  }
  conectado = false
}

export function estaConectado() {
  return conectado && qz.websocket.isActive()
}

// ─── Impresoras disponibles ───

export async function getImpresoras() {
  await conectar()
  return qz.printers.find()
}

export async function buscarZebra() {
  const impresoras = await getImpresoras()
  return impresoras.filter(p =>
    p.toLowerCase().includes('zebra') ||
    p.toLowerCase().includes('zdesigner') ||
    p.toLowerCase().includes('gk420')
  )
}

// ─── Envío ZPL raw ───

async function enviarZPL(zpl) {
  await conectar()
  const config = qz.configs.create(impresoraZebra)
  await qz.print(config, [{
    type: 'raw',
    format: 'command',
    data: zpl,
  }])
}

async function enviarZPLBatch(zplArray) {
  await conectar()
  const config = qz.configs.create(impresoraZebra)
  const data = zplArray.map(zpl => ({
    type: 'raw',
    format: 'command',
    data: zpl,
  }))
  await qz.print(config, data)
}

// ─── Templates ZPL ───
// Zebra GK420t 100x150mm (4x6") = 812x1218 dots a 203 dpi

function zplEtiquetaCanasto(codigo) {
  // 4 códigos de barras iguales distribuidos en la etiqueta
  // Para pegar en los 4 lados del canasto
  return `^XA
^CI28
^LH0,0

~SD25

^FO60,30^BY3,2,90^BCN,90,Y,N,N^FD${codigo}^FS

^FO60,200^BY3,2,90^BCN,90,Y,N,N^FD${codigo}^FS

^FO60,370^BY3,2,90^BCN,90,Y,N,N^FD${codigo}^FS

^FO60,540^BY3,2,90^BCN,90,Y,N,N^FD${codigo}^FS

^XZ`
}

function zplEtiquetaPedido(pedido) {
  const fecha = pedido.fecha || new Date().toLocaleDateString('es-AR')
  const cliente = (pedido.cliente_nombre || 'Sin cliente').substring(0, 30)
  const numero = pedido.numero || pedido.id?.substring(0, 8) || ''

  return `^XA
^CI28
^LH0,0

~SD25

^CF0,40
^FO30,30^FDPedido: ${numero}^FS

^CF0,30
^FO30,90^FD${cliente}^FS
^FO30,130^FDFecha: ${fecha}^FS

^FO30,180^BY3,2,80^BCN,80,Y,N,N^FD${numero}^FS

^CF0,25
^FO30,310^FDItems: ${pedido.items?.length || 0}^FS

^XZ`
}

function zplEtiquetaTraspaso(orden) {
  const numero = orden.numero || ''
  const origen = (orden.sucursal_origen_nombre || '').substring(0, 25)
  const destino = (orden.sucursal_destino_nombre || '').substring(0, 25)
  const fecha = orden.fecha || new Date().toLocaleDateString('es-AR')

  return `^XA
^CI28
^LH0,0

~SD25

^CF0,35
^FO30,30^FDTRASPASO^FS

^CF0,40
^FO30,75^FD${numero}^FS

^CF0,28
^FO30,130^FDOrigen: ${origen}^FS
^FO30,170^FDDestino: ${destino}^FS
^FO30,210^FDFecha: ${fecha}^FS

^FO30,260^BY3,2,90^BCN,90,Y,N,N^FD${numero}^FS

^XZ`
}

// ─── API pública por módulo ───

export async function imprimirEtiquetaCanasto(canasto) {
  const zpl = zplEtiquetaCanasto(canasto.codigo)
  await enviarZPL(zpl)
}

export async function imprimirEtiquetasCanastos(canastos) {
  const zplArray = canastos.map(c => zplEtiquetaCanasto(c.codigo))
  await enviarZPLBatch(zplArray)
}

export async function imprimirEtiquetaPedido(pedido) {
  const zpl = zplEtiquetaPedido(pedido)
  await enviarZPL(zpl)
}

export async function imprimirEtiquetaTraspaso(orden) {
  const zpl = zplEtiquetaTraspaso(orden)
  await enviarZPL(zpl)
}

// ─── Utilidad: imprimir ZPL custom ───

export async function imprimirZPLCustom(zpl) {
  await enviarZPL(zpl)
}
