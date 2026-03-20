// ─────────────────────────────────────────────────────────────────────────────
// MCP Tools Config — POS Padano
// ─────────────────────────────────────────────────────────────────────────────
// Para agregar un nuevo tool:
//   1. Agregá un objeto al array del módulo correspondiente (o creá uno nuevo)
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

const tools = [

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'auth_me',
    description: 'Obtener información del usuario autenticado actual',
    method: 'GET',
    path: '/api/auth/me',
    params: {},
  },
  {
    name: 'auth_listar_usuarios',
    description: 'Listar todos los usuarios del sistema',
    method: 'GET',
    path: '/api/auth/usuarios',
    params: {},
  },
  {
    name: 'auth_crear_usuario',
    description: 'Crear un nuevo usuario del sistema',
    method: 'POST',
    path: '/api/auth/usuarios',
    params: {
      username: { type: 'string', description: 'Nombre de usuario', required: true },
      password: { type: 'string', description: 'Contraseña', required: true },
      nombre: { type: 'string', description: 'Nombre completo', required: true },
      rol: { type: 'string', description: 'Rol del usuario', enum: ['admin', 'cajero', 'gestor'] },
      sucursal_id: { type: 'string', description: 'ID de sucursal asignada' },
    },
  },
  {
    name: 'auth_editar_usuario',
    description: 'Editar un usuario existente',
    method: 'PUT',
    path: '/api/auth/usuarios/:id',
    params: {
      id: { type: 'string', description: 'ID del usuario', required: true },
      username: { type: 'string', description: 'Nombre de usuario' },
      password: { type: 'string', description: 'Nueva contraseña' },
      nombre: { type: 'string', description: 'Nombre completo' },
      rol: { type: 'string', description: 'Rol del usuario' },
      sucursal_id: { type: 'string', description: 'ID de sucursal' },
    },
  },
  {
    name: 'auth_eliminar_usuario',
    description: 'Eliminar un usuario del sistema',
    method: 'DELETE',
    path: '/api/auth/usuarios/:id',
    params: {
      id: { type: 'string', description: 'ID del usuario', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ARTICULOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'articulos_listar',
    description: 'Listar artículos del sistema con filtro opcional por sucursal',
    method: 'GET',
    path: '/api/articulos',
    params: {
      sucursal_id: { type: 'string', description: 'Filtrar por sucursal' },
      tipo: { type: 'string', description: 'Tipo de artículo' },
      ids: { type: 'string', description: 'IDs separados por coma' },
    },
    queryParams: ['sucursal_id', 'tipo', 'ids'],
  },
  {
    name: 'articulos_actualizaciones',
    description: 'Obtener artículos actualizados en una fecha específica',
    method: 'GET',
    path: '/api/articulos/actualizaciones',
    params: {
      fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD', required: true },
    },
    queryParams: ['fecha'],
  },
  {
    name: 'articulos_erp',
    description: 'Obtener artículos del ERP Centum con paginación y búsqueda',
    method: 'GET',
    path: '/api/articulos/erp',
    params: {
      page: { type: 'number', description: 'Número de página' },
      limit: { type: 'number', description: 'Artículos por página' },
      buscar: { type: 'string', description: 'Término de búsqueda' },
      ids: { type: 'string', description: 'IDs separados por coma' },
    },
    queryParams: ['page', 'limit', 'buscar', 'ids'],
  },
  {
    name: 'articulos_por_sucursal',
    description: 'Obtener artículos habilitados para una sucursal específica',
    method: 'GET',
    path: '/api/articulos/sucursal/:sucursalId',
    params: {
      sucursalId: { type: 'string', description: 'ID de la sucursal', required: true },
    },
  },
  {
    name: 'articulos_diagnostico_erp',
    description: 'Obtener información de diagnóstico de la conexión con ERP',
    method: 'GET',
    path: '/api/articulos/diagnostico-erp',
    params: {},
  },
  {
    name: 'articulos_sincronizar_erp',
    description: 'Sincronización completa de artículos desde Centum ERP',
    method: 'POST',
    path: '/api/articulos/sincronizar-erp',
    params: {},
  },
  {
    name: 'articulos_sincronizar_precios',
    description: 'Sincronización rápida solo de precios desde ERP',
    method: 'POST',
    path: '/api/articulos/sincronizar-precios',
    params: {},
  },
  {
    name: 'articulos_sincronizar_stock',
    description: 'Sincronizar stock de depósito desde ERP (proceso en background)',
    method: 'POST',
    path: '/api/articulos/sincronizar-stock',
    params: {},
  },
  {
    name: 'articulos_crear',
    description: 'Crear un artículo manual (no viene del ERP)',
    method: 'POST',
    path: '/api/articulos',
    params: {
      nombre: { type: 'string', description: 'Nombre del artículo', required: true },
      precio: { type: 'number', description: 'Precio del artículo', required: true },
      rubro_id: { type: 'string', description: 'ID del rubro' },
      codigo_barras: { type: 'string', description: 'Código de barras' },
    },
  },
  {
    name: 'articulos_editar',
    description: 'Editar nombre/rubro de un artículo manual',
    method: 'PUT',
    path: '/api/articulos/:id',
    params: {
      id: { type: 'string', description: 'ID del artículo', required: true },
      nombre: { type: 'string', description: 'Nuevo nombre' },
      rubro_id: { type: 'string', description: 'Nuevo rubro' },
    },
  },
  {
    name: 'articulos_toggle_sucursal',
    description: 'Habilitar/deshabilitar un artículo para una sucursal',
    method: 'PUT',
    path: '/api/articulos/:articuloId/sucursal/:sucursalId',
    params: {
      articuloId: { type: 'string', description: 'ID del artículo', required: true },
      sucursalId: { type: 'string', description: 'ID de la sucursal', required: true },
      habilitado: { type: 'boolean', description: 'true para habilitar, false para deshabilitar' },
    },
  },
  {
    name: 'articulos_set_stock_ideal',
    description: 'Establecer stock ideal de un artículo en una sucursal',
    method: 'PUT',
    path: '/api/articulos/:articuloId/sucursal/:sucursalId/stock-ideal',
    params: {
      articuloId: { type: 'string', description: 'ID del artículo', required: true },
      sucursalId: { type: 'string', description: 'ID de la sucursal', required: true },
      stock_ideal: { type: 'number', description: 'Cantidad de stock ideal', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENTES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'clientes_listar',
    description: 'Listar clientes con búsqueda y paginación',
    method: 'GET',
    path: '/api/clientes',
    params: {
      page: { type: 'number', description: 'Número de página' },
      limit: { type: 'number', description: 'Clientes por página' },
      buscar: { type: 'string', description: 'Buscar por nombre, CUIT o código' },
      solo_dni: { type: 'boolean', description: 'Buscar solo por DNI/CUIT' },
    },
    queryParams: ['page', 'limit', 'buscar', 'solo_dni'],
  },
  {
    name: 'clientes_detalle',
    description: 'Obtener detalle de un cliente por su ID',
    method: 'GET',
    path: '/api/clientes/:id',
    params: {
      id: { type: 'string', description: 'ID del cliente', required: true },
    },
  },
  {
    name: 'clientes_crear',
    description: 'Crear un nuevo cliente (se exporta automáticamente a Centum)',
    method: 'POST',
    path: '/api/clientes',
    params: {
      razon_social: { type: 'string', description: 'Razón social / nombre', required: true },
      cuit: { type: 'string', description: 'CUIT/DNI del cliente', required: true },
      condicion_iva: { type: 'string', description: 'Condición ante IVA', required: true, enum: ['CF', 'RI', 'MT', 'EX'] },
      direccion: { type: 'string', description: 'Dirección' },
      localidad: { type: 'string', description: 'Localidad' },
      codigo_postal: { type: 'string', description: 'Código postal' },
      provincia: { type: 'string', description: 'Provincia' },
      telefono: { type: 'string', description: 'Teléfono' },
      email: { type: 'string', description: 'Email' },
      celular: { type: 'string', description: 'Celular' },
      grupo_descuento_id: { type: 'string', description: 'ID del grupo de descuento' },
    },
  },
  {
    name: 'clientes_editar',
    description: 'Editar datos de un cliente',
    method: 'PUT',
    path: '/api/clientes/:id',
    params: {
      id: { type: 'string', description: 'ID del cliente', required: true },
      razon_social: { type: 'string', description: 'Razón social' },
      cuit: { type: 'string', description: 'CUIT/DNI' },
      condicion_iva: { type: 'string', description: 'Condición IVA' },
      direccion: { type: 'string', description: 'Dirección' },
      localidad: { type: 'string', description: 'Localidad' },
      telefono: { type: 'string', description: 'Teléfono' },
      email: { type: 'string', description: 'Email' },
      celular: { type: 'string', description: 'Celular' },
      grupo_descuento_id: { type: 'string', description: 'ID grupo descuento' },
    },
  },
  {
    name: 'clientes_editar_centum',
    description: 'Editar cliente y sincronizar cambios con Centum ERP',
    method: 'PUT',
    path: '/api/clientes/editar-centum/:idCentum',
    params: {
      idCentum: { type: 'string', description: 'ID del cliente en Centum', required: true },
      razon_social: { type: 'string', description: 'Razón social' },
      cuit: { type: 'string', description: 'CUIT/DNI' },
      condicion_iva: { type: 'string', description: 'Condición IVA' },
      direccion: { type: 'string', description: 'Dirección' },
      localidad: { type: 'string', description: 'Localidad' },
      codigo_postal: { type: 'string', description: 'CP' },
      telefono: { type: 'string', description: 'Teléfono' },
      email: { type: 'string', description: 'Email' },
      celular: { type: 'string', description: 'Celular' },
      grupo_descuento_id: { type: 'string', description: 'ID grupo descuento' },
    },
  },
  {
    name: 'clientes_actualizar_contacto',
    description: 'Actualizar email/celular de un cliente (solo local)',
    method: 'PUT',
    path: '/api/clientes/contacto/:idCentum',
    params: {
      idCentum: { type: 'string', description: 'ID del cliente en Centum', required: true },
      email: { type: 'string', description: 'Nuevo email' },
      celular: { type: 'string', description: 'Nuevo celular' },
    },
  },
  {
    name: 'clientes_buscar_afip',
    description: 'Buscar datos de un CUIT en AFIP/ARCA',
    method: 'GET',
    path: '/api/clientes/buscar-afip',
    params: {
      cuit: { type: 'string', description: 'CUIT a buscar', required: true },
    },
    queryParams: ['cuit'],
  },
  {
    name: 'clientes_buscar_centum',
    description: 'Buscar un cliente en Centum BI por CUIT',
    method: 'GET',
    path: '/api/clientes/buscar-centum',
    params: {
      cuit: { type: 'string', description: 'CUIT a buscar', required: true },
    },
    queryParams: ['cuit'],
  },
  {
    name: 'clientes_refresh',
    description: 'Refrescar datos de un cliente desde Centum BI',
    method: 'GET',
    path: '/api/clientes/refresh/:idCentum',
    params: {
      idCentum: { type: 'string', description: 'ID del cliente en Centum', required: true },
    },
  },
  {
    name: 'clientes_importar_centum',
    description: 'Importar un cliente existente de Centum al sistema local',
    method: 'POST',
    path: '/api/clientes/importar-centum',
    params: {
      id_centum: { type: 'number', description: 'ID del cliente en Centum', required: true },
      razon_social: { type: 'string', description: 'Razón social' },
      cuit: { type: 'string', description: 'CUIT' },
      direccion: { type: 'string', description: 'Dirección' },
      localidad: { type: 'string', description: 'Localidad' },
      telefono: { type: 'string', description: 'Teléfono' },
    },
  },
  {
    name: 'clientes_sincronizar_centum',
    description: 'Importar masivamente todos los clientes desde Centum',
    method: 'POST',
    path: '/api/clientes/sincronizar-centum',
    params: {},
  },
  {
    name: 'clientes_duplicados',
    description: 'Encontrar clientes duplicados (por id_centum o CUIT)',
    method: 'GET',
    path: '/api/clientes/duplicados',
    params: {},
  },
  {
    name: 'clientes_direcciones',
    description: 'Obtener direcciones de entrega de un cliente',
    method: 'GET',
    path: '/api/clientes/:id/direcciones',
    params: {
      id: { type: 'string', description: 'ID del cliente', required: true },
    },
  },
  {
    name: 'clientes_agregar_direccion',
    description: 'Agregar una dirección de entrega a un cliente',
    method: 'POST',
    path: '/api/clientes/:id/direcciones',
    params: {
      id: { type: 'string', description: 'ID del cliente', required: true },
      direccion: { type: 'string', description: 'Dirección completa', required: true },
      localidad: { type: 'string', description: 'Localidad' },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
  {
    name: 'clientes_exportar_centum',
    description: 'Exportar un cliente local a Centum ERP',
    method: 'POST',
    path: '/api/clientes/:id/exportar-centum',
    params: {
      id: { type: 'string', description: 'ID del cliente', required: true },
    },
  },
  {
    name: 'clientes_afip_status',
    description: 'Ver estado de la configuración AFIP',
    method: 'GET',
    path: '/api/clientes/afip-status',
    params: {},
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // POS — VENTAS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'pos_articulos',
    description: 'Obtener artículos disponibles en el POS con búsqueda opcional',
    method: 'GET',
    path: '/api/pos/articulos',
    params: {
      buscar: { type: 'string', description: 'Término de búsqueda' },
    },
    queryParams: ['buscar'],
  },
  {
    name: 'pos_rubros',
    description: 'Obtener rubros/categorías del POS',
    method: 'GET',
    path: '/api/pos/rubros',
    params: {},
  },
  {
    name: 'pos_subrubros',
    description: 'Obtener sub-rubros del POS',
    method: 'GET',
    path: '/api/pos/subrubros',
    params: {},
  },
  {
    name: 'pos_crear_venta',
    description: 'Crear una venta en el POS (genera factura en Centum y AFIP)',
    method: 'POST',
    path: '/api/pos/ventas',
    params: {
      id_cliente_centum: { type: 'number', description: 'ID del cliente en Centum', required: true },
      nombre_cliente: { type: 'string', description: 'Nombre del cliente' },
      items: { type: 'array', description: 'Array de items: [{id_articulo_centum, nombre, cantidad, precio_unitario, subtotal, es_pesable, rubro}]', required: true },
      subtotal: { type: 'number', description: 'Subtotal de la venta', required: true },
      descuento_total: { type: 'number', description: 'Descuento total aplicado' },
      total: { type: 'number', description: 'Total final de la venta', required: true },
      monto_pagado: { type: 'number', description: 'Monto pagado por el cliente', required: true },
      vuelto: { type: 'number', description: 'Vuelto a dar' },
      pagos: { type: 'array', description: 'Array de pagos: [{forma_cobro_id, nombre, monto}]', required: true },
      descuento_forma_pago: { type: 'number', description: 'Descuento por forma de pago' },
      promociones_aplicadas: { type: 'array', description: 'Promociones aplicadas' },
      pedido_pos_id: { type: 'string', description: 'ID del pedido POS si es cobro de pedido' },
      saldo_aplicado: { type: 'number', description: 'Saldo de cuenta corriente aplicado' },
      gift_cards_aplicadas: { type: 'array', description: 'Gift cards usadas' },
      gift_cards_a_activar: { type: 'array', description: 'Gift cards a activar' },
      caja_id: { type: 'string', description: 'ID de la caja' },
      canal: { type: 'string', description: 'Canal de venta' },
      descuento_grupo_cliente: { type: 'number', description: 'Descuento por grupo de cliente' },
      grupo_descuento_nombre: { type: 'string', description: 'Nombre del grupo de descuento' },
    },
  },
  {
    name: 'pos_listar_ventas',
    description: 'Listar ventas del POS con filtros opcionales',
    method: 'GET',
    path: '/api/pos/ventas',
    params: {
      numero_factura: { type: 'string', description: 'Buscar por número de factura' },
      buscar: { type: 'string', description: 'Buscar por nombre/CUIT del cliente' },
      fecha: { type: 'string', description: 'Filtrar por fecha (YYYY-MM-DD)' },
      sucursal_id: { type: 'string', description: 'Filtrar por sucursal' },
      cajero_id: { type: 'string', description: 'Filtrar por cajero' },
      articulo: { type: 'string', description: 'Buscar por nombre de artículo' },
      clasificacion: { type: 'string', description: 'Filtrar por clasificación (empresa/prueba)' },
    },
    queryParams: ['numero_factura', 'buscar', 'fecha', 'sucursal_id', 'cajero_id', 'articulo', 'clasificacion'],
  },
  {
    name: 'pos_detalle_venta',
    description: 'Obtener detalle completo de una venta por ID',
    method: 'GET',
    path: '/api/pos/ventas/:id',
    params: {
      id: { type: 'string', description: 'ID de la venta', required: true },
    },
  },
  {
    name: 'pos_cae_venta',
    description: 'Obtener el CAE (autorización AFIP) de una venta',
    method: 'GET',
    path: '/api/pos/ventas/:id/cae',
    params: {
      id: { type: 'string', description: 'ID de la venta', required: true },
    },
  },
  {
    name: 'pos_devoluciones_venta',
    description: 'Obtener notas de crédito/devoluciones de una venta',
    method: 'GET',
    path: '/api/pos/ventas/:id/devoluciones',
    params: {
      id: { type: 'string', description: 'ID de la venta', required: true },
    },
  },
  {
    name: 'pos_enviar_email_venta',
    description: 'Enviar comprobante de venta por email',
    method: 'POST',
    path: '/api/pos/ventas/:id/enviar-email',
    params: {
      id: { type: 'string', description: 'ID de la venta', required: true },
      email: { type: 'string', description: 'Email destino', required: true },
    },
  },
  {
    name: 'pos_eliminar_venta',
    description: 'Eliminar una venta (solo admin)',
    method: 'DELETE',
    path: '/api/pos/ventas/:id',
    params: {
      id: { type: 'string', description: 'ID de la venta', required: true },
    },
  },
  {
    name: 'pos_cambiar_cliente_venta',
    description: 'Cambiar el cliente asignado a una venta',
    method: 'PUT',
    path: '/api/pos/ventas/:id/cliente',
    params: {
      id: { type: 'string', description: 'ID de la venta', required: true },
      id_cliente_centum: { type: 'number', description: 'ID del nuevo cliente en Centum', required: true },
    },
  },
  {
    name: 'pos_reenviar_centum',
    description: 'Reenviar una venta a Centum ERP (si falló previamente)',
    method: 'POST',
    path: '/api/pos/ventas/:id/reenviar-centum',
    params: {
      id: { type: 'string', description: 'ID de la venta', required: true },
    },
  },
  {
    name: 'pos_reporte_promociones',
    description: 'Reporte de promociones aplicadas en ventas (por rango de fechas)',
    method: 'GET',
    path: '/api/pos/ventas/reportes/promociones',
    params: {
      desde: { type: 'string', description: 'Fecha desde (YYYY-MM-DD)' },
      hasta: { type: 'string', description: 'Fecha hasta (YYYY-MM-DD)' },
    },
    queryParams: ['desde', 'hasta'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // POS — DEVOLUCIONES / NOTAS DE CRÉDITO
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'pos_devolucion',
    description: 'Crear una devolución (nota de crédito por devolución de artículos)',
    method: 'POST',
    path: '/api/pos/devolucion',
    params: {
      venta_id: { type: 'string', description: 'ID de la venta original', required: true },
      items: { type: 'array', description: 'Items a devolver [{id_articulo_centum, nombre, cantidad, precio_unitario}]', required: true },
      motivo: { type: 'string', description: 'Motivo de la devolución', required: true },
      observaciones: { type: 'string', description: 'Observaciones adicionales' },
    },
  },
  {
    name: 'pos_correccion_cliente',
    description: 'Crear NC por corrección de cliente (cambio de cliente en factura)',
    method: 'POST',
    path: '/api/pos/correccion-cliente',
    params: {
      venta_id: { type: 'string', description: 'ID de la venta original', required: true },
      nuevo_cliente_id_centum: { type: 'number', description: 'ID del nuevo cliente en Centum', required: true },
      motivo: { type: 'string', description: 'Motivo de la corrección' },
    },
  },
  {
    name: 'pos_devolucion_precio',
    description: 'Crear NC por diferencia de precio',
    method: 'POST',
    path: '/api/pos/devolucion-precio',
    params: {
      venta_id: { type: 'string', description: 'ID de la venta original', required: true },
      items: { type: 'array', description: 'Items con diferencia [{id_articulo_centum, nombre, cantidad, precio_correcto, precio_original}]', required: true },
      motivo: { type: 'string', description: 'Motivo' },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // POS — PROMOCIONES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'pos_listar_promociones',
    description: 'Listar promociones del POS (activas por defecto)',
    method: 'GET',
    path: '/api/pos/promociones',
    params: {
      todas: { type: 'boolean', description: 'true para ver todas, incluso inactivas' },
    },
    queryParams: ['todas'],
  },
  {
    name: 'pos_crear_promocion',
    description: 'Crear una nueva promoción para el POS',
    method: 'POST',
    path: '/api/pos/promociones',
    params: {
      nombre: { type: 'string', description: 'Nombre de la promoción', required: true },
      tipo: { type: 'string', description: 'Tipo: NxM, porcentaje, monto_fijo, condicional', required: true },
      fecha_desde: { type: 'string', description: 'Fecha inicio (YYYY-MM-DD)' },
      fecha_hasta: { type: 'string', description: 'Fecha fin (YYYY-MM-DD)' },
      reglas: { type: 'object', description: 'Reglas de la promoción (depende del tipo)' },
    },
  },
  {
    name: 'pos_editar_promocion',
    description: 'Editar una promoción existente',
    method: 'PUT',
    path: '/api/pos/promociones/:id',
    params: {
      id: { type: 'string', description: 'ID de la promoción', required: true },
      nombre: { type: 'string', description: 'Nombre' },
      tipo: { type: 'string', description: 'Tipo' },
      activa: { type: 'boolean', description: 'Activar/desactivar' },
      fecha_desde: { type: 'string', description: 'Fecha inicio' },
      fecha_hasta: { type: 'string', description: 'Fecha fin' },
      reglas: { type: 'object', description: 'Reglas' },
    },
  },
  {
    name: 'pos_eliminar_promocion',
    description: 'Eliminar una promoción',
    method: 'DELETE',
    path: '/api/pos/promociones/:id',
    params: {
      id: { type: 'string', description: 'ID de la promoción', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // POS — PEDIDOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'pos_crear_pedido',
    description: 'Crear un pedido en el POS (delivery, retiro, etc)',
    method: 'POST',
    path: '/api/pos/pedidos',
    params: {
      id_cliente_centum: { type: 'number', description: 'ID del cliente en Centum', required: true },
      nombre_cliente: { type: 'string', description: 'Nombre del cliente' },
      items: { type: 'array', description: 'Items del pedido', required: true },
      total: { type: 'number', description: 'Total del pedido', required: true },
      observaciones: { type: 'string', description: 'Observaciones' },
      tipo: { type: 'string', description: 'Tipo: delivery, retiro, mostrador' },
      direccion_entrega: { type: 'string', description: 'Dirección de entrega' },
      sucursal_retiro: { type: 'string', description: 'Sucursal de retiro' },
      estado: { type: 'string', description: 'Estado inicial' },
      fecha_entrega: { type: 'string', description: 'Fecha de entrega' },
      total_pagado: { type: 'number', description: 'Monto ya pagado' },
      turno_entrega: { type: 'string', description: 'Turno de entrega' },
      sucursal_id: { type: 'string', description: 'ID sucursal' },
    },
  },
  {
    name: 'pos_listar_pedidos',
    description: 'Listar pedidos del POS con filtros',
    method: 'GET',
    path: '/api/pos/pedidos',
    params: {
      estado: { type: 'string', description: 'Filtrar por estado' },
      fecha: { type: 'string', description: 'Filtrar por fecha (YYYY-MM-DD)' },
      sucursal_id: { type: 'string', description: 'Filtrar por sucursal' },
      busqueda: { type: 'string', description: 'Buscar por DNI/CUIT' },
      tipo: { type: 'string', description: 'Filtrar por tipo' },
    },
    queryParams: ['estado', 'fecha', 'sucursal_id', 'busqueda', 'tipo'],
  },
  {
    name: 'pos_detalle_pedido',
    description: 'Obtener detalle de un pedido',
    method: 'GET',
    path: '/api/pos/pedidos/:id',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
    },
  },
  {
    name: 'pos_editar_pedido',
    description: 'Editar un pedido existente',
    method: 'PUT',
    path: '/api/pos/pedidos/:id',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
      items: { type: 'array', description: 'Nuevos items' },
      total: { type: 'number', description: 'Nuevo total' },
      observaciones: { type: 'string', description: 'Observaciones' },
      direccion_entrega: { type: 'string', description: 'Dirección' },
      fecha_entrega: { type: 'string', description: 'Fecha entrega' },
      turno_entrega: { type: 'string', description: 'Turno' },
    },
  },
  {
    name: 'pos_pagar_pedido',
    description: 'Registrar pago de un pedido',
    method: 'PUT',
    path: '/api/pos/pedidos/:id/pago',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
      pagos: { type: 'array', description: 'Array de pagos [{forma_cobro_id, nombre, monto}]', required: true },
      monto_pagado: { type: 'number', description: 'Monto total pagado', required: true },
    },
  },
  {
    name: 'pos_cambiar_estado_pedido',
    description: 'Cambiar estado de un pedido (pendiente, preparando, listo, entregado, cancelado)',
    method: 'PUT',
    path: '/api/pos/pedidos/:id/estado',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
      estado: { type: 'string', description: 'Nuevo estado', required: true },
    },
  },
  {
    name: 'pos_link_pago_pedido',
    description: 'Crear link de pago Mercado Pago para un pedido',
    method: 'POST',
    path: '/api/pos/pedidos/:id/link-pago',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
    },
  },
  {
    name: 'pos_articulos_por_dia',
    description: 'Obtener artículos de pedidos agrupados por día',
    method: 'GET',
    path: '/api/pos/pedidos/articulos-por-dia',
    params: {
      fecha: { type: 'string', description: 'Fecha (YYYY-MM-DD)' },
    },
    queryParams: ['fecha'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // POS — GUÍAS DELIVERY
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'pos_listar_guias_delivery',
    description: 'Listar guías de delivery',
    method: 'GET',
    path: '/api/pos/guias-delivery',
    params: {
      fecha: { type: 'string', description: 'Filtrar por fecha' },
      estado: { type: 'string', description: 'Filtrar por estado' },
    },
    queryParams: ['fecha', 'estado'],
  },
  {
    name: 'pos_detalle_guia_delivery',
    description: 'Obtener detalle de una guía de delivery',
    method: 'GET',
    path: '/api/pos/guias-delivery/:id',
    params: {
      id: { type: 'string', description: 'ID de la guía', required: true },
    },
  },
  {
    name: 'pos_despachar_guia',
    description: 'Crear/despachar una guía de delivery',
    method: 'POST',
    path: '/api/pos/guias-delivery/despachar',
    params: {
      fecha: { type: 'string', description: 'Fecha de despacho', required: true },
      turno: { type: 'string', description: 'Turno' },
      cadete_id: { type: 'string', description: 'ID del cadete', required: true },
      cadete_nombre: { type: 'string', description: 'Nombre del cadete' },
      cambio_entregado: { type: 'number', description: 'Cambio entregado al cadete' },
      caja_id: { type: 'string', description: 'ID de la caja' },
    },
  },
  {
    name: 'pos_cerrar_guia',
    description: 'Cerrar una guía de delivery al regreso del cadete',
    method: 'PUT',
    path: '/api/pos/guias-delivery/:id/cerrar',
    params: {
      id: { type: 'string', description: 'ID de la guía', required: true },
      efectivo_recibido: { type: 'number', description: 'Efectivo recibido del cadete' },
      observaciones: { type: 'string', description: 'Observaciones' },
      pedidos_no_entregados: { type: 'array', description: 'IDs de pedidos no entregados' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // POS — SALDOS CUENTA CORRIENTE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'pos_saldo_cliente',
    description: 'Obtener saldo de cuenta corriente de un cliente',
    method: 'GET',
    path: '/api/pos/saldo/:idClienteCentum',
    params: {
      idClienteCentum: { type: 'string', description: 'ID del cliente en Centum', required: true },
    },
  },
  {
    name: 'pos_listar_saldos',
    description: 'Listar saldos de cuenta corriente de todos los clientes',
    method: 'GET',
    path: '/api/pos/saldos',
    params: {},
  },
  {
    name: 'pos_buscar_saldo_cuit',
    description: 'Buscar saldo de cuenta corriente por CUIT',
    method: 'GET',
    path: '/api/pos/saldos/buscar-cuit',
    params: {
      cuit: { type: 'string', description: 'CUIT del cliente', required: true },
    },
    queryParams: ['cuit'],
  },
  {
    name: 'pos_ajuste_saldo',
    description: 'Ajustar saldo de cuenta corriente de un cliente (admin)',
    method: 'POST',
    path: '/api/pos/saldos/ajuste',
    params: {
      id_cliente_centum: { type: 'number', description: 'ID del cliente en Centum', required: true },
      monto: { type: 'number', description: 'Monto del ajuste (positivo o negativo)', required: true },
      motivo: { type: 'string', description: 'Motivo del ajuste', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // POS — FAVORITOS Y BLOQUEOS
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // CIERRES DE CAJA
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'cierres_listar',
    description: 'Listar cierres de caja con filtros',
    method: 'GET',
    path: '/api/cierres',
    params: {
      fecha: { type: 'string', description: 'Filtrar por fecha' },
      estado: { type: 'string', description: 'Filtrar por estado (abierta, cerrada)' },
      caja_id: { type: 'string', description: 'Filtrar por caja' },
    },
    queryParams: ['fecha', 'estado', 'caja_id'],
  },
  {
    name: 'cierres_detalle',
    description: 'Obtener detalle completo de un cierre de caja',
    method: 'GET',
    path: '/api/cierres/:id',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_abrir',
    description: 'Abrir un nuevo cierre de caja',
    method: 'POST',
    path: '/api/cierres/abrir',
    params: {
      caja_id: { type: 'string', description: 'ID de la caja', required: true },
      fondo_inicio: { type: 'number', description: 'Fondo de caja inicial' },
    },
  },
  {
    name: 'cierres_cerrar',
    description: 'Cerrar un cierre de caja',
    method: 'PUT',
    path: '/api/cierres/:id/cerrar',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
      conteo: { type: 'object', description: 'Conteo de efectivo por denominación' },
    },
  },
  {
    name: 'cierres_comprobantes',
    description: 'Obtener comprobantes/facturas de un cierre',
    method: 'GET',
    path: '/api/cierres/:id/comprobantes',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_verificacion',
    description: 'Obtener estado de verificación de un cierre',
    method: 'GET',
    path: '/api/cierres/:id/verificacion',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_verificar',
    description: 'Verificar/aprobar un cierre de caja (admin)',
    method: 'POST',
    path: '/api/cierres/:id/verificar',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
      aprobado: { type: 'boolean', description: 'true para aprobar' },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
  {
    name: 'cierres_analisis_ia',
    description: 'Obtener análisis de IA sobre un cierre de caja',
    method: 'GET',
    path: '/api/cierres/:id/analisis-ia',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_chat_ia',
    description: 'Chatear con IA sobre un cierre específico',
    method: 'POST',
    path: '/api/cierres/:id/chat-ia',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
      mensaje: { type: 'string', description: 'Mensaje/pregunta', required: true },
      historial: { type: 'array', description: 'Historial de chat previo' },
    },
  },
  {
    name: 'cierres_auditoria',
    description: 'Información de auditoría de un cierre',
    method: 'GET',
    path: '/api/cierres/:id/auditoria',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CIERRES POS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'cierres_pos_listar',
    description: 'Listar cierres de caja del POS',
    method: 'GET',
    path: '/api/cierres-pos',
    params: {
      fecha: { type: 'string', description: 'Filtrar por fecha' },
      estado: { type: 'string', description: 'Estado (abierta/cerrada)' },
      caja_id: { type: 'string', description: 'ID de la caja' },
    },
    queryParams: ['fecha', 'estado', 'caja_id'],
  },
  {
    name: 'cierres_pos_abierta',
    description: 'Obtener cierre POS abierto actualmente',
    method: 'GET',
    path: '/api/cierres-pos/abierta',
    params: {
      caja_id: { type: 'string', description: 'ID de la caja', required: true },
    },
    queryParams: ['caja_id'],
  },
  {
    name: 'cierres_pos_detalle',
    description: 'Detalle de un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:id',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_pos_ventas',
    description: 'Ventas incluidas en un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:id/pos-ventas',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_pos_abrir',
    description: 'Abrir un nuevo cierre POS',
    method: 'POST',
    path: '/api/cierres-pos/abrir',
    params: {
      caja_id: { type: 'string', description: 'ID de la caja', required: true },
      fondo_inicio: { type: 'number', description: 'Fondo de caja inicial' },
    },
  },
  {
    name: 'cierres_pos_cerrar',
    description: 'Cerrar un cierre POS',
    method: 'PUT',
    path: '/api/cierres-pos/:id/cerrar',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
      conteo: { type: 'object', description: 'Conteo de efectivo' },
    },
  },
  {
    name: 'cierres_pos_cancelaciones',
    description: 'Cancelaciones en un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:id/cancelaciones',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_pos_eliminaciones',
    description: 'Items eliminados en un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:id/eliminaciones',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_pos_cambios_precio',
    description: 'Cambios de precio registrados en un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:id/cambios-precio',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GASTOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'gastos_listar',
    description: 'Listar gastos de un cierre de caja',
    method: 'GET',
    path: '/api/cierres/:cierreId/gastos',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'gastos_crear',
    description: 'Registrar un gasto en un cierre de caja',
    method: 'POST',
    path: '/api/cierres/:cierreId/gastos',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre', required: true },
      concepto: { type: 'string', description: 'Concepto del gasto', required: true },
      monto: { type: 'number', description: 'Monto del gasto', required: true },
      tipo: { type: 'string', description: 'Tipo de gasto' },
    },
  },
  {
    name: 'gastos_controlar',
    description: 'Aprobar/controlar un gasto (admin)',
    method: 'PUT',
    path: '/api/gastos/:id/controlar',
    params: {
      id: { type: 'string', description: 'ID del gasto', required: true },
      controlado: { type: 'boolean', description: 'true para aprobar' },
    },
  },
  {
    name: 'gastos_pos_listar',
    description: 'Listar gastos de un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:cierreId/gastos',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre POS', required: true },
    },
  },
  {
    name: 'gastos_pos_crear',
    description: 'Registrar un gasto en un cierre POS',
    method: 'POST',
    path: '/api/cierres-pos/:cierreId/gastos',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre POS', required: true },
      concepto: { type: 'string', description: 'Concepto del gasto', required: true },
      monto: { type: 'number', description: 'Monto del gasto', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RETIROS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'retiros_listar',
    description: 'Listar retiros de un cierre de caja',
    method: 'GET',
    path: '/api/cierres/:cierreId/retiros',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'retiros_crear',
    description: 'Registrar un retiro de efectivo',
    method: 'POST',
    path: '/api/cierres/:cierreId/retiros',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre', required: true },
      monto: { type: 'number', description: 'Monto retirado', required: true },
      motivo: { type: 'string', description: 'Motivo del retiro' },
    },
  },
  {
    name: 'retiros_pos_listar',
    description: 'Listar retiros de un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:cierreId/retiros',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre POS', required: true },
    },
  },
  {
    name: 'retiros_pos_crear',
    description: 'Registrar un retiro en un cierre POS',
    method: 'POST',
    path: '/api/cierres-pos/:cierreId/retiros',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre POS', required: true },
      monto: { type: 'number', description: 'Monto retirado', required: true },
      motivo: { type: 'string', description: 'Motivo' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EMPLEADOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'empleados_listar',
    description: 'Listar empleados con filtros opcionales',
    method: 'GET',
    path: '/api/empleados',
    params: {
      sucursal_id: { type: 'string', description: 'Filtrar por sucursal' },
      todas: { type: 'boolean', description: 'Incluir inactivos' },
      empresa: { type: 'string', description: 'Filtrar por empresa' },
    },
    queryParams: ['sucursal_id', 'todas', 'empresa'],
  },
  {
    name: 'empleados_por_codigo',
    description: 'Obtener empleado por su código',
    method: 'GET',
    path: '/api/empleados/por-codigo/:codigo',
    params: {
      codigo: { type: 'string', description: 'Código del empleado', required: true },
    },
  },
  {
    name: 'empleados_crear',
    description: 'Crear un nuevo empleado',
    method: 'POST',
    path: '/api/empleados',
    params: {
      nombre: { type: 'string', description: 'Nombre completo', required: true },
      sucursal_id: { type: 'string', description: 'Sucursal asignada', required: true },
      codigo: { type: 'string', description: 'Código de empleado' },
      fecha_cumpleanos: { type: 'string', description: 'Fecha de cumpleaños (YYYY-MM-DD)' },
      empresa: { type: 'string', description: 'Empresa' },
    },
  },
  {
    name: 'empleados_editar',
    description: 'Editar un empleado',
    method: 'PUT',
    path: '/api/empleados/:id',
    params: {
      id: { type: 'string', description: 'ID del empleado', required: true },
      nombre: { type: 'string', description: 'Nombre' },
      sucursal_id: { type: 'string', description: 'Sucursal' },
      activo: { type: 'boolean', description: 'Activo/inactivo' },
      codigo: { type: 'string', description: 'Código' },
      fecha_cumpleanos: { type: 'string', description: 'Cumpleaños' },
      empresa: { type: 'string', description: 'Empresa' },
    },
  },
  {
    name: 'empleados_eliminar',
    description: 'Eliminar un empleado',
    method: 'DELETE',
    path: '/api/empleados/:id',
    params: {
      id: { type: 'string', description: 'ID del empleado', required: true },
    },
  },
  {
    name: 'empleados_set_pin',
    description: 'Establecer PIN de fichaje para un empleado',
    method: 'POST',
    path: '/api/empleados/:id/pin',
    params: {
      id: { type: 'string', description: 'ID del empleado', required: true },
      pin: { type: 'string', description: 'PIN numérico', required: true },
      temporal: { type: 'boolean', description: 'true si es PIN temporal' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FICHAJES (RELOJ)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'fichajes_listar',
    description: 'Listar fichajes/registros de asistencia con filtros',
    method: 'GET',
    path: '/api/fichajes',
    params: {
      empleado_id: { type: 'string', description: 'Filtrar por empleado' },
      sucursal_id: { type: 'string', description: 'Filtrar por sucursal' },
      fecha_desde: { type: 'string', description: 'Desde (YYYY-MM-DD)' },
      fecha_hasta: { type: 'string', description: 'Hasta (YYYY-MM-DD)' },
    },
    queryParams: ['empleado_id', 'sucursal_id', 'fecha_desde', 'fecha_hasta'],
  },
  {
    name: 'fichajes_estado',
    description: 'Ver si un empleado está fichado (entrada/salida)',
    method: 'GET',
    path: '/api/fichajes/estado/:empleadoId',
    params: {
      empleadoId: { type: 'string', description: 'ID del empleado', required: true },
    },
    noAuth: true,
  },
  {
    name: 'fichajes_ultimos',
    description: 'Obtener últimos fichajes (pantalla de reloj)',
    method: 'GET',
    path: '/api/fichajes/ultimos',
    params: {
      sucursal_id: { type: 'string', description: 'Sucursal' },
      limit: { type: 'number', description: 'Cantidad a mostrar' },
    },
    queryParams: ['sucursal_id', 'limit'],
    noAuth: true,
  },
  {
    name: 'fichajes_manual',
    description: 'Registrar fichaje manual (admin)',
    method: 'POST',
    path: '/api/fichajes/manual',
    params: {
      empleado_id: { type: 'string', description: 'ID del empleado', required: true },
      sucursal_id: { type: 'string', description: 'ID de la sucursal', required: true },
      tipo: { type: 'string', description: 'entrada o salida', required: true, enum: ['entrada', 'salida'] },
      fecha_hora: { type: 'string', description: 'Fecha y hora (ISO)' },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
  {
    name: 'fichajes_eliminar',
    description: 'Eliminar un fichaje (admin)',
    method: 'DELETE',
    path: '/api/fichajes/:id',
    params: {
      id: { type: 'string', description: 'ID del fichaje', required: true },
    },
  },
  {
    name: 'fichajes_dashboard',
    description: 'Dashboard de asistencia/fichajes (admin)',
    method: 'GET',
    path: '/api/fichajes/dashboard',
    params: {},
  },
  {
    name: 'fichajes_reporte',
    description: 'Reporte de fichajes/asistencia (admin)',
    method: 'GET',
    path: '/api/fichajes/reporte',
    params: {
      fecha_desde: { type: 'string', description: 'Desde' },
      fecha_hasta: { type: 'string', description: 'Hasta' },
      empleado_id: { type: 'string', description: 'Filtrar por empleado' },
    },
    queryParams: ['fecha_desde', 'fecha_hasta', 'empleado_id'],
  },
  {
    name: 'fichajes_autorizaciones',
    description: 'Listar autorizaciones de fichaje (admin)',
    method: 'GET',
    path: '/api/fichajes/autorizaciones',
    params: {},
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPRAS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'compras_dashboard',
    description: 'Dashboard del módulo de compras',
    method: 'GET',
    path: '/api/compras/dashboard',
    params: {},
  },
  {
    name: 'compras_listar_proveedores',
    description: 'Listar proveedores',
    method: 'GET',
    path: '/api/compras/proveedores',
    params: {},
  },
  {
    name: 'compras_detalle_proveedor',
    description: 'Detalle de un proveedor',
    method: 'GET',
    path: '/api/compras/proveedores/:id',
    params: {
      id: { type: 'string', description: 'ID del proveedor', required: true },
    },
  },
  {
    name: 'compras_crear_proveedor',
    description: 'Crear un nuevo proveedor',
    method: 'POST',
    path: '/api/compras/proveedores',
    params: {
      nombre: { type: 'string', description: 'Nombre del proveedor', required: true },
      cuit: { type: 'string', description: 'CUIT' },
      codigo: { type: 'string', description: 'Código interno' },
      lead_time_dias: { type: 'number', description: 'Lead time en días' },
      lead_time_variabilidad_dias: { type: 'number', description: 'Variabilidad del lead time' },
      dias_pedido: { type: 'array', description: 'Días en que se puede pedir [1-7]' },
      contacto: { type: 'string', description: 'Nombre de contacto' },
      telefono: { type: 'string', description: 'Teléfono' },
      email: { type: 'string', description: 'Email' },
      whatsapp: { type: 'string', description: 'WhatsApp' },
      monto_minimo: { type: 'number', description: 'Monto mínimo de pedido' },
      notas: { type: 'string', description: 'Notas' },
    },
  },
  {
    name: 'compras_editar_proveedor',
    description: 'Editar un proveedor',
    method: 'PUT',
    path: '/api/compras/proveedores/:id',
    params: {
      id: { type: 'string', description: 'ID del proveedor', required: true },
      nombre: { type: 'string', description: 'Nombre' },
      cuit: { type: 'string', description: 'CUIT' },
      codigo: { type: 'string', description: 'Código' },
      lead_time_dias: { type: 'number', description: 'Lead time' },
      dias_pedido: { type: 'array', description: 'Días de pedido' },
      contacto: { type: 'string', description: 'Contacto' },
      telefono: { type: 'string', description: 'Teléfono' },
      email: { type: 'string', description: 'Email' },
      whatsapp: { type: 'string', description: 'WhatsApp' },
      monto_minimo: { type: 'number', description: 'Monto mínimo' },
      notas: { type: 'string', description: 'Notas' },
      activo: { type: 'boolean', description: 'Activo/inactivo' },
    },
  },
  {
    name: 'compras_articulos_proveedor',
    description: 'Artículos asociados a un proveedor',
    method: 'GET',
    path: '/api/compras/proveedores/:id/articulos',
    params: {
      id: { type: 'string', description: 'ID del proveedor', required: true },
    },
  },
  {
    name: 'compras_vincular_articulo',
    description: 'Vincular un artículo a un proveedor',
    method: 'POST',
    path: '/api/compras/proveedores/:id/articulos',
    params: {
      id: { type: 'string', description: 'ID del proveedor', required: true },
      articulo_id: { type: 'string', description: 'ID del artículo', required: true },
      unidad_compra: { type: 'string', description: 'Unidad de compra' },
      factor_conversion: { type: 'number', description: 'Factor de conversión' },
      codigo_proveedor: { type: 'string', description: 'Código del proveedor para este artículo' },
      precio_compra: { type: 'number', description: 'Precio de compra' },
      es_principal: { type: 'boolean', description: 'Es proveedor principal de este artículo' },
    },
  },
  {
    name: 'compras_listar_ordenes',
    description: 'Listar órdenes de compra con filtros',
    method: 'GET',
    path: '/api/compras/ordenes',
    params: {
      estado: { type: 'string', description: 'Filtrar por estado' },
      proveedor_id: { type: 'string', description: 'Filtrar por proveedor' },
      desde: { type: 'string', description: 'Fecha desde' },
      hasta: { type: 'string', description: 'Fecha hasta' },
    },
    queryParams: ['estado', 'proveedor_id', 'desde', 'hasta'],
  },
  {
    name: 'compras_detalle_orden',
    description: 'Detalle de una orden de compra',
    method: 'GET',
    path: '/api/compras/ordenes/:id',
    params: {
      id: { type: 'string', description: 'ID de la orden', required: true },
    },
  },
  {
    name: 'compras_crear_orden',
    description: 'Crear una orden de compra',
    method: 'POST',
    path: '/api/compras/ordenes',
    params: {
      proveedor_id: { type: 'string', description: 'ID del proveedor', required: true },
      items: { type: 'array', description: 'Items [{articulo_id, cantidad, precio_unitario}]', required: true },
      notas: { type: 'string', description: 'Notas' },
      fecha_entrega_esperada: { type: 'string', description: 'Fecha entrega esperada' },
      metodo_envio: { type: 'string', description: 'Método de envío' },
    },
  },
  {
    name: 'compras_editar_orden',
    description: 'Editar una orden de compra',
    method: 'PUT',
    path: '/api/compras/ordenes/:id',
    params: {
      id: { type: 'string', description: 'ID de la orden', required: true },
      items: { type: 'array', description: 'Items actualizados' },
      notas: { type: 'string', description: 'Notas' },
      fecha_entrega_esperada: { type: 'string', description: 'Fecha entrega' },
      metodo_envio: { type: 'string', description: 'Método de envío' },
    },
  },
  {
    name: 'compras_enviar_orden',
    description: 'Enviar/confirmar una orden de compra al proveedor',
    method: 'PUT',
    path: '/api/compras/ordenes/:id/enviar',
    params: {
      id: { type: 'string', description: 'ID de la orden', required: true },
    },
  },
  {
    name: 'compras_cancelar_orden',
    description: 'Cancelar una orden de compra',
    method: 'DELETE',
    path: '/api/compras/ordenes/:id',
    params: {
      id: { type: 'string', description: 'ID de la orden', required: true },
    },
  },
  {
    name: 'compras_demanda',
    description: 'Análisis de demanda para un proveedor',
    method: 'GET',
    path: '/api/compras/demanda/:proveedorId',
    params: {
      proveedorId: { type: 'string', description: 'ID del proveedor', required: true },
    },
  },
  {
    name: 'compras_orden_sugerida',
    description: 'Generar orden de compra sugerida por IA',
    method: 'POST',
    path: '/api/compras/orden-sugerida/:proveedorId',
    params: {
      proveedorId: { type: 'string', description: 'ID del proveedor', required: true },
    },
  },
  {
    name: 'compras_chat',
    description: 'Chat con IA sobre el módulo de compras',
    method: 'POST',
    path: '/api/compras/chat',
    params: {
      mensaje: { type: 'string', description: 'Mensaje/pregunta', required: true },
      historial: { type: 'array', description: 'Historial previo' },
    },
  },
  {
    name: 'compras_consumo_interno',
    description: 'Ver registro de consumo interno',
    method: 'GET',
    path: '/api/compras/consumo-interno',
    params: {},
  },
  {
    name: 'compras_registrar_consumo',
    description: 'Registrar consumo interno de artículo',
    method: 'POST',
    path: '/api/compras/consumo-interno',
    params: {
      articulo_id: { type: 'string', description: 'ID del artículo', required: true },
      cantidad: { type: 'number', description: 'Cantidad consumida', required: true },
      motivo: { type: 'string', description: 'Motivo del consumo' },
    },
  },
  {
    name: 'compras_pedidos_extraordinarios',
    description: 'Listar pedidos extraordinarios',
    method: 'GET',
    path: '/api/compras/pedidos-extraordinarios',
    params: {},
  },
  {
    name: 'compras_crear_pedido_extraordinario',
    description: 'Crear pedido extraordinario',
    method: 'POST',
    path: '/api/compras/pedidos-extraordinarios',
    params: {
      articulo_id: { type: 'string', description: 'ID del artículo' },
      cantidad: { type: 'number', description: 'Cantidad' },
      motivo: { type: 'string', description: 'Motivo' },
      proveedor_id: { type: 'string', description: 'ID del proveedor' },
    },
  },
  {
    name: 'compras_promociones_proveedor',
    description: 'Ver promociones de un proveedor',
    method: 'GET',
    path: '/api/compras/proveedores/:id/promociones',
    params: {
      id: { type: 'string', description: 'ID del proveedor', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PEDIDOS INTERNOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'pedidos_listar',
    description: 'Listar pedidos internos (no POS) con filtros',
    method: 'GET',
    path: '/api/pedidos',
    params: {
      estado: { type: 'string', description: 'Filtrar por estado' },
      fecha: { type: 'string', description: 'Filtrar por fecha' },
      sucursal_id: { type: 'string', description: 'Filtrar por sucursal' },
    },
    queryParams: ['estado', 'fecha', 'sucursal_id'],
  },
  {
    name: 'pedidos_detalle',
    description: 'Detalle de un pedido interno',
    method: 'GET',
    path: '/api/pedidos/:id',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
    },
  },
  {
    name: 'pedidos_crear',
    description: 'Crear pedido interno',
    method: 'POST',
    path: '/api/pedidos',
    params: {
      items: { type: 'array', description: 'Items del pedido', required: true },
      sucursal_id: { type: 'string', description: 'Sucursal que pide' },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
  {
    name: 'pedidos_editar',
    description: 'Editar items de un pedido interno (admin)',
    method: 'PUT',
    path: '/api/pedidos/:id',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
      items: { type: 'array', description: 'Items actualizados' },
    },
  },
  {
    name: 'pedidos_cambiar_estado',
    description: 'Cambiar estado de un pedido interno (admin)',
    method: 'PUT',
    path: '/api/pedidos/:id/estado',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
      estado: { type: 'string', description: 'Nuevo estado', required: true },
    },
  },
  {
    name: 'pedidos_check_pendiente',
    description: 'Verificar si hay pedido pendiente para el usuario actual',
    method: 'GET',
    path: '/api/pedidos/check-pendiente',
    params: {},
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CAJAS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'cajas_listar',
    description: 'Listar cajas registradoras',
    method: 'GET',
    path: '/api/cajas',
    params: {},
  },
  {
    name: 'cajas_crear',
    description: 'Crear una caja registradora',
    method: 'POST',
    path: '/api/cajas',
    params: {
      nombre: { type: 'string', description: 'Nombre de la caja', required: true },
      sucursal_id: { type: 'string', description: 'Sucursal', required: true },
    },
  },
  {
    name: 'cajas_editar',
    description: 'Editar una caja',
    method: 'PUT',
    path: '/api/cajas/:id',
    params: {
      id: { type: 'string', description: 'ID de la caja', required: true },
      nombre: { type: 'string', description: 'Nombre' },
      sucursal_id: { type: 'string', description: 'Sucursal' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SUCURSALES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'sucursales_listar',
    description: 'Listar sucursales/locales',
    method: 'GET',
    path: '/api/sucursales',
    params: {},
  },
  {
    name: 'sucursales_crear',
    description: 'Crear una sucursal',
    method: 'POST',
    path: '/api/sucursales',
    params: {
      nombre: { type: 'string', description: 'Nombre de la sucursal', required: true },
      direccion: { type: 'string', description: 'Dirección' },
    },
  },
  {
    name: 'sucursales_editar',
    description: 'Editar una sucursal',
    method: 'PUT',
    path: '/api/sucursales/:id',
    params: {
      id: { type: 'string', description: 'ID de la sucursal', required: true },
      nombre: { type: 'string', description: 'Nombre' },
      direccion: { type: 'string', description: 'Dirección' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RUBROS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'rubros_listar',
    description: 'Listar rubros/categorías de artículos',
    method: 'GET',
    path: '/api/rubros',
    params: {},
  },
  {
    name: 'rubros_crear',
    description: 'Crear un rubro',
    method: 'POST',
    path: '/api/rubros',
    params: {
      nombre: { type: 'string', description: 'Nombre del rubro', required: true },
      color: { type: 'string', description: 'Color hex para el POS' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMAS DE COBRO
  // ═══════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════
  // DENOMINACIONES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'denominaciones_listar',
    description: 'Listar denominaciones de billetes/monedas',
    method: 'GET',
    path: '/api/denominaciones',
    params: {},
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GIFT CARDS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'giftcards_listar',
    description: 'Listar gift cards con filtros',
    method: 'GET',
    path: '/api/gift-cards',
    params: {
      estado: { type: 'string', description: 'Filtrar por estado (activa, usada, anulada)' },
      buscar: { type: 'string', description: 'Buscar por código' },
    },
    queryParams: ['estado', 'buscar'],
  },
  {
    name: 'giftcards_consultar',
    description: 'Consultar saldo de una gift card por código',
    method: 'GET',
    path: '/api/gift-cards/consultar/:codigo',
    params: {
      codigo: { type: 'string', description: 'Código de la gift card', required: true },
    },
  },
  {
    name: 'giftcards_activar',
    description: 'Activar una gift card nueva',
    method: 'POST',
    path: '/api/gift-cards/activar',
    params: {
      codigo: { type: 'string', description: 'Código de la gift card', required: true },
      monto: { type: 'number', description: 'Monto a cargar', required: true },
      comprador_nombre: { type: 'string', description: 'Nombre del comprador' },
      pagos: { type: 'array', description: 'Forma de pago' },
    },
  },
  {
    name: 'giftcards_anular',
    description: 'Anular una gift card',
    method: 'PUT',
    path: '/api/gift-cards/:id/anular',
    params: {
      id: { type: 'string', description: 'ID de la gift card', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MP POINT (MERCADO PAGO POSNET)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'mp_listar_dispositivos',
    description: 'Listar dispositivos Mercado Pago Point',
    method: 'GET',
    path: '/api/mp-point/devices',
    params: {},
  },
  {
    name: 'mp_crear_orden',
    description: 'Crear una orden de pago en el posnet MP Point',
    method: 'POST',
    path: '/api/mp-point/order',
    params: {
      device_id: { type: 'string', description: 'ID del dispositivo posnet', required: true },
      amount: { type: 'number', description: 'Monto a cobrar', required: true },
      external_reference: { type: 'string', description: 'Referencia externa' },
      description: { type: 'string', description: 'Descripción del cobro' },
      payment_type: { type: 'string', description: 'Tipo de pago' },
    },
  },
  {
    name: 'mp_estado_orden',
    description: 'Ver estado de una orden de pago MP',
    method: 'GET',
    path: '/api/mp-point/order/:id',
    params: {
      id: { type: 'string', description: 'ID de la orden', required: true },
    },
  },
  {
    name: 'mp_cancelar_orden',
    description: 'Cancelar una orden de pago MP',
    method: 'POST',
    path: '/api/mp-point/order/:id/cancel',
    params: {
      id: { type: 'string', description: 'ID de la orden', required: true },
    },
  },
  {
    name: 'mp_refund',
    description: 'Reembolsar un pago MP',
    method: 'POST',
    path: '/api/mp-point/order/:id/refund',
    params: {
      id: { type: 'string', description: 'ID de la orden', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TAREAS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'tareas_listar',
    description: 'Listar tareas/responsabilidades definidas',
    method: 'GET',
    path: '/api/tareas',
    params: {},
  },
  {
    name: 'tareas_crear',
    description: 'Crear una nueva tarea',
    method: 'POST',
    path: '/api/tareas',
    params: {
      nombre: { type: 'string', description: 'Nombre de la tarea', required: true },
      descripcion: { type: 'string', description: 'Descripción' },
      enlace_manual: { type: 'string', description: 'Link al manual/procedimiento' },
      subtareas: { type: 'array', description: 'Subtareas [{nombre, orden}]' },
    },
  },
  {
    name: 'tareas_editar',
    description: 'Editar una tarea',
    method: 'PUT',
    path: '/api/tareas/:id',
    params: {
      id: { type: 'string', description: 'ID de la tarea', required: true },
      nombre: { type: 'string', description: 'Nombre' },
      descripcion: { type: 'string', description: 'Descripción' },
      activo: { type: 'boolean', description: 'Activa/inactiva' },
    },
  },
  {
    name: 'tareas_panel_general',
    description: 'Panel general de tareas con estado de cumplimiento',
    method: 'GET',
    path: '/api/tareas/panel-general',
    params: {},
  },
  {
    name: 'tareas_pendientes',
    description: 'Tareas pendientes de ejecutar',
    method: 'GET',
    path: '/api/tareas/pendientes',
    params: {},
  },
  {
    name: 'tareas_ejecutar',
    description: 'Marcar una tarea como ejecutada',
    method: 'POST',
    path: '/api/tareas/ejecutar',
    params: {
      tarea_config_id: { type: 'string', description: 'ID de la config de tarea', required: true },
      subtareas_completadas: { type: 'array', description: 'Subtareas completadas' },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
  {
    name: 'tareas_ranking',
    description: 'Ranking de cumplimiento de tareas',
    method: 'GET',
    path: '/api/tareas/ranking',
    params: {},
  },
  {
    name: 'tareas_analytics_resumen',
    description: 'Resumen analítico de tareas',
    method: 'GET',
    path: '/api/tareas/analytics/resumen',
    params: {},
  },
  {
    name: 'tareas_analytics_por_empleado',
    description: 'Analytics de tareas por empleado',
    method: 'GET',
    path: '/api/tareas/analytics/por-empleado',
    params: {},
  },
  {
    name: 'tareas_analytics_incumplimiento',
    description: 'Reporte de incumplimiento de tareas',
    method: 'GET',
    path: '/api/tareas/analytics/incumplimiento',
    params: {},
  },
  {
    name: 'tareas_analytics_rendimiento',
    description: 'Rendimiento de empleado en tareas',
    method: 'GET',
    path: '/api/tareas/analytics/rendimiento-empleado',
    params: {
      empleado_id: { type: 'string', description: 'ID del empleado' },
    },
    queryParams: ['empleado_id'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CUENTA CORRIENTE EMPLEADOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'cuenta_empleados_saldos',
    description: 'Saldos de cuenta corriente de empleados',
    method: 'GET',
    path: '/api/cuenta-empleados/saldos',
    params: {},
  },
  {
    name: 'cuenta_empleados_movimientos',
    description: 'Movimientos de cuenta de un empleado',
    method: 'GET',
    path: '/api/cuenta-empleados/:empleadoId/movimientos',
    params: {
      empleadoId: { type: 'string', description: 'ID del empleado', required: true },
    },
  },
  {
    name: 'cuenta_empleados_descuentos',
    description: 'Listar descuentos/deducciones de empleados',
    method: 'GET',
    path: '/api/cuenta-empleados/descuentos',
    params: {},
  },
  {
    name: 'cuenta_empleados_crear_descuento',
    description: 'Crear un descuento a un empleado',
    method: 'POST',
    path: '/api/cuenta-empleados/descuentos',
    params: {
      empleado_id: { type: 'string', description: 'ID del empleado', required: true },
      monto: { type: 'number', description: 'Monto', required: true },
      concepto: { type: 'string', description: 'Concepto', required: true },
    },
  },
  {
    name: 'cuenta_empleados_registrar_pago',
    description: 'Registrar pago a un empleado',
    method: 'POST',
    path: '/api/cuenta-empleados/:empleadoId/pagos',
    params: {
      empleadoId: { type: 'string', description: 'ID del empleado', required: true },
      monto: { type: 'number', description: 'Monto del pago', required: true },
      concepto: { type: 'string', description: 'Concepto' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TURNOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'turnos_listar',
    description: 'Listar turnos de trabajo definidos',
    method: 'GET',
    path: '/api/turnos',
    params: {},
  },
  {
    name: 'turnos_crear',
    description: 'Crear un turno de trabajo',
    method: 'POST',
    path: '/api/turnos',
    params: {
      nombre: { type: 'string', description: 'Nombre del turno', required: true },
      hora_inicio: { type: 'string', description: 'Hora inicio (HH:mm)' },
      hora_fin: { type: 'string', description: 'Hora fin (HH:mm)' },
    },
  },
  {
    name: 'turnos_asignaciones',
    description: 'Listar asignaciones de turnos a empleados',
    method: 'GET',
    path: '/api/turnos/asignaciones',
    params: {},
  },
  {
    name: 'turnos_crear_asignacion',
    description: 'Asignar un turno a un empleado',
    method: 'POST',
    path: '/api/turnos/asignaciones',
    params: {
      empleado_id: { type: 'string', description: 'ID del empleado', required: true },
      turno_id: { type: 'string', description: 'ID del turno', required: true },
      dia_semana: { type: 'number', description: 'Día de la semana (1-7)' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LICENCIAS Y FERIADOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'licencias_listar',
    description: 'Listar licencias de empleados',
    method: 'GET',
    path: '/api/licencias',
    params: {},
  },
  {
    name: 'licencias_crear',
    description: 'Crear licencia para un empleado',
    method: 'POST',
    path: '/api/licencias',
    params: {
      empleado_id: { type: 'string', description: 'ID del empleado', required: true },
      tipo: { type: 'string', description: 'Tipo de licencia', required: true },
      fecha_desde: { type: 'string', description: 'Fecha inicio', required: true },
      fecha_hasta: { type: 'string', description: 'Fecha fin', required: true },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
  {
    name: 'feriados_listar',
    description: 'Listar feriados configurados',
    method: 'GET',
    path: '/api/feriados',
    params: {},
  },
  {
    name: 'feriados_crear',
    description: 'Crear un feriado',
    method: 'POST',
    path: '/api/feriados',
    params: {
      nombre: { type: 'string', description: 'Nombre del feriado', required: true },
      fecha: { type: 'string', description: 'Fecha (YYYY-MM-DD)', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GRUPOS DE DESCUENTO
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'grupos_descuento_listar',
    description: 'Listar grupos de descuento para clientes',
    method: 'GET',
    path: '/api/grupos-descuento',
    params: {},
  },
  {
    name: 'grupos_descuento_crear',
    description: 'Crear grupo de descuento',
    method: 'POST',
    path: '/api/grupos-descuento',
    params: {
      nombre: { type: 'string', description: 'Nombre del grupo', required: true },
      porcentaje: { type: 'number', description: 'Porcentaje de descuento', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDITORÍA
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'auditoria_dashboard',
    description: 'Dashboard de auditoría con KPIs, gráficos y métricas',
    method: 'GET',
    path: '/api/auditoria/dashboard',
    params: {
      fecha_desde: { type: 'string', description: 'Desde' },
      fecha_hasta: { type: 'string', description: 'Hasta' },
      cajero_id: { type: 'string', description: 'Filtrar por cajero' },
    },
    queryParams: ['fecha_desde', 'fecha_hasta', 'cajero_id'],
  },
  {
    name: 'auditoria_cancelacion',
    description: 'Registrar una cancelación de venta en auditoría',
    method: 'POST',
    path: '/api/auditoria/cancelacion',
    params: {
      venta_id: { type: 'string', description: 'ID de la venta' },
      motivo: { type: 'string', description: 'Motivo de cancelación', required: true },
      items: { type: 'array', description: 'Items cancelados' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CAJEROS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'cajeros_historial_auditoria',
    description: 'Historial de auditoría de un cajero',
    method: 'GET',
    path: '/api/cajeros/:empleadoId/historial-auditoria',
    params: {
      empleadoId: { type: 'string', description: 'ID del empleado/cajero', required: true },
    },
  },
  {
    name: 'cajeros_chat_ia',
    description: 'Chat con IA sobre el desempeño de un cajero',
    method: 'POST',
    path: '/api/cajeros/:empleadoId/chat-ia',
    params: {
      empleadoId: { type: 'string', description: 'ID del cajero', required: true },
      mensaje: { type: 'string', description: 'Pregunta/mensaje', required: true },
      historial: { type: 'array', description: 'Historial previo' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // REGLAS IA
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'reglas_ia_listar',
    description: 'Listar reglas de IA configuradas',
    method: 'GET',
    path: '/api/reglas-ia',
    params: {},
  },
  {
    name: 'reglas_ia_crear',
    description: 'Crear una regla de IA',
    method: 'POST',
    path: '/api/reglas-ia',
    params: {
      tipo: { type: 'string', description: 'Tipo de regla', required: true },
      descripcion: { type: 'string', description: 'Descripción de la regla', required: true },
      valor: { type: 'string', description: 'Valor/contenido de la regla' },
    },
  },
  {
    name: 'reglas_ia_eliminar',
    description: 'Eliminar una regla de IA',
    method: 'DELETE',
    path: '/api/reglas-ia/:id',
    params: {
      id: { type: 'string', description: 'ID de la regla', required: true },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLUCIONES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'resoluciones_listar',
    description: 'Listar resoluciones internas',
    method: 'GET',
    path: '/api/resoluciones',
    params: {},
  },
  {
    name: 'resoluciones_crear',
    description: 'Crear una resolución',
    method: 'POST',
    path: '/api/resoluciones',
    params: {
      titulo: { type: 'string', description: 'Título', required: true },
      contenido: { type: 'string', description: 'Contenido de la resolución', required: true },
    },
  },
  {
    name: 'resoluciones_estadisticas',
    description: 'Estadísticas de resoluciones',
    method: 'GET',
    path: '/api/resoluciones/estadisticas',
    params: {},
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // API LOGS & HEALTH
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'api_logs',
    description: 'Ver logs de llamadas a APIs externas (Centum, AFIP, etc)',
    method: 'GET',
    path: '/api/api-logs',
    params: {},
  },
  {
    name: 'api_health',
    description: 'Estado de salud de las APIs externas',
    method: 'GET',
    path: '/api/api-logs/health',
    params: {},
  },
  {
    name: 'api_errores_recientes',
    description: 'Errores recientes en llamadas a APIs',
    method: 'GET',
    path: '/api/api-logs/errores-recientes',
    params: {},
  },
  {
    name: 'health',
    description: 'Health check del servidor backend',
    method: 'GET',
    path: '/health',
    params: {},
    noAuth: true,
  },
]

module.exports = tools
