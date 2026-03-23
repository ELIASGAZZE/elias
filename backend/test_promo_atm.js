// Test EXHAUSTIVO: Todos los tipos de promo × todas las variantes × todas las combinaciones
// Copia EXACTA de la lógica de POS.jsx (incluye combo y condicional)

// === LÓGICA COPIADA DEL POS ===
function itemMatcheaRegla(item, aplicarA) {
  if (!aplicarA || aplicarA.length === 0) return true
  for (const regla of aplicarA) {
    if (regla.tipo === 'todos') return true
    if (regla.tipo === 'articulo' && item.articulo.id === regla.id) return true
    if (regla.tipo === 'rubro' && item.articulo.rubro?.id === regla.id) return true
    if (regla.tipo === 'subrubro' && item.articulo.subRubro?.id === regla.id) return true
    if (regla.tipo === 'atributo' && item.articulo.atributos?.some(a => a.id_valor === regla.id_valor)) return true
  }
  return false
}

function calcularPrecioConDescuentosBase(articulo) {
  let precio = articulo.precio || 0
  if (articulo.descuento1) precio *= (1 - articulo.descuento1 / 100)
  if (articulo.descuento2) precio *= (1 - articulo.descuento2 / 100)
  if (articulo.descuento3) precio *= (1 - articulo.descuento3 / 100)
  return precio
}

function promoEnRango(promo) {
  const hoy = new Date().toISOString().split('T')[0]
  if (promo.fecha_desde && hoy < promo.fecha_desde) return false
  if (promo.fecha_hasta && hoy > promo.fecha_hasta) return false
  return true
}

const formatPrecio = n => `$${n}`

function calcularPromocionesLocales(carrito, promociones) {
  const aplicadas = []
  for (const promo of promociones) {
    if (!promo.activa || !promoEnRango(promo)) continue
    const reglas = promo.reglas || {}
    switch (promo.tipo) {
      case 'porcentaje': {
        const itemsMatch = carrito.filter(i => itemMatcheaRegla(i, reglas.aplicar_a))
        if (itemsMatch.length === 0) break
        const cantidadTotal = itemsMatch.reduce((s, i) => s + i.cantidad, 0)
        const cantMin = reglas.cantidad_minima || 1
        if (cantidadTotal < cantMin) break
        const descuentoPorItem = {}
        const cantPorItem = {}
        let descuento = 0
        for (const i of itemsMatch) {
          const d = calcularPrecioConDescuentosBase(i.articulo) * i.cantidad * ((reglas.valor || 0) / 100)
          descuentoPorItem[i.articulo.id] = d
          cantPorItem[i.articulo.id] = i.cantidad
          descuento += d
        }
        aplicadas.push({ promoId: promo.id, promoNombre: promo.nombre, tipoPromo: 'porcentaje', detalle: `${reglas.valor}% off`, descuento, itemsAfectados: itemsMatch.map(i => i.articulo.id), descuentoPorItem, cantPorItem })
        break
      }
      case 'monto_fijo': {
        const itemsMatch = carrito.filter(i => itemMatcheaRegla(i, reglas.aplicar_a))
        if (itemsMatch.length === 0) break
        const cantidadTotal = itemsMatch.reduce((s, i) => s + i.cantidad, 0)
        const cantMin = reglas.cantidad_minima || 1
        if (cantidadTotal < cantMin) break
        const descuentoPorItem = {}
        const cantPorItem = {}
        let descuento = 0
        for (const i of itemsMatch) {
          const d = (reglas.valor || 0) * i.cantidad
          descuentoPorItem[i.articulo.id] = d
          cantPorItem[i.articulo.id] = i.cantidad
          descuento += d
        }
        aplicadas.push({ promoId: promo.id, promoNombre: promo.nombre, tipoPromo: 'monto_fijo', detalle: `${formatPrecio(reglas.valor)} off`, descuento, itemsAfectados: itemsMatch.map(i => i.articulo.id), descuentoPorItem, cantPorItem })
        break
      }
      case 'nxm': {
        const itemsMatch = carrito.filter(i => itemMatcheaRegla(i, reglas.aplicar_a))
        if (itemsMatch.length === 0) break
        const cantidadTotal = itemsMatch.reduce((s, i) => s + i.cantidad, 0)
        const llevar = reglas.llevar || 3
        const pagar = reglas.pagar || 2
        if (cantidadTotal < llevar) break
        const gruposNxM = Math.floor(cantidadTotal / llevar)
        const unidadesGratis = gruposNxM * (llevar - pagar)
        const precioDescuento = reglas.descuento_en === 'mas_caro'
          ? Math.max(...itemsMatch.map(i => calcularPrecioConDescuentosBase(i.articulo)))
          : Math.min(...itemsMatch.map(i => calcularPrecioConDescuentosBase(i.articulo)))
        const descuento = unidadesGratis * precioDescuento
        const descuentoPorItem = {}
        const cantPorItem = {}
        const subtotalNxM = itemsMatch.reduce((s, i) => s + calcularPrecioConDescuentosBase(i.articulo) * i.cantidad, 0)
        for (const i of itemsMatch) {
          const peso = (calcularPrecioConDescuentosBase(i.articulo) * i.cantidad) / subtotalNxM
          descuentoPorItem[i.articulo.id] = descuento * peso
          cantPorItem[i.articulo.id] = i.cantidad
        }
        aplicadas.push({ promoId: promo.id, promoNombre: promo.nombre, tipoPromo: 'nxm', detalle: `${llevar}x${pagar} (${unidadesGratis} gratis)`, descuento, itemsAfectados: itemsMatch.map(i => i.articulo.id), descuentoPorItem, cantPorItem })
        break
      }
      case 'combo': {
        const articulosCombo = reglas.articulos || []
        if (articulosCombo.length < 2) break
        let combosPosibles = Infinity
        let sumaPreciosIndividuales = 0
        const comboItems = []
        for (const artCombo of articulosCombo) {
          const enCarrito = carrito.find(i => i.articulo.id === artCombo.id)
          if (!enCarrito) { combosPosibles = 0; break }
          const cantRequerida = artCombo.cantidad || 1
          combosPosibles = Math.min(combosPosibles, Math.floor(enCarrito.cantidad / cantRequerida))
          const precioItem = calcularPrecioConDescuentosBase(enCarrito.articulo)
          sumaPreciosIndividuales += precioItem * cantRequerida
          comboItems.push({ id: artCombo.id, cant: cantRequerida, precio: precioItem })
        }
        if (combosPosibles <= 0 || !isFinite(combosPosibles)) break
        const precioCombo = reglas.precio_combo || 0
        const descuento = (sumaPreciosIndividuales - precioCombo) * combosPosibles
        if (descuento <= 0) break
        const descuentoPorItem = {}
        const cantPorItem = {}
        for (const ci of comboItems) {
          const peso = (ci.precio * ci.cant) / sumaPreciosIndividuales
          descuentoPorItem[ci.id] = descuento * peso
          cantPorItem[ci.id] = ci.cant * combosPosibles
        }
        aplicadas.push({ promoId: promo.id, promoNombre: promo.nombre, tipoPromo: 'combo', detalle: `Combo x${combosPosibles}`, descuento, itemsAfectados: articulosCombo.map(a => a.id), descuentoPorItem, cantPorItem })
        break
      }
      case 'condicional': {
        const grupos = reglas.grupos_condicion
          || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
          || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion, cantidad: reglas.cantidad_minima || 1 }]] : [])
        const listaBenef = reglas.articulos_beneficio || (reglas.articulo_beneficio ? [reglas.articulo_beneficio] : [])
        if (!grupos || grupos.length === 0 || listaBenef.length === 0) break
        let vecesPromo = 0
        let itemsCondicion = []
        for (const grupo of grupos) {
          if (!grupo || grupo.length === 0) continue
          const segmentos = []
          for (const cond of grupo) {
            if (cond.o) {
              const u = segmentos.length > 0 ? segmentos[segmentos.length - 1] : null
              if (u && u.tipo === 'or') u.items.push(cond)
              else segmentos.push({ tipo: 'or', items: [cond] })
            } else {
              segmentos.push({ tipo: 'and', items: [cond] })
            }
          }
          let veces = Infinity
          const itemsGrupo = []
          let cumple = true
          const findInCarrito = (cond) => carrito.find(i =>
            i.articulo.id === cond.id || (cond.codigo && String(i.articulo.codigo) === String(cond.codigo))
          )
          for (const seg of segmentos) {
            if (seg.tipo === 'and') {
              for (const cond of seg.items) {
                const ic = findInCarrito(cond)
                if (!ic) { cumple = false; break }
                const cantReq = cond.cantidad || 1
                if (ic.cantidad < cantReq) { cumple = false; break }
                veces = Math.min(veces, Math.floor(ic.cantidad / cantReq))
                itemsGrupo.push({ item: ic, cantReq })
              }
            } else {
              let totalOrUnits = 0
              const orMatches = []
              for (const cond of seg.items) {
                const ic = findInCarrito(cond)
                const cantReq = cond.cantidad || 1
                if (ic && ic.cantidad >= cantReq) {
                  totalOrUnits += Math.floor(ic.cantidad / cantReq)
                  orMatches.push({ item: ic, cantReq })
                }
              }
              if (totalOrUnits === 0) { cumple = false }
              else {
                veces = Math.min(veces, totalOrUnits)
                for (const m of orMatches) itemsGrupo.push({ item: m.item, cantReq: m.cantReq, isOr: true })
              }
            }
            if (!cumple) break
          }
          if (cumple && veces > 0) { vecesPromo = veces; itemsCondicion = itemsGrupo; break }
        }
        if (vecesPromo <= 0) break
        const descontados = new Set()
        const descuentoPorItem = {}
        const cantPorItem = {}
        let descuento = 0
        let orDescontados = 0
        for (const { item, cantReq, isOr } of itemsCondicion) {
          const enBenef = listaBenef.some(ab =>
            ab.id === item.articulo.id || (ab.codigo && String(item.articulo.codigo) === String(ab.codigo))
          )
          if (!enBenef) continue
          if (isOr) {
            const orDisp = vecesPromo - orDescontados
            if (orDisp <= 0) continue
            const cantDesc = Math.min(orDisp * cantReq, item.cantidad)
            const precio = calcularPrecioConDescuentosBase(item.articulo)
            const d = reglas.tipo_descuento === 'porcentaje'
              ? precio * cantDesc * ((reglas.valor || 0) / 100)
              : Math.min(reglas.valor || 0, precio) * cantDesc
            descuento += d
            descuentoPorItem[item.articulo.id] = (descuentoPorItem[item.articulo.id] || 0) + d
            cantPorItem[item.articulo.id] = (cantPorItem[item.articulo.id] || 0) + cantDesc
            orDescontados += Math.ceil(cantDesc / cantReq)
            descontados.add(item.articulo.id)
          } else {
            const cantDesc = Math.min(vecesPromo * cantReq, item.cantidad)
            const precio = calcularPrecioConDescuentosBase(item.articulo)
            const d = reglas.tipo_descuento === 'porcentaje'
              ? precio * cantDesc * ((reglas.valor || 0) / 100)
              : Math.min(reglas.valor || 0, precio) * cantDesc
            descuento += d
            descuentoPorItem[item.articulo.id] = (descuentoPorItem[item.articulo.id] || 0) + d
            cantPorItem[item.articulo.id] = (cantPorItem[item.articulo.id] || 0) + cantDesc
            descontados.add(item.articulo.id)
          }
        }
        const allCondIds = new Set()
        for (const grupo of grupos) {
          for (const c of grupo) { allCondIds.add(c.id); if (c.codigo) allCondIds.add(c.codigo) }
        }
        const findBenefInCarrito = (ab) => carrito.find(i =>
          i.articulo.id === ab.id || (ab.codigo && String(i.articulo.codigo) === String(ab.codigo))
        )
        for (const ab of listaBenef) {
          if (descontados.has(ab.id)) continue
          if (allCondIds.has(ab.id) || allCondIds.has(ab.codigo)) continue
          const found = findBenefInCarrito(ab)
          if (!found || descontados.has(found.articulo.id)) continue
          const cantBenef = Math.min(vecesPromo, found.cantidad)
          const precio = calcularPrecioConDescuentosBase(found.articulo)
          const d = reglas.tipo_descuento === 'porcentaje'
            ? precio * cantBenef * ((reglas.valor || 0) / 100)
            : Math.min(reglas.valor || 0, precio) * cantBenef
          descuento += d
          descuentoPorItem[found.articulo.id] = (descuentoPorItem[found.articulo.id] || 0) + d
          cantPorItem[found.articulo.id] = (cantPorItem[found.articulo.id] || 0) + cantBenef
          descontados.add(found.articulo.id)
        }
        if (descuento <= 0) break
        aplicadas.push({
          promoId: promo.id, promoNombre: promo.nombre, tipoPromo: 'condicional',
          detalle: `Cond x${vecesPromo}`, descuento,
          itemsAfectados: [...descontados], descuentoPorItem, cantPorItem,
        })
        break
      }
      case 'forma_pago': break
      default: break
    }
  }
  return aplicadas
}

// === DATOS DE PRUEBA ===
const ATTR_ATM = [{ id: 16, id_valor: 84, nombre: 'CLASIFICACION ESPECIAL', valor: 'ATM CAGNOLI' }]
const ATTR_ZAATAR = [{ id: 13, id_valor: 41, nombre: 'ZAATAR - UNIDAD DE REPOSICION', valor: 'UNIDAD' }]
const ATTR_PREMIUM = [{ id: 20, id_valor: 100, nombre: 'GAMA', valor: 'PREMIUM' }]

// Salamines ATM (rubro FIAMBRES, subrubro SALAMINES)
const salamines = [
  { id: 363, codigo: '00500', nombre: 'SALAMIN GRUESO ATM *145G', precio: 7449.73, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 5, nombre: 'FIAMBRES' }, subRubro: { id: 18, nombre: 'SALAMINES' }, atributos: [...ATTR_ATM, ...ATTR_ZAATAR] },
  { id: 6058, codigo: '06057', nombre: 'SALAMIN AHUMADO ATM *145G', precio: 7756.40, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 5, nombre: 'FIAMBRES' }, subRubro: { id: 18, nombre: 'SALAMINES' }, atributos: [...ATTR_ATM, ...ATTR_ZAATAR] },
  { id: 364, codigo: '00501', nombre: 'SALAMIN FINO ATM *145G', precio: 7449.73, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 5, nombre: 'FIAMBRES' }, subRubro: { id: 18, nombre: 'SALAMINES' }, atributos: [...ATTR_ATM, ...ATTR_ZAATAR] },
  { id: 6064, codigo: '06063', nombre: 'SALAMIN PICANTE ATM *145G', precio: 7756.40, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 5, nombre: 'FIAMBRES' }, subRubro: { id: 18, nombre: 'SALAMINES' }, atributos: [...ATTR_ATM, ...ATTR_ZAATAR] },
  { id: 7564, codigo: '07563', nombre: 'SALAMIN ESPECIADO ATM *145', precio: 7756.40, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 5, nombre: 'FIAMBRES' }, subRubro: { id: 18, nombre: 'SALAMINES' }, atributos: [...ATTR_ATM, ...ATTR_ZAATAR] },
]

// Artículo con descuentos base (para probar interacción descuento1/2/3)
const salaminConDescBase = { id: 9001, codigo: '09001', nombre: 'SALAMIN DESC BASE', precio: 10000, descuento1: 10, descuento2: 5, descuento3: 0, rubro: { id: 5, nombre: 'FIAMBRES' }, subRubro: { id: 18, nombre: 'SALAMINES' }, atributos: [...ATTR_ATM] }
// precio efectivo = 10000 * 0.9 * 0.95 = 8550

const queso = { id: 999, codigo: '99999', nombre: 'QUESO BARRA', precio: 5000, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 3, nombre: 'LACTEOS' }, subRubro: { id: 10, nombre: 'QUESOS' }, atributos: [...ATTR_ZAATAR] }
const cerveza = { id: 888, codigo: '88888', nombre: 'CERVEZA IPA', precio: 3000, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 8, nombre: 'BEBIDAS' }, subRubro: { id: 25, nombre: 'CERVEZAS' }, atributos: [] }
const pan = { id: 777, codigo: '77777', nombre: 'PAN LACTAL', precio: 2500, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 10, nombre: 'PANADERIA' }, subRubro: { id: 30, nombre: 'PANES' }, atributos: [...ATTR_PREMIUM] }
const jamon = { id: 555, codigo: '55555', nombre: 'JAMON COCIDO', precio: 12000, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 5, nombre: 'FIAMBRES' }, subRubro: { id: 19, nombre: 'JAMONES' }, atributos: [] }
const mortadela = { id: 556, codigo: '55556', nombre: 'MORTADELA', precio: 4000, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 5, nombre: 'FIAMBRES' }, subRubro: { id: 20, nombre: 'MORTADELAS' }, atributos: [...ATTR_PREMIUM] }
const artSinAttr = { id: 1000, codigo: '10000', nombre: 'ART SIN ATRIBUTOS', precio: 6000, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 99, nombre: 'OTROS' }, subRubro: { id: 99, nombre: 'OTROS' }, atributos: [] }
const artPesable = { id: 1001, codigo: '10001', nombre: 'QUESO PESABLE', precio: 15000, descuento1: 0, descuento2: 0, descuento3: 0, rubro: { id: 3, nombre: 'LACTEOS' }, subRubro: { id: 10, nombre: 'QUESOS' }, atributos: [...ATTR_PREMIUM], es_pesable: true }

// === TODAS LAS PROMOS ===
// NxM
const promoNxM_ATM_masBarato = { id: 'nxm1', nombre: 'ATM 3x2 barato', tipo: 'nxm', activa: true, reglas: { llevar: 3, pagar: 2, aplicar_a: [{ tipo: 'atributo', id_valor: 84 }], descuento_en: 'mas_barato' } }
const promoNxM_ATM_masCaro = { id: 'nxm2', nombre: 'ATM 3x2 caro', tipo: 'nxm', activa: true, reglas: { llevar: 3, pagar: 2, aplicar_a: [{ tipo: 'atributo', id_valor: 84 }], descuento_en: 'mas_caro' } }
const promoNxM_rubro = { id: 'nxm3', nombre: 'Fiambres 3x2', tipo: 'nxm', activa: true, reglas: { llevar: 3, pagar: 2, aplicar_a: [{ tipo: 'rubro', id: 5 }] } }
const promoNxM_subrubro = { id: 'nxm4', nombre: 'Salamines 2x1', tipo: 'nxm', activa: true, reglas: { llevar: 2, pagar: 1, aplicar_a: [{ tipo: 'subrubro', id: 18 }] } }
const promoNxM_articulo = { id: 'nxm5', nombre: 'GRUESO 2x1', tipo: 'nxm', activa: true, reglas: { llevar: 2, pagar: 1, aplicar_a: [{ tipo: 'articulo', id: 363 }] } }
const promoNxM_todos = { id: 'nxm6', nombre: '3x2 TODOS', tipo: 'nxm', activa: true, reglas: { llevar: 3, pagar: 2, aplicar_a: [{ tipo: 'todos' }] } }
const promoNxM_4x3_zaatar = { id: 'nxm7', nombre: 'ZAATAR 4x3', tipo: 'nxm', activa: true, reglas: { llevar: 4, pagar: 3, aplicar_a: [{ tipo: 'atributo', id_valor: 41 }] } }
const promoNxM_premium_caro = { id: 'nxm8', nombre: 'PREMIUM 3x2 caro', tipo: 'nxm', activa: true, reglas: { llevar: 3, pagar: 2, aplicar_a: [{ tipo: 'atributo', id_valor: 100 }], descuento_en: 'mas_caro' } }

// Porcentaje
const promoPct_ATM_15 = { id: 'pct1', nombre: '15% ATM', tipo: 'porcentaje', activa: true, reglas: { valor: 15, cantidad_minima: 1, aplicar_a: [{ tipo: 'atributo', id_valor: 84 }] } }
const promoPct_rubro_10 = { id: 'pct2', nombre: '10% Fiambres', tipo: 'porcentaje', activa: true, reglas: { valor: 10, cantidad_minima: 1, aplicar_a: [{ tipo: 'rubro', id: 5 }] } }
const promoPct_subrubro_20 = { id: 'pct3', nombre: '20% Salamines', tipo: 'porcentaje', activa: true, reglas: { valor: 20, cantidad_minima: 1, aplicar_a: [{ tipo: 'subrubro', id: 18 }] } }
const promoPct_articulo_5 = { id: 'pct4', nombre: '5% GRUESO', tipo: 'porcentaje', activa: true, reglas: { valor: 5, cantidad_minima: 1, aplicar_a: [{ tipo: 'articulo', id: 363 }] } }
const promoPct_todos_10 = { id: 'pct5', nombre: '10% en TODO', tipo: 'porcentaje', activa: true, reglas: { valor: 10, cantidad_minima: 1, aplicar_a: [{ tipo: 'todos' }] } }
const promoPct_cantMin3 = { id: 'pct6', nombre: '15% ATM min3', tipo: 'porcentaje', activa: true, reglas: { valor: 15, cantidad_minima: 3, aplicar_a: [{ tipo: 'atributo', id_valor: 84 }] } }
const promoPct_cervezas6 = { id: 'pct7', nombre: '15% 6 cervezas', tipo: 'porcentaje', activa: true, reglas: { valor: 15, cantidad_minima: 6, aplicar_a: [{ tipo: 'subrubro', id: 25 }] } }

// Monto fijo
const promoMF_ATM_500 = { id: 'mf1', nombre: '$500 ATM', tipo: 'monto_fijo', activa: true, reglas: { valor: 500, cantidad_minima: 1, aplicar_a: [{ tipo: 'atributo', id_valor: 84 }] } }
const promoMF_rubro_200 = { id: 'mf2', nombre: '$200 Fiambres', tipo: 'monto_fijo', activa: true, reglas: { valor: 200, cantidad_minima: 1, aplicar_a: [{ tipo: 'rubro', id: 5 }] } }
const promoMF_todos_100 = { id: 'mf3', nombre: '$100 off TODO', tipo: 'monto_fijo', activa: true, reglas: { valor: 100, cantidad_minima: 1, aplicar_a: [{ tipo: 'todos' }] } }
const promoMF_cantMin2 = { id: 'mf4', nombre: '$1000 ATM min2', tipo: 'monto_fijo', activa: true, reglas: { valor: 1000, cantidad_minima: 2, aplicar_a: [{ tipo: 'atributo', id_valor: 84 }] } }

// Combo
const promoCombo_salamin_queso = { id: 'cmb1', nombre: 'Combo Salamin+Queso', tipo: 'combo', activa: true, reglas: { articulos: [{ id: 363, cantidad: 1 }, { id: 999, cantidad: 1 }], precio_combo: 10000 } }
const promoCombo_pan_jamon = { id: 'cmb2', nombre: 'Combo Pan+Jamón', tipo: 'combo', activa: true, reglas: { articulos: [{ id: 777, cantidad: 1 }, { id: 555, cantidad: 1 }], precio_combo: 12000 } }
const promoCombo_triple = { id: 'cmb3', nombre: 'Combo Triple', tipo: 'combo', activa: true, reglas: { articulos: [{ id: 363, cantidad: 1 }, { id: 999, cantidad: 1 }, { id: 888, cantidad: 2 }], precio_combo: 15000 } }
const promoCombo_x2 = { id: 'cmb4', nombre: 'Combo 2 Salamines', tipo: 'combo', activa: true, reglas: { articulos: [{ id: 363, cantidad: 2 }, { id: 364, cantidad: 1 }], precio_combo: 18000 } }

// Condicional
const promoCond_simple = { id: 'cnd1', nombre: 'Comprá 2 Grueso, 50% en Queso', tipo: 'condicional', activa: true,
  reglas: { grupos_condicion: [[{ id: 363, nombre: 'SALAMIN GRUESO', cantidad: 2 }]], articulos_beneficio: [{ id: 999, nombre: 'QUESO BARRA' }], tipo_descuento: 'porcentaje', valor: 50 } }
const promoCond_montoFijo = { id: 'cnd2', nombre: 'Comprá 1 Jamón, $2000 off Cerveza', tipo: 'condicional', activa: true,
  reglas: { grupos_condicion: [[{ id: 555, nombre: 'JAMON', cantidad: 1 }]], articulos_beneficio: [{ id: 888, nombre: 'CERVEZA' }], tipo_descuento: 'monto_fijo', valor: 2000 } }
const promoCond_mismoItem = { id: 'cnd3', nombre: 'Comprá 3 Grueso, 30% en Grueso', tipo: 'condicional', activa: true,
  reglas: { grupos_condicion: [[{ id: 363, nombre: 'SALAMIN GRUESO', cantidad: 3 }]], articulos_beneficio: [{ id: 363, nombre: 'SALAMIN GRUESO' }], tipo_descuento: 'porcentaje', valor: 30 } }
const promoCond_or = { id: 'cnd4', nombre: 'Comprá Grueso O Fino, 20% Cerveza', tipo: 'condicional', activa: true,
  reglas: { grupos_condicion: [[{ id: 363, nombre: 'GRUESO', cantidad: 1, o: true }, { id: 364, nombre: 'FINO', cantidad: 1, o: true }]], articulos_beneficio: [{ id: 888, nombre: 'CERVEZA' }], tipo_descuento: 'porcentaje', valor: 20 } }
const promoCond_and = { id: 'cnd5', nombre: 'Comprá Grueso Y Jamón → 25% Cerveza', tipo: 'condicional', activa: true,
  reglas: { grupos_condicion: [[{ id: 363, nombre: 'GRUESO', cantidad: 1 }, { id: 555, nombre: 'JAMON', cantidad: 1 }]], articulos_beneficio: [{ id: 888, nombre: 'CERVEZA' }], tipo_descuento: 'porcentaje', valor: 25 } }
const promoCond_multiGrupo = { id: 'cnd6', nombre: 'Grupo A O Grupo B → 15% Pan', tipo: 'condicional', activa: true,
  reglas: { grupos_condicion: [
    [{ id: 363, nombre: 'GRUESO', cantidad: 2 }],  // grupo A
    [{ id: 555, nombre: 'JAMON', cantidad: 1 }],    // grupo B (alternativo)
  ], articulos_beneficio: [{ id: 777, nombre: 'PAN' }], tipo_descuento: 'porcentaje', valor: 15 } }
const promoCond_benefMultiple = { id: 'cnd7', nombre: 'Comprá 2 Jamón → 40% Queso y Pan', tipo: 'condicional', activa: true,
  reglas: { grupos_condicion: [[{ id: 555, nombre: 'JAMON', cantidad: 2 }]], articulos_beneficio: [{ id: 999, nombre: 'QUESO' }, { id: 777, nombre: 'PAN' }], tipo_descuento: 'porcentaje', valor: 40 } }
const promoCond_byCodigo = { id: 'cnd8', nombre: 'Por código: 00500 → 10% 99999', tipo: 'condicional', activa: true,
  reglas: { grupos_condicion: [[{ id: 363, codigo: '00500', nombre: 'GRUESO', cantidad: 1 }]], articulos_beneficio: [{ id: 999, codigo: '99999', nombre: 'QUESO' }], tipo_descuento: 'porcentaje', valor: 10 } }

// === HELPERS ===
let passed = 0, failed = 0, totalBlocks = 0
function test(nombre, fn) {
  try { fn(); console.log(`  ✓ ${nombre}`); passed++ }
  catch (e) { console.log(`  ✗ ${nombre}: ${e.message}`); failed++ }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} esperado ${b}, recibió ${a}`) }
function approx(a, b, msg, tol = 0.02) { if (Math.abs(a - b) > tol) throw new Error(`${msg || ''} esperado ~${b}, recibió ${a}`) }
function gt(a, b, msg) { if (!(a > b)) throw new Error(`${msg || ''} esperado >${b}, recibió ${a}`) }
function lt(a, b, msg) { if (!(a < b)) throw new Error(`${msg || ''} esperado <${b}, recibió ${a}`) }
function r2(n) { return Math.round(n * 100) / 100 }
function block(name) { totalBlocks++; console.log(`\n=== BLOQUE ${totalBlocks}: ${name} ===`) }

// ================================================================
// PARTE 1: CADA TIPO DE PROMO INDIVIDUAL
// ================================================================

// --- PORCENTAJE ---
block('Porcentaje × cada tipo de aplicar_a')

test('Pct por atributo: 15% ATM, 1 item', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 1 }], [promoPct_ATM_15])
  eq(r.length, 1); approx(r[0].descuento, 7449.73 * 0.15)
})

test('Pct por atributo: 15% ATM, 3 items distintos', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: salamines[1], cantidad: 1 }, { articulo: salamines[2], cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoPct_ATM_15])
  approx(r[0].descuento, (7449.73 + 7756.40 + 7449.73) * 0.15)
})

test('Pct por rubro: 10% fiambres aplica a salamín y jamón', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: jamon, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoPct_rubro_10])
  approx(r[0].descuento, (7449.73 + 12000) * 0.10)
})

test('Pct por rubro: no aplica a otro rubro', () => {
  const r = calcularPromocionesLocales([{ articulo: cerveza, cantidad: 1 }], [promoPct_rubro_10])
  eq(r.length, 0)
})

test('Pct por subrubro: 20% salamines', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 2 }], [promoPct_subrubro_20])
  approx(r[0].descuento, 7449.73 * 2 * 0.20)
})

test('Pct por subrubro: no aplica a jamones (otro subrubro mismo rubro)', () => {
  const r = calcularPromocionesLocales([{ articulo: jamon, cantidad: 1 }], [promoPct_subrubro_20])
  eq(r.length, 0)
})

test('Pct por artículo: 5% solo GRUESO', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 1 }], [promoPct_articulo_5])
  approx(r[0].descuento, 7449.73 * 0.05)
})

test('Pct por artículo: no aplica a otro salamín', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[1], cantidad: 1 }], [promoPct_articulo_5])
  eq(r.length, 0)
})

test('Pct todos: 10% aplica a todo', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: cerveza, cantidad: 1 }, { articulo: pan, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoPct_todos_10])
  approx(r[0].descuento, (7449.73 + 3000 + 2500) * 0.10)
})

test('Pct con cantidad mínima: 15% ATM min3 — 2 items no califica', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 2 }], [promoPct_cantMin3])
  eq(r.length, 0)
})

test('Pct con cantidad mínima: 15% ATM min3 — 3 items califica', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 3 }], [promoPct_cantMin3])
  eq(r.length, 1); approx(r[0].descuento, 7449.73 * 3 * 0.15)
})

test('Pct con cantidad mínima: 15% ATM min3 — 5 items califica (todo se descuenta)', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 5 }], [promoPct_cantMin3])
  approx(r[0].descuento, 7449.73 * 5 * 0.15)
})

test('Pct con descuentos base: precio efectivo correcto', () => {
  const r = calcularPromocionesLocales([{ articulo: salaminConDescBase, cantidad: 1 }], [promoPct_ATM_15])
  const precioEfectivo = 10000 * 0.9 * 0.95 // 8550
  approx(r[0].descuento, precioEfectivo * 0.15)
})

// --- MONTO FIJO ---
block('Monto fijo × cada tipo de aplicar_a')

test('MF por atributo: $500 ATM × 1', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 1 }], [promoMF_ATM_500])
  approx(r[0].descuento, 500)
})

test('MF por atributo: $500 ATM × 3 items', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: salamines[1], cantidad: 2 }]
  const r = calcularPromocionesLocales(c, [promoMF_ATM_500])
  approx(r[0].descuento, 1500) // 500 × 3
})

test('MF por rubro: $200 fiambres', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: jamon, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoMF_rubro_200])
  approx(r[0].descuento, 400) // 200 × 2
})

test('MF todos: $100 × todos los items', () => {
  const c = [{ articulo: salamines[0], cantidad: 2 }, { articulo: cerveza, cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoMF_todos_100])
  approx(r[0].descuento, 500) // 100 × 5
})

test('MF con cantidad mínima: $1000 ATM min2 — 1 no califica', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 1 }], [promoMF_cantMin2])
  eq(r.length, 0)
})

test('MF con cantidad mínima: $1000 ATM min2 — 2 califica', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 2 }], [promoMF_cantMin2])
  approx(r[0].descuento, 2000)
})

test('MF no aplica a rubro incorrecto', () => {
  const r = calcularPromocionesLocales([{ articulo: cerveza, cantidad: 5 }], [promoMF_rubro_200])
  eq(r.length, 0)
})

// --- NxM ---
block('NxM × cada tipo de aplicar_a × más barato/más caro')

test('NxM atributo más barato: 3 iguales', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 3 }], [promoNxM_ATM_masBarato])
  approx(r[0].descuento, 7449.73) // 1 gratis al más barato
})

test('NxM atributo más caro: 3 distintos', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: salamines[1], cantidad: 1 }, { articulo: salamines[2], cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masCaro])
  approx(r[0].descuento, 7756.40) // 1 gratis al más caro
})

test('NxM atributo: 2 no califica (necesita 3)', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 2 }], [promoNxM_ATM_masBarato])
  eq(r.length, 0)
})

test('NxM atributo: 6 unidades = 2 grupos', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 6 }], [promoNxM_ATM_masBarato])
  approx(r[0].descuento, 7449.73 * 2)
})

test('NxM atributo: 7 unidades = 2 grupos (sobra 1)', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 7 }], [promoNxM_ATM_masBarato])
  approx(r[0].descuento, 7449.73 * 2) // solo 2 grupos, no 3
})

test('NxM atributo: 9 unidades = 3 grupos', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 9 }], [promoNxM_ATM_masBarato])
  approx(r[0].descuento, 7449.73 * 3)
})

test('NxM rubro: fiambres 3x2 — mezcla salamin + jamon', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: jamon, cantidad: 1 }, { articulo: mortadela, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_rubro])
  // más barato = mortadela $4000
  approx(r[0].descuento, 4000)
})

test('NxM subrubro: salamines 2x1', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 2 }], [promoNxM_subrubro])
  approx(r[0].descuento, 7449.73)
})

test('NxM artículo: GRUESO 2x1', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 2 }], [promoNxM_articulo])
  approx(r[0].descuento, 7449.73)
})

test('NxM artículo: no aplica a otro salamín', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[1], cantidad: 2 }], [promoNxM_articulo])
  eq(r.length, 0)
})

test('NxM todos: mezcla de productos', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: cerveza, cantidad: 1 }, { articulo: pan, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_todos])
  approx(r[0].descuento, 2500) // más barato = pan
})

test('NxM más caro con descuentos base: usa precio post-desc', () => {
  const c = [{ articulo: salaminConDescBase, cantidad: 2 }, { articulo: salamines[0], cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masCaro])
  // salaminConDescBase = 8550, salamines[0] = 7449.73 → más caro = 8550
  approx(r[0].descuento, 8550)
})

test('NxM más barato con descuentos base: usa precio post-desc', () => {
  const c = [{ articulo: salaminConDescBase, cantidad: 2 }, { articulo: salamines[0], cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato])
  approx(r[0].descuento, 7449.73) // más barato sigue siendo el otro
})

test('NxM 4x3 ZAATAR con 4 items', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 4 }], [promoNxM_4x3_zaatar])
  approx(r[0].descuento, 7449.73) // 1 gratis
})

test('NxM 4x3 ZAATAR con 8 items = 2 grupos', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 8 }], [promoNxM_4x3_zaatar])
  approx(r[0].descuento, 7449.73 * 2)
})

test('NxM pesable: cantidad fraccionaria — 0.5kg no califica para 2x1', () => {
  const r = calcularPromocionesLocales([{ articulo: artPesable, cantidad: 0.5 }], [{ id: 'x', nombre: 'test', tipo: 'nxm', activa: true, reglas: { llevar: 2, pagar: 1, aplicar_a: [{ tipo: 'todos' }] } }])
  eq(r.length, 0)
})

// --- COMBO ---
block('Combo')

test('Combo básico: salamin + queso → precio combo $10000', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCombo_salamin_queso])
  // individual = 7449.73 + 5000 = 12449.73, combo = 10000, desc = 2449.73
  approx(r[0].descuento, 2449.73)
})

test('Combo: falta 1 artículo → no aplica', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCombo_salamin_queso])
  eq(r.length, 0)
})

test('Combo: doble cantidad → 2 combos posibles', () => {
  const c = [{ articulo: salamines[0], cantidad: 2 }, { articulo: queso, cantidad: 2 }]
  const r = calcularPromocionesLocales(c, [promoCombo_salamin_queso])
  approx(r[0].descuento, 2449.73 * 2)
  eq(r[0].detalle, 'Combo x2')
})

test('Combo: cantidad desigual → min combos', () => {
  const c = [{ articulo: salamines[0], cantidad: 5 }, { articulo: queso, cantidad: 2 }]
  const r = calcularPromocionesLocales(c, [promoCombo_salamin_queso])
  approx(r[0].descuento, 2449.73 * 2) // limitado por queso
})

test('Combo triple: salamin + queso + 2 cervezas', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }, { articulo: cerveza, cantidad: 2 }]
  const r = calcularPromocionesLocales(c, [promoCombo_triple])
  // individual = 7449.73 + 5000 + 3000*2 = 18449.73, combo = 15000, desc = 3449.73
  approx(r[0].descuento, 3449.73)
})

test('Combo triple: cervezas insuficientes → no aplica', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCombo_triple])
  eq(r.length, 0) // necesita 2 cervezas
})

test('Combo con cantidad >1: 2 Grueso + 1 Fino', () => {
  const c = [{ articulo: salamines[0], cantidad: 2 }, { articulo: salamines[2], cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCombo_x2])
  // individual = 7449.73*2 + 7449.73 = 22349.19, combo = 18000
  approx(r[0].descuento, 22349.19 - 18000, '', 0.1)
})

test('Combo: precio combo mayor a individual → no aplica (desc <=0)', () => {
  const promoMalCombo = { id: 'bad', nombre: 'Combo caro', tipo: 'combo', activa: true, reglas: { articulos: [{ id: 888, cantidad: 1 }, { id: 777, cantidad: 1 }], precio_combo: 99999 } }
  const c = [{ articulo: cerveza, cantidad: 1 }, { articulo: pan, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoMalCombo])
  eq(r.length, 0)
})

test('Combo: 1 solo artículo en lista → no aplica (necesita ≥2)', () => {
  const promo1art = { id: 'x', nombre: 'solo 1', tipo: 'combo', activa: true, reglas: { articulos: [{ id: 363, cantidad: 1 }], precio_combo: 5000 } }
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 1 }], [promo1art])
  eq(r.length, 0)
})

test('Combo con descuento base: usa precio post-descuento', () => {
  const promoDescBase = { id: 'cbd', nombre: 'Combo desc base', tipo: 'combo', activa: true, reglas: { articulos: [{ id: 9001, cantidad: 1 }, { id: 999, cantidad: 1 }], precio_combo: 10000 } }
  const c = [{ articulo: salaminConDescBase, cantidad: 1 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoDescBase])
  // individual = 8550 + 5000 = 13550, combo = 10000
  approx(r[0].descuento, 3550)
})

// --- CONDICIONAL ---
block('Condicional — AND simple')

test('Cond simple: 2 Grueso → 50% Queso', () => {
  const c = [{ articulo: salamines[0], cantidad: 2 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_simple])
  eq(r.length, 1); approx(r[0].descuento, 5000 * 0.50)
})

test('Cond simple: 1 Grueso (insuficiente) → no aplica', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_simple])
  eq(r.length, 0)
})

test('Cond simple: 4 Grueso → se aplica 2 veces', () => {
  const c = [{ articulo: salamines[0], cantidad: 4 }, { articulo: queso, cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoCond_simple])
  // vecesPromo=2, pero queso solo tiene 3 → min(2,3)=2 quesos descontados
  approx(r[0].descuento, 5000 * 0.50 * 2)
})

test('Cond simple: condición ok pero no hay beneficio en carrito → no aplica', () => {
  const c = [{ articulo: salamines[0], cantidad: 2 }]
  const r = calcularPromocionesLocales(c, [promoCond_simple])
  eq(r.length, 0)
})

test('Cond monto_fijo: 1 Jamón → $2000 off Cerveza', () => {
  const c = [{ articulo: jamon, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_montoFijo])
  // monto_fijo $2000 pero cerveza cuesta $3000, aplica min(2000,3000)=2000
  approx(r[0].descuento, 2000)
})

test('Cond monto_fijo: valor > precio → cap al precio', () => {
  const promoCap = { id: 'cap', nombre: 'cap', tipo: 'condicional', activa: true,
    reglas: { grupos_condicion: [[{ id: 555, nombre: 'JAMON', cantidad: 1 }]], articulos_beneficio: [{ id: 777, nombre: 'PAN' }], tipo_descuento: 'monto_fijo', valor: 50000 } }
  const c = [{ articulo: jamon, cantidad: 1 }, { articulo: pan, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCap])
  // min(50000, 2500) = 2500
  approx(r[0].descuento, 2500)
})

test('Cond mismo item condición+beneficio: 3 Grueso → 30% en Grueso (3 unidades)', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoCond_mismoItem])
  // vecesPromo=1, cantReq=3, cantDesc=min(1*3, 3)=3 → descuenta las 3 unidades
  approx(r[0].descuento, 7449.73 * 3 * 0.30)
})

block('Condicional — OR')

test('Cond OR: solo Grueso en carrito → cumple', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_or])
  approx(r[0].descuento, 3000 * 0.20)
})

test('Cond OR: solo Fino en carrito → cumple', () => {
  const c = [{ articulo: salamines[2], cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_or])
  approx(r[0].descuento, 3000 * 0.20)
})

test('Cond OR: ambos en carrito → cumple, se suman veces', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: salamines[2], cantidad: 1 }, { articulo: cerveza, cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoCond_or])
  // vecesPromo = 2 (1 de cada OR), cerveza tiene 3 → se descuentan 2
  approx(r[0].descuento, 3000 * 0.20 * 2)
})

test('Cond OR: ninguna alternativa → no aplica', () => {
  const c = [{ articulo: jamon, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_or])
  eq(r.length, 0)
})

block('Condicional — AND multi-item')

test('Cond AND: necesita Grueso Y Jamón → ambos presentes', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: jamon, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_and])
  approx(r[0].descuento, 3000 * 0.25)
})

test('Cond AND: falta Jamón → no aplica', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_and])
  eq(r.length, 0)
})

test('Cond AND: falta Grueso → no aplica', () => {
  const c = [{ articulo: jamon, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_and])
  eq(r.length, 0)
})

block('Condicional — múltiples grupos (OR entre grupos)')

test('Cond multiGrupo: cumple grupo A (2 Grueso)', () => {
  const c = [{ articulo: salamines[0], cantidad: 2 }, { articulo: pan, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_multiGrupo])
  approx(r[0].descuento, 2500 * 0.15)
})

test('Cond multiGrupo: cumple grupo B (1 Jamón)', () => {
  const c = [{ articulo: jamon, cantidad: 1 }, { articulo: pan, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_multiGrupo])
  approx(r[0].descuento, 2500 * 0.15)
})

test('Cond multiGrupo: no cumple ninguno', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: pan, cantidad: 1 }] // solo 1 grueso, no 2
  const r = calcularPromocionesLocales(c, [promoCond_multiGrupo])
  eq(r.length, 0)
})

block('Condicional — beneficio múltiple')

test('Cond benefMultiple: 2 Jamón → 40% en Queso y Pan', () => {
  const c = [{ articulo: jamon, cantidad: 2 }, { articulo: queso, cantidad: 1 }, { articulo: pan, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_benefMultiple])
  // queso 5000*0.4 + pan 2500*0.4 = 2000+1000=3000
  approx(r[0].descuento, 3000)
})

test('Cond benefMultiple: 2 Jamón pero solo Queso → aplica solo a queso', () => {
  const c = [{ articulo: jamon, cantidad: 2 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_benefMultiple])
  approx(r[0].descuento, 5000 * 0.40)
})

block('Condicional — por código')

test('Cond por código: matchea condición y beneficio por código', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_byCodigo])
  approx(r[0].descuento, 5000 * 0.10)
})

// ================================================================
// PARTE 2: COMBINACIONES DE 2 PROMOS
// ================================================================

block('NxM ATM + Porcentaje (5 variantes de aplicar_a)')

test('NxM ATM + Pct atributo ATM', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoPct_ATM_15])
  eq(r.length, 2)
  approx(r[0].descuento, 7449.73, 'nxm')
  approx(r[1].descuento, 7449.73 * 3 * 0.15, '15% ATM')
})

test('NxM ATM + Pct rubro fiambres', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: salamines[1], cantidad: 1 }, { articulo: salamines[2], cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoPct_rubro_10])
  eq(r.length, 2)
  approx(r[1].descuento, (7449.73 + 7756.40 + 7449.73) * 0.10)
})

test('NxM ATM + Pct subrubro salamines', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoPct_subrubro_20])
  eq(r.length, 2)
  approx(r[1].descuento, 7449.73 * 3 * 0.20)
})

test('NxM ATM + Pct artículo GRUESO', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoPct_articulo_5])
  eq(r.length, 2)
  approx(r[1].descuento, 7449.73 * 3 * 0.05)
})

test('NxM ATM + Pct todos', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoPct_todos_10])
  eq(r.length, 2)
  approx(r[1].descuento, 7449.73 * 3 * 0.10)
})

block('NxM ATM + Monto fijo')

test('NxM ATM + MF ATM → ambas aplican', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoMF_ATM_500])
  eq(r.length, 2)
  approx(r[0].descuento, 7449.73)
  approx(r[1].descuento, 1500) // $500 × 3
})

test('NxM ATM + MF todos', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoMF_todos_100])
  eq(r.length, 2)
  approx(r[1].descuento, 400) // $100 × 4 items
})

block('NxM ATM + Combo')

test('NxM ATM + Combo salamin+queso → ambas aplican (items comparten)', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoCombo_salamin_queso])
  eq(r.length, 2)
  approx(r[0].descuento, 7449.73, 'nxm')
  approx(r[1].descuento, 2449.73, 'combo')
})

test('NxM ATM + Combo sin suficientes items para combo → solo NxM', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }] // sin queso
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoCombo_salamin_queso])
  eq(r.length, 1)
  eq(r[0].tipoPromo, 'nxm')
})

block('NxM ATM + Condicional')

test('NxM ATM + Cond (2 Grueso → 50% Queso) → ambas aplican', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoCond_simple])
  eq(r.length, 2)
  approx(r[0].descuento, 7449.73, 'nxm')
  approx(r[1].descuento, 5000 * 0.50, 'cond')
})

test('NxM ATM + Cond (condición no cumplida) → solo NxM', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoCond_simple])
  eq(r.length, 1)
  eq(r[0].tipoPromo, 'nxm')
})

block('NxM ATM + NxM otro (overlap y no overlap)')

test('NxM ATM + NxM ZAATAR → ambas aplican (items tienen ambos attr)', () => {
  const c = [{ articulo: salamines[0], cantidad: 4 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoNxM_4x3_zaatar])
  eq(r.length, 2)
  approx(r[0].descuento, 7449.73, 'ATM 1 gratis')
  approx(r[1].descuento, 7449.73, 'ZAATAR 1 gratis')
})

test('NxM ATM + NxM todos → ambas aplican', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoNxM_todos])
  eq(r.length, 2)
})

test('NxM ATM + NxM rubro fiambres → ambas (mismo target)', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoNxM_rubro])
  eq(r.length, 2)
})

test('NxM ATM + NxM subrubro → ambas aplican', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoNxM_subrubro])
  eq(r.length, 2)
  // NxM subrubro = 2x1, 3 items = 1 grupo, 1 gratis
  approx(r[1].descuento, 7449.73)
})

block('Porcentaje + Monto fijo')

test('Pct ATM 15% + MF ATM $500 → ambas sobre mismos items', () => {
  const c = [{ articulo: salamines[0], cantidad: 2 }]
  const r = calcularPromocionesLocales(c, [promoPct_ATM_15, promoMF_ATM_500])
  eq(r.length, 2)
  approx(r[0].descuento, 7449.73 * 2 * 0.15)
  approx(r[1].descuento, 1000)
})

test('Pct rubro + MF rubro → ambas', () => {
  const c = [{ articulo: jamon, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoPct_rubro_10, promoMF_rubro_200])
  eq(r.length, 2)
  approx(r[0].descuento, 12000 * 0.10)
  approx(r[1].descuento, 200)
})

block('Porcentaje + Combo')

test('Pct todos + Combo → ambas', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoPct_todos_10, promoCombo_salamin_queso])
  eq(r.length, 2)
  approx(r[0].descuento, (7449.73 + 5000) * 0.10, 'pct')
  approx(r[1].descuento, 2449.73, 'combo')
})

block('Porcentaje + Condicional')

test('Pct ATM + Cond (Grueso → Queso) → ambas', () => {
  const c = [{ articulo: salamines[0], cantidad: 2 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoPct_ATM_15, promoCond_simple])
  eq(r.length, 2)
  approx(r[0].descuento, 7449.73 * 2 * 0.15, 'pct')
  approx(r[1].descuento, 5000 * 0.50, 'cond')
})

block('Monto fijo + Combo')

test('MF todos + Combo → ambas', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoMF_todos_100, promoCombo_salamin_queso])
  eq(r.length, 2)
  approx(r[0].descuento, 200, 'mf $100 × 2')
  approx(r[1].descuento, 2449.73, 'combo')
})

block('Monto fijo + Condicional')

test('MF ATM + Cond (Grueso → Queso) → ambas', () => {
  const c = [{ articulo: salamines[0], cantidad: 2 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoMF_ATM_500, promoCond_simple])
  eq(r.length, 2)
  approx(r[0].descuento, 1000, 'mf $500 × 2')
  approx(r[1].descuento, 5000 * 0.50, 'cond')
})

block('Combo + Condicional')

test('Combo salamin+queso + Cond (Jamón → Cerveza) → ambas (disjuntas)', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }, { articulo: jamon, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCombo_salamin_queso, promoCond_montoFijo])
  eq(r.length, 2)
  approx(r[0].descuento, 2449.73, 'combo')
  approx(r[1].descuento, 2000, 'cond')
})

test('Combo + Cond compartiendo artículo condición', () => {
  // Combo usa salamin+queso, Cond usa salamin como condición y cerveza como beneficio
  const c = [{ articulo: salamines[0], cantidad: 2 }, { articulo: queso, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const promoCond = { id: 'cndX', nombre: 'Grueso→Cerveza', tipo: 'condicional', activa: true,
    reglas: { grupos_condicion: [[{ id: 363, nombre: 'GRUESO', cantidad: 1 }]], articulos_beneficio: [{ id: 888, nombre: 'CERVEZA' }], tipo_descuento: 'porcentaje', valor: 30 } }
  const r = calcularPromocionesLocales(c, [promoCombo_salamin_queso, promoCond])
  eq(r.length, 2)
})

block('Dos combos simultáneos')

test('Combo salamin+queso + Combo pan+jamón → ambos (disjuntos)', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }, { articulo: pan, cantidad: 1 }, { articulo: jamon, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCombo_salamin_queso, promoCombo_pan_jamon])
  eq(r.length, 2)
  approx(r[0].descuento, 2449.73, 'combo 1')
  approx(r[1].descuento, (2500 + 12000) - 12000, 'combo 2') // 14500-12000=2500
})

block('Dos condicionales simultáneas')

test('Cond simple + Cond AND → ambas si se cumplen', () => {
  // Cond simple: 2 Grueso → 50% Queso
  // Cond AND: Grueso + Jamón → 25% Cerveza
  const c = [{ articulo: salamines[0], cantidad: 2 }, { articulo: jamon, cantidad: 1 }, { articulo: queso, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCond_simple, promoCond_and])
  eq(r.length, 2)
  approx(r[0].descuento, 5000 * 0.50, 'cond 1')
  approx(r[1].descuento, 3000 * 0.25, 'cond 2')
})

// ================================================================
// PARTE 3: COMBINACIONES DE 3+ PROMOS
// ================================================================

block('Triple: NxM + Pct + MF sobre mismos items')

test('NxM ATM + 15% ATM + $500 ATM → las 3 aplican', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoPct_ATM_15, promoMF_ATM_500])
  eq(r.length, 3)
  const tipos = r.map(p => p.tipoPromo).sort().join(',')
  eq(tipos, 'monto_fijo,nxm,porcentaje')
  const subtotal = 7449.73 * 3
  const descTotal = r.reduce((s, p) => s + p.descuento, 0)
  lt(descTotal, subtotal, 'desc no supera subtotal')
})

block('Triple: NxM + Combo + Pct')

test('NxM ATM 3x2 + Combo salamin+queso + 10% todos', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoCombo_salamin_queso, promoPct_todos_10])
  eq(r.length, 3)
  const tipos = r.map(p => p.tipoPromo).sort().join(',')
  eq(tipos, 'combo,nxm,porcentaje')
})

block('Triple: NxM + Cond + Pct')

test('NxM ATM + Cond (Grueso→Queso) + 10% fiambres', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoCond_simple, promoPct_rubro_10])
  eq(r.length, 3)
})

block('Cuádruple: NxM + Pct + MF + Cond')

test('4 promos simultáneas', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoPct_ATM_15, promoMF_ATM_500, promoCond_simple])
  eq(r.length, 4)
  const descTotal = r.reduce((s, p) => s + p.descuento, 0)
  const subtotal = 7449.73 * 3 + 5000
  lt(descTotal, subtotal, 'desc no supera subtotal')
})

block('Quíntuple: NxM + Pct + MF + Combo + Cond')

test('5 promos simultáneas', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }, { articulo: queso, cantidad: 1 }, { articulo: jamon, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, promoPct_todos_10, promoMF_ATM_500, promoCombo_salamin_queso, promoCond_montoFijo])
  eq(r.length, 5)
  const descTotal = r.reduce((s, p) => s + p.descuento, 0)
  const subtotal = 7449.73 * 3 + 5000 + 12000 + 3000
  lt(descTotal, subtotal, '5 promos: desc no supera subtotal')
  gt(descTotal, 0, 'hay descuento')
})

// ================================================================
// PARTE 4: VALIDACIÓN DESCUENTO_EN MÁS CARO EN COMBINACIONES
// ================================================================

block('NxM más caro + otras promos')

test('NxM más caro + Pct rubro → ambas, NxM descuenta el más caro', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: salamines[1], cantidad: 1 }, { articulo: salamines[2], cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masCaro, promoPct_rubro_10])
  eq(r.length, 2)
  approx(r[0].descuento, 7756.40, 'más caro')
})

test('NxM más caro + MF ATM → ambas', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: salamines[1], cantidad: 2 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masCaro, promoMF_ATM_500])
  eq(r.length, 2)
  approx(r[0].descuento, 7756.40, 'más caro = ahumado')
  approx(r[1].descuento, 1500, '$500 × 3')
})

test('NxM más caro + NxM ZAATAR más barato → ambas con distintos precios', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: salamines[1], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masCaro, promoNxM_4x3_zaatar])
  eq(r.length, 2)
  approx(r[0].descuento, 7756.40, 'ATM más caro')
  approx(r[1].descuento, 7449.73, 'ZAATAR más barato')
})

test('NxM más caro + Combo + Cond', () => {
  const c = [{ articulo: salamines[0], cantidad: 3 }, { articulo: queso, cantidad: 1 }, { articulo: jamon, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masCaro, promoCombo_salamin_queso, promoCond_montoFijo])
  eq(r.length, 3)
  // NxM descuenta al más caro (todos son iguales = 7449.73)
  approx(r[0].descuento, 7449.73, 'nxm más caro (todos iguales)')
})

// ================================================================
// PARTE 5: PROMOS INACTIVAS / EXPIRADAS / SIN RANGO
// ================================================================

block('Promos inactivas/expiradas/futuras')

test('Promo inactiva → no aplica', () => {
  const inactiva = { ...promoNxM_ATM_masBarato, activa: false }
  eq(calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 3 }], [inactiva]).length, 0)
})

test('Promo expirada → no aplica', () => {
  const exp = { ...promoNxM_ATM_masBarato, fecha_hasta: '2020-01-01' }
  eq(calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 3 }], [exp]).length, 0)
})

test('Promo futura → no aplica', () => {
  const fut = { ...promoNxM_ATM_masBarato, fecha_desde: '2099-01-01' }
  eq(calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 3 }], [fut]).length, 0)
})

test('Promo en rango → aplica', () => {
  const ok = { ...promoNxM_ATM_masBarato, fecha_desde: '2020-01-01', fecha_hasta: '2099-12-31' }
  eq(calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 3 }], [ok]).length, 1)
})

test('Mezcla activas e inactivas → solo las activas', () => {
  const inactiva = { ...promoPct_ATM_15, activa: false }
  const expirada = { ...promoMF_ATM_500, fecha_hasta: '2020-01-01' }
  const c = [{ articulo: salamines[0], cantidad: 3 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato, inactiva, expirada, promoPct_todos_10])
  eq(r.length, 2)
  eq(r[0].tipoPromo, 'nxm')
  eq(r[1].tipoPromo, 'porcentaje')
})

// ================================================================
// PARTE 6: EDGE CASES
// ================================================================

block('Edge cases')

test('Carrito vacío → 0 promos', () => {
  const r = calcularPromocionesLocales([], [promoNxM_ATM_masBarato, promoPct_todos_10, promoCombo_salamin_queso, promoCond_simple])
  eq(r.length, 0)
})

test('0 promos → 0 aplicadas', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 5 }], [])
  eq(r.length, 0)
})

test('Artículo sin atributos → promo atributo no matchea', () => {
  const r = calcularPromocionesLocales([{ articulo: artSinAttr, cantidad: 3 }], [promoNxM_ATM_masBarato])
  eq(r.length, 0)
})

test('Artículo con atributos undefined', () => {
  const art = { ...salamines[0], atributos: undefined }
  const r = calcularPromocionesLocales([{ articulo: art, cantidad: 3 }], [promoNxM_ATM_masBarato])
  eq(r.length, 0)
})

test('Artículo con atributos null', () => {
  const art = { ...salamines[0], atributos: null }
  const r = calcularPromocionesLocales([{ articulo: art, cantidad: 3 }], [promoNxM_ATM_masBarato])
  eq(r.length, 0)
})

test('Promo con aplicar_a vacío → matchea todos (default)', () => {
  const promo = { id: 'x', nombre: 'vacio', tipo: 'porcentaje', activa: true, reglas: { valor: 10, aplicar_a: [] } }
  const r = calcularPromocionesLocales([{ articulo: cerveza, cantidad: 1 }], [promo])
  eq(r.length, 1)
})

test('Promo con aplicar_a undefined → matchea todos', () => {
  const promo = { id: 'x', nombre: 'undef', tipo: 'porcentaje', activa: true, reglas: { valor: 10 } }
  const r = calcularPromocionesLocales([{ articulo: cerveza, cantidad: 1 }], [promo])
  eq(r.length, 1)
})

test('Cantidad 0 → no matchea (no suma)', () => {
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 0 }], [promoPct_ATM_15])
  // cantidad_minima = 1, pero 0 < 1
  eq(r.length, 0)
})

test('Precio 0 → descuento es 0', () => {
  const art0 = { ...salamines[0], precio: 0 }
  const r = calcularPromocionesLocales([{ articulo: art0, cantidad: 3 }], [promoPct_ATM_15])
  eq(r.length, 1)
  approx(r[0].descuento, 0)
})

test('Porcentaje 0% → descuento es 0 (pero promo se registra)', () => {
  const p0 = { id: 'z', nombre: '0%', tipo: 'porcentaje', activa: true, reglas: { valor: 0, aplicar_a: [{ tipo: 'todos' }] } }
  const r = calcularPromocionesLocales([{ articulo: salamines[0], cantidad: 1 }], [p0])
  eq(r.length, 1)
  approx(r[0].descuento, 0)
})

test('Porcentaje 100% → descuento = precio total', () => {
  const p100 = { id: 'z', nombre: '100%', tipo: 'porcentaje', activa: true, reglas: { valor: 100, aplicar_a: [{ tipo: 'todos' }] } }
  const r = calcularPromocionesLocales([{ articulo: cerveza, cantidad: 2 }], [p100])
  approx(r[0].descuento, 3000 * 2)
})

test('Monto fijo muy grande → descuenta el valor por unidad (sin cap)', () => {
  const mfGrande = { id: 'z', nombre: 'MF grande', tipo: 'monto_fijo', activa: true, reglas: { valor: 999999, aplicar_a: [{ tipo: 'todos' }] } }
  const r = calcularPromocionesLocales([{ articulo: cerveza, cantidad: 1 }], [mfGrande])
  // monto_fijo no capea al precio del artículo
  approx(r[0].descuento, 999999)
})

test('NxM donde llevar=pagar → 0 gratis', () => {
  const nxn = { id: 'z', nombre: '3x3', tipo: 'nxm', activa: true, reglas: { llevar: 3, pagar: 3, aplicar_a: [{ tipo: 'todos' }] } }
  const r = calcularPromocionesLocales([{ articulo: cerveza, cantidad: 3 }], [nxn])
  eq(r.length, 1)
  approx(r[0].descuento, 0, 'llevar=pagar → 0 desc')
})

test('NxM 2x1: cada 2 te lleva 1 gratis', () => {
  const r = calcularPromocionesLocales([{ articulo: cerveza, cantidad: 4 }], [promoNxM_subrubro])
  // 2x1 subrubro(salamines) no matchea cervezas
  eq(r.length, 0)
})

test('Cantidad fraccionaria en pesable: 1.5kg con NxM', () => {
  // 1.5 < 2 → no llega a NxM 2x1
  const nxm21 = { id: 'z', nombre: '2x1 todo', tipo: 'nxm', activa: true, reglas: { llevar: 2, pagar: 1, aplicar_a: [{ tipo: 'todos' }] } }
  const r = calcularPromocionesLocales([{ articulo: artPesable, cantidad: 1.5 }], [nxm21])
  eq(r.length, 0)
})

test('Cantidad fraccionaria 2.5kg con NxM 2x1', () => {
  const nxm21 = { id: 'z', nombre: '2x1 todo', tipo: 'nxm', activa: true, reglas: { llevar: 2, pagar: 1, aplicar_a: [{ tipo: 'todos' }] } }
  const r = calcularPromocionesLocales([{ articulo: artPesable, cantidad: 2.5 }], [nxm21])
  // floor(2.5/2) = 1 grupo, 1 gratis
  eq(r.length, 1)
  approx(r[0].descuento, 15000)
})

test('Muchos items distintos, solo algunos matchean', () => {
  const c = [
    { articulo: salamines[0], cantidad: 1 },
    { articulo: cerveza, cantidad: 2 },
    { articulo: pan, cantidad: 1 },
    { articulo: jamon, cantidad: 1 },
    { articulo: queso, cantidad: 1 },
  ]
  const r = calcularPromocionesLocales(c, [promoPct_ATM_15])
  eq(r.length, 1)
  // Solo salamin[0] tiene ATM
  approx(r[0].descuento, 7449.73 * 0.15)
  eq(r[0].itemsAfectados.length, 1)
  eq(r[0].itemsAfectados[0], 363)
})

test('Artículo con 3 niveles de descuento base', () => {
  const art3desc = { id: 9999, codigo: '99', nombre: 'TRIPLE DESC', precio: 10000, descuento1: 10, descuento2: 20, descuento3: 5, rubro: { id: 5, nombre: 'FIAMBRES' }, subRubro: { id: 18, nombre: 'SALAMINES' }, atributos: [...ATTR_ATM] }
  // 10000 * 0.9 * 0.8 * 0.95 = 6840
  const r = calcularPromocionesLocales([{ articulo: art3desc, cantidad: 1 }], [promoPct_ATM_15])
  approx(r[0].descuento, 6840 * 0.15)
})

test('Combo distribuye descuento proporcionalmente', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promoCombo_salamin_queso])
  const total = 7449.73 + 5000
  const desc = total - 10000
  // salamin peso = 7449.73 / total
  const descSalamin = desc * (7449.73 / total)
  const descQueso = desc * (5000 / total)
  approx(r[0].descuentoPorItem[363], descSalamin, 'desc salamin proporcional')
  approx(r[0].descuentoPorItem[999], descQueso, 'desc queso proporcional')
})

test('NxM distribuye descuento proporcionalmente por peso', () => {
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: salamines[1], cantidad: 2 }]
  const r = calcularPromocionesLocales(c, [promoNxM_ATM_masBarato])
  const sub = 7449.73 + 7756.40 * 2
  const pesoGrueso = 7449.73 / sub
  const pesoAhumado = (7756.40 * 2) / sub
  approx(r[0].descuentoPorItem[363], r[0].descuento * pesoGrueso, 'desc grueso prop')
  approx(r[0].descuentoPorItem[6058], r[0].descuento * pesoAhumado, 'desc ahumado prop')
})

// ================================================================
// PARTE 7: MÚLTIPLES REGLAS aplicar_a EN UNA MISMA PROMO
// ================================================================

block('Promo con múltiples reglas aplicar_a')

test('Pct con 2 reglas: atributo ATM + rubro LACTEOS → matchea ambos', () => {
  const promo = { id: 'multi', nombre: 'ATM o Lacteos', tipo: 'porcentaje', activa: true,
    reglas: { valor: 10, aplicar_a: [{ tipo: 'atributo', id_valor: 84 }, { tipo: 'rubro', id: 3 }] } }
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: queso, cantidad: 1 }, { articulo: cerveza, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promo])
  eq(r.length, 1)
  // matchea salamin (ATM) + queso (LACTEOS), no cerveza
  approx(r[0].descuento, (7449.73 + 5000) * 0.10)
  eq(r[0].itemsAfectados.length, 2)
})

test('NxM con 2 reglas: atributo + rubro → items de ambos califican', () => {
  const promo = { id: 'multi2', nombre: 'NxM ATM+Lacteos', tipo: 'nxm', activa: true,
    reglas: { llevar: 3, pagar: 2, aplicar_a: [{ tipo: 'atributo', id_valor: 84 }, { tipo: 'rubro', id: 3 }] } }
  const c = [{ articulo: salamines[0], cantidad: 1 }, { articulo: salamines[1], cantidad: 1 }, { articulo: queso, cantidad: 1 }]
  const r = calcularPromocionesLocales(c, [promo])
  eq(r.length, 1)
  // 3 items matchean (2 por ATM + 1 por LACTEOS), más barato = queso $5000
  approx(r[0].descuento, 5000)
})

// ================================================================
// PARTE 8: STRESS TEST — MUCHAS PROMOS SIMULTÁNEAS
// ================================================================

block('Stress: 10 promos simultáneas')

test('10 promos activas sobre carrito variado', () => {
  const c = [
    { articulo: salamines[0], cantidad: 3 },
    { articulo: salamines[1], cantidad: 2 },
    { articulo: queso, cantidad: 2 },
    { articulo: cerveza, cantidad: 6 },
    { articulo: pan, cantidad: 1 },
    { articulo: jamon, cantidad: 2 },
  ]
  const promos = [
    promoNxM_ATM_masBarato,    // NxM ATM 3x2
    promoPct_rubro_10,          // 10% fiambres
    promoMF_ATM_500,            // $500 ATM
    promoPct_cervezas6,         // 15% 6 cervezas
    promoCombo_salamin_queso,   // Combo salamin+queso
    promoCond_montoFijo,        // Jamón → $2000 cerveza
    promoPct_todos_10,          // 10% todo
    promoMF_todos_100,          // $100 todo
    promoCombo_pan_jamon,       // Combo pan+jamón
    promoCond_benefMultiple,    // 2 Jamón → 40% queso+pan
  ]
  const r = calcularPromocionesLocales(c, promos)
  gt(r.length, 5, 'al menos 6 promos aplican')
  const descTotal = r.reduce((s, p) => s + p.descuento, 0)
  const subtotal = 7449.73*3 + 7756.40*2 + 5000*2 + 3000*6 + 2500 + 12000*2
  gt(descTotal, 0, 'hay descuento')
  // Verify every promo has positive or zero descuento
  for (const p of r) {
    eq(p.descuento >= 0, true, `${p.promoNombre} desc >= 0`)
  }
  console.log(`    → ${r.length} promos aplicadas, subtotal: $${r2(subtotal)}, desc total: $${r2(descTotal)} (${r2(descTotal/subtotal*100)}%)`)
})

// ================================================================
// RESULTADO
// ================================================================
console.log('\n\n========================================')
console.log(`RESULTADO FINAL: ${passed} passed, ${failed} failed (${totalBlocks} bloques)`)
console.log('========================================\n')
process.exit(failed > 0 ? 1 : 0)
