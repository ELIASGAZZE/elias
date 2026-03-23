// Test standalone del motor de promos + dedup
// Simula: 3x PV(7935) + 2x Syrah(7936) + 2x Atemporal(6015)
// Promo 15% vinos (porcentaje) + condicional "2x LINEA_BODEGA → 99% ATEMPORAL"

const ATTR_LINEA_BODEGA_ESCASOS = 100 // id_valor del atributo "LINEA DE BODEGA: LOS ESCASOS"
const ATTR_LINEA_BODEGA_ATEMPORAL = 200

function calcularPrecioConDescuentosBase(articulo) {
  let precio = articulo.precio || 0
  if (articulo.descuento1) precio *= (1 - articulo.descuento1 / 100)
  if (articulo.descuento2) precio *= (1 - articulo.descuento2 / 100)
  if (articulo.descuento3) precio *= (1 - articulo.descuento3 / 100)
  return precio
}

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

function promoEnRango() { return true }
const formatPrecio = (n) => `$${n}`

function calcularPromoCondicional(reglas, carrito) {
  const grupos = reglas.grupos_condicion
    || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
    || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion, cantidad: reglas.cantidad_minima || 1 }]] : [])
  const listaBenef = reglas.articulos_beneficio || (reglas.articulo_beneficio ? [reglas.articulo_beneficio] : [])
  if (!grupos || grupos.length === 0 || listaBenef.length === 0) return null

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

  const itemMatchesBenef = (cartItem, benef) => {
    if (benef.tipo === 'atributo') return cartItem.articulo.atributos?.some(a => a.id_valor === benef.id_valor)
    if (benef.tipo === 'marca') return cartItem.articulo.marca === benef.nombre
    return cartItem.articulo.id === benef.id || (benef.codigo && String(cartItem.articulo.codigo) === String(benef.codigo))
  }

  const descontados = new Set()
  const descuentoPorItem = {}
  const cantPorItem = {}
  let descuento = 0, orDescontados = 0

  const condGroups = new Map()
  for (const entry of itemsCondicion) {
    const key = entry.condRef?.tipo === 'atributo' ? `attr:${entry.condRef.id_valor}` : entry.condRef?.tipo === 'marca' ? `mrc:${entry.condRef.nombre}` : `art:${entry.item.articulo.id}`
    if (!condGroups.has(key)) condGroups.set(key, { items: [], cantReq: entry.cantReq, isOr: entry.isOr })
    condGroups.get(key).items.push(entry.item)
  }

  for (const [, group] of condGroups) {
    const benefItems = group.items.filter(item => listaBenef.some(ab => itemMatchesBenef(item, ab)))
    if (benefItems.length === 0) continue
    const maxDesc = group.isOr
      ? (vecesPromo - orDescontados) * group.cantReq
      : vecesPromo * group.cantReq
    if (maxDesc <= 0) continue
    let restante = maxDesc
    for (const item of benefItems) {
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

  const condItemIds = new Set(itemsCondicion.map(ic => ic.item.articulo.id))
  let benefRestante = vecesPromo
  for (const ab of listaBenef) {
    if (benefRestante <= 0) break
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

// ====== MAIN: calcularPromocionesLocales (copy from POS.jsx with dedup) ======

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
        })
        break
      }
      case 'condicional': {
        const grupos = reglas.grupos_condicion
          || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
          || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion, cantidad: reglas.cantidad_minima || 1 }]] : [])
        const listaBenef = reglas.articulos_beneficio || (reglas.articulo_beneficio ? [reglas.articulo_beneficio] : [])
        if (grupos.length === 0 || listaBenef.length === 0) break

        let vecesPromo = 0
        let itemsCondicion = []
        let grupoMatchNames = []
        for (const grupo of grupos) {
          if (!grupo || grupo.length === 0) continue
          const segmentos = []
          for (const cond of grupo) {
            if (cond.o) {
              const ultimo = segmentos.length > 0 ? segmentos[segmentos.length - 1] : null
              if (ultimo && ultimo.tipo === 'or') { ultimo.items.push(cond) }
              else { segmentos.push({ tipo: 'or', items: [cond] }) }
            } else {
              segmentos.push({ tipo: 'and', items: [cond] })
            }
          }
          let veces = Infinity
          const itemsGrupo = []
          const matchedNames = []
          let cumple = true
          const findInCarrito = (cond) => {
            if (cond.tipo === 'atributo' || cond.tipo === 'marca') return null
            return carrito.find(i => i.articulo.id === cond.id || (cond.codigo && String(i.articulo.codigo) === String(cond.codigo)))
          }
          const findAllInCarritoGroup = (cond) =>
            cond.tipo === 'marca'
              ? carrito.filter(i => i.articulo.marca === cond.nombre)
              : carrito.filter(i => i.articulo.atributos?.some(a => a.id_valor === cond.id_valor))
          for (const seg of segmentos) {
            if (seg.tipo === 'and') {
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
              // OR logic (simplified for test)
              cumple = false
            }
            if (!cumple) break
          }
          if (cumple && veces > 0) {
            vecesPromo = veces
            itemsCondicion = itemsGrupo
            grupoMatchNames = matchedNames
            break
          }
        }
        if (vecesPromo <= 0) break

        const itemMatchesBenefLocal = (cartItem, ab) => {
          if (ab.tipo === 'atributo') return cartItem.articulo.atributos?.some(a => a.id_valor === ab.id_valor)
          if (ab.tipo === 'marca') return cartItem.articulo.marca === ab.nombre
          return cartItem.articulo.id === ab.id || (ab.codigo && String(cartItem.articulo.codigo) === String(ab.codigo))
        }
        const descontados = new Set()
        const descuentoPorItem = {}
        const cantPorItem = {}
        let descuento = 0
        let orDescontados = 0
        for (const { item, cantReq, isOr } of itemsCondicion) {
          const enBenef = listaBenef.some(ab => itemMatchesBenefLocal(item, ab))
          if (!enBenef) continue
          const cantDescontada = Math.min(vecesPromo * cantReq, item.cantidad)
          const precio = calcularPrecioConDescuentosBase(item.articulo)
          let itemDesc = reglas.tipo_descuento === 'porcentaje'
            ? precio * cantDescontada * ((reglas.valor || 0) / 100)
            : Math.min(reglas.valor || 0, precio) * cantDescontada
          descuento += itemDesc
          descuentoPorItem[item.articulo.id] = (descuentoPorItem[item.articulo.id] || 0) + itemDesc
          cantPorItem[item.articulo.id] = (cantPorItem[item.articulo.id] || 0) + cantDescontada
          descontados.add(item.articulo.id)
        }
        const condItemIds = new Set(itemsCondicion.map(ic => ic.item.articulo.id))
        for (const ab of listaBenef) {
          const cantLimiteBenef = ab.cantidad ? ab.cantidad * vecesPromo : vecesPromo
          let benefRestante = cantLimiteBenef
          const matchingItems = carrito.filter(i =>
            itemMatchesBenefLocal(i, ab) && !descontados.has(i.articulo.id) && !condItemIds.has(i.articulo.id)
          )
          for (const found of matchingItems) {
            if (benefRestante <= 0) break
            const cantBenef = Math.min(benefRestante, found.cantidad)
            const precio = calcularPrecioConDescuentosBase(found.articulo)
            let itemDesc = reglas.tipo_descuento === 'porcentaje'
              ? precio * cantBenef * ((reglas.valor || 0) / 100)
              : Math.min(reglas.valor || 0, precio) * cantBenef
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
        // itemsCondicionUsados
        const itemsCondicionUsados = {}
        const porCondRef = new Map()
        for (const entry of itemsCondicion) {
          const key = entry.condRef
          if (!porCondRef.has(key)) porCondRef.set(key, [])
          porCondRef.get(key).push(entry)
        }
        for (const [, entries] of porCondRef) {
          const isOr = entries[0].isOr
          const cantReq = entries[0].cantReq
          let totalNecesario = vecesPromo * cantReq
          for (const { item } of entries) {
            if (totalNecesario <= 0) break
            const reservar = Math.min(item.cantidad, totalNecesario)
            itemsCondicionUsados[item.articulo.id] = (itemsCondicionUsados[item.articulo.id] || 0) + reservar
            totalNecesario -= reservar
          }
        }
        aplicadas.push({
          promoId: promo.id,
          promoNombre: promo.nombre,
          tipoPromo: 'condicional',
          detalle: condDetalle,
          descuento,
          itemsAfectados,
          descuentoPorItem,
          cantPorItem,
          itemsCondicionUsados,
          _reglas: reglas,
        })
        break
      }
    }
  }

  // DEDUP
  if (aplicadas.length > 1) {
    const formaPago = aplicadas.filter(p => p.tipoPromo === 'forma_pago')
    const promos = aplicadas.filter(p => p.tipoPromo !== 'forma_pago')
    const condicionales = promos.filter(p => p.tipoPromo === 'condicional')
    const noCondicionales = promos.filter(p => p.tipoPromo !== 'condicional')
    const condValidas = []
    if (condicionales.length > 0) {
      condicionales.sort((a, b) => b.descuento - a.descuento)
      const disponible = {}
      for (const item of carrito) disponible[item.articulo.id] = item.cantidad

      const intentarReservar = (promo) => {
        const reglas = promo._reglas
        if (!reglas) return null
        const grupos = reglas.grupos_condicion
          || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
          || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion, cantidad: reglas.cantidad_minima || 1 }]] : [])
        if (!grupos || grupos.length === 0) return null

        const findDisp = (cond) => {
          if (cond.tipo === 'atributo' || cond.tipo === 'marca') {
            const matches = cond.tipo === 'marca'
              ? carrito.filter(i => i.articulo.marca === cond.nombre)
              : carrito.filter(i => i.articulo.atributos?.some(a => a.id_valor === cond.id_valor))
            if (matches.length === 0) return null
            const totalDisp = matches.reduce((s, i) => s + (disponible[i.articulo.id] || 0), 0)
            return totalDisp > 0 ? { item: matches[0], dispCant: totalDisp, items: matches } : null
          }
          const item = carrito.find(i => i.articulo.id === cond.id || (cond.codigo && String(i.articulo.codigo) === String(cond.codigo)))
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
          // Paso A: calcular veces
          let veces = Infinity
          let cumple = true
          const segCondData = []
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
            // Paso B: reservar veces*cantReq
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
        console.log('  [P1] reservas:', JSON.stringify(reservas))
        if (reservas) {
          for (const { artId, cant } of reservas) disponible[artId] -= cant
          const carritoVirtual = carrito.map(i => {
            const id = i.articulo.id
            const cantDisp = (disponible[id] || 0) + (reservas.find(r => r.artId === id)?.cant || 0)
            return { ...i, cantidad: Math.min(i.cantidad, cantDisp) }
          }).filter(i => i.cantidad > 0)
          const reeval = calcularPromoCondicional(promo._reglas, carritoVirtual)
          const itemsCondicionUsados = {}
          for (const { artId, cant } of reservas) {
            itemsCondicionUsados[artId] = (itemsCondicionUsados[artId] || 0) + cant
          }
          console.log('  [P1] itemsCondicionUsados:', JSON.stringify(itemsCondicionUsados))
          console.log('  [P1] reeval itemsAfectados:', reeval?.itemsAfectados)
          if (reeval) {
            condValidas.push({ ...promo, ...reeval, itemsCondicionUsados })
          } else {
            condValidas.push({ ...promo, itemsCondicionUsados })
          }
        }
      }
    }

    const todasPromos = [...noCondicionales, ...condValidas]
    if (todasPromos.length <= 1) return [...formaPago, ...todasPromos]

    const articulosAfectados = new Set()
    for (const p of todasPromos) {
      for (const id of (p.itemsAfectados || [])) articulosAfectados.add(id)
    }

    const unidadesReservadas = {}
    for (const promo of condValidas) {
      console.log('  [P2] promo condValida itemsCondicionUsados:', JSON.stringify(promo.itemsCondicionUsados), 'itemsAfectados:', promo.itemsAfectados)
      for (const [artId, cant] of Object.entries(promo.itemsCondicionUsados || {})) {
        if (!(promo.itemsAfectados || []).includes(Number(artId))) {
          unidadesReservadas[artId] = (unidadesReservadas[artId] || 0) + cant
        } else {
          console.log(`  [P2] FILTERED OUT artId=${artId} (is in itemsAfectados)`)
        }
      }
    }

    console.log('  [P2] unidadesReservadas:', JSON.stringify(unidadesReservadas))
    console.log('  [P2] articulosAfectados:', [...articulosAfectados])

    const promoDescFinal = new Map()
    const promoItemsFinal = new Map()
    for (const artId of articulosAfectados) {
      const itemCarrito = carrito.find(i => i.articulo.id === artId)
      if (!itemCarrito) continue
      let unidadesDisp = itemCarrito.cantidad - (unidadesReservadas[artId] || 0)
      if (unidadesDisp <= 0) { console.log(`  [P2] artId=${artId} SKIP (reservado completo)`); continue }

      const claims = []
      todasPromos.forEach((promo, idx) => {
        if (!(promo.itemsAfectados || []).includes(artId)) return
        const descTotal = (promo.descuentoPorItem || {})[artId] || 0
        const cantClaimed = (promo.cantPorItem || {})[artId] || 1
        const rate = descTotal / cantClaimed
        claims.push({ idx, rate, cantClaimed, promoNombre: promo.promoNombre })
      })
      claims.sort((a, b) => b.rate - a.rate)
      console.log(`  [P2] artId=${artId} cant=${itemCarrito.cantidad} reservadas=${unidadesReservadas[artId]||0} disp=${unidadesDisp} claims:`, claims.map(c => `${c.promoNombre}(cant=${c.cantClaimed},rate=${c.rate.toFixed(2)})`))

      for (const { idx, rate, cantClaimed } of claims) {
        if (unidadesDisp <= 0) break
        const asignadas = Math.min(cantClaimed, unidadesDisp)
        const descAsignado = rate * asignadas
        promoDescFinal.set(idx, (promoDescFinal.get(idx) || 0) + descAsignado)
        if (!promoItemsFinal.has(idx)) promoItemsFinal.set(idx, new Set())
        promoItemsFinal.get(idx).add(artId)
        unidadesDisp -= asignadas
        console.log(`    → asignar ${asignadas} a ${todasPromos[idx].promoNombre}, desc=${descAsignado.toFixed(2)}, disp_restante=${unidadesDisp}`)
      }
    }

    const resultado = [...formaPago]
    todasPromos.forEach((promo, idx) => {
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

// ============ TEST DATA ============
// Test case 1: 2+2 LOS ESCASOS + 2 ATEMPORAL (exacto, no debería haber 15%)
const carrito = [
  { articulo: { id: 7935, codigo: '07935', nombre: 'PETIT VERDOT', precio: 16500.17, marca: 'ALTA VISTA', atributos: [{ id_valor: ATTR_LINEA_BODEGA_ESCASOS }] }, cantidad: 2 },
  { articulo: { id: 7936, codigo: '07937', nombre: 'SYRAH', precio: 16500.17, marca: 'ALTA VISTA', atributos: [{ id_valor: ATTR_LINEA_BODEGA_ESCASOS }] }, cantidad: 2 },
  { articulo: { id: 6015, codigo: '06014', nombre: 'ATEMPORAL BLEND', precio: 16500.17, marca: 'ALTA VISTA', atributos: [{ id_valor: ATTR_LINEA_BODEGA_ATEMPORAL }] }, cantidad: 2 },
]

const promociones = [
  {
    id: 1,
    nombre: '15% vinos',
    tipo: 'porcentaje',
    activa: true,
    reglas: {
      valor: 15,
      aplicar_a: [{ tipo: 'atributo', id_valor: ATTR_LINEA_BODEGA_ESCASOS }, { tipo: 'atributo', id_valor: ATTR_LINEA_BODEGA_ATEMPORAL }],
    }
  },
  {
    id: 2,
    nombre: 'ALTA VISTA LOS ESCASOS condicional',
    tipo: 'condicional',
    activa: true,
    reglas: {
      grupos_condicion: [[{ tipo: 'atributo', id_valor: ATTR_LINEA_BODEGA_ESCASOS, nombre: 'LINEA DE BODEGA: ALTA VISTA LOS ESCASOS', cantidad: 2 }]],
      articulos_beneficio: [{ tipo: 'atributo', id_valor: ATTR_LINEA_BODEGA_ATEMPORAL, nombre: 'ATEMPORAL' }],
      tipo_descuento: 'porcentaje',
      valor: 99,
    }
  },
]

// ============ TEST 1: cantidad beneficio no definida (comportamiento actual) ============
console.log('=== TEST 1: 2+2+2, sin cantidad en beneficio ===')
const result1 = calcularPromocionesLocales(carrito, promociones)
console.log('Resultado:')
for (const r of result1) console.log(`  ${r.promoNombre}: -$${r.descuento.toFixed(2)} (items: ${r.itemsAfectados})`)
const t1_15 = result1.find(r => r.promoNombre === '15% vinos')
console.log(t1_15 ? `❌ 15% NO debería aparecer` : '✅ 15% excluido')

// ============ TEST 2: beneficio con cantidad=2 ============
console.log('\n=== TEST 2: condición 2x ATEMPORAL, beneficio cantidad=2 PREMIUM ESTATE ===')
const ATTR_PREMIUM = 300
const carrito2 = [
  { articulo: { id: 6015, codigo: '06014', nombre: 'ATEMPORAL', precio: 16500, atributos: [{ id_valor: ATTR_LINEA_BODEGA_ATEMPORAL }] }, cantidad: 2 },
  { articulo: { id: 8000, codigo: '08000', nombre: 'PREMIUM ESTATE', precio: 20000, atributos: [{ id_valor: ATTR_PREMIUM }] }, cantidad: 5 },
]
const promos2 = [{
  id: 10, nombre: 'Cond: 2x ATEMPORAL → 100% en 2x PREMIUM', tipo: 'condicional', activa: true,
  reglas: {
    grupos_condicion: [[{ tipo: 'atributo', id_valor: ATTR_LINEA_BODEGA_ATEMPORAL, nombre: 'ATEMPORAL', cantidad: 2 }]],
    articulos_beneficio: [{ tipo: 'atributo', id_valor: ATTR_PREMIUM, nombre: 'PREMIUM ESTATE', cantidad: 2 }],
    tipo_descuento: 'porcentaje', valor: 100,
  }
}]
const result2 = calcularPromocionesLocales(carrito2, promos2)
console.log('Resultado:')
for (const r of result2) console.log(`  ${r.promoNombre}: -$${r.descuento.toFixed(2)} (items: ${r.itemsAfectados})`)
// Esperado: 100% en 2 PREMIUM = -$40,000 (no 1, no 5)
const cond2 = result2.find(r => r.tipoPromo === 'condicional')
if (cond2 && Math.abs(cond2.descuento - 40000) < 1) {
  console.log('✅ Descuento en 2 unidades de PREMIUM ($40,000)')
} else {
  console.log(`❌ Esperado $40,000 pero dio $${cond2?.descuento?.toFixed(2) || 'nada'}`)
}

// ============ TEST 3: beneficio sin cantidad (default = vecesPromo) ============
console.log('\n=== TEST 3: mismo caso pero sin cantidad en beneficio ===')
const promos3 = [{
  id: 10, nombre: 'Cond: 2x ATEMPORAL → 100% en PREMIUM (sin cant)', tipo: 'condicional', activa: true,
  reglas: {
    grupos_condicion: [[{ tipo: 'atributo', id_valor: ATTR_LINEA_BODEGA_ATEMPORAL, nombre: 'ATEMPORAL', cantidad: 2 }]],
    articulos_beneficio: [{ tipo: 'atributo', id_valor: ATTR_PREMIUM, nombre: 'PREMIUM ESTATE' }],
    tipo_descuento: 'porcentaje', valor: 100,
  }
}]
const result3 = calcularPromocionesLocales(carrito2, promos3)
console.log('Resultado:')
for (const r of result3) console.log(`  ${r.promoNombre}: -$${r.descuento.toFixed(2)} (items: ${r.itemsAfectados})`)
// Esperado: 100% en 1 PREMIUM = -$20,000 (vecesPromo=1, sin cantidad → 1)
const cond3 = result3.find(r => r.tipoPromo === 'condicional')
if (cond3 && Math.abs(cond3.descuento - 20000) < 1) {
  console.log('✅ Descuento en 1 unidad de PREMIUM ($20,000) — vecesPromo=1')
} else {
  console.log(`❌ Esperado $20,000 pero dio $${cond3?.descuento?.toFixed(2) || 'nada'}`)
}

// ============ TEST 4: MARCA — condición por marca + dedup ============
console.log('\n=== TEST 4: Condición por MARCA "ALTA VISTA" (2 unidades), beneficio por MARCA "CATENA" ===')
const carrito4 = [
  { articulo: { id: 1001, codigo: '1001', nombre: 'AV Malbec', precio: 10000, marca: 'ALTA VISTA', atributos: [] }, cantidad: 1 },
  { articulo: { id: 1002, codigo: '1002', nombre: 'AV Cab Sauv', precio: 12000, marca: 'ALTA VISTA', atributos: [] }, cantidad: 1 },
  { articulo: { id: 2001, codigo: '2001', nombre: 'Catena Malbec', precio: 15000, marca: 'CATENA', atributos: [] }, cantidad: 2 },
]
const promos4 = [
  {
    id: 20, nombre: '10% marca ALTA VISTA', tipo: 'porcentaje', activa: true,
    reglas: { valor: 10, aplicar_a: [{ tipo: 'marca', nombre: 'ALTA VISTA' }] }
  },
  {
    id: 21, nombre: 'Cond: 2x ALTA VISTA → 50% en CATENA', tipo: 'condicional', activa: true,
    reglas: {
      grupos_condicion: [[{ tipo: 'marca', nombre: 'ALTA VISTA', cantidad: 2 }]],
      articulos_beneficio: [{ tipo: 'marca', nombre: 'CATENA' }],
      tipo_descuento: 'porcentaje', valor: 50,
    }
  },
]
const result4 = calcularPromocionesLocales(carrito4, promos4)
console.log('Resultado:')
for (const r of result4) console.log(`  ${r.promoNombre}: -$${r.descuento.toFixed(2)} (items: ${r.itemsAfectados})`)
// Esperado: condicional aplica (2 ALTA VISTA como condición → 50% en CATENA)
// Los 2 ALTA VISTA quedan reservados como condición → NO deberían recibir 10%
const t4_cond = result4.find(r => r.promoNombre.includes('50% en CATENA'))
const t4_10 = result4.find(r => r.promoNombre === '10% marca ALTA VISTA')
// vecesPromo=1, sin cantidad en beneficio → 1 CATENA = $7,500
if (t4_cond && Math.abs(t4_cond.descuento - 7500) < 1) {
  console.log('✅ Condicional: 50% en 1x CATENA = $7,500 (vecesPromo=1, sin cant benef)')
} else {
  console.log(`❌ Condicional esperado $7,500, dio $${t4_cond?.descuento?.toFixed(2) || 'nada'}`)
}
if (!t4_10) {
  console.log('✅ 10% ALTA VISTA excluido (items condición reservados)')
} else {
  console.log(`❌ 10% ALTA VISTA NO debería aparecer, dio $${t4_10.descuento.toFixed(2)}`)
}

// ============ TEST 5: MARCA con sobrante ============
console.log('\n=== TEST 5: 3x ALTA VISTA + 1x CATENA — 1 sobrante recibe 10% ===')
const carrito5 = [
  { articulo: { id: 1001, codigo: '1001', nombre: 'AV Malbec', precio: 10000, marca: 'ALTA VISTA', atributos: [] }, cantidad: 2 },
  { articulo: { id: 1002, codigo: '1002', nombre: 'AV Cab Sauv', precio: 12000, marca: 'ALTA VISTA', atributos: [] }, cantidad: 1 },
  { articulo: { id: 2001, codigo: '2001', nombre: 'Catena Malbec', precio: 15000, marca: 'CATENA', atributos: [] }, cantidad: 1 },
]
const result5 = calcularPromocionesLocales(carrito5, promos4)
console.log('Resultado:')
for (const r of result5) console.log(`  ${r.promoNombre}: -$${r.descuento.toFixed(2)} (items: ${r.itemsAfectados})`)
// Esperado: condicional usa 2 de los 3 ALTA VISTA, 1 sobrante recibe 10%
const t5_cond = result5.find(r => r.promoNombre.includes('50% en CATENA'))
const t5_10 = result5.find(r => r.promoNombre === '10% marca ALTA VISTA')
if (t5_cond && Math.abs(t5_cond.descuento - 7500) < 1) {
  console.log('✅ Condicional: 50% en 1x CATENA = $7,500')
} else {
  console.log(`❌ Condicional esperado $7,500, dio $${t5_cond?.descuento?.toFixed(2) || 'nada'}`)
}
if (t5_10 && t5_10.descuento > 0) {
  console.log(`✅ 10% en sobrante: $${t5_10.descuento.toFixed(2)} (1 unidad sobrante)`)
} else {
  console.log('❌ 10% debería aplicar al sobrante')
}
