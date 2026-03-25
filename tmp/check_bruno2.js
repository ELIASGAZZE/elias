(async () => {
  const {token} = await (await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username:'elias',password:'admin123'})
  })).json()

  const emps = await (await fetch('http://localhost:3001/api/empleados', {headers: {'Authorization': 'Bearer ' + token}})).json()
  const bruno = emps.find(e => e.nombre.toLowerCase().includes('rossi'))
  console.log('Bruno:', bruno.nombre)

  const rend = await (await fetch('http://localhost:3001/api/tareas/analytics/rendimiento-empleado?empleado_id=' + bruno.id + '&desde=2026-03-01', {headers: {'Authorization': 'Bearer ' + token}})).json()
  console.log('KPIs:', JSON.stringify(rend.kpis))
  console.log('Por tarea:')
  for (const t of rend.por_tipo_tarea) {
    console.log('  ' + t.tarea + ': ' + t.cantidad)
  }

  // Also check ranking
  const ranking = await (await fetch('http://localhost:3001/api/tareas/analytics/por-empleado?desde=2026-03-01', {headers: {'Authorization': 'Bearer ' + token}})).json()
  const brunoRank = ranking.find(r => r.nombre.includes('Rossi'))
  console.log('\nRanking - Bruno:', brunoRank ? ('tareas:' + brunoRank.cantidad + ' score:' + brunoRank.score) : 'no encontrado')
})().catch(e => console.error(e.message))
