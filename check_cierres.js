const d = JSON.parse(require('fs').readFileSync('C:/Users/WINDOWS/Documents/elias/tmp_cierres.json','utf8'))
const closed = d.filter(x => x.estado !== 'abierta').slice(0,5)
closed.forEach(x => console.log(x.id, 'p:'+x.planilla_id, 'caja:'+x.caja_id, 'estado:'+x.estado, 'cambio_b:', JSON.stringify(x.cambio_billetes)))
