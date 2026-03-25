(async () => {
  const {token} = await (await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username:'elias',password:'admin123'})
  })).json()

  console.log('Disparando full scan de clientes faltantes...')
  const r = await fetch('http://localhost:3001/api/api-logs/sync/clientes-faltantes', {
    method: 'POST',
    headers: {'Authorization': 'Bearer ' + token}
  })
  const data = await r.json()
  console.log('Resultado:', JSON.stringify(data, null, 2))
})().catch(e => console.error(e.message))
