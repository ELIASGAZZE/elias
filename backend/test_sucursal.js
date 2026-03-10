require('dotenv').config()

const BASE = 'http://localhost:3001'
async function post(path, body, headers = {}) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { data: await r.json(), status: r.status }
}
async function get(path, headers = {}) {
  const r = await fetch(BASE + path, { headers })
  return { data: await r.json(), status: r.status }
}

;(async () => {
  // Login como operario Fisherton (centum_sucursal_id: 6084)
  const login = await post('/api/auth/login', { username: 'fisherton', password: 'fisherton123' })
  if (!login.data.token) { console.log('Login failed:', JSON.stringify(login.data)); return }
  const token = login.data.token
  const perfil = login.data.perfil || login.data.usuario
  const headers = { Authorization: 'Bearer ' + token }
  console.log('Logueado como:', perfil?.nombre, '- Sucursal:', perfil?.sucursal_id)

  // Buscar un cliente con id_centum
  const cliResp = await get('/api/clientes?limit=10', headers)
  const cliente = cliResp.data.clientes.find(c => c.id_centum)
  if (!cliente) { console.log('No hay clientes con id_centum'); return }
  console.log('Cliente:', cliente.razon_social, '(id_centum:', cliente.id_centum + ')')

  // Buscar artículos ERP (tienen id_centum)
  const artResp = await get('/api/articulos/erp?buscar=vino&limit=3', headers)
  const arts = artResp.data.articulos || artResp.data
  if (!arts || arts.length === 0) { console.log('No hay artículos ERP'); return }
  console.log('Artículo:', arts[0].nombre, '(id:', arts[0].id, 'id_centum:', arts[0].id_centum + ')')

  // Crear pedido delivery
  const resp = await post('/api/delivery', {
    cliente_id: cliente.id,
    items: [{ articulo_id: arts[0].id, cantidad: 2 }],
    direccion_entrega: 'Test sucursal Fisherton',
  }, headers)

  console.log('\nResultado:', JSON.stringify(resp.data, null, 2))
})().catch(e => console.error('Error:', e.message))
