// MCP Tools — POS Favoritos y Bloqueos
module.exports = [
  {
    name: 'pos_listar_favoritos',
    description: 'Obtener artículos favoritos del POS',
    method: 'GET',
    path: '/api/pos/favoritos',
    params: {},
  },
  {
    name: 'pos_agregar_favorito',
    description: 'Agregar un artículo a favoritos',
    method: 'POST',
    path: '/api/pos/favoritos',
    params: {
      articulo_id: { type: 'string', description: 'ID del artículo', required: true },
    },
  },
  {
    name: 'pos_listar_bloqueos',
    description: 'Listar artículos bloqueados en el POS',
    method: 'GET',
    path: '/api/pos/bloqueos',
    params: {},
  },
  {
    name: 'pos_crear_bloqueo',
    description: 'Bloquear un artículo en el POS',
    method: 'POST',
    path: '/api/pos/bloqueos',
    params: {
      articulo_id: { type: 'string', description: 'ID del artículo a bloquear', required: true },
      motivo: { type: 'string', description: 'Motivo del bloqueo' },
    },
  },
  {
    name: 'pos_eliminar_bloqueo',
    description: 'Desbloquear un artículo',
    method: 'DELETE',
    path: '/api/pos/bloqueos/:id',
    params: {
      id: { type: 'string', description: 'ID del bloqueo', required: true },
    },
  },
]
