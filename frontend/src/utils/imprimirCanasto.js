/**
 * Imprime etiquetas de canastos con código de barras Code 128
 * Formato: etiqueta térmica ~50x30mm
 * @param {Array<{codigo: string}>} canastos - Array de canastos a imprimir
 */
export function imprimirCanastos(canastos) {
  if (!canastos || canastos.length === 0) return

  const etiquetas = canastos.map(c => `
    <div class="etiqueta">
      <svg id="bc-${c.codigo}"></svg>
      <div class="codigo">${c.codigo}</div>
    </div>
  `).join('')

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Etiquetas Canastos</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
<style>
  @page { size: 50mm 30mm; margin: 2mm; }
  body { margin: 0; padding: 0; }
  .etiqueta {
    width: 46mm;
    height: 26mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    page-break-after: always;
    padding: 1mm;
  }
  .etiqueta:last-child { page-break-after: auto; }
  .etiqueta svg { width: 40mm; height: 16mm; }
  .codigo {
    font-family: monospace;
    font-size: 14px;
    font-weight: bold;
    margin-top: 1mm;
    letter-spacing: 2px;
  }
</style>
</head><body>
${etiquetas}
<script>
  ${canastos.map(c => `
    JsBarcode("#bc-${c.codigo}", "${c.codigo}", {
      format: "CODE128",
      width: 2,
      height: 50,
      displayValue: false,
      margin: 0,
    });
  `).join('')}
  window.onload = function() { setTimeout(function() { window.print(); }, 300); };
<\/script>
</body></html>`

  const win = window.open('', '_blank', 'width=400,height=300')
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
