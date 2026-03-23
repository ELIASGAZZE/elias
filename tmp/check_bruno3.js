(async () => {
  const {token} = await (await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username:'elias',password:'admin123'})
  })).json()

  // Get ALL tareas configs named Fraccionados with their sucursales
  const configs = await (await fetch('http://localhost:3001/api/tareas/configuracion', {headers: {'Authorization': 'Bearer ' + token}})).json()

  const fraccionados = configs.filter(c => c.tarea?.nombre?.includes('Fraccionado') || c.nombre?.includes('Fraccionado'))
  console.log('Configs de Fraccionados:', fraccionados.length)
  for (const f of fraccionados) {
    console.log('  config_id:', f.id, '| sucursal:', f.sucursal?.nombre || f.sucursal_id)
  }
})().catch(e => console.error(e.message))
