// Motor de promociones local — extraído de POS.jsx

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

// Precio con descuentos base del artículo (no promo)
function calcularPrecioConDescuentosBase(articulo) {
  let precio = articulo.precio || 0
  if (articulo.descuento1) precio *= (1 - articulo.descuento1 / 100)
  if (articulo.descuento2) precio *= (1 - articulo.descuento2 / 100)
  if (articulo.descuento3) precio *= (1 - articulo.descuento3 / 100)
  return precio
}

// Verificar si un item del carrito matchea una regla aplicar_a
function itemMatcheaRegla(item, aplicarA) {
  if (!aplicarA || aplicarA.length === 0) return true
  for (const regla of aplicarA) {
    if (regla.tipo === 'todos') return true
    if (regla.tipo === 'articulo' && item.articulo.id === regla.id) return true
    if (regla.tipo === 'rubro' && item.articulo.rubro?.id === regla.id) return true
    if (regla.tipo === 'subrubro' && item.articulo.subRubro?.id === regla.id) return true
    if (regla.tipo === 'atributo' && item.articulo.atributos?.some(a => a.id_valor === regla.id_valor)) return true
    if (regla.tipo === 'marca' && item.articulo.marca === regla.nombre) return true
  }
  return false
}

// Verificar si la promo está dentro de rango de fechas
function promoEnRango(promo) {
  const hoy = new Date().toISOString().split('T')[0]
  if (promo.fecha_desde && hoy < promo.fecha_desde) return false
  if (promo.fecha_hasta && hoy > promo.fecha_hasta) return false
  return true
}

// Motor de promociones local
// Evaluar una promo condicional contra un carrito dado → retorna datos de descuento o null
// Soporta condiciones/beneficios por artículo individual o por atributo (grupo de artículos)
function calcularPromoCondicional(reglas, carrito) {
  const grupos = reglas.grupos_condicion
    || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
    || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion, cantidad: reglas.cantidad_minima || 1 }]] : [])
  const listaBenef = reglas.articulos_beneficio || (reglas.articulo_beneficio ? [reglas.articulo_beneficio] : [])
  if (!grupos || grupos.length === 0 || listaBenef.length === 0) return null

  // Helper: buscar items del carrito que matchean una condición (artículo, atributo o marca)
  const findAllInCarrito = (cond) => {
    if (cond.tipo === 'atributo') {
      return carrito.filter(i => i.articulo.atributos?.some(a => a.id_valor === cond.id_valor))
    }
    if (cond.tipo === 'marca') {
      return carrito.filter(i => i.articulo.marca === cond.nombre)
    }
    const found = carrito.find(i => i.articulo.id === cond.id || (cond.codigo && String(i.articulo.codigo) === String(cond.codigo)))
    return found ? [found] : []
  }
  // Sumar cantidades de múltiples items del carrito
  const sumarCantidad = (items) => items.reduce((sum, i) => sum + i.cantidad, 0)

  let vecesPromo = 0, itemsCondicion = []
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
    for (const seg of segmentos) {
      if (seg.tipo === 'and') {
        for (const cond of seg.items) {
          const matches = findAllInCarrito(cond)
          const totalCant = sumarCantidad(matches)
          const cantReq = cond.cantidad || 1
          if (totalCant < cantReq) { cumple = false; break }
          veces = Math.min(veces, Math.floor(totalCant / cantReq))
          for (const ic of matches) itemsGrupo.push({ item: ic, cantReq, condRef: cond })
        }
      } else {
        let totalOrUnits = 0
        const orMatches = []
        for (const cond of seg.items) {
          const matches = findAllInCarrito(cond)
          const totalCant = sumarCantidad(matches)
          const cantReq = cond.cantidad || 1
          if (totalCant >= cantReq) {
            totalOrUnits += Math.floor(totalCant / cantReq)
            for (const ic of matches) orMatches.push({ item: ic, cantReq, condRef: cond })
          }
        }
        if (totalOrUnits === 0) { cumple = false }
        else {
          veces = Math.min(veces, totalOrUnits)
          for (const m of orMatches) itemsGrupo.push({ ...m, isOr: true })
        }
      }
      if (!cumple) break
    }
    if (cumple && veces > 0) { vecesPromo = veces; itemsCondicion = itemsGrupo; break }
  }
  if (vecesPromo <= 0) return null

  // Helper: ¿un item del carrito matchea un beneficio?
  const itemMatchesBenef = (cartItem, benef) => {
    if (benef.tipo === 'atributo') return cartItem.articulo.atributos?.some(a => a.id_valor === benef.id_valor)
    if (benef.tipo === 'marca') return cartItem.articulo.marca === benef.nombre
    return cartItem.articulo.id === benef.id || (benef.codigo && String(cartItem.articulo.codigo) === String(benef.codigo))
  }

  const descontados = new Set()
  const descuentoPorItem = {}
  const cantPorItem = {}
  let descuento = 0, orDescontados = 0

  // Agrupar items de condición por condRef para limitar descuento total por condición
  // (cuando un atributo matchea múltiples items, no descontar más que vecesPromo * cantReq en total)
  const condGroups = new Map() // condRef key → { items, cantReq, isOr }
  for (const entry of itemsCondicion) {
    const key = entry.condRef?.tipo === 'atributo' ? `attr:${entry.condRef.id_valor}` : entry.condRef?.tipo === 'marca' ? `mrc:${entry.condRef.nombre}` : `art:${entry.item.articulo.id}`
    if (!condGroups.has(key)) condGroups.set(key, { items: [], cantReq: entry.cantReq, isOr: entry.isOr })
    condGroups.get(key).items.push(entry.item)
  }

  for (const [, group] of condGroups) {
    const benefMatches = group.items.map(item => {
      const ab = listaBenef.find(ab => itemMatchesBenef(item, ab))
      return ab ? { item, ab } : null
    }).filter(Boolean)
    if (benefMatches.length === 0) continue
    // Usar la cantidad del BENEFICIO (no de la condición) para limitar unidades descontadas
    const cantBenefPorVez = benefMatches[0].ab.cantidad || Infinity
    const maxDesc = group.isOr
      ? (vecesPromo - orDescontados) * cantBenefPorVez
      : vecesPromo * cantBenefPorVez
    if (maxDesc <= 0) continue
    let restante = maxDesc
    for (const { item } of benefMatches) {
      if (restante <= 0) break
      const cantDesc = Math.min(restante, item.cantidad)
      const precio = calcularPrecioConDescuentosBase(item.articulo)
      const d = reglas.tipo_descuento === 'porcentaje'
        ? precio * cantDesc * ((reglas.valor || 0) / 100)
        : Math.min(reglas.valor || 0, precio) * cantDesc
      descuento += d
      descuentoPorItem[item.articulo.id] = (descuentoPorItem[item.articulo.id] || 0) + d
      cantPorItem[item.articulo.id] = (cantPorItem[item.articulo.id] || 0) + cantDesc
      descontados.add(item.articulo.id)
      restante -= cantDesc
    }
    if (group.isOr) orDescontados += Math.ceil((maxDesc - restante) / group.cantReq)
  }

  // Beneficios no-condición: buscar items del carrito que matchean beneficios pero no fueron usados como condición
  const condItemIds = new Set(itemsCondicion.map(ic => ic.item.articulo.id))
  for (const ab of listaBenef) {
    const cantLimiteBenef = ab.cantidad ? ab.cantidad * vecesPromo : Infinity
    let benefRestante = cantLimiteBenef
    const matchingItems = carrito.filter(i => itemMatchesBenef(i, ab) && !descontados.has(i.articulo.id) && !condItemIds.has(i.articulo.id))
    for (const found of matchingItems) {
      if (benefRestante <= 0) break
      const cantBenef = Math.min(benefRestante, found.cantidad)
      const precio = calcularPrecioConDescuentosBase(found.articulo)
      const d = reglas.tipo_descuento === 'porcentaje'
        ? precio * cantBenef * ((reglas.valor || 0) / 100)
        : Math.min(reglas.valor || 0, precio) * cantBenef
      descuento += d
      descuentoPorItem[found.articulo.id] = (descuentoPorItem[found.articulo.id] || 0) + d
      cantPorItem[found.articulo.id] = (cantPorItem[found.articulo.id] || 0) + cantBenef
      descontados.add(found.articulo.id)
      benefRestante -= cantBenef
    }
  }
  if (descuento <= 0) return null
  return { descuento, itemsAfectados: [...descontados], descuentoPorItem, cantPorItem }
}

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
        aplicadas.push({
          promoId: promo.id,
          promoNombre: promo.nombre,
          tipoPromo: 'porcentaje',
          detalle: `${reglas.valor}% off`,
          descuento,
          itemsAfectados: itemsMatch.map(i => i.articulo.id),
          descuentoPorItem,
          cantPorItem,
          _cantidadMinima: cantMin,
        })
        break
      }

      case 'monto_fijo': {
        const itemsMatch = carrito.filter(i => itemMatcheaRegla(i, reglas.aplicar_a))
        if (itemsMatch.length === 0) break
        const cantidadTotal = itemsMatch.reduce((s, i) => s + i.cantidad, 0)
        const cantMin = reglas.cantidad_minima || 1
        if (cantidadTotal < cantMin) break
        const cantidadQueCalifica = cantidadTotal
        const descuentoPorItem = {}
        const cantPorItem = {}
        let descuento = 0
        for (const i of itemsMatch) {
          const d = (reglas.valor || 0) * i.cantidad
          descuentoPorItem[i.articulo.id] = d
          cantPorItem[i.articulo.id] = i.cantidad
          descuento += d
        }
        aplicadas.push({
          promoId: promo.id,
          promoNombre: promo.nombre,
          tipoPromo: 'monto_fijo',
          detalle: `${formatPrecio(reglas.valor)} off x${cantidadQueCalifica}`,
          descuento,
          itemsAfectados: itemsMatch.map(i => i.articulo.id),
          descuentoPorItem,
          cantPorItem,
          _cantidadMinima: cantMin,
        })
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
        // Distribuir descuento proporcionalmente por item
        const descuentoPorItem = {}
        const cantPorItem = {}
        const subtotalNxM = itemsMatch.reduce((s, i) => s + calcularPrecioConDescuentosBase(i.articulo) * i.cantidad, 0)
        for (const i of itemsMatch) {
          const peso = (calcularPrecioConDescuentosBase(i.articulo) * i.cantidad) / subtotalNxM
          descuentoPorItem[i.articulo.id] = descuento * peso
          cantPorItem[i.articulo.id] = i.cantidad
        }
        aplicadas.push({
          promoId: promo.id,
          promoNombre: promo.nombre,
          tipoPromo: 'nxm',
          detalle: `${llevar}x${pagar} (${unidadesGratis} gratis)`,
          descuento,
          itemsAfectados: itemsMatch.map(i => i.articulo.id),
          descuentoPorItem,
          cantPorItem,
          _cantidadMinima: llevar,
        })
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
        // Distribuir descuento proporcionalmente por item
        const descuentoPorItem = {}
        const cantPorItem = {}
        for (const ci of comboItems) {
          const peso = (ci.precio * ci.cant) / sumaPreciosIndividuales
          descuentoPorItem[ci.id] = descuento * peso
          cantPorItem[ci.id] = ci.cant * combosPosibles
        }
        aplicadas.push({
          promoId: promo.id,
          promoNombre: promo.nombre,
          tipoPromo: 'combo',
          detalle: `Combo x${combosPosibles}`,
          descuento,
          itemsAfectados: articulosCombo.map(a => a.id),
          descuentoPorItem,
          cantPorItem,
        })
        break
      }

      case 'condicional': {
        // Backwards compat: normalizar a grupos_condicion (array de arrays)
        const grupos = reglas.grupos_condicion
          || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
          || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion, cantidad: reglas.cantidad_minima || 1 }]] : [])
        const listaBenef = reglas.articulos_beneficio || (reglas.articulo_beneficio ? [reglas.articulo_beneficio] : [])
        if (grupos.length === 0 || listaBenef.length === 0) break

        // Evaluar grupos con lógica OR entre grupos
        // Dentro de cada grupo: items con o:true consecutivos son alternativas (OR), el resto AND
        let vecesPromo = 0
        let itemsCondicion = []
        let grupoMatchNames = []
        for (const grupo of grupos) {
          if (!grupo || grupo.length === 0) continue
          // Parsear segmentos: AND items y OR sub-grupos
          // Items con o:true consecutivos forman un grupo OR entre ellos (no arrastran el AND previo)
          const segmentos = [] // cada segmento: { tipo: 'and'|'or', items: [{id, cantidad, nombre}] }
          for (const cond of grupo) {
            if (cond.o) {
              const ultimo = segmentos.length > 0 ? segmentos[segmentos.length - 1] : null
              if (ultimo && ultimo.tipo === 'or') {
                ultimo.items.push(cond)
              } else {
                segmentos.push({ tipo: 'or', items: [cond] })
              }
            } else {
              segmentos.push({ tipo: 'and', items: [cond] })
            }
          }
          // Evaluar todos los segmentos
          let veces = Infinity
          const itemsGrupo = []
          const matchedNames = []
          let cumple = true
          const findInCarrito = (cond) => {
            if (cond.tipo === 'atributo' || cond.tipo === 'marca') return null // usan findAllInCarritoGroup
            return carrito.find(i =>
              i.articulo.id === cond.id || (cond.codigo && String(i.articulo.codigo) === String(cond.codigo))
            )
          }
          const findAllInCarritoGroup = (cond) =>
            cond.tipo === 'marca'
              ? carrito.filter(i => i.articulo.marca === cond.nombre)
              : carrito.filter(i => i.articulo.atributos?.some(a => a.id_valor === cond.id_valor))
          for (const seg of segmentos) {
            if (seg.tipo === 'and') {
              // Todos deben estar
              for (const cond of seg.items) {
                if (cond.tipo === 'atributo' || cond.tipo === 'marca') {
                  const attrItems = findAllInCarritoGroup(cond)
                  const totalCant = attrItems.reduce((s, i) => s + i.cantidad, 0)
                  const cantReq = cond.cantidad || 1
                  if (totalCant < cantReq) { cumple = false; break }
                  veces = Math.min(veces, Math.floor(totalCant / cantReq))
                  for (const ai of attrItems) itemsGrupo.push({ item: ai, cantReq, condRef: cond })
                  matchedNames.push(`${cantReq}x ${cond.nombre}`)
                } else {
                  const itemCarro = findInCarrito(cond)
                  if (!itemCarro) { cumple = false; break }
                  const cantReq = cond.cantidad || 1
                  if (itemCarro.cantidad < cantReq) { cumple = false; break }
                  veces = Math.min(veces, Math.floor(itemCarro.cantidad / cantReq))
                  itemsGrupo.push({ item: itemCarro, cantReq })
                  matchedNames.push(`${cantReq}x ${cond.nombre}`)
                }
              }
            } else {
              // OR: sumar cantidades de TODAS las alternativas encontradas en el carrito
              let totalOrUnits = 0
              const orMatches = []
              for (const cond of seg.items) {
                const cantReq = cond.cantidad || 1
                if (cond.tipo === 'atributo' || cond.tipo === 'marca') {
                  const attrItems = findAllInCarritoGroup(cond)
                  const totalCant = attrItems.reduce((s, i) => s + i.cantidad, 0)
                  if (totalCant >= cantReq) {
                    totalOrUnits += Math.floor(totalCant / cantReq)
                    for (const ai of attrItems) orMatches.push({ item: ai, cantReq, cond, condRef: cond })
                  }
                } else {
                  const itemCarro = findInCarrito(cond)
                  if (itemCarro && itemCarro.cantidad >= cantReq) {
                    const units = Math.floor(itemCarro.cantidad / cantReq)
                    totalOrUnits += units
                    orMatches.push({ item: itemCarro, cantReq, units, cond })
                  }
                }
              }
              if (totalOrUnits === 0) { cumple = false }
              else {
                veces = Math.min(veces, totalOrUnits)
                for (const m of orMatches) {
                  itemsGrupo.push({ item: m.item, cantReq: m.cantReq, isOr: true, condRef: m.condRef })
                  matchedNames.push(`${m.cantReq}x ${m.cond.nombre}`)
                }
              }
            }
            if (!cumple) break
          }
          if (cumple && veces > 0) {
            vecesPromo = veces
            itemsCondicion = itemsGrupo
            grupoMatchNames = matchedNames
            break // OR entre grupos: basta con uno
          }
        }
        if (vecesPromo <= 0) break

        // Determinar qué items se descuentan
        const itemMatchesBenefLocal = (cartItem, ab) => {
          if (ab.tipo === 'atributo') return cartItem.articulo.atributos?.some(a => a.id_valor === ab.id_valor)
          if (ab.tipo === 'marca') return cartItem.articulo.marca === ab.nombre
          return cartItem.articulo.id === ab.id || (ab.codigo && String(cartItem.articulo.codigo) === String(ab.codigo))
        }
        // 1) Artículos que participaron en la condición Y están en beneficios
        // Usar la cantidad del BENEFICIO (no de la condición) para limitar unidades descontadas
        const descontados = new Set()
        const descuentoPorItem = {} // articuloId -> monto descuento
        const cantPorItem = {} // articuloId -> cant unidades descontadas
        let descuento = 0
        let orDescontados = 0
        for (const { item, cantReq, isOr } of itemsCondicion) {
          const abMatch = listaBenef.find(ab => itemMatchesBenefLocal(item, ab))
          if (!abMatch) continue
          // Usar cantidad del beneficio para limitar cuántas unidades se descuentan
          const cantBenefPorVez = abMatch.cantidad || Infinity
          if (isOr) {
            const orDisponible = vecesPromo - orDescontados
            if (orDisponible <= 0) continue
            const cantDescontada = Math.min(orDisponible * cantBenefPorVez, item.cantidad)
            const precio = calcularPrecioConDescuentosBase(item.articulo)
            let itemDesc = 0
            if (reglas.tipo_descuento === 'porcentaje') {
              itemDesc = precio * cantDescontada * ((reglas.valor || 0) / 100)
            } else {
              itemDesc = Math.min(reglas.valor || 0, precio) * cantDescontada
            }
            descuento += itemDesc
            descuentoPorItem[item.articulo.id] = (descuentoPorItem[item.articulo.id] || 0) + itemDesc
            cantPorItem[item.articulo.id] = (cantPorItem[item.articulo.id] || 0) + cantDescontada
            orDescontados += Math.ceil(cantDescontada / cantBenefPorVez)
            descontados.add(item.articulo.id)
          } else {
            const cantDescontada = Math.min(vecesPromo * cantBenefPorVez, item.cantidad)
            const precio = calcularPrecioConDescuentosBase(item.articulo)
            let itemDesc = 0
            if (reglas.tipo_descuento === 'porcentaje') {
              itemDesc = precio * cantDescontada * ((reglas.valor || 0) / 100)
            } else {
              itemDesc = Math.min(reglas.valor || 0, precio) * cantDescontada
            }
            descuento += itemDesc
            descuentoPorItem[item.articulo.id] = (descuentoPorItem[item.articulo.id] || 0) + itemDesc
            cantPorItem[item.articulo.id] = (cantPorItem[item.articulo.id] || 0) + cantDescontada
            descontados.add(item.articulo.id)
          }
        }
        // 2) Beneficios que NO son parte de ningún grupo condición → descuento limitado por vecesPromo * cantidad beneficio
        const condItemIds = new Set(itemsCondicion.map(ic => ic.item.articulo.id))
        for (const ab of listaBenef) {
          const cantLimiteBenef = ab.cantidad ? ab.cantidad * vecesPromo : Infinity
          let benefRestante = cantLimiteBenef
          // Find matching items not already discounted and not condition items
          const matchingItems = carrito.filter(i =>
            itemMatchesBenefLocal(i, ab) && !descontados.has(i.articulo.id) && !condItemIds.has(i.articulo.id)
          )
          for (const found of matchingItems) {
            if (benefRestante <= 0) break
            const cantBenef = Math.min(benefRestante, found.cantidad)
            const precio = calcularPrecioConDescuentosBase(found.articulo)
            let itemDesc = 0
            if (reglas.tipo_descuento === 'porcentaje') {
              itemDesc = precio * cantBenef * ((reglas.valor || 0) / 100)
            } else {
              itemDesc = Math.min(reglas.valor || 0, precio) * cantBenef
            }
            descuento += itemDesc
            descuentoPorItem[found.articulo.id] = (descuentoPorItem[found.articulo.id] || 0) + itemDesc
            cantPorItem[found.articulo.id] = (cantPorItem[found.articulo.id] || 0) + cantBenef
            descontados.add(found.articulo.id)
            benefRestante -= cantBenef
          }
        }
        if (descuento <= 0) break
        const condDetalle = grupoMatchNames.join(' + ')
        const itemsAfectados = [...descontados]
        // Guardar items de condición usados (articuloId -> cantUsada) para dedup
        // Cuando un atributo matchea múltiples items, distribuir vecesPromo*cantReq entre ellos
        const itemsCondicionUsados = {}
        // Agrupar items por condRef para distribuir correctamente
        const porCondRef = new Map()
        for (const entry of itemsCondicion) {
          const key = entry.condRef
          if (!porCondRef.has(key)) porCondRef.set(key, [])
          porCondRef.get(key).push(entry)
        }
        let orReservados = 0
        for (const [condRef, entries] of porCondRef) {
          const isOr = entries[0].isOr
          const cantReq = entries[0].cantReq
          if (isOr) {
            // OR: reservar solo vecesPromo items
            for (const { item } of entries) {
              if (orReservados >= vecesPromo) break
              const reservar = Math.min(cantReq, item.cantidad)
              itemsCondicionUsados[item.articulo.id] = (itemsCondicionUsados[item.articulo.id] || 0) + reservar
              orReservados++
            }
          } else {
            // AND: distribuir vecesPromo*cantReq entre items que matchearon
            let totalNecesario = vecesPromo * cantReq
            for (const { item } of entries) {
              if (totalNecesario <= 0) break
              const reservar = Math.min(item.cantidad, totalNecesario)
              itemsCondicionUsados[item.articulo.id] = (itemsCondicionUsados[item.articulo.id] || 0) + reservar
              totalNecesario -= reservar
            }
          }
        }
        aplicadas.push({
          promoId: promo.id,
          promoNombre: promo.nombre,
          tipoPromo: 'condicional',
          detalle: `${condDetalle} → ${reglas.valor}${reglas.tipo_descuento === 'porcentaje' ? '%' : '$'} off en ${descontados.size} art${descontados.size > 1 ? 's' : ''}`,
          descuento,
          itemsAfectados,
          descuentoPorItem,
          cantPorItem,
          itemsCondicionUsados,
          _reglas: reglas, // para re-evaluar condición en dedup
        })
        break
      }
    }
  }

  // Deduplicar promos: cada artículo recibe solo el mejor descuento.
  // forma_pago siempre pasa (se aplica aparte en cobro).
  // Paso 1: Resolver conflictos de condición entre condicionales (greedy por desc)
  // Paso 2: Per-item, de todas las promos que lo afectan, quedarse con la de mayor descuento
  if (aplicadas.length > 1) {
    // forma_pago siempre pasa
    const formaPago = aplicadas.filter(p => p.tipoPromo === 'forma_pago')
    const promos = aplicadas.filter(p => p.tipoPromo !== 'forma_pago')

    // Paso 1: Resolver conflictos de condición entre condicionales
    // Re-evalúa condiciones contra stock disponible (no pre-computado)
    const condicionales = promos.filter(p => p.tipoPromo === 'condicional')
    const noCondicionales = promos.filter(p => p.tipoPromo !== 'condicional')
    const condValidas = []
    if (condicionales.length > 0) {
      condicionales.sort((a, b) => b.descuento - a.descuento)
      const disponible = {}
      for (const item of carrito) disponible[item.articulo.id] = item.cantidad

      // Función para intentar reservar condición de una promo contra disponibilidad actual
      const intentarReservar = (promo) => {
        // Re-parsear los grupos de condición y evaluar contra disponible
        const reglas = promo._reglas
        if (!reglas) return null
        const grupos = reglas.grupos_condicion
          || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
          || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion, cantidad: reglas.cantidad_minima || 1 }]] : [])
        if (!grupos || grupos.length === 0) return null

        const findDisp = (cond) => {
          if (cond.tipo === 'atributo' || cond.tipo === 'marca') {
            // Para atributos/marcas, sumar disponibilidad de todos los items que matchean
            const matches = cond.tipo === 'marca'
              ? carrito.filter(i => i.articulo.marca === cond.nombre)
              : carrito.filter(i => i.articulo.atributos?.some(a => a.id_valor === cond.id_valor))
            if (matches.length === 0) return null
            const totalDisp = matches.reduce((s, i) => s + (disponible[i.articulo.id] || 0), 0)
            return totalDisp > 0 ? { item: matches[0], dispCant: totalDisp, items: matches } : null
          }
          const item = carrito.find(i =>
            i.articulo.id === cond.id || (cond.codigo && String(i.articulo.codigo) === String(cond.codigo))
          )
          if (!item) return null
          const dispCant = disponible[item.articulo.id] || 0
          return dispCant > 0 ? { item, dispCant } : null
        }

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
          // Paso A: calcular veces (sin reservar)
          let veces = Infinity
          let cumple = true
          const segCondData = [] // guardar datos para paso B
          for (const seg of segmentos) {
            if (seg.tipo === 'and') {
              for (const cond of seg.items) {
                const r = findDisp(cond)
                const cantReq = cond.cantidad || 1
                if (!r || r.dispCant < cantReq) { cumple = false; break }
                veces = Math.min(veces, Math.floor(r.dispCant / cantReq))
                segCondData.push({ tipo: 'and', cond, r, cantReq })
              }
            } else {
              let found = false
              for (const cond of seg.items) {
                const r = findDisp(cond)
                const cantReq = cond.cantidad || 1
                if (r && r.dispCant >= cantReq) {
                  veces = Math.min(veces, Math.floor(r.dispCant / cantReq))
                  segCondData.push({ tipo: 'or', cond, r, cantReq })
                  found = true
                  break
                }
              }
              if (!found) { cumple = false }
            }
            if (!cumple) break
          }
          if (cumple && veces > 0) {
            // Paso B: construir reservas con veces*cantReq, distribuyendo entre todos los items
            const reservas = []
            for (const { r, cantReq } of segCondData) {
              const totalReservar = veces * cantReq
              if (r.items) {
                let pendiente = totalReservar
                for (const it of r.items) {
                  if (pendiente <= 0) break
                  const d = Math.min(pendiente, disponible[it.articulo.id] || 0)
                  if (d > 0) { reservas.push({ artId: it.articulo.id, cant: d }); pendiente -= d }
                }
              } else {
                reservas.push({ artId: r.item.articulo.id, cant: totalReservar })
              }
            }
            return reservas
          }
        }
        return null
      }

      for (const promo of condicionales) {
        const reservas = intentarReservar(promo)
        if (reservas) {
          for (const { artId, cant } of reservas) disponible[artId] -= cant
          // Re-evaluar descuento con carrito virtual (disponibilidad pre-reserva + lo que reservó)
          // para que itemsAfectados/descuentoPorItem reflejen los items realmente usados
          const carritoVirtual = carrito.map(i => {
            const id = i.articulo.id
            // Disponible después de reservar + lo que esta promo reservó
            const cantDisp = (disponible[id] || 0) + (reservas.find(r => r.artId === id)?.cant || 0)
            return { ...i, cantidad: Math.min(i.cantidad, cantDisp) }
          }).filter(i => i.cantidad > 0)
          const reeval = calcularPromoCondicional(promo._reglas, carritoVirtual)
          // Reconstruir itemsCondicionUsados desde reservas reales del paso 1
          const itemsCondicionUsados = {}
          for (const { artId, cant } of reservas) {
            itemsCondicionUsados[artId] = (itemsCondicionUsados[artId] || 0) + cant
          }
          if (reeval) {
            condValidas.push({ ...promo, ...reeval, itemsCondicionUsados })
          } else {
            condValidas.push({ ...promo, itemsCondicionUsados }) // fallback: usar datos originales
          }
        }
      }
    }

    // Paso 2: Condicionales ya tienen su descuento final (del reeval).
    // Solo las no-condicionales pasan por dedup per-unit contra unidades restantes.
    if (noCondicionales.length === 0) return [...formaPago, ...condValidas]

    // Reservar TODAS las unidades involucradas en promos condicionales (condición + beneficio)
    const unidadesReservadas = {} // artId → cant reservada
    for (const promo of condValidas) {
      const porArt = {} // artId → { condicion, beneficio }
      for (const [artId, cant] of Object.entries(promo.itemsCondicionUsados || {})) {
        if (!porArt[artId]) porArt[artId] = { condicion: 0, beneficio: 0 }
        porArt[artId].condicion += cant
      }
      for (const [artId, cant] of Object.entries(promo.cantPorItem || {})) {
        if (!porArt[artId]) porArt[artId] = { condicion: 0, beneficio: 0 }
        porArt[artId].beneficio += cant
      }
      for (const [artId, { condicion, beneficio }] of Object.entries(porArt)) {
        // Si el artículo es ambos (condición + beneficio), las unidades de beneficio
        // están contenidas en las de condición, así que tomar condición.
        // Si solo es beneficio (artículo distinto), sumar beneficio.
        const reservar = condicion > 0 ? condicion : beneficio
        unidadesReservadas[artId] = (unidadesReservadas[artId] || 0) + reservar
      }
    }

    // Dedup solo para no-condicionales: asignar unidades restantes por rate DESC
    const articulosAfectados = new Set()
    for (const p of noCondicionales) {
      for (const id of (p.itemsAfectados || [])) articulosAfectados.add(id)
    }

    const promoDescFinal = new Map() // promoIdx -> descuento recalculado
    const promoItemsFinal = new Map() // promoIdx -> [itemIds]
    for (const artId of articulosAfectados) {
      const itemCarrito = carrito.find(i => i.articulo.id === artId)
      if (!itemCarrito) continue
      let unidadesDisp = itemCarrito.cantidad - (unidadesReservadas[artId] || 0)
      if (unidadesDisp <= 0) continue

      const claims = []
      noCondicionales.forEach((promo, idx) => {
        if (!(promo.itemsAfectados || []).includes(artId)) return
        // Re-validar cantidad_minima: si la promo requiere N unidades y no hay suficientes
        // después de reservar condicionales, no aplicar
        const cantMin = promo._cantidadMinima || 1
        if (cantMin > 1) {
          // Contar unidades disponibles totales de todos los items que matchean esta promo
          const totalDisp = (promo.itemsAfectados || []).reduce((sum, id) => {
            const ic = carrito.find(i => i.articulo.id === id)
            return sum + ((ic?.cantidad || 0) - (unidadesReservadas[id] || 0))
          }, 0)
          if (totalDisp < cantMin) return
        }
        const descTotal = (promo.descuentoPorItem || {})[artId] || 0
        const cantClaimed = (promo.cantPorItem || {})[artId] || 1
        const rate = descTotal / cantClaimed
        claims.push({ idx, rate, cantClaimed })
      })

      claims.sort((a, b) => b.rate - a.rate)

      for (const { idx, rate, cantClaimed } of claims) {
        if (unidadesDisp <= 0) break
        const asignadas = Math.min(cantClaimed, unidadesDisp)
        const descAsignado = rate * asignadas
        promoDescFinal.set(idx, (promoDescFinal.get(idx) || 0) + descAsignado)
        if (!promoItemsFinal.has(idx)) promoItemsFinal.set(idx, new Set())
        promoItemsFinal.get(idx).add(artId)
        unidadesDisp -= asignadas
      }
    }

    // Resultado: formaPago + condicionales (con su descuento original) + no-condicionales deduplicadas
    const resultado = [...formaPago, ...condValidas]
    noCondicionales.forEach((promo, idx) => {
      if (promoDescFinal.has(idx) && promoDescFinal.get(idx) > 0) {
        resultado.push({
          ...promo,
          descuento: promoDescFinal.get(idx),
          itemsAfectados: [...(promoItemsFinal.get(idx) || [])],
        })
      }
    })
    return resultado
  }

  return aplicadas
}

export { calcularPromocionesLocales, calcularPrecioConDescuentosBase, formatPrecio }
export default calcularPromocionesLocales
