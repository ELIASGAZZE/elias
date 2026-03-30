/**
 * Genera SVG de código de barras Code128B
 */
function code128SVG(text, width = 400, height = 100) {
  const CODE128B = [
    [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],
    [1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
    [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],
    [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
    [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
    [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
    [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],
    [1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
    [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],
    [1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
    [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],
    [3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
    [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],
    [1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,2,2,1],[1,4,1,1,2,2],[1,1,2,2,1,4],
    [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],
    [2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
    [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],
    [1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
    [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
    [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
    [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],
    [2,1,1,2,3,2],[2,3,3,1,1,1,2]
  ]
  const START_B = 104
  const STOP = 106
  let checksum = START_B
  const codes = [START_B]
  for (let i = 0; i < text.length; i++) {
    const val = text.charCodeAt(i) - 32
    codes.push(val)
    checksum += val * (i + 1)
  }
  codes.push(checksum % 103)
  codes.push(STOP)

  let bars = ''
  for (const code of codes) {
    const pattern = CODE128B[code]
    for (let j = 0; j < pattern.length; j++) {
      bars += (j % 2 === 0 ? '1' : '0').repeat(pattern[j])
    }
  }

  const barWidth = width / bars.length
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
  for (let i = 0; i < bars.length; i++) {
    if (bars[i] === '1') {
      svg += `<rect x="${i * barWidth}" y="0" width="${barWidth}" height="${height}" fill="black"/>`
    }
  }
  svg += '</svg>'
  return svg
}

/**
 * Imprime etiqueta A4 para un pallet de traspaso con código de barras
 */
export function imprimirPallet(pallet, orden) {
  const codigo = pallet.numero_pallet || pallet.precinto || ''
  const fecha = new Date().toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const barcodeSVG = code128SVG(codigo, 500, 120)

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Pallet ${codigo}</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: Arial, sans-serif; margin: 0; padding: 40px; }
  .header { text-align: center; margin-bottom: 40px; }
  .header h1 { font-size: 28px; margin: 0; letter-spacing: 2px; }
  .header .line { border-top: 3px double #333; margin-top: 10px; }
  .info { font-size: 18px; line-height: 2.2; }
  .info .label { color: #666; display: inline-block; width: 200px; }
  .info .value { font-weight: bold; }
  .descripcion { margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px; font-size: 16px; }
  .barcode-box { text-align: center; margin-top: 50px; padding: 30px; border: 3px solid #333; border-radius: 12px; }
  .barcode-box .label { font-size: 14px; color: #666; margin-bottom: 15px; }
  .barcode-box .num { font-size: 36px; font-weight: bold; letter-spacing: 3px; font-family: monospace; margin-top: 15px; }
  .barcode-box svg { display: block; margin: 0 auto; }
</style>
</head><body>
  <div class="header">
    <h1>PALLET DE TRASPASO</h1>
    <div class="line"></div>
  </div>
  <div class="info">
    <div><span class="label">Numero:</span> <span class="value">${codigo}</span></div>
    <div><span class="label">Orden:</span> <span class="value">${orden.numero || ''}</span></div>
    <div><span class="label">Origen:</span> <span class="value">${orden.sucursal_origen_nombre || ''}</span></div>
    <div><span class="label">Destino:</span> <span class="value">${orden.sucursal_destino_nombre || ''}</span></div>
    <div><span class="label">Fecha:</span> <span class="value">${fecha}</span></div>
  </div>
  ${pallet.items_descripcion ? `<div class="descripcion"><strong>Descripcion:</strong> ${pallet.items_descripcion}</div>` : ''}
  <div class="barcode-box">
    <div class="label">ESCANEAR PALLET</div>
    ${barcodeSVG}
    <div class="num">${codigo}</div>
  </div>
</body></html>`

  const win = window.open('', '_blank', 'width=800,height=600')
  if (win) {
    win.document.write(html)
    win.document.close()
    setTimeout(() => win.print(), 400)
  }
}
