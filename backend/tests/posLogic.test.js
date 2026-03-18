const {
  esFacturaA,
  clasificarDivision,
  clasificarVenta,
  precioNeto,
  precioParaCentum,
  calcularSubtotalYAjuste,
  importeConceptoNC,
  calcularDevolucion,
  filtrarArticulosERP,
  mapearArticuloERP,
  articuloCambio,
  safeParseJSON,
} = require('../src/utils/posLogic')

// ==========================================
// esFacturaA
// ==========================================
describe('esFacturaA', () => {
  test('RI es factura A', () => {
    expect(esFacturaA('RI')).toBe(true)
  })

  test('MT (Monotributo) es factura A', () => {
    expect(esFacturaA('MT')).toBe(true)
  })

  test('CF (Consumidor Final) NO es factura A', () => {
    expect(esFacturaA('CF')).toBe(false)
  })

  test('EX (Exento) NO es factura A', () => {
    expect(esFacturaA('EX')).toBe(false)
  })

  test('null/undefined NO es factura A', () => {
    expect(esFacturaA(null)).toBe(false)
    expect(esFacturaA(undefined)).toBe(false)
  })
})

// ==========================================
// clasificarDivision
// ==========================================
describe('clasificarDivision', () => {
  test('RI → siempre EMPRESA (3), sin importar forma de pago', () => {
    expect(clasificarDivision('RI', [])).toBe(3)
    expect(clasificarDivision('RI', [{ tipo: 'efectivo', monto: 100 }])).toBe(3)
    expect(clasificarDivision('RI', [{ tipo: 'Transferencia', monto: 100 }])).toBe(3)
  })

  test('MT → siempre EMPRESA (3)', () => {
    expect(clasificarDivision('MT', [{ tipo: 'efectivo', monto: 100 }])).toBe(3)
  })

  test('CF + solo efectivo → PRUEBA (2)', () => {
    expect(clasificarDivision('CF', [{ tipo: 'efectivo', monto: 100 }])).toBe(2)
  })

  test('CF + sin pagos → PRUEBA (2)', () => {
    expect(clasificarDivision('CF', [])).toBe(2)
    expect(clasificarDivision('CF', null)).toBe(2)
  })

  test('CF + saldo/gift_card/cuenta_corriente → PRUEBA (2)', () => {
    expect(clasificarDivision('CF', [{ tipo: 'Saldo', monto: 50 }])).toBe(2)
    expect(clasificarDivision('CF', [{ tipo: 'gift_card', monto: 50 }])).toBe(2)
    expect(clasificarDivision('CF', [{ tipo: 'cuenta_corriente', monto: 50 }])).toBe(2)
  })

  test('CF + transferencia → EMPRESA (3)', () => {
    expect(clasificarDivision('CF', [{ tipo: 'Transferencia', monto: 100 }])).toBe(3)
  })

  test('CF + efectivo + transferencia (mixto) → EMPRESA (3)', () => {
    expect(clasificarDivision('CF', [
      { tipo: 'efectivo', monto: 50 },
      { tipo: 'Transferencia', monto: 50 },
    ])).toBe(3)
  })

  test('CF + Posnet MP → EMPRESA (3)', () => {
    expect(clasificarDivision('CF', [{ tipo: 'Débito', monto: 100 }])).toBe(3)
  })
})

// ==========================================
// clasificarVenta (texto)
// ==========================================
describe('clasificarVenta', () => {
  test('devuelve EMPRESA o PRUEBA como texto', () => {
    expect(clasificarVenta('RI', [])).toBe('EMPRESA')
    expect(clasificarVenta('CF', [{ tipo: 'efectivo', monto: 100 }])).toBe('PRUEBA')
    expect(clasificarVenta('CF', [{ tipo: 'Transferencia', monto: 100 }])).toBe('EMPRESA')
  })
})

// ==========================================
// precioNeto
// ==========================================
describe('precioNeto', () => {
  test('quita IVA 21% correctamente', () => {
    // $121 con IVA 21% → $100 neto
    expect(precioNeto(121, 21)).toBe(100)
  })

  test('quita IVA 10.5%', () => {
    // $110.50 con IVA 10.5% → $100 neto
    expect(precioNeto(110.5, 10.5)).toBe(100)
  })

  test('IVA 0% devuelve el mismo precio', () => {
    expect(precioNeto(100, 0)).toBe(100)
  })

  test('redondea a 2 decimales', () => {
    // $1000 / 1.21 = 826.446... → 826.45
    expect(precioNeto(1000, 21)).toBe(826.45)
  })

  test('default IVA 21% si no se pasa', () => {
    expect(precioNeto(121)).toBe(100)
  })
})

// ==========================================
// precioParaCentum
// ==========================================
describe('precioParaCentum', () => {
  test('Factura A (RI): devuelve precio neto', () => {
    expect(precioParaCentum(121, 'RI', 21)).toBe(100)
  })

  test('Factura B (CF): devuelve precio con IVA', () => {
    expect(precioParaCentum(121, 'CF', 21)).toBe(121)
  })

  test('Factura A (MT): devuelve precio neto', () => {
    expect(precioParaCentum(242, 'MT', 21)).toBe(200)
  })
})

// ==========================================
// calcularSubtotalYAjuste
// ==========================================
describe('calcularSubtotalYAjuste', () => {
  const items2 = [
    { precio_unitario: 121, cantidad: 2, iva_tasa: 21 },
    { precio_unitario: 242, cantidad: 1, iva_tasa: 21 },
  ]

  test('Factura B sin descuento: subtotal = suma de precios', () => {
    // 121*2 + 242*1 = 484
    const result = calcularSubtotalYAjuste(items2, 484, 'CF')
    expect(result.subtotalArticulos).toBe(484)
    expect(result.importeValor).toBe(484)
    expect(result.factor).toBe(1)
  })

  test('Factura B con descuento forma pago: aplica factor proporcional', () => {
    // total 435.60 (10% off de 484)
    const result = calcularSubtotalYAjuste(items2, 435.60, 'CF')
    expect(result.factor).toBeCloseTo(435.60 / 484, 4)
    expect(result.importeValor).toBeCloseTo(435.60, 1)
  })

  test('Factura A: precios se convierten a neto', () => {
    const items = [{ precio_unitario: 121, cantidad: 1, iva_tasa: 21 }]
    // neto = 100, total POS = 121
    const result = calcularSubtotalYAjuste(items, 121, 'RI')
    expect(result.subtotalArticulos).toBe(100)
    expect(result.importeValor).toBe(121) // Factura A: importe = total POS
  })

  test('sin descuento, factor = 1', () => {
    const items = [{ precio_unitario: 100, cantidad: 1, iva_tasa: 21 }]
    const result = calcularSubtotalYAjuste(items, 100, 'CF')
    expect(result.factor).toBe(1)
  })
})

// ==========================================
// importeConceptoNC
// ==========================================
describe('importeConceptoNC', () => {
  test('Factura A: devuelve neto (sin IVA 21%)', () => {
    expect(importeConceptoNC(1210, 'RI')).toBe(1000)
  })

  test('Factura B: devuelve total tal cual', () => {
    expect(importeConceptoNC(1210, 'CF')).toBe(1210)
  })

  test('MT también es factura A', () => {
    expect(importeConceptoNC(121, 'MT')).toBe(100)
  })
})

// ==========================================
// calcularDevolucion
// ==========================================
describe('calcularDevolucion', () => {
  const itemsVenta = [
    { nombre: 'Pan', precio_unitario: 100, cantidad: 3 },
    { nombre: 'Leche', precio_unitario: 200, cantidad: 1 },
  ]

  test('devolución parcial calcula saldo proporcional', () => {
    // subtotal = 100*3 + 200*1 = 500, total con descuento = 450
    const devueltos = [{ indice: 0, cantidad: 1 }] // devolver 1 pan ($100)
    const result = calcularDevolucion(devueltos, itemsVenta, 500, 450)
    // proporción = 100/500 = 0.2, saldo = 0.2 * 450 = 90
    expect(result.subtotalDevuelto).toBe(100)
    expect(result.saldoAFavor).toBe(90)
    expect(result.factorDescuento).toBe(0.9) // 450/500
    expect(result.errores).toHaveLength(0)
  })

  test('devolución total', () => {
    const devueltos = [
      { indice: 0, cantidad: 3 },
      { indice: 1, cantidad: 1 },
    ]
    const result = calcularDevolucion(devueltos, itemsVenta, 500, 500)
    expect(result.subtotalDevuelto).toBe(500)
    expect(result.saldoAFavor).toBe(500)
    expect(result.factorDescuento).toBe(1)
  })

  test('subtotal venta inválido devuelve error', () => {
    const result = calcularDevolucion([{ indice: 0, cantidad: 1 }], itemsVenta, 0, 0)
    expect(result.errores).toContain('Subtotal de venta inválido')
    expect(result.saldoAFavor).toBe(0)
  })

  test('índice inexistente se ignora', () => {
    const result = calcularDevolucion([{ indice: 99, cantidad: 1 }], itemsVenta, 500, 450)
    expect(result.subtotalDevuelto).toBe(0)
    expect(result.saldoAFavor).toBe(0)
  })
})

// ==========================================
// filtrarArticulosERP
// ==========================================
describe('filtrarArticulosERP', () => {
  test('filtra deshabilitados', () => {
    const items = [
      { Nombre: 'Pan', Habilitado: true },
      { Nombre: 'Viejo', Habilitado: false },
    ]
    expect(filtrarArticulosERP(items)).toHaveLength(1)
    expect(filtrarArticulosERP(items)[0].Nombre).toBe('Pan')
  })

  test('filtra combos', () => {
    const items = [
      { Nombre: 'Pan', EsCombo: false },
      { Nombre: 'Combo Pack', EsCombo: true },
    ]
    expect(filtrarArticulosERP(items)).toHaveLength(1)
  })

  test('filtra por nombre que empieza con COMBO', () => {
    const items = [
      { NombreFantasia: 'COMBO navideño', Habilitado: true, EsCombo: false },
      { NombreFantasia: 'Queso combo', Habilitado: true, EsCombo: false }, // no empieza con COMBO
    ]
    expect(filtrarArticulosERP(items)).toHaveLength(1)
    expect(filtrarArticulosERP(items)[0].NombreFantasia).toBe('Queso combo')
  })

  test('mantiene artículos válidos', () => {
    const items = [
      { Nombre: 'Pan', Habilitado: true, EsCombo: false },
      { Nombre: 'Leche', Habilitado: true, EsCombo: false },
    ]
    expect(filtrarArticulosERP(items)).toHaveLength(2)
  })
})

// ==========================================
// mapearArticuloERP
// ==========================================
describe('mapearArticuloERP', () => {
  test('mapea campos correctamente', () => {
    const art = {
      Codigo: ' ABC123 ',
      NombreFantasia: 'Pan Lactal',
      Rubro: { Nombre: 'Panadería', IdRubro: 10 },
      SubRubro: { Nombre: 'Lacteados', IdSubRubro: 20 },
      MarcaArticulo: { Nombre: 'Bimbo' },
      EsPesable: true,
      IdArticulo: 555,
      Precio: 150.999,
      PorcentajeDescuento1: 5,
      PorcentajeDescuento2: 0,
      PorcentajeDescuento3: 0,
      CategoriaImpuestoIVA: { Tasa: 10.5 },
    }
    const mapped = mapearArticuloERP(art)
    expect(mapped.codigo).toBe('ABC123')
    expect(mapped.nombre).toBe('Pan Lactal')
    expect(mapped.rubro).toBe('Panadería')
    expect(mapped.subrubro).toBe('Lacteados')
    expect(mapped.marca).toBe('Bimbo')
    expect(mapped.es_pesable).toBe(true)
    expect(mapped.id_centum).toBe(555)
    expect(mapped.precio).toBe(151) // redondeado
    expect(mapped.descuento1).toBe(5)
    expect(mapped.iva_tasa).toBe(10.5)
    expect(mapped.tipo).toBe('automatico')
  })

  test('valores por defecto para campos faltantes', () => {
    const mapped = mapearArticuloERP({})
    expect(mapped.codigo).toBe('')
    expect(mapped.nombre).toBe('Sin nombre')
    expect(mapped.rubro).toBeNull()
    expect(mapped.es_pesable).toBe(false)
    expect(mapped.precio).toBeNull()
    expect(mapped.iva_tasa).toBe(21)
    expect(mapped.descuento1).toBe(0)
  })
})

// ==========================================
// articuloCambio
// ==========================================
describe('articuloCambio', () => {
  const base = { precio: 100, descuento1: 5, descuento2: 0, descuento3: 0, iva_tasa: 21, nombre: 'Pan' }

  test('sin cambios → false', () => {
    expect(articuloCambio(base, base)).toBe(false)
  })

  test('cambio de precio → true', () => {
    expect(articuloCambio({ ...base, precio: 101 }, base)).toBe(true)
  })

  test('cambio mínimo dentro de tolerancia → false', () => {
    expect(articuloCambio({ ...base, precio: 100.0005 }, base)).toBe(false)
  })

  test('cambio de nombre → true', () => {
    expect(articuloCambio({ ...base, nombre: 'Pan Lactal' }, base)).toBe(true)
  })

  test('cambio de IVA → true', () => {
    expect(articuloCambio({ ...base, iva_tasa: 10.5 }, base)).toBe(true)
  })

  test('cambio de descuento1 → true', () => {
    expect(articuloCambio({ ...base, descuento1: 10 }, base)).toBe(true)
  })
})

// ==========================================
// safeParseJSON
// ==========================================
describe('safeParseJSON', () => {
  test('parsea JSON válido', () => {
    expect(safeParseJSON('[1,2,3]')).toEqual([1, 2, 3])
  })

  test('JSON inválido devuelve fallback', () => {
    expect(safeParseJSON('{corrupto')).toEqual([])
    expect(safeParseJSON('{corrupto', null)).toBeNull()
  })

  test('null/undefined devuelve fallback', () => {
    expect(safeParseJSON(null)).toEqual([])
    expect(safeParseJSON(undefined)).toEqual([])
  })

  test('si ya es objeto, lo devuelve', () => {
    const obj = [1, 2, 3]
    expect(safeParseJSON(obj)).toBe(obj)
  })

  test('string vacío devuelve fallback', () => {
    expect(safeParseJSON('')).toEqual([])
  })
})
