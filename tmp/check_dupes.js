(async () => {
  const {token} = await (await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username:'elias',password:'admin123'})
  })).json()

  // Get all clients
  let page = 1
  let allClients = []
  while (true) {
    const r = await fetch(`http://localhost:3001/api/clientes?page=${page}&limit=100`, {headers: {'Authorization': 'Bearer ' + token}})
    const data = await r.json()
    allClients = allClients.concat(data.clientes || [])
    if (allClients.length >= (data.total || 0)) break
    page++
    if (page > 200) break
  }
  console.log('Total clientes:', allClients.length)

  // Find duplicates by CUIT
  const byCuit = {}
  for (const c of allClients) {
    if (!c.cuit || !c.cuit.trim()) continue
    const cuit = c.cuit.replace(/\D/g, '')
    if (!cuit) continue
    if (!byCuit[cuit]) byCuit[cuit] = []
    byCuit[cuit].push(c)
  }

  const dupes = Object.entries(byCuit).filter(([_, arr]) => arr.length > 1)
  console.log('CUITs duplicados:', dupes.length)

  for (const [cuit, arr] of dupes.slice(0, 10)) {
    console.log('\nCUIT:', cuit)
    for (const c of arr) {
      console.log('  id:', c.id?.substring(0, 8), '| codigo:', c.codigo, '| nombre:', c.razon_social, '| id_centum:', c.id_centum, '| activo:', c.activo)
    }
  }
})().catch(e => console.error(e.message))
