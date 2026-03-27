/**
 * Imprime etiqueta A4 para un pallet de traspaso
 */
export function imprimirPallet(pallet, orden) {
  const fecha = new Date().toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Pallet ${pallet.numero_pallet}</title>
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
  .numero-grande { text-align: center; margin-top: 50px; padding: 30px; border: 3px solid #333; border-radius: 12px; }
  .numero-grande .label { font-size: 14px; color: #666; margin-bottom: 10px; }
  .numero-grande .num { font-size: 48px; font-weight: bold; letter-spacing: 4px; font-family: monospace; }
</style>
</head><body>
  <div class="header">
    <h1>PALLET DE TRASPASO</h1>
    <div class="line"></div>
  </div>
  <div class="info">
    <div><span class="label">Numero:</span> <span class="value">${pallet.numero_pallet}</span></div>
    <div><span class="label">Orden:</span> <span class="value">${orden.numero || ''}</span></div>
    <div><span class="label">Origen:</span> <span class="value">${orden.sucursal_origen_nombre || ''}</span></div>
    <div><span class="label">Destino:</span> <span class="value">${orden.sucursal_destino_nombre || ''}</span></div>
    <div><span class="label">Cantidad de bultos:</span> <span class="value">${pallet.cantidad_bultos_origen}</span></div>
    <div><span class="label">Fecha:</span> <span class="value">${fecha}</span></div>
  </div>
  ${pallet.items_descripcion ? `<div class="descripcion"><strong>Descripcion:</strong> ${pallet.items_descripcion}</div>` : ''}
  <div class="numero-grande">
    <div class="label">NUMERO DE PALLET</div>
    <div class="num">${pallet.numero_pallet}</div>
  </div>
</body></html>`

  const win = window.open('', '_blank', 'width=800,height=600')
  if (win) {
    win.document.write(html)
    win.document.close()
    setTimeout(() => win.print(), 400)
  }
}
