// MCP Tools — Cuenta Corriente Empleados
module.exports = [
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
]
