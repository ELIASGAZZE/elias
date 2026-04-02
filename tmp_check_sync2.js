const fs = require('fs')
const raw = fs.readFileSync('C:/Users/Elias/.claude/projects/C--Users-Elias/69516fc2-8301-45df-ada9-98ce3fa697bf/tool-results/mcp-claude_ai_padano_srl-pos_listar_ventas-1774620940667.txt', 'utf8')
const parsed = JSON.parse(raw)
const text = parsed.find(p => p.type === 'text').text
const data = JSON.parse(text)
const ventas = data.ventas || data
const pendientes = ventas.filter(v => v.centum_sync !== true)
const conError = ventas.filter(v => v.centum_error)
console.log('Total:', ventas.length, 'Pendientes:', pendientes.length, 'Con error:', conError.length)
pendientes.slice(0, 5).forEach(v => console.log(' -', v.id, v.numero_venta, v.centum_error || 'sin error'))
