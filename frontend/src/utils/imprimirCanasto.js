/**
 * Imprime etiquetas de canastos con código de barras Code 128
 * Cada canasto genera 1 página con 4 códigos iguales (para pegar en los 4 lados)
 * Pensado para impresora Zebra GK420t con etiquetas 100x150mm
 * @param {Array<{codigo: string}>} canastos - Array de canastos a imprimir
 */
export function imprimirCanastos(canastos) {
  if (!canastos || canastos.length === 0) return

  // Cada canasto = 1 página con 4 copias del mismo código
  const paginasHTML = canastos.map((c, cIdx) => {
    const filas = [0, 1, 2, 3].map(fIdx => `
      <div class="fila">
        <canvas id="bc-${cIdx}-${fIdx}"></canvas>
        <div class="codigo">${c.codigo}</div>
      </div>
    `).join('')
    return `<div class="pagina">${filas}</div>`
  }).join('')

  const barcodeScripts = canastos.map((c, cIdx) =>
    [0, 1, 2, 3].map(fIdx => `
      JsBarcode("#bc-${cIdx}-${fIdx}", "${c.codigo}", {
        format: "CODE128",
        width: 4,
        height: 100,
        displayValue: false,
        margin: 0,
      });
    `).join('')
  ).join('')

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Etiquetas Canastos</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>
  @page { size: 100mm 150mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { margin: 0; padding: 0; }
  .pagina {
    width: 100mm;
    height: 148mm;
    page-break-after: always;
    padding: 1mm 2mm;
  }
  .pagina:last-child { page-break-after: auto; }
  .fila {
    width: 96mm;
    height: 35mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 1px dashed #888;
    margin: 0 auto 1mm auto;
    padding: 1mm 2mm;
    overflow: hidden;
  }
  .fila canvas {
    max-width: 90mm;
    height: 22mm;
  }
  .codigo {
    font-family: 'Courier New', monospace;
    font-size: 12pt;
    font-weight: bold;
    margin-top: 1mm;
    letter-spacing: 2px;
    text-align: center;
  }
</style>
</head><body>
${paginasHTML}
<script>
  ${barcodeScripts}
  window.onload = function() { setTimeout(function() { window.print(); }, 400); };
<\/script>
</body></html>`

  const win = window.open('', '_blank', 'width=380,height=570')
  if (win) {
    win.document.write(html)
    win.document.close()
  }
}

/**
 * Imprime una sola etiqueta de canasto (4 copias del código para los 4 lados)
 */
export function imprimirCanasto(canasto) {
  imprimirCanastos([canasto])
}
