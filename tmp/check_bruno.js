(async () => {
  const {token} = await (await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username:'elias',password:'admin123'})
  })).json()

  const emps = await (await fetch('http://localhost:3001/api/empleados', {headers: {'Authorization': 'Bearer ' + token}})).json()
  const bruno = emps.find(e => e.nombre.toLowerCase().includes('bruno') || e.nombre.toLowerCase().includes('rossi'))
  if (!bruno) { console.log('Bruno no encontrado'); return }
  console.log('Bruno:', bruno.id, bruno.nombre)

  const rend = await (await fetch('http://localhost:3001/api/tareas/analytics/rendimiento-empleado?empleado_id=' + bruno.id, {headers: {'Authorization': 'Bearer ' + token}})).json()
  console.log('\nPor tarea:')
  for (const t of rend.por_tipo_tarea) {
    console.log('  ' + t.tarea + ': ' + t.cantidad + ' ejecuciones, calif: ' + (t.calificacion_promedio || '-'))
  }
  console.log('\nEvolucion diaria:')
  for (const d of rend.evolucion_diaria) {
    console.log('  ' + d.fecha + ': ' + d.completadas + ' tareas')
  }
})().catch(e => console.error(e.message))
