/**
 * Imprime etiquetas de canastos con código de barras Code 128
 * Formato: etiqueta 100x150mm, 4 códigos por etiqueta (cada uno ~100x35mm)
 * Se imprimen de a 4 y se cortan con tijera
 * @param {Array<{codigo: string}>} canastos - Array de canastos a imprimir
 */
export function imprimirCanastos(canastos) {
  if (!canastos || canastos.length === 0) return

  // Agrupar de a 4 canastos por etiqueta
  const paginas = []
  for (let i = 0; i < canastos.length; i += 4) {
    paginas.push(canastos.slice(i, i + 4))
  }

  const paginasHTML = paginas.map((grupo, pIdx) => {
    const filas = grupo.map((c, fIdx) => `
      <div class="fila">
        <svg id="bc-${pIdx}-${fIdx}"></svg>
        <div class="codigo">${c.codigo}</div>
      </div>
    `).join('')
    return `<div class="pagina">${filas}</div>`
  }).join('')

  const barcodeScripts = paginas.map((grupo, pIdx) =>
    grupo.map((c, fIdx) => `
      JsBarcode("#bc-${pIdx}-${fIdx}", "${c.codigo}", {
        format: "CODE128",
        width: 2,
        height: 50,
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
  body { margin: 0; padding: 0; }
  .pagina {
    width: 100mm;
    height: 150mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    page-break-after: always;
    padding: 2mm 0;
    box-sizing: border-box;
  }
  .pagina:last-child { page-break-after: auto; }
  .fila {
    width: 96mm;
    height: 35mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 1px dashed #999;
    box-sizing: border-box;
    padding: 2mm 0;
    margin-bottom: 1mm;
  }
  .fila:last-child { margin-bottom: 0; }
  .fila svg { width: 80mm; height: 20mm; }
  .codigo {
    font-family: monospace;
    font-size: 16px;
    font-weight: bold;
    margin-top: 1mm;
    letter-spacing: 2px;
  }
</style>
</head><body>
${paginasHTML}
<script>
  ${barcodeScripts}
  window.onload = function() { setTimeout(function() { window.print(); }, 300); };
<\/script>
</body></html>`

  const win = window.open('', '_blank', 'width=400,height=600')
  if (win) {
    win.document.write(html)
    win.document.close()
  }
}

/**
 * Imprime una sola etiqueta de canasto
 */
export function imprimirCanasto(canasto) {
  imprimirCanastos([canasto])
}
