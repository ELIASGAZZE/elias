require('dotenv').config()
const { generateAccessToken } = require('./src/services/syncERP')
const BASE_URL = 'https://plataforma5.centum.com.ar:23990/BL7'
const API_KEY = '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb'

async function test() {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'CentumSuiteConsumidorApiPublicaId': '2',
    'CentumSuiteAccessToken': generateAccessToken(API_KEY),
  }
  const r = await fetch(BASE_URL + '/PromocionesComerciales/FiltrosPromocionComercial', {
    method: 'POST', headers, body: JSON.stringify({})
  })
  const data = await r.json()
  console.log('Total items en array:', data.length)

  // Agrupar por IdPromocionComercial (viene repetido)
  const unique = {}
  data.forEach(p => {
    if (!unique[p.IdPromocionComercial]) {
      unique[p.IdPromocionComercial] = { ...p, _count: 0 }
    }
    unique[p.IdPromocionComercial]._count++
  })

  Object.values(unique).forEach(p => {
    console.log('\n--- Promo ID:', p.IdPromocionComercial, '---')
    console.log('  Nombre:', p.Nombre)
    console.log('  Activo:', p.Activo)
    console.log('  Desde:', p.FechaPromocionDesde?.split('T')[0], '| Hasta:', p.FechaPromocionHasta?.split('T')[0])
    console.log('  TotalComprobanteSupera:', p.TotalComprobanteSupera)
    console.log('  DiasSemana:', p.DiasSemana || '(todos)')
    console.log('  Repetida', p._count, 'veces en el array')
    console.log('  Resultados:')
    ;(p.PromocionComercialResultados || []).forEach(r => {
      console.log('    TipoEntidad:', r.TipoEntidad, '| IdEntidad:', r.IdEntidad,
        '| Unidades:', r.Unidades, '| Descuento:', r.Descuento + '%',
        '| EsSinCargo:', r.EsSinCargo, '| CantidadAplica:', r.CantidadAplica)
    })
  })
}
test().catch(console.error)
