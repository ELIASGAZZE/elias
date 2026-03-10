const http = require('http')
const fs = require('fs')

async function main() {
  // Get token
  const loginRes = await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'elias', password: 'admin123' })
  })
  const { token } = await loginRes.json()

  // Get cierre detail for 7165
  const id = 'a9d09a07-a8f5-47bf-b0dc-91f0a8182212'
  const res = await fetch(`http://localhost:3001/api/cierres/${id}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const cierre = await res.json()

  console.log('apertura_siguiente:', JSON.stringify(cierre.apertura_siguiente))
  console.log('cambio_billetes:', JSON.stringify(cierre.cambio_billetes))
  console.log('estado:', cierre.estado)
  console.log('_blind:', cierre._blind)
}

main().catch(console.error)
