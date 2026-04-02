// MCP Tools — Formas de Cobro
module.exports = [
  {
    name: 'formas_cobro_listar',
    description: 'Listar formas de cobro/pago disponibles',
    method: 'GET',
    path: '/api/formas-cobro',
    params: {},
  },
  {
    name: 'formas_cobro_crear',
    description: 'Crear una forma de cobro',
    method: 'POST',
    path: '/api/formas-cobro',
    params: {
      nombre: { type: 'string', description: 'Nombre (Efectivo, Débito, etc)', required: true },
      tipo: { type: 'string', description: 'Tipo de forma de cobro' },
    },
  },
]
