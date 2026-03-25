import React, { useRef } from 'react'

const ModalTarjetasRegalo = ({ tarjetas, onCerrar }) => {
  const printRef = useRef()

  function imprimirTarjetas() {
    const contenido = printRef.current
    if (!contenido) return
    const origin = window.location.origin
    const logoUrl = `${origin}/brand/Principal-LOGO.png`
    const leaf1Url = `${origin}/brand/Forma 703.png`
    const leaf2Url = `${origin}/brand/Forma 708.png`
    const flowerUrl = `${origin}/brand/Forma 710.png`
    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Tarjetas de Regalo - Za'atar</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Inter:wght@400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; background: #fff; padding: 0; margin: 0; }

  .tarjeta-wrapper {
    page-break-inside: avoid;
    margin-bottom: 8px;
  }

  .tarjeta {
    border: none;
    padding: 32px 40px 24px;
    position: relative;
    background: #edeae5;
    width: 100%;
    min-height: 280px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: stretch;
    overflow: hidden;
  }

  /* Inner border decorative */
  .tarjeta::before {
    content: '';
    position: absolute;
    top: 6px; left: 20px; right: 20px; bottom: 6px;
    border: 1px solid rgba(255, 176, 0, 0.25);
    pointer-events: none;
    z-index: 1;
  }

  /* Decorative leaf top-left */
  .leaf-tl {
    position: absolute;
    top: -8px;
    left: -8px;
    width: 80px;
    height: auto;
    opacity: 0.25;
    transform: rotate(15deg);
    pointer-events: none;
  }

  /* Decorative leaf bottom-right */
  .leaf-br {
    position: absolute;
    bottom: -8px;
    right: -8px;
    width: 80px;
    height: auto;
    opacity: 0.25;
    transform: rotate(-160deg);
    pointer-events: none;
  }

  /* Flower accent top-right */
  .flower-tr {
    position: absolute;
    top: 12px;
    right: 16px;
    width: 48px;
    height: auto;
    opacity: 0.2;
    pointer-events: none;
  }

  /* Flower accent bottom-left */
  .flower-bl {
    position: absolute;
    bottom: 12px;
    left: 16px;
    width: 48px;
    height: auto;
    opacity: 0.2;
    transform: rotate(180deg);
    pointer-events: none;
  }

  .logo-container {
    text-align: center;
    margin-bottom: 16px;
    position: relative;
    z-index: 2;
  }

  .logo-container img {
    height: 52px;
    width: auto;
  }

  .separador {
    text-align: center;
    color: #ffb000;
    font-size: 16px;
    letter-spacing: 8px;
    margin: 10px 0;
    position: relative;
    z-index: 2;
  }

  .separador-linea {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 12px 40px;
    position: relative;
    z-index: 2;
  }

  .separador-linea::before,
  .separador-linea::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, transparent, #ffb000, transparent);
  }

  .separador-linea span {
    color: #ffb000;
    font-size: 12px;
    letter-spacing: 4px;
  }

  .mensaje {
    font-family: 'Playfair Display', serif;
    font-style: italic;
    font-weight: 400;
    font-size: 24px;
    text-align: center;
    color: #101010;
    line-height: 1.6;
    padding: 16px 20px;
    min-height: 70px;
    word-wrap: break-word;
    position: relative;
    z-index: 2;
  }

  .quote-mark {
    font-family: 'Playfair Display', serif;
    font-size: 48px;
    color: #ffb000;
    opacity: 0.5;
    line-height: 1;
    display: inline-block;
  }

  .quote-open {
    vertical-align: top;
    margin-right: 4px;
  }

  .quote-close {
    vertical-align: bottom;
    margin-left: 4px;
  }

  .regalo-label {
    text-align: center;
    font-family: 'Inter', sans-serif;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 4px;
    color: #ffb000;
    margin-bottom: 6px;
    position: relative;
    z-index: 2;
  }

  .pedido-ref {
    text-align: right;
    font-size: 9px;
    color: #aaa;
    margin: 3px 0 16px;
    padding-right: 4px;
    font-style: italic;
  }

  .corte {
    border: none;
    border-top: 1.5px dashed #bbb;
    margin: 0;
  }

  @media print {
    body { padding: 0; margin: 0; }
    .tarjeta-wrapper { margin-bottom: 0; }
  }
</style>
</head>
<body>
${tarjetas.map(t => `
  <div class="tarjeta-wrapper">
    <hr class="corte">
    <div class="tarjeta">
      <img class="leaf-tl" src="${leaf1Url}" alt="">
      <img class="leaf-br" src="${leaf2Url}" alt="">
      <img class="flower-tr" src="${flowerUrl}" alt="">
      <img class="flower-bl" src="${flowerUrl}" alt="">

      <div class="logo-container">
        <img src="${logoUrl}" alt="Za'atar">
      </div>

      <div class="regalo-label">Tarjeta de regalo</div>

      <div class="separador-linea">
        <span>&#10043; &#10043; &#10043;</span>
      </div>

      <div class="mensaje">
        <span class="quote-mark quote-open">&ldquo;</span>${t.mensaje.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}<span class="quote-mark quote-close">&rdquo;</span>
      </div>

      <div class="separador-linea">
        <span>&#10043; &#10043; &#10043;</span>
      </div>
    </div>
    <hr class="corte">
    <div class="pedido-ref">Pedido #${t.numero} &mdash; ${t.cliente}</div>
  </div>
`).join('')}
</body>
</html>`)
    win.document.close()
    setTimeout(() => { win.print() }, 600)
  }

  if (!tarjetas || tarjetas.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onCerrar} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col z-10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#ffb000' }}>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" style={{ color: '#ffb000' }} fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            <h2 className="text-lg font-bold" style={{ color: '#101010' }}>Tarjetas de regalo para hoy</h2>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fff3d6', color: '#b87a00' }}>{tarjetas.length}</span>
          </div>
          <button onClick={onCerrar} className="p-2 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Lista de tarjetas */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" ref={printRef}>
          {tarjetas.map((t, i) => (
            <div key={t.id || i} className="border-2 border-dashed rounded-xl p-4" style={{ borderColor: '#ffb000', backgroundColor: '#faf8f4' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: '#b87a00', backgroundColor: '#fff3d6' }}>Pedido #{t.numero}</span>
                <span className="text-xs text-gray-400">{t.cliente}</span>
              </div>
              <p className="text-sm italic leading-relaxed" style={{ color: '#101010' }}>"{t.mensaje}"</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t rounded-b-2xl" style={{ backgroundColor: '#faf8f4', borderColor: '#ffb000' }}>
          <button
            onClick={imprimirTarjetas}
            className="w-full flex items-center justify-center gap-2 text-white text-sm font-semibold py-3 rounded-lg transition-colors hover:opacity-90"
            style={{ backgroundColor: '#ffb000' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.75 12h.008v.008h-.008V12zm-3 0h.008v.008h-.008V12z" />
            </svg>
            Imprimir todas las tarjetas
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalTarjetasRegalo
