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
    // Modo sin firma — QZ Tray mostrará popup de confianza al usuario
    qz.security.setCertificatePromise(function(resolve, reject) {
      resolve('')
    })
    qz.security.setSignaturePromise(function(toSign) {
      return function(resolve, reject) {
        resolve('')
      }
    })

    await qz.websocket.connect({ retries: 3, delay: 1 })
    conectado = true
    impresoraZebra = getNombreImpresora()
    return true
  } catch (err) {
    // Si ya está conectado, no es error
    const errMsg = typeof err === 'string' ? err : (err.message || '')
    if (errMsg.includes('already active') || errMsg.includes('already exists')) {
      conectado = true
      impresoraZebra = getNombreImpresora()
      return true
    }
    console.error('Error conectando QZ Tray:', err)
    const msg = typeof err === 'string' ? err : (err.message || JSON.stringify(err))
    throw new Error(msg)
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
  // 4 códigos de barras en etiqueta 100x150mm (812x1218 dots @ 203dpi)
  // Cada bloque ocupa ~300 dots de alto (1218/4 ≈ 304)
  // Barcode ancho completo: módulo 4, ratio 2, altura 150
  // Línea punteada de corte entre cada bloque
  const bloqueAlto = 304
  const margenLinea = 20
  const anchoLinea = 772  // 812 - 2*20
  const barcodeAlto = 150
  // Code128 con módulo 4: ~11 módulos por carácter * 8 chars + start/stop ≈ 480 dots
  // Centrado: (812 - 480) / 2 ≈ 160
  const barcodeX = 160

  let zpl = `^XA
^CI28
^LH0,0
~SD25
`

  for (let i = 0; i < 4; i++) {
    const baseY = i * bloqueAlto
    const barcodeY = baseY + 20
    const textoY = barcodeY + barcodeAlto + 10
    // Barcode Code128 centrado
    zpl += `^FO${barcodeX},${barcodeY}^BY4,2,${barcodeAlto}^BCN,${barcodeAlto},N,N,N^FD${codigo}^FS
`
    // Texto centrado debajo
    zpl += `^FO0,${textoY}^FB812,1,0,C,0^CF0,40^FD${codigo}^FS
`
    // Línea punteada de corte (excepto después del último)
    if (i < 3) {
      const lineaY = baseY + bloqueAlto - 8
      // Línea punteada con segmentos cortos
      for (let x = margenX; x < margenX + anchoLinea; x += 20) {
        zpl += `^FO${x},${lineaY}^GB10,2,2^FS
`
      }
    }
  }

  zpl += `^XZ`
  return zpl
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
