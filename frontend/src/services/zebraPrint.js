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

// ─── Tamaños de etiqueta (dots @ 203 dpi) ───
// Para agregar un tamaño nuevo: definir ancho/alto en mm, se convierte automáticamente
const DPI = 203
const mmToDots = (mm) => Math.round(mm * DPI / 25.4)

const ETIQUETAS = {
  '100x150': { ancho: mmToDots(100), alto: mmToDots(150) }, // 812x1218 — GK420t estándar
  '100x50':  { ancho: mmToDots(100), alto: mmToDots(50) },  // 812x406
  '50x25':   { ancho: mmToDots(50),  alto: mmToDots(25) },  // 406x203
  '80x40':   { ancho: mmToDots(80),  alto: mmToDots(40) },  // 650x325
}

function getEtiqueta(nombre) {
  return ETIQUETAS[nombre] || ETIQUETAS['100x150']
}

// ─── Helpers ZPL ───

function zplInicio(oscuridad = 25) {
  return `^XA\n^CI28\n^LH0,0\n~SD${oscuridad}\n`
}

function zplBarcodeCentrado(x, y, ancho, codigo, modulo = 3, alto = 140) {
  // Code128: cada carácter ≈ 11 módulos, start=11, stop=13, quiet=20
  const modulosTotales = (codigo.length * 11 + 11 + 13 + 20)
  const anchoBc = modulosTotales * modulo
  const offsetX = Math.max(0, Math.floor((ancho - anchoBc) / 2))
  return `^FO${offsetX},${y}^BY${modulo},2,${alto}^BCN,${alto},N,N,N^FD${codigo}^FS\n`
}

function zplTextoCentrado(y, ancho, texto, tamano = 36) {
  return `^FO0,${y}^FB${ancho},1,0,C,0^CF0,${tamano}^FD${texto}^FS\n`
}

function zplTexto(x, y, texto, tamano = 30) {
  return `^FO${x},${y}^CF0,${tamano}^FD${texto}^FS\n`
}

function zplLineaHorizontal(x, y, largo, grosor = 1) {
  return `^FO${x},${y}^GB${largo},${grosor},${grosor}^FS\n`
}

// ─── Templates ZPL ───

function zplEtiquetaCanasto(codigo) {
  const { ancho, alto } = getEtiqueta('100x150')
  const bloques = 4
  const bloqueAlto = Math.floor(alto / bloques)
  const barcodeAlto = 140

  const textoAlto = 36
  const gap = 15
  const contenidoAlto = barcodeAlto + gap + textoAlto // 191
  const padY = Math.floor((bloqueAlto - contenidoAlto) / 2) // centrado vertical

  let zpl = zplInicio()
  for (let i = 0; i < bloques; i++) {
    const baseY = i * bloqueAlto + padY
    zpl += zplBarcodeCentrado(0, baseY, ancho, codigo, 3, barcodeAlto)
    zpl += zplTextoCentrado(baseY + barcodeAlto + gap, ancho, codigo, textoAlto)
    if (i < bloques - 1) {
      zpl += zplLineaHorizontal(20, (i + 1) * bloqueAlto, ancho - 40)
    }
  }
  zpl += '^XZ'
  return zpl
}

function zplEtiquetaPedido(pedido) {
  const { ancho } = getEtiqueta('100x150')
  const fecha = pedido.fecha || new Date().toLocaleDateString('es-AR')
  const cliente = (pedido.cliente_nombre || 'Sin cliente').substring(0, 30)
  const numero = pedido.numero || pedido.id?.substring(0, 8) || ''

  let zpl = zplInicio()
  zpl += zplTexto(30, 30, `Pedido: ${numero}`, 40)
  zpl += zplTexto(30, 90, cliente, 30)
  zpl += zplTexto(30, 130, `Fecha: ${fecha}`, 30)
  zpl += `^FO30,180^BY3,2,80^BCN,80,Y,N,N^FD${numero}^FS\n`
  zpl += zplTexto(30, 310, `Items: ${pedido.items?.length || 0}`, 25)
  zpl += '^XZ'
  return zpl
}

function zplEtiquetaTraspaso(orden) {
  const numero = orden.numero || ''
  const origen = (orden.sucursal_origen_nombre || '').substring(0, 25)
  const destino = (orden.sucursal_destino_nombre || '').substring(0, 25)
  const fecha = orden.fecha || new Date().toLocaleDateString('es-AR')

  let zpl = zplInicio()
  zpl += zplTexto(30, 30, 'TRASPASO', 35)
  zpl += zplTexto(30, 75, numero, 40)
  zpl += zplTexto(30, 130, `Origen: ${origen}`, 28)
  zpl += zplTexto(30, 170, `Destino: ${destino}`, 28)
  zpl += zplTexto(30, 210, `Fecha: ${fecha}`, 28)
  zpl += `^FO30,260^BY3,2,90^BCN,90,Y,N,N^FD${numero}^FS\n`
  zpl += '^XZ'
  return zpl
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
