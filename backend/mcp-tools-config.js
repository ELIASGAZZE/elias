// ─────────────────────────────────────────────────────────────────────────────
// MCP Tools Config — POS Padano
// ─────────────────────────────────────────────────────────────────────────────
// Para agregar un nuevo tool:
//   1. Agregá un objeto al array del módulo correspondiente en mcp-tools/
//   2. Reiniciá el MCP server
//
// Estructura de cada tool:
//   name:        nombre único del tool (snake_case, prefijo = módulo)
//   description: qué hace (esto lo ve Claude)
//   method:      GET | POST | PUT | DELETE | PATCH
//   path:        ruta de la API (usa :param para path params)
//   params:      { paramName: { type, description, required?, enum? } }
//   queryParams: ['param1', 'param2']  — cuáles van en query string
//   noAuth:      true si no requiere autenticación
// ─────────────────────────────────────────────────────────────────────────────

module.exports = require('./mcp-tools')
