async function main() {
  const loginRes = await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'elias', password: 'admin123' })
  })
  const { token } = await loginRes.json()

  // Check both cierres
  const ids = [
    'c784d9b7-a7e5-4748-8c8c-e589cbb457ba', // planilla 7179
    'a9d09a07-a8f5-47bf-b0dc-91f0a8182212', // planilla 7165
  ]

  for (const id of ids) {
    const res = await fetch(`http://localhost:3001/api/cierres/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const c = await res.json()
    console.log('\n--- Planilla', c.planilla_id, '---')
    console.log('estado:', c.estado)
    console.log('fondo_fijo_billetes:', JSON.stringify(c.fondo_fijo_billetes))
    console.log('diferencias_apertura:', JSON.stringify(c.diferencias_apertura))
    console.log('cambio_billetes:', JSON.stringify(c.cambio_billetes))
    console.log('apertura_siguiente:', JSON.stringify(c.apertura_siguiente))
  }
}
main().catch(console.error)
