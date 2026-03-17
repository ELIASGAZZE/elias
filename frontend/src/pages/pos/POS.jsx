// Punto de Venta — POS con motor de promociones local
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import ModalCobrar from '../../components/pos/ModalCobrar'
import ModalVentaEmpleado from '../../components/pos/ModalVentaEmpleado'
import PedidosPOS from './PedidosPOS'
import SaldosPOS from './SaldosPOS'
import GiftCardsPOS from './GiftCardsPOS'
import NuevoClienteModal from '../../components/NuevoClienteModal'
import ContadorDenominacion from '../../components/cajas/ContadorDenominacion'
import TecladoVirtual from '../../components/pos/TecladoVirtual'
import api, { isNetworkError } from '../../services/api'
import useOnlineStatus from '../../hooks/useOnlineStatus'
import { guardarArticulos, getArticulos, guardarPromociones, getPromociones, guardarClientes, getClientes } from '../../services/offlineDB'
import { syncVentasPendientes } from '../../services/offlineSync'
import { imprimirTicketDevolucion } from '../../utils/imprimirComprobante'
import ActualizacionesPOS from '../../components/pos/ActualizacionesPOS'
import ModalCerrarCaja from '../../components/cajas-pos/ModalCerrarCaja'

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
function calcularPromoCondicional(reglas, carrito) {
  const grupos = reglas.grupos_condicion
    || (reglas.articulos_condicion ? [reglas.articulos_condicion] : null)
    || (reglas.articulo_condicion ? [[{ ...reglas.articulo_condicion, cantidad: reglas.cantidad_minima || 1 }]] : [])
  const listaBenef = reglas.articulos_beneficio || (reglas.articulo_beneficio ? [reglas.articulo_beneficio] : [])
  if (!grupos || grupos.length === 0 || listaBenef.length === 0) return null

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
  if (vecesPromo <= 0) return null

  const descontados = new Set()
  const descuentoPorItem = {}
  const cantPorItem = {}
  let descuento = 0, orDescontados = 0
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
  // Beneficios no-condición
  const allCondIds = new Set()
  for (const grupo of grupos) {
    for (const c of grupo) { allCondIds.add(c.id); if (c.codigo) allCondIds.add(c.codigo) }
  }
  let benefRest = vecesPromo
  const findBenefInCarrito = (ab) => carrito.find(i =>
    i.articulo.id === ab.id || (ab.codigo && String(i.articulo.codigo) === String(ab.codigo))
  )
  for (const ab of listaBenef) {
    if (benefRest <= 0) break
    if (descontados.has(ab.id)) continue
    if (allCondIds.has(ab.id) || allCondIds.has(ab.codigo)) continue
    const found = findBenefInCarrito(ab)
    if (!found || descontados.has(found.articulo.id)) continue
    const cantBenef = Math.min(benefRest, found.cantidad)
    const precio = calcularPrecioConDescuentosBase(found.articulo)
    const d = reglas.tipo_descuento === 'porcentaje'
      ? precio * cantBenef * ((reglas.valor || 0) / 100)
      : Math.min(reglas.valor || 0, precio) * cantBenef
    descuento += d
    descuentoPorItem[found.articulo.id] = (descuentoPorItem[found.articulo.id] || 0) + d
    cantPorItem[found.articulo.id] = (cantPorItem[found.articulo.id] || 0) + cantBenef
    benefRest -= cantBenef
    descontados.add(found.articulo.id)
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
        const precioMasBajo = Math.min(...itemsMatch.map(i => calcularPrecioConDescuentosBase(i.articulo)))
        const descuento = unidadesGratis * precioMasBajo
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
          const findInCarrito = (cond) => carrito.find(i =>
            i.articulo.id === cond.id || (cond.codigo && String(i.articulo.codigo) === String(cond.codigo))
          )
          for (const seg of segmentos) {
            if (seg.tipo === 'and') {
              // Todos deben estar
              for (const cond of seg.items) {
                const itemCarro = findInCarrito(cond)
                if (!itemCarro) { cumple = false; break }
                const cantReq = cond.cantidad || 1
                if (itemCarro.cantidad < cantReq) { cumple = false; break }
                veces = Math.min(veces, Math.floor(itemCarro.cantidad / cantReq))
                itemsGrupo.push({ item: itemCarro, cantReq })
                matchedNames.push(`${cantReq}x ${cond.nombre}`)
              }
            } else {
              // OR: sumar cantidades de TODAS las alternativas encontradas en el carrito
              let totalOrUnits = 0
              const orMatches = []
              for (const cond of seg.items) {
                const itemCarro = findInCarrito(cond)
                const cantReq = cond.cantidad || 1
                if (itemCarro && itemCarro.cantidad >= cantReq) {
                  const units = Math.floor(itemCarro.cantidad / cantReq)
                  totalOrUnits += units
                  orMatches.push({ item: itemCarro, cantReq, units, cond })
                }
              }
              if (totalOrUnits === 0) { cumple = false }
              else {
                veces = Math.min(veces, totalOrUnits)
                for (const m of orMatches) {
                  itemsGrupo.push({ item: m.item, cantReq: m.cantReq, isOr: true })
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
        const findBenefInCarrito = (ab) => carrito.find(i =>
          i.articulo.id === ab.id || (ab.codigo && String(i.articulo.codigo) === String(ab.codigo))
        )
        // 1) Artículos que participaron en la condición Y están en beneficios
        // AND items: siempre se descuentan. OR items: limitados por vecesPromo
        const descontados = new Set()
        const descuentoPorItem = {} // articuloId -> monto descuento
        const cantPorItem = {} // articuloId -> cant unidades descontadas
        let descuento = 0
        let orDescontados = 0
        for (const { item, cantReq, isOr } of itemsCondicion) {
          const enBenef = listaBenef.some(ab =>
            ab.id === item.articulo.id || (ab.codigo && String(item.articulo.codigo) === String(ab.codigo))
          )
          if (!enBenef) continue
          if (isOr) {
            // Limitar items OR por vecesPromo
            const orDisponible = vecesPromo - orDescontados
            if (orDisponible <= 0) continue
            const cantDescontada = Math.min(orDisponible * cantReq, item.cantidad)
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
            orDescontados += Math.ceil(cantDescontada / cantReq)
            descontados.add(item.articulo.id)
          } else {
            const cantDescontada = Math.min(vecesPromo * cantReq, item.cantidad)
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
        // 2) Beneficios que NO son parte de ningún grupo condición → descuento limitado por vecesPromo
        const allCondIds = new Set()
        for (const grupo of grupos) {
          for (const c of grupo) {
            allCondIds.add(c.id)
            if (c.codigo) allCondIds.add(c.codigo)
          }
        }
        let benefRestantes = vecesPromo
        for (const ab of listaBenef) {
          if (benefRestantes <= 0) break
          if (descontados.has(ab.id)) continue
          // Skip si este beneficio aparece en algún grupo condición (no participó pero podría haber)
          if (allCondIds.has(ab.id) || allCondIds.has(ab.codigo)) continue
          const found = findBenefInCarrito(ab)
          if (!found || descontados.has(found.articulo.id)) continue
          const cantBenef = Math.min(benefRestantes, found.cantidad)
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
          benefRestantes -= cantBenef
          descontados.add(found.articulo.id)
        }
        if (descuento <= 0) break
        const condDetalle = grupoMatchNames.join(' + ')
        const itemsAfectados = [...descontados]
        // Guardar items de condición usados (articuloId -> cantUsada) para dedup
        // OR items: solo reservar los necesarios (vecesPromo), no todos los que matchearon
        const itemsCondicionUsados = {}
        let orReservados = 0
        for (const { item, cantReq, isOr } of itemsCondicion) {
          if (isOr) {
            if (orReservados >= vecesPromo) continue
            itemsCondicionUsados[item.articulo.id] = cantReq
            orReservados++
          } else {
            itemsCondicionUsados[item.articulo.id] = (itemsCondicionUsados[item.articulo.id] || 0) + cantReq
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
          let veces = Infinity
          const reservas = [] // {artId, cant}
          let cumple = true
          for (const seg of segmentos) {
            if (seg.tipo === 'and') {
              for (const cond of seg.items) {
                const r = findDisp(cond)
                const cantReq = cond.cantidad || 1
                if (!r || r.dispCant < cantReq) { cumple = false; break }
                veces = Math.min(veces, Math.floor(r.dispCant / cantReq))
                reservas.push({ artId: r.item.articulo.id, cant: cantReq })
              }
            } else {
              // OR: buscar primera alternativa disponible
              let found = false
              for (const cond of seg.items) {
                const r = findDisp(cond)
                const cantReq = cond.cantidad || 1
                if (r && r.dispCant >= cantReq) {
                  veces = Math.min(veces, Math.floor(r.dispCant / cantReq))
                  reservas.push({ artId: r.item.articulo.id, cant: cantReq })
                  found = true
                  break
                }
              }
              if (!found) { cumple = false }
            }
            if (!cumple) break
          }
          if (cumple && veces > 0) return reservas
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
          if (reeval) {
            condValidas.push({ ...promo, ...reeval })
          } else {
            condValidas.push(promo) // fallback: usar datos originales
          }
        }
      }
    }

    // Paso 2: Per-unit dedup global (todas las promos menos forma_pago)
    // Para cada artículo, asignar unidades a la promo con mejor descuento por unidad.
    // Múltiples promos pueden compartir un artículo si hay suficientes unidades.
    const todasPromos = [...noCondicionales, ...condValidas]
    if (todasPromos.length <= 1) return [...formaPago, ...todasPromos]

    // Recopilar todos los artículos afectados
    const articulosAfectados = new Set()
    for (const p of todasPromos) {
      for (const id of (p.itemsAfectados || [])) articulosAfectados.add(id)
    }

    // Para cada artículo, asignar unidades por rate DESC
    const promoDescFinal = new Map() // promoIdx -> descuento recalculado
    const promoItemsFinal = new Map() // promoIdx -> [itemIds]
    for (const artId of articulosAfectados) {
      const itemCarrito = carrito.find(i => i.articulo.id === artId)
      if (!itemCarrito) continue
      let unidadesDisp = itemCarrito.cantidad

      // Recopilar promos que afectan este artículo con su rate por unidad
      const claims = []
      todasPromos.forEach((promo, idx) => {
        if (!(promo.itemsAfectados || []).includes(artId)) return
        const descTotal = (promo.descuentoPorItem || {})[artId] || 0
        const cantClaimed = (promo.cantPorItem || {})[artId] || 1
        const rate = descTotal / cantClaimed // descuento por unidad
        claims.push({ idx, rate, cantClaimed })
      })

      // Ordenar por rate DESC
      claims.sort((a, b) => b.rate - a.rate)

      // Asignar unidades greedy
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

// Paleta de colores para tiles por rubro
const TILE_COLORS = [
  { border: '#3B82F6', bg: '#EFF6FF', tab: '#3B82F6' },
  { border: '#10B981', bg: '#ECFDF5', tab: '#10B981' },
  { border: '#8B5CF6', bg: '#F5F3FF', tab: '#8B5CF6' },
  { border: '#F59E0B', bg: '#FFFBEB', tab: '#F59E0B' },
  { border: '#EC4899', bg: '#FDF2F8', tab: '#EC4899' },
  { border: '#14B8A6', bg: '#F0FDFA', tab: '#14B8A6' },
  { border: '#F97316', bg: '#FFF7ED', tab: '#F97316' },
  { border: '#6366F1', bg: '#EEF2FF', tab: '#6366F1' },
  { border: '#EF4444', bg: '#FEF2F2', tab: '#EF4444' },
  { border: '#06B6D4', bg: '#ECFEFF', tab: '#06B6D4' },
]

// ============ CONFIGURACIÓN TERMINAL POS ============
const TERMINAL_KEY = 'pos_terminal_config'

function getTerminalConfig() {
  try {
    return JSON.parse(localStorage.getItem(TERMINAL_KEY))
  } catch { return null }
}

function saveTerminalConfig(config) {
  localStorage.setItem(TERMINAL_KEY, JSON.stringify(config))
}

// Pantalla de configuración inicial del terminal (solo admin)
const ConfigurarTerminal = ({ onConfigurar, configActual }) => {
  const [sucursales, setSucursales] = useState([])
  const [cajas, setCajas] = useState([])
  const [sucursalId, setSucursalId] = useState(configActual?.sucursal_id || '')
  const [cajaId, setCajaId] = useState(configActual?.caja_id || '')
  const [mpDevices, setMpDevices] = useState([])
  const [mpDeviceId, setMpDeviceId] = useState(configActual?.mp_device_id || '')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    api.get('/api/sucursales')
      .then(({ data }) => setSucursales(data || []))
      .catch((err) => console.error('Error cargando sucursales:', err.message))
      .finally(() => setCargando(false))
    // Cargar dispositivos MP Point
    api.get('/api/mp-point/devices')
      .then(({ data }) => {
        const devs = data.devices || data || []
        setMpDevices(Array.isArray(devs) ? devs : [])
      })
      .catch((err) => console.warn('MP Point devices no disponible:', err.message))
  }, [])

  useEffect(() => {
    if (!sucursalId) { setCajas([]); return }
    api.get('/api/cajas', { params: { sucursal_id: sucursalId } })
      .then(({ data }) => setCajas(data || []))
      .catch((err) => { console.error('Error cargando cajas:', err.message); setCajas([]) })
  }, [sucursalId])

  const sucursalSeleccionada = sucursales.find(s => s.id === sucursalId)
  const cajaSeleccionada = cajas.find(c => c.id === cajaId)

  const [cambiandoModo, setCambiandoModo] = useState(false)
  const [errorModo, setErrorModo] = useState('')

  const confirmar = async () => {
    if (!sucursalId || !cajaId) return
    setErrorModo('')

    // Si seleccionó un posnet, cambiar a modo PDV automáticamente
    if (mpDeviceId) {
      const device = mpDevices.find(d => d.id === mpDeviceId)
      if (device && device.operating_mode !== 'PDV') {
        setCambiandoModo(true)
        try {
          const resp = await api.patch(`/api/mp-point/devices/${mpDeviceId}`, { operating_mode: 'PDV' })
          console.log('[MP Point] Modo cambiado a PDV:', resp.data)
        } catch (err) {
          const msg = err.response?.data?.message || err.response?.data?.error || err.message
          console.error('Error cambiando posnet a modo PDV:', msg, err.response?.data)
          setErrorModo(msg.includes('one pos-store') ? 'Solo 1 posnet en modo PDV por cada caja. Revisar en MP.' : `No se pudo cambiar a modo PDV: ${msg}`)
          setCambiandoModo(false)
          return // No continuar si falla el cambio de modo
        }
        setCambiandoModo(false)
      }
    }

    onConfigurar({
      sucursal_id: sucursalId,
      sucursal_nombre: sucursalSeleccionada?.nombre || '',
      caja_id: cajaId,
      caja_nombre: cajaSeleccionada?.nombre || '',
      mp_device_id: mpDeviceId || null,
    })
  }

  if (cargando) {
    return (
      <div className="h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-400">Cargando configuracion...</div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800">Configurar Terminal POS</h2>
          <p className="text-sm text-gray-400 mt-1">Selecciona la sucursal y caja para esta PC</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sucursal</label>
            <select
              value={sucursalId}
              onChange={e => { setSucursalId(e.target.value); setCajaId('') }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            >
              <option value="">Seleccionar sucursal...</option>
              {sucursales.map(s => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Caja</label>
            <select
              value={cajaId}
              onChange={e => setCajaId(e.target.value)}
              disabled={!sucursalId}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">{sucursalId ? 'Seleccionar caja...' : 'Primero selecciona sucursal'}</option>
              {cajas.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Posnet Mercado Pago (opcional)</label>
            {mpDevices.length > 0 ? (
              <select
                value={mpDeviceId}
                onChange={e => setMpDeviceId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              >
                <option value="">Sin posnet</option>
                {mpDevices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.id}{d.operating_mode === 'PDV' ? ' (PDV)' : ' (Standalone)'}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={mpDeviceId}
                onChange={e => setMpDeviceId(e.target.value)}
                placeholder="ID del dispositivo (ej: PAX_A910__SMARTPOS...)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            )}
            <p className="text-xs text-gray-400 mt-1">Al guardar, el posnet se configurará automáticamente en modo PDV</p>
            {errorModo && <p className="text-xs text-red-500 mt-1 font-medium">{errorModo}</p>}
          </div>
        </div>

        <button
          onClick={confirmar}
          disabled={!sucursalId || !cajaId || cambiandoModo}
          className="w-full mt-6 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {cambiandoModo ? 'Configurando posnet...' : 'Guardar configuracion'}
        </button>

        {configActual && (
          <button
            onClick={() => onConfigurar(null)}
            className="w-full mt-2 text-sm text-gray-400 hover:text-gray-600"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}

// ============ PANTALLA APERTURA DE CAJA POS ============
const AbrirCajaPOS = ({ terminalConfig, onCajaAbierta }) => {
  const [codigoEmpleado, setCodigoEmpleado] = useState('')
  const [empleadoResuelto, setEmpleadoResuelto] = useState(null)
  const [errorEmpleado, setErrorEmpleado] = useState('')
  const [validandoEmpleado, setValidandoEmpleado] = useState(false)

  const [denomBilletes, setDenomBilletes] = useState([])
  const [billetesApertura, setBilletesApertura] = useState({})
  const [cargandoDenominaciones, setCargandoDenominaciones] = useState(true)

  const [ultimoCambio, setUltimoCambio] = useState(null)
  const [observaciones, setObservaciones] = useState('')
  const [abriendo, setAbriendo] = useState(false)
  const [errorAbrir, setErrorAbrir] = useState('')

  const totalCambioInicial = useMemo(
    () => denomBilletes.reduce((sum, d) => sum + d.valor * (billetesApertura[d.valor] || 0), 0),
    [denomBilletes, billetesApertura]
  )

  const hayUltimoCambio = ultimoCambio && Object.keys(ultimoCambio.cambio_billetes || {}).length > 0

  const tieneDiferencia = (valor) => {
    if (!hayUltimoCambio) return false
    const anterior = (ultimoCambio.cambio_billetes || {})[String(valor)] || 0
    const actual = billetesApertura[valor] || 0
    return anterior !== actual
  }

  const calcularDiferencias = () => {
    if (!hayUltimoCambio) return null
    const diffs = {}
    denomBilletes.forEach(d => {
      const anterior = (ultimoCambio.cambio_billetes || {})[String(d.valor)] || 0
      const actual = billetesApertura[d.valor] || 0
      if (anterior !== actual) {
        diffs[String(d.valor)] = { anterior, actual, tipo: 'billete' }
      }
    })
    return Object.keys(diffs).length > 0 ? diffs : null
  }

  // Cargar denominaciones y último cambio al montar
  useEffect(() => {
    Promise.all([
      api.get('/api/denominaciones'),
      api.get(`/api/cierres-pos/ultimo-cambio?caja_id=${terminalConfig.caja_id}`),
    ]).then(([denomRes, cambioRes]) => {
      const activas = (denomRes.data || []).filter(d => d.activo)
      setDenomBilletes(activas.filter(d => d.tipo === 'billete').sort((a, b) => b.valor - a.valor))
      setUltimoCambio(cambioRes.data)
    }).catch(err => {
      console.error('Error cargando datos apertura:', err)
    }).finally(() => {
      setCargandoDenominaciones(false)
    })
  }, [terminalConfig.caja_id])

  const validarCodigoEmpleado = async () => {
    const codigo = codigoEmpleado.trim()
    if (!codigo) {
      setEmpleadoResuelto(null)
      setErrorEmpleado('')
      return
    }
    setValidandoEmpleado(true)
    setErrorEmpleado('')
    try {
      const { data } = await api.get(`/api/empleados/por-codigo/${encodeURIComponent(codigo)}`)
      setEmpleadoResuelto(data)
      setErrorEmpleado('')
    } catch {
      setEmpleadoResuelto(null)
      setErrorEmpleado('Codigo no valido')
    } finally {
      setValidandoEmpleado(false)
    }
  }

  const abrirCaja = async (e) => {
    e.preventDefault()
    if (!empleadoResuelto) {
      setErrorAbrir('Ingresa un codigo de empleado valido')
      return
    }
    setAbriendo(true)
    setErrorAbrir('')
    try {
      const ffBilletes = {}
      denomBilletes.forEach(d => {
        const cant = billetesApertura[d.valor] || 0
        if (cant > 0) ffBilletes[String(d.valor)] = cant
      })

      const { data } = await api.post('/api/cierres-pos/abrir', {
        caja_id: terminalConfig.caja_id,
        codigo_empleado: codigoEmpleado.trim(),
        fondo_fijo: totalCambioInicial,
        fondo_fijo_billetes: ffBilletes,
        fondo_fijo_monedas: {},
        diferencias_apertura: calcularDiferencias(),
        observaciones_apertura: observaciones.trim() || null,
      })
      onCajaAbierta(data)
    } catch (err) {
      setErrorAbrir(err.response?.data?.error || 'Error al abrir caja')
    } finally {
      setAbriendo(false)
    }
  }

  const formatMonto = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n || 0)

  return (
    <div className="h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800">Abrir Caja</h2>
          <p className="text-sm text-gray-400 mt-1">
            {terminalConfig.sucursal_nombre} — {terminalConfig.caja_nombre}
          </p>
        </div>

        <form onSubmit={abrirCaja} className="space-y-4">
          {/* Código de empleado */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Codigo de empleado</label>
            <input
              type="text"
              value={codigoEmpleado}
              onChange={(e) => {
                setCodigoEmpleado(e.target.value)
                setEmpleadoResuelto(null)
                setErrorEmpleado('')
              }}
              onBlur={validarCodigoEmpleado}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); validarCodigoEmpleado() } }}
              placeholder="Ingresa el codigo"
              autoFocus
              className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent ${empleadoResuelto ? 'border-green-400' : errorEmpleado ? 'border-red-400' : 'border-gray-300'}`}
            />
            {validandoEmpleado && <p className="text-xs text-gray-400 mt-1">Validando...</p>}
            {empleadoResuelto && <p className="text-xs text-green-600 mt-1">{empleadoResuelto.nombre}</p>}
            {errorEmpleado && <p className="text-xs text-red-600 mt-1">{errorEmpleado}</p>}
          </div>

          {/* Cambio inicial — billetes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-700">Cambio inicial (billetes)</h4>
              {totalCambioInicial > 0 && (
                <span className="text-sm font-bold text-violet-600">{formatMonto(totalCambioInicial)}</span>
              )}
            </div>

            {cargandoDenominaciones ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2">
                  {denomBilletes.map(d => (
                    <ContadorDenominacion
                      key={`ba-${d.id}`}
                      valor={d.valor}
                      cantidad={billetesApertura[d.valor] || 0}
                      onChange={(val) => setBilletesApertura(prev => ({ ...prev, [d.valor]: val }))}
                    />
                  ))}
                </div>

                {totalCambioInicial > 0 && (
                  <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 flex justify-between items-center mt-3">
                    <span className="text-sm font-medium text-violet-800">Total cambio inicial</span>
                    <span className="text-sm font-bold text-violet-700">{formatMonto(totalCambioInicial)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Observaciones */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Observaciones (opcional)</label>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              rows={2}
              placeholder="Notas sobre la apertura..."
            />
          </div>

          {errorAbrir && <p className="text-sm text-red-600">{errorAbrir}</p>}

          <button
            type="submit"
            disabled={abriendo}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {abriendo ? 'Abriendo...' : 'Abrir Caja'}
          </button>
        </form>

        <a href="/apps" className="block text-center mt-4 text-sm text-gray-400 hover:text-gray-600">
          Volver al menu
        </a>
      </div>
    </div>
  )
}

const POS = () => {
  const { usuario, esAdmin } = useAuth()
  const { isOnline, ventasPendientes, actualizarPendientes } = useOnlineStatus()

  // Terminal config (sucursal + caja de esta PC)
  const [terminalConfig, setTerminalConfig] = useState(() => getTerminalConfig())
  const [mostrarConfigTerminal, setMostrarConfigTerminal] = useState(false)

  // Apertura de caja obligatoria
  const [cierreActivo, setCierreActivo] = useState(null)
  const [verificandoCaja, setVerificandoCaja] = useState(true)

  function handleConfigurarTerminal(config) {
    if (config) {
      saveTerminalConfig(config)
      setTerminalConfig(config)
    }
    setMostrarConfigTerminal(false)
  }

  const necesitaConfig = !terminalConfig && !mostrarConfigTerminal

  // Verificar si la caja tiene un cierre abierto
  useEffect(() => {
    if (!terminalConfig?.caja_id) {
      setVerificandoCaja(false)
      return
    }
    let cancelled = false
    setVerificandoCaja(true)
    api.get(`/api/cierres-pos/abierta?caja_id=${terminalConfig.caja_id}`)
      .then(({ data }) => {
        if (cancelled) return
        if (data.abierta) {
          setCierreActivo(data.cierre)
        } else {
          setCierreActivo(null)
        }
      })
      .catch(() => {
        if (!cancelled) setCierreActivo(null)
      })
      .finally(() => {
        if (!cancelled) setVerificandoCaja(false)
      })
    return () => { cancelled = true }
  }, [terminalConfig?.caja_id])

  // Estado cliente
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [clientesCentum, setClientesCentum] = useState([])
  const [buscandoClientes, setBuscandoClientes] = useState(false)
  const [seleccionandoCliente, setSeleccionandoCliente] = useState(false)
  const [guardandoContacto, setGuardandoContacto] = useState(false)
  const CLIENTE_DEFAULT = { id_centum: 0, codigo: '', razon_social: 'Consumidor Final', lista_precio_id: 1, email: '', celular: '', condicion_iva: 'CF' }

  // Multi-ticket: 2 tickets en paralelo
  const [tickets, setTickets] = useState([
    { carrito: [], cliente: { ...CLIENTE_DEFAULT } },
    { carrito: [], cliente: { ...CLIENTE_DEFAULT } },
  ])
  const [ticketActivo, setTicketActivo] = useState(0)
  const ticketActivoRef = useRef(ticketActivo)
  ticketActivoRef.current = ticketActivo

  // Derivar carrito y cliente del ticket activo
  const carrito = tickets[ticketActivo].carrito
  const cliente = tickets[ticketActivo].cliente

  // Auto-expiración: si un ticket inactivo con items no se usa en 7 min, se limpia
  const TICKET_TIMEOUT = 7 * 60 * 1000
  const ticketTimestamps = useRef([0, 0]) // última actividad por ticket

  useEffect(() => {
    // Al cambiar de ticket, marcar timestamp del que se deja
    ticketTimestamps.current[ticketActivo] = Date.now()
  }, [ticketActivo])

  useEffect(() => {
    const interval = setInterval(() => {
      const ahora = Date.now()
      setTickets(prev => {
        let changed = false
        const nuevo = prev.map((t, idx) => {
          if (idx === ticketActivoRef.current) return t // no tocar el activo
          if (t.carrito.length === 0) return t // ya vacío
          const lastActivity = ticketTimestamps.current[idx]
          if (lastActivity > 0 && ahora - lastActivity >= TICKET_TIMEOUT) {
            changed = true
            ticketTimestamps.current[idx] = 0
            return { carrito: [], cliente: { ...CLIENTE_DEFAULT } }
          }
          return t
        })
        return changed ? nuevo : prev
      })
    }, 30000) // revisar cada 30s
    return () => clearInterval(interval)
  }, [CLIENTE_DEFAULT])

  // setCarrito/setCliente usan ref para que no cambien de identidad al cambiar de ticket
  const setCarrito = useCallback((updater) => {
    setTickets(prev => {
      const idx = ticketActivoRef.current
      ticketTimestamps.current[idx] = Date.now()
      const nuevo = [...prev]
      nuevo[idx] = {
        ...nuevo[idx],
        carrito: typeof updater === 'function' ? updater(nuevo[idx].carrito) : updater,
      }
      return nuevo
    })
  }, [])

  const setCliente = useCallback((cliOrUpdater) => {
    setTickets(prev => {
      const idx = ticketActivoRef.current
      ticketTimestamps.current[idx] = Date.now()
      const nuevo = [...prev]
      const clienteActual = nuevo[idx].cliente
      const nuevoCliente = typeof cliOrUpdater === 'function' ? cliOrUpdater(clienteActual) : cliOrUpdater
      nuevo[idx] = { ...nuevo[idx], cliente: nuevoCliente }
      return nuevo
    })
  }, [])

  // Estado artículos
  const [articulos, setArticulos] = useState([])
  const [cargandoArticulos, setCargandoArticulos] = useState(false)
  const [sincronizandoERP, setSincronizandoERP] = useState(false)
  const [busquedaArt, setBusquedaArt] = useState('')
  const [busquedaIdx, setBusquedaIdx] = useState(-1) // índice seleccionado en dropdown
  const [mostrarTeclado, setMostrarTeclado] = useState(false)
  const [carritoIdx, setCarritoIdx] = useState(-1) // índice seleccionado en carrito (-1 = no seleccionado, foco en buscador)
  const [alertaBarcode, setAlertaBarcode] = useState(null) // código no encontrado
  const [alertaDuplicado, setAlertaDuplicado] = useState(null) // duplicado (balanza o barcode)
  const ultimoBarcodaBalanzaRef = useRef(null) // último código de balanza escaneado
  const ultimoBarcodeRef = useRef({ codigo: null, time: 0 }) // último barcode normal escaneado
  const [popupPesable, setPopupPesable] = useState(null) // { articulo } — pedir peso manual
  const [popupPesableKg, setPopupPesableKg] = useState('')

  // Alarma continua con Web Audio API — suena hasta que se cierra la alerta
  const alertCtxRef = useRef(null)
  const playAlertSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'square'
      osc.frequency.value = 880
      // Sirena: oscila entre 880 y 1200 Hz
      const lfo = ctx.createOscillator()
      const lfoGain = ctx.createGain()
      lfo.connect(lfoGain)
      lfoGain.connect(osc.frequency)
      lfo.frequency.value = 5
      lfoGain.gain.value = 300
      gain.gain.value = 0.5
      lfo.start()
      osc.start()
      alertCtxRef.current = ctx
    } catch {}
  }, [])

  const stopAlertSound = useCallback(() => {
    if (alertCtxRef.current) {
      alertCtxRef.current.close()
      alertCtxRef.current = null
    }
  }, [])

  // Promociones
  const [promociones, setPromociones] = useState([])
  const [cargandoPromos, setCargandoPromos] = useState(false)

  // Modal cobrar
  const [mostrarCobrar, setMostrarCobrar] = useState(false)
  // Modal venta empleado
  const [mostrarVentaEmpleado, setMostrarVentaEmpleado] = useState(false)

  // Pedidos POS
  const [cargandoPedidos, setCargandoPedidos] = useState(false)
  const [guardandoPedido, setGuardandoPedido] = useState(false)

  // Modal wizard pedido (paso 0: cliente, paso 1: tipo, paso 2: dirección/sucursal, paso 3: pago anticipado)
  const [mostrarBuscarClientePedido, setMostrarBuscarClientePedido] = useState(false)
  const [pasoPedido, setPasoPedido] = useState(0) // 0=fecha, 1=cliente, 2=tipo, 3=dirección/sucursal, 4=pago
  const [fechaEntregaPedido, setFechaEntregaPedido] = useState('')
  const [turnoPedido, setTurnoPedido] = useState('')
  const [bloqueosFecha, setBloqueosFecha] = useState([])
  const [mostrarCobrarPedido, setMostrarCobrarPedido] = useState(false)
  const [cobrarPedidoExistente, setCobrarPedidoExistente] = useState(null) // { id, total, items, cliente_nombre, id_cliente_centum }
  const [pedidosRefreshKey, setPedidosRefreshKey] = useState(0)
  const pedidoWizardDataRef = useRef(null)
  const [clientePedido, setClientePedido] = useState(null)
  const [busquedaClientePedido, setBusquedaClientePedido] = useState('')
  const [clientesPedido, setClientesPedido] = useState([])
  const [buscandoClientePedido, setBuscandoClientePedido] = useState(false)
  const [mostrarCrearClientePedido, setMostrarCrearClientePedido] = useState(false)
  const inputClientePedidoRef = useRef(null)
  // Paso 2: direcciones delivery / sucursales retiro
  const [tipoPedidoSeleccionado, setTipoPedidoSeleccionado] = useState(null)
  const [direccionesPedido, setDireccionesPedido] = useState([])
  const [direccionSeleccionadaPedido, setDireccionSeleccionadaPedido] = useState(null)
  const [sucursalesPedido, setSucursalesPedido] = useState([])
  const [sucursalSeleccionadaPedido, setSucursalSeleccionadaPedido] = useState(null)
  const [cargandoDetallePedido, setCargandoDetallePedido] = useState(false)
  const [mostrarNuevaDirPedido, setMostrarNuevaDirPedido] = useState(false)
  const [nuevaDirPedido, setNuevaDirPedido] = useState({ direccion: '', localidad: '' })
  const [guardandoDirPedido, setGuardandoDirPedido] = useState(false)

  // Edición inline de precio
  const [editandoPrecio, setEditandoPrecio] = useState(null) // articuloId o null

  // Saldo a favor del cliente seleccionado
  const [saldoCliente, setSaldoCliente] = useState(0)

  // Vista activa: tabs estilo Chrome (venta vs pedidos vs saldos)
  const [vistaActiva, setVistaActiva] = useState('venta')

  // Gift cards para vender junto con artículos
  const [giftCardsEnVenta, setGiftCardsEnVenta] = useState([])
  const [mostrarAgregarGC, setMostrarAgregarGC] = useState(false)
  const [gcCodigo, setGcCodigo] = useState('')
  const [gcMonto, setGcMonto] = useState('')
  const [gcComprador, setGcComprador] = useState('')
  const [gcError, setGcError] = useState('')

  // Pedido en proceso de entrega (viene de tab Pedidos)
  const [pedidoEnProceso, setPedidoEnProceso] = useState(null) // { id, esPagado, ... }

  // Modal problema
  const [mostrarActualizaciones, setMostrarActualizaciones] = useState(false)
  const [mostrarCerrarCaja, setMostrarCerrarCaja] = useState(false)
  const [mostrarConfirmarCancelar, setMostrarConfirmarCancelar] = useState(false)
  const [mostrarProblema, setMostrarProblema] = useState(false)
  const [problemaSeleccionado, setProblemaSeleccionado] = useState(null)
  const [problemaPaso, setProblemaPaso] = useState(0) // 0=tipo, 1=buscar factura, 2=seleccionar productos
  const [problemaBusqueda, setProblemaBusqueda] = useState('')
  const [problemaBusFactura, setProblemaBusFactura] = useState('')
  const [problemaFecha, setProblemaFecha] = useState('')
  const [problemaBusArticulo, setProblemaBusArticulo] = useState('')
  const [problemaSucursal, setProblemaSucursal] = useState('')
  const [problemaSucursales, setProblemaSucursales] = useState([])
  const [problemaVentas, setProblemaVentas] = useState([])
  const [problemaBuscando, setProblemaBuscando] = useState(false)
  const [problemaVentaSel, setProblemaVentaSel] = useState(null)
  const [problemaItemsSel, setProblemaItemsSel] = useState({}) // { idx: cantDevolver }
  const [problemaDescripciones, setProblemaDescripciones] = useState({}) // { idx: 'texto' }
  const [problemaYaDevuelto, setProblemaYaDevuelto] = useState({}) // { idx: cantDevueltaPrevia }
  const [problemaCliente, setProblemaCliente] = useState(null) // cliente identificado
  const [problemaBusCliente, setProblemaBusCliente] = useState('')
  const [problemaClientesRes, setProblemaClientesRes] = useState([])
  const [problemaBuscandoCli, setProblemaBuscandoCli] = useState(false)
  const [problemaCrearCliente, setProblemaCrearCliente] = useState(false)
  const [problemaConfirmando, setProblemaConfirmando] = useState(false)
  const [problemaObservacion, setProblemaObservacion] = useState('')
  const [problemaPreciosCorregidos, setProblemaPreciosCorregidos] = useState({}) // { idx: precioCorreecto }

  // Modal cancelar venta
  const [mostrarCancelar, setMostrarCancelar] = useState(false)
  const [cancelarMotivo, setCancelarMotivo] = useState(null)
  const [cancelarMotivoOtro, setCancelarMotivoOtro] = useState('')
  const [cancelarPasoConfirm, setCancelarPasoConfirm] = useState(false)
  const problemaTimerRef = useRef(null)
  const problemaCliTimerRef = useRef(null)

  function cerrarModalProblema() {
    setMostrarProblema(false)
    setProblemaSeleccionado(null)
    setProblemaPaso(0)
    setProblemaBusqueda('')
    setProblemaBusFactura('')
    setProblemaBusArticulo('')
    setProblemaSucursal('')
    setProblemaFecha('')
    setProblemaVentas([])
    setProblemaVentaSel(null)
    setProblemaItemsSel({})
    setProblemaDescripciones({})
    setProblemaCliente(null)
    setProblemaBusCliente('')
    setProblemaClientesRes([])
    setProblemaCrearCliente(false)
    setProblemaObservacion('')
    setProblemaPreciosCorregidos({})
    setProblemaYaDevuelto({})
  }

  function buscarVentasProblemaDebounced(overrides = {}) {
    clearTimeout(problemaTimerRef.current)
    problemaTimerRef.current = setTimeout(() => {
      buscarVentasProblema(overrides)
    }, 300)
  }

  async function buscarVentasProblema(overrides = {}) {
    const cliente = overrides.buscar ?? problemaBusqueda
    const fecha = overrides.fecha ?? problemaFecha
    const articulo = overrides.articulo ?? problemaBusArticulo
    const sucId = overrides.sucursal_id ?? problemaSucursal
    const numFactura = overrides.numero_factura ?? problemaBusFactura
    setProblemaBuscando(true)
    try {
      const params = {}
      if (numFactura && numFactura.trim().length >= 1) {
        params.numero_factura = numFactura.trim()
      } else {
        if (fecha) params.fecha = fecha
        if (cliente && cliente.trim().length >= 2) params.buscar = cliente.trim()
        if (articulo && articulo.trim().length >= 2) params.articulo = articulo.trim()
        if (sucId) params.sucursal_id = sucId
      }
      const { data } = await api.get('/api/pos/ventas', { params })
      setProblemaVentas(data.ventas || [])
    } catch {
      setProblemaVentas([])
    } finally {
      setProblemaBuscando(false)
    }
  }

  // Carrito mobile toggle
  const [carritoVisible, setCarritoVisible] = useState(false)

  // Modo empleado (cuenta corriente)
  const [empleadoActivo, setEmpleadoActivo] = useState(null) // { id, nombre, codigo }
  const [descuentosEmpleado, setDescuentosEmpleado] = useState({}) // { rubroNombre: porcentaje }

  // Favoritos (globales desde DB)
  const [favoritos, setFavoritos] = useState([])

  const inputBusquedaRef = useRef(null)
  const inputClienteRef = useRef(null)

  // Refocus al buscador tras cualquier click (excepto otros inputs)
  const handlePOSClick = useCallback((e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
    // No refocalizar si hay un modal abierto (gift card, cobro, etc.)
    if (e.target.closest('[data-modal]')) return
    setTimeout(() => {
      if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT') {
        inputBusquedaRef.current?.focus()
      }
    }, 0)
  }, [])

  // Cargar promos, artículos, clientes y favoritos al montar (1 sola vez)
  useEffect(() => {
    cargarPromociones()
    cargarArticulos()
    cargarClientesCache()
    cargarFavoritos()
  }, [])

  async function cargarFavoritos() {
    try {
      const { data } = await api.get('/api/pos/favoritos')
      setFavoritos(data.articulo_ids || [])
    } catch (err) {
      console.error('Error cargando favoritos:', err)
    }
  }

  async function cargarPromociones() {
    setCargandoPromos(true)
    try {
      const { data } = await api.get('/api/pos/promociones')
      const promos = data.promociones || []
      setPromociones(promos)
      guardarPromociones(promos).catch(() => {})
    } catch (err) {
      console.error('Error cargando promos:', err)
      if (isNetworkError(err)) {
        try {
          const cached = await getPromociones()
          if (cached.length > 0) setPromociones(cached)
        } catch {}
      }
    } finally {
      setCargandoPromos(false)
    }
  }

  // Precargar clientes en IndexedDB para búsqueda offline
  async function cargarClientesCache() {
    try {
      const { data } = await api.get('/api/clientes', { params: { limit: 5000 } })
      const clientes = data.clientes || data.data || []
      guardarClientes(clientes).catch(() => {})
    } catch (err) {
      // Si falla la red, no pasa nada — usaremos cache existente
      console.error('Error precargando clientes:', err)
    }
  }

  // Buscar clientes en Centum (debounced) — offline: busca en IndexedDB
  useEffect(() => {
    if (!busquedaCliente.trim() || busquedaCliente.trim().length < 2) {
      setClientesCentum([])
      return
    }

    const timeout = setTimeout(async () => {
      setBuscandoClientes(true)
      try {
        if (isOnline) {
          const { data } = await api.get('/api/clientes', {
            params: { buscar: busquedaCliente.trim(), limit: 10 }
          })
          setClientesCentum(data.clientes || data.data || [])
        } else {
          const cached = await getClientes(busquedaCliente.trim())
          setClientesCentum(cached.slice(0, 10))
        }
      } catch (err) {
        console.error('Error buscando clientes:', err)
        // Fallback a IndexedDB si la API falla
        if (isNetworkError(err)) {
          try {
            const cached = await getClientes(busquedaCliente.trim())
            setClientesCentum(cached.slice(0, 10))
          } catch {}
        }
      } finally {
        setBuscandoClientes(false)
      }
    }, 400)

    return () => clearTimeout(timeout)
  }, [busquedaCliente, isOnline])

  // Cargar artículos desde DB local (precios minoristas, sync 1x/día)
  async function cargarArticulos() {
    setCargandoArticulos(true)
    try {
      const { data } = await api.get('/api/pos/articulos')
      const arts = data.articulos || []
      setArticulos(arts)
      guardarArticulos(arts).catch(() => {})
    } catch (err) {
      console.error('Error cargando artículos:', err)
      try {
        const cached = await getArticulos()
        if (cached.length > 0) {
          setArticulos(cached)
          return
        }
      } catch {}
      alert('Error al cargar artículos: ' + (err.response?.data?.error || err.message))
    } finally {
      setCargandoArticulos(false)
    }
  }

  // Sincronizar precios desde Centum ERP
  async function sincronizarPrecios() {
    if (sincronizandoERP) return
    setSincronizandoERP(true)
    try {
      await api.post('/api/articulos/sincronizar-precios')
      await cargarArticulos()
    } catch (err) {
      alert('Error al sincronizar: ' + (err.response?.data?.error || err.message))
    } finally {
      setSincronizandoERP(false)
    }
  }

  // Consultar saldo a favor del cliente seleccionado
  useEffect(() => {
    if (!cliente.id_centum || cliente.id_centum === 0) {
      setSaldoCliente(0)
      return
    }
    let cancelled = false
    api.get(`/api/pos/saldo/${cliente.id_centum}`)
      .then(({ data }) => { if (!cancelled) setSaldoCliente(data.saldo || 0) })
      .catch(() => { if (!cancelled) setSaldoCliente(0) })
    return () => { cancelled = true }
  }, [cliente.id_centum])

  async function seleccionarCliente(cli) {
    if (seleccionandoCliente) return // evitar doble click
    setSeleccionandoCliente(true)
    // Cerrar lista y limpiar búsqueda inmediatamente para dar feedback visual
    setClientesCentum([])
    setBusquedaCliente('')
    // Setear cliente con datos locales al instante (se actualiza luego con refresh)
    const clienteLocal = {
      id_centum: cli.id_centum || 0,
      codigo: cli.codigo || '',
      razon_social: cli.razon_social || 'Consumidor Final',
      lista_precio_id: cli.lista_precio_id || 1,
      email: cli.email || '',
      celular: cli.celular || '',
      condicion_iva: cli.condicion_iva || 'CF',
    }
    setCliente(clienteLocal)

    // Verificar en Centum que el cliente esté activo (en background)
    let emailFinal = clienteLocal.email
    let condicionFinal = clienteLocal.condicion_iva
    if (cli.id_centum) {
      try {
        const { data } = await api.get(`/api/clientes/refresh/${cli.id_centum}`)
        emailFinal = data.email || ''
        condicionFinal = data.condicion_iva || condicionFinal
        // Actualizar con datos frescos de Centum
        setCliente(prev => ({
          ...prev,
          codigo: data.codigo || prev.codigo,
          razon_social: data.razon_social || prev.razon_social,
          email: emailFinal,
          celular: data.celular || prev.celular,
          condicion_iva: condicionFinal,
        }))
      } catch (err) {
        if (err.response?.status === 410) {
          alert('Este cliente está desactivado en Centum y no se puede usar.')
          setCliente({ ...CLIENTE_DEFAULT })
          setSeleccionandoCliente(false)
          return
        }
        // Si falla la verificación, ya tiene los datos locales cargados
      }
    }
    setSeleccionandoCliente(false)

    // Alerta si es Factura A y no tiene email
    if ((condicionFinal === 'RI' || condicionFinal === 'MT') && !emailFinal) {
      alert('Este cliente no tiene email cargado. No se podrá enviar el comprobante por email.')
    }
  }

  async function guardarContactoCliente() {
    if (!cliente.id_centum || cliente.id_centum === 0) return
    setGuardandoContacto(true)
    try {
      await api.put(`/api/clientes/contacto/${cliente.id_centum}`, {
        email: cliente.email,
        celular: cliente.celular,
      })
    } catch (err) {
      console.error('Error guardando contacto:', err)
    } finally {
      setGuardandoContacto(false)
    }
  }

  // Extraer rubros únicos de los artículos cargados
  const rubros = useMemo(() => {
    const map = new Map()
    articulos.forEach(a => {
      if (a.rubro?.nombre && !map.has(a.rubro.nombre)) {
        map.set(a.rubro.nombre, a.rubro)
      }
    })
    return Array.from(map.values())
  }, [articulos])

  // Mapa rubro -> color
  const rubroColorMap = useMemo(() => {
    const map = {}
    rubros.forEach((r, i) => {
      map[r.nombre] = TILE_COLORS[i % TILE_COLORS.length]
    })
    return map
  }, [rubros])

  // Toggle favorito (solo admin, guarda en DB global)
  const toggleFavorito = useCallback((articuloId, e) => {
    e.stopPropagation()
    if (!esAdmin) return
    setFavoritos(prev => {
      const next = prev.includes(articuloId)
        ? prev.filter(id => id !== articuloId)
        : [...prev, articuloId]
      api.post('/api/pos/favoritos', { articulo_ids: next }).catch(err => {
        console.error('Error guardando favoritos:', err)
      })
      return next
    })
  }, [esAdmin])

  // Precio con descuento empleado (si modo empleado activo)
  const precioConDescEmpleado = useCallback((articulo) => {
    const precioBase = calcularPrecioConDescuentosBase(articulo)
    if (!empleadoActivo) return precioBase
    const rubroNombre = articulo.rubro?.nombre || ''
    const descPct = descuentosEmpleado[rubroNombre] || 0
    if (descPct <= 0) return precioBase
    return Math.round(precioBase * (1 - descPct / 100) * 100) / 100
  }, [empleadoActivo, descuentosEmpleado])

  // Favoritos: siempre visibles como tiles, ordenados por rubro
  const articulosFavoritos = useMemo(() => {
    const favs = articulos.filter(a => favoritos.includes(a.id))
    const rubroOrden = {}
    rubros.forEach((r, i) => { rubroOrden[r.nombre] = i })
    favs.sort((a, b) => (rubroOrden[a.rubro?.nombre] ?? 999) - (rubroOrden[b.rubro?.nombre] ?? 999))
    return favs
  }, [articulos, favoritos, rubros])

  // Resultados de búsqueda: dropdown autocompletado
  const resultadosBusqueda = useMemo(() => {
    if (!busquedaArt.trim()) return []
    const terminos = busquedaArt.toLowerCase().trim().split(/\s+/)
    return articulos.filter(a => {
      const texto = `${a.codigo} ${a.nombre} ${a.rubro?.nombre || ''} ${a.subRubro?.nombre || ''}`.toLowerCase()
      return terminos.every(t => texto.includes(t))
    }).slice(0, 30)
  }, [articulos, busquedaArt])

  // Agregar al carrito — pesables abren popup para ingresar peso, no pesables suman 1
  const agregarAlCarrito = useCallback((articulo) => {
    if (articulo.esPesable) {
      setPopupPesable({ articulo })
      setPopupPesableKg('')
      return
    }
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articulo.id)
      if (idx >= 0) {
        const nuevo = [...prev]
        nuevo[idx] = { ...nuevo[idx], cantidad: nuevo[idx].cantidad + 1 }
        return nuevo
      }
      return [...prev, { articulo, cantidad: 1 }]
    })
  }, [])

  const confirmarPesable = useCallback(() => {
    if (!popupPesable) return
    const kg = parseFloat(popupPesableKg)
    if (!kg || kg <= 0) return
    setCarrito(prev => [...prev, { articulo: popupPesable.articulo, cantidad: Math.round(kg * 1000) / 1000 }])
    setPopupPesable(null)
    setPopupPesableKg('')
    setTimeout(() => inputBusquedaRef.current?.focus(), 50)
  }, [popupPesable, popupPesableKg])

  // Parsear código de barras de balanza Kretz (EAN-13, prefijo 20)
  // Formato: 20 PPPPP WWWWW C → PLU (5 dígitos) + Peso en gramos (5 dígitos) + check
  const parsearBarcodeBalanza = useCallback((barcode) => {
    const code = barcode.replace(/\s/g, '')
    if (code.length === 13 && code.startsWith('20')) {
      const plu = code.substring(2, 7)        // 5 dígitos PLU
      const pesoGramos = parseInt(code.substring(7, 12), 10) // 5 dígitos peso
      const pesoKg = pesoGramos / 1000
      if (pesoKg > 0) {
        return { plu, pesoKg }
      }
    }
    return null
  }, [])

  // Buscar artículo por código de barras (también busca por código interno y balanza)
  const buscarPorBarcode = useCallback((barcode) => {
    const codigo = barcode.trim()

    // 1. Verificar si es código de balanza Kretz (prefijo 20, 13 dígitos)
    const balanza = parsearBarcodeBalanza(codigo)
    if (balanza) {
      const articuloPlu = articulos.find(a => a.codigo === balanza.plu)
      if (articuloPlu) {
        // Detectar duplicado: mismo código de barras escaneado dos veces seguidas
        const ultimo = ultimoBarcodaBalanzaRef.current
        if (ultimo && ultimo === codigo) {
          // Mostrar alerta de duplicado y guardar datos para agregar si confirma
          setAlertaDuplicado({ articulo: articuloPlu, pesoKg: balanza.pesoKg, barcode: codigo })
          setBusquedaArt('')
          return true
        }
        // Guardar como último escaneado
        ultimoBarcodaBalanzaRef.current = codigo
        // Agregar como línea separada (no sumar al existente)
        setCarrito(prev => [...prev, { articulo: articuloPlu, cantidad: balanza.pesoKg }])
        setBusquedaArt('')
        return true
      }
    }

    // 2. Buscar en codigos_barras
    let encontrado = articulos.find(a =>
      a.codigosBarras && a.codigosBarras.length > 0 && a.codigosBarras.includes(codigo)
    )
    // 3. Si no se encuentra, buscar por código interno exacto
    if (!encontrado) {
      encontrado = articulos.find(a => a.codigo === codigo)
    }
    if (encontrado) {
      // Detectar duplicado: mismo barcode escaneado rápido (< 3 seg)
      const ahora = Date.now()
      const ultimo = ultimoBarcodeRef.current
      if (ultimo.codigo === codigo && (ahora - ultimo.time) < 1500) {
        setAlertaDuplicado({ articulo: encontrado, cantidad: 1 })
        setBusquedaArt('')
        return true
      }
      ultimoBarcodeRef.current = { codigo, time: ahora }
      agregarAlCarrito(encontrado)
      setBusquedaArt('')
      return true
    }
    return false
  }, [articulos, agregarAlCarrito, parsearBarcodeBalanza])

  // Detectar entrada rápida tipo escáner de barras
  const ultimoInputRef = useRef({ time: 0 })

  const handleBusquedaChange = useCallback((e) => {
    const valor = e.target.value
    setBusquedaArt(valor)
    setBusquedaIdx(-1)
    ultimoInputRef.current.time = Date.now()
  }, [])

  const handleBusquedaKeyDown = useCallback((e) => {
    // Navegación con flechas en dropdown de resultados
    if (e.key === 'ArrowDown' && resultadosBusqueda.length > 0) {
      e.preventDefault()
      setBusquedaIdx(prev => prev < resultadosBusqueda.length - 1 ? prev + 1 : 0)
      return
    }
    if (e.key === 'ArrowUp' && resultadosBusqueda.length > 0) {
      e.preventDefault()
      setBusquedaIdx(prev => prev > 0 ? prev - 1 : resultadosBusqueda.length - 1)
      return
    }
    if (e.key === 'Escape' && busquedaArt.trim()) {
      e.preventDefault()
      setBusquedaArt('')
      setBusquedaIdx(-1)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      // Leer valor directo del input (no del state que puede estar desactualizado)
      const valor = e.target.value.trim()
      if (!valor) return

      // Si es un código numérico largo, buscar como barcode
      if (/^\d{4,}$/.test(valor)) {
        if (!buscarPorBarcode(valor)) {
          setAlertaBarcode(valor)
          playAlertSound()
          setTimeout(() => { setAlertaBarcode(null); stopAlertSound() }, 3000)
        }
        setBusquedaArt('')
        setBusquedaIdx(-1)
        return
      }

      // Detectar entrada rápida de scanner (no numérica, ej: QR con URL)
      const dt = Date.now() - ultimoInputRef.current.time
      const esScanner = dt < 80 && valor.length > 6

      if (esScanner) {
        setAlertaBarcode(valor)
        playAlertSound()
        setTimeout(() => { setAlertaBarcode(null); stopAlertSound() }, 3000)
        setBusquedaArt('')
        setBusquedaIdx(-1)
        return
      }

      // Si hay un item seleccionado con flechas, agregarlo
      if (busquedaIdx >= 0 && busquedaIdx < resultadosBusqueda.length) {
        agregarAlCarrito(resultadosBusqueda[busquedaIdx])
        setBusquedaArt('')
        setBusquedaIdx(-1)
        return
      }

      // Si hay exactamente un resultado de búsqueda por texto, agregarlo
      if (resultadosBusqueda.length === 1) {
        agregarAlCarrito(resultadosBusqueda[0])
        setBusquedaArt('')
        setBusquedaIdx(-1)
      }
    }
  }, [buscarPorBarcode, resultadosBusqueda, agregarAlCarrito, busquedaIdx, busquedaArt])

  const cambiarCantidad = useCallback((articuloId, delta, esPesable) => {
    const paso = esPesable ? 0.1 : 1
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articuloId)
      if (idx < 0) return prev
      const nuevaCantidad = Math.round((prev[idx].cantidad + paso * delta) * 1000) / 1000
      if (nuevaCantidad <= 0) {
        setConfirmEliminar({ articuloId, nombre: prev[idx].articulo.nombre, cantidad: prev[idx].cantidad })
        return prev
      }
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], cantidad: nuevaCantidad }
      return nuevo
    })
  }, [])

  const setCantidadDirecta = useCallback((articuloId, cantidad) => {
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articuloId)
      if (idx < 0) return prev
      if (cantidad <= 0) {
        setConfirmEliminar({ articuloId, nombre: prev[idx].articulo.nombre, cantidad: prev[idx].cantidad })
        return prev
      }
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], cantidad: Math.round(cantidad * 1000) / 1000 }
      return nuevo
    })
  }, [])


  const quitarDelCarrito = useCallback((articuloId) => {
    setCarrito(prev => {
      const item = prev.find(i => i.articulo.id === articuloId)
      if (item) {
        const precio = item.precioOverride ?? item.articulo.precio ?? 0
        api.post('/api/pos/log-eliminacion', {
          usuario_nombre: cierreActivo?.empleado?.nombre || usuario?.nombre || 'Desconocido',
          cierre_id: cierreActivo?.id || null,
          items: [{ articulo_id: articuloId, nombre: item.articulo.nombre, cantidad: item.cantidad, precio, hora: new Date().toISOString() }],
        }).catch(err => console.error('Error registrando eliminación:', err))
      }
      return prev.filter(i => i.articulo.id !== articuloId)
    })
    setCarritoIdx(-1)
    setTimeout(() => inputBusquedaRef.current?.focus(), 50)
  }, [usuario, cierreActivo])

  // Atajos de teclado para modales y acciones rápidas
  useEffect(() => {
    const handler = (e) => {
      // Confirmar cancelación
      if (mostrarConfirmarCancelar) {
        if (e.key === 'Enter') { e.preventDefault(); ejecutarCancelacion() }
        if (e.key === 'Escape') { e.preventDefault(); setMostrarConfirmarCancelar(false) }
        return
      }
      // Si hay un modal abierto (cobrar, etc.) no interceptar F-keys pero bloquear defaults del browser
      if (mostrarCobrar) {
        if (e.key.startsWith('F') && e.key.length <= 3) e.preventDefault()
        return
      }

      // No interceptar teclas cuando el foco está en un select (para permitir navegación del dropdown)
      if (document.activeElement?.tagName === 'SELECT') return

      const tieneItems = carrito.length > 0 || giftCardsEnVenta.length > 0

      // F1 = Cambiar cliente
      if (e.key === 'F1') {
        e.preventDefault()
        setVistaActiva('venta')
        setTimeout(() => inputClienteRef.current?.focus(), 50)
      }
      // F2 = Foco buscador artículos
      if (e.key === 'F2') {
        e.preventDefault()
        setVistaActiva('venta')
        setTimeout(() => { inputBusquedaRef.current?.focus(); inputBusquedaRef.current?.select() }, 50)
      }
      // F3 = Tab Pedidos
      if (e.key === 'F3') {
        e.preventDefault()
        setVistaActiva('pedidos')
      }
      // F4 = Tab Saldos
      if (e.key === 'F4') {
        e.preventDefault()
        setVistaActiva('saldos')
      }
      // F5 = Sincronizar precios
      if (e.key === 'F5') {
        e.preventDefault()
        sincronizarPrecios()
      }
      // F6 = Tab Gift Cards
      if (e.key === 'F6') {
        e.preventDefault()
        setVistaActiva('giftcards')
      }
      // F7 = Alternar ticket 1/2
      if (e.key === 'F7') {
        e.preventDefault()
        setTicketActivo(prev => prev === 0 ? 1 : 0)
        setBusquedaArt(''); setBusquedaCliente('')
      }
      // F8 = Problema
      if (e.key === 'F8') {
        e.preventDefault()
        setMostrarProblema(true)
      }
      // F9 = Cancelar venta
      if (e.key === 'F9' && tieneItems) {
        e.preventDefault()
        setMostrarConfirmarCancelar(true)
      }
      // F10 = Es pedido
      if (e.key === 'F10' && tieneItems && !pedidoEnProceso) {
        e.preventDefault()
        handleEsPedido()
      }
      // F11 = Cobrar
      if (e.key === 'F11' && tieneItems) {
        e.preventDefault()
        setMostrarCobrar(true)
      }
      // + / - = Cantidad del item seleccionado (o último) (solo si no hay foco en input)
      if ((e.key === '+' || e.key === '-') && carrito.length > 0 && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        const idx = carritoIdx >= 0 && carritoIdx < carrito.length ? carritoIdx : carrito.length - 1
        const item = carrito[idx]
        cambiarCantidad(item.articulo.id, e.key === '+' ? 1 : -1, item.articulo.esPesable)
      }

      // Flecha izquierda = entrar al carrito (seleccionar último item)
      if (e.key === 'ArrowLeft' && carrito.length > 0 && document.activeElement?.tagName !== 'TEXTAREA') {
        // Solo si el cursor está al inicio del input de búsqueda o no hay texto
        const input = inputBusquedaRef.current
        if (input && document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === 0) {
          e.preventDefault()
          input.blur()
          setCarritoIdx(carrito.length - 1)
        } else if (document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault()
          setCarritoIdx(carrito.length - 1)
        }
      }
      // Flecha derecha = volver al buscador
      if (e.key === 'ArrowRight' && carritoIdx >= 0) {
        e.preventDefault()
        setCarritoIdx(-1)
        setTimeout(() => inputBusquedaRef.current?.focus(), 50)
      }
      // Flechas arriba/abajo = navegar carrito (solo si estamos en modo carrito)
      if (e.key === 'ArrowUp' && carritoIdx >= 0) {
        e.preventDefault()
        setCarritoIdx(prev => Math.max(0, prev - 1))
      }
      if (e.key === 'ArrowDown' && carritoIdx >= 0) {
        e.preventDefault()
        setCarritoIdx(prev => Math.min(carrito.length - 1, prev + 1))
      }
      // Backspace = eliminar item seleccionado del carrito
      if (e.key === 'Backspace' && carritoIdx >= 0 && carritoIdx < carrito.length && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        const item = carrito[carritoIdx]
        quitarDelCarrito(item.articulo.id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mostrarCancelar, cancelarMotivo, cancelarMotivoOtro, mostrarCobrar, carrito, giftCardsEnVenta.length, pedidoEnProceso, sincronizarPrecios, cambiarCantidad, carritoIdx, quitarDelCarrito, cierreActivo])

  const setPrecioOverride = useCallback((articuloId, nuevoPrecio) => {
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articuloId)
      if (idx < 0) return prev
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], precioOverride: nuevoPrecio }
      return nuevo
    })
  }, [])

  // Calcular totales — precio de Centum ya incluye IVA
  const { subtotal, subtotalSinDescEmpleado, descuentoTotal, descEmpleadoDetalle, descEmpleadoTotal, total, promosAplicadas } = useMemo(() => {
    let sub = 0
    let subSinDesc = 0
    const rubroMap = {}

    for (const item of carrito) {
      const precioOriginal = item.precioOverride != null ? item.precioOverride : calcularPrecioConDescuentosBase(item.articulo)
      const precioFinal = item.precioOverride != null ? item.precioOverride : precioConDescEmpleado(item.articulo)
      sub += precioFinal * item.cantidad
      subSinDesc += precioOriginal * item.cantidad

      // Acumular descuento empleado por rubro
      if (empleadoActivo && precioOriginal !== precioFinal) {
        const rubroNombre = item.articulo.rubro?.nombre || 'Sin rubro'
        const descItem = (precioOriginal - precioFinal) * item.cantidad
        if (!rubroMap[rubroNombre]) {
          rubroMap[rubroNombre] = { rubro: rubroNombre, porcentaje: descuentosEmpleado[rubroNombre] || 0, descuento: 0 }
        }
        rubroMap[rubroNombre].descuento += descItem
      }
    }

    const descEmpleado = Object.values(rubroMap)
    const totalDescEmpleado = descEmpleado.reduce((s, d) => s + d.descuento, 0)

    const aplicadas = calcularPromocionesLocales(carrito, promociones)
    const descTotal = aplicadas.reduce((sum, p) => sum + p.descuento, 0)

    return {
      subtotal: sub,
      subtotalSinDescEmpleado: subSinDesc,
      descuentoTotal: descTotal,
      descEmpleadoDetalle: descEmpleado,
      descEmpleadoTotal: totalDescEmpleado,
      total: sub - descTotal,
      promosAplicadas: aplicadas,
    }
  }, [carrito, promociones, empleadoActivo, descuentosEmpleado, precioConDescEmpleado])

  function ejecutarCancelacion() {
    api.post('/api/auditoria/cancelacion', {
      motivo: 'Cancelación rápida',
      items: carrito.map(i => ({ articulo_id: i.articulo.id, codigo: i.articulo.codigo, nombre: i.articulo.nombre, cantidad: i.cantidad, precio: i.precioOverride ?? i.articulo.precio })),
      subtotal,
      total,
      cliente_nombre: cliente?.nombre || null,
      caja_id: terminalConfig?.caja_id || null,
      sucursal_id: terminalConfig?.sucursal_id || null,
      cierre_id: cierreActivo?.id || null,
    }).catch(err => console.error('Error registrando cancelación:', err))
    limpiarVenta()
    setMostrarConfirmarCancelar(false)
  }

  function limpiarVenta() {
    setCarrito([])
    setCliente({ ...CLIENTE_DEFAULT })
    setBusquedaArt('')
    setBusquedaCliente('')
    setPedidoEnProceso(null)
    setGiftCardsEnVenta([])
    setMostrarAgregarGC(false)
  }

  const totalGiftCardsEnVenta = giftCardsEnVenta.reduce((s, g) => s + g.monto, 0)
  const totalConGiftCards = total + totalGiftCardsEnVenta

  function agregarGiftCardAVenta() {
    if (!gcCodigo.trim() || !gcMonto || parseFloat(gcMonto) <= 0) return
    if (giftCardsEnVenta.some(g => g.codigo === gcCodigo.trim())) {
      setGcError('Esta gift card ya fue agregada')
      return
    }
    setGiftCardsEnVenta(prev => [...prev, {
      codigo: gcCodigo.trim(),
      monto: parseFloat(gcMonto),
      comprador_nombre: gcComprador.trim() || null,
    }])
    setGcCodigo('')
    setGcMonto('')
    setGcComprador('')
    setGcError('')
    setMostrarAgregarGC(false) // cierra el modal
  }

  function quitarGiftCardDeVenta(codigo) {
    setGiftCardsEnVenta(prev => prev.filter(g => g.codigo !== codigo))
  }

  // Callback desde tab Pedidos: cargar pedido al carrito para entregar
  function handleEntregarPedido(pedido) {
    const itemsPedido = typeof pedido.items === 'string' ? JSON.parse(pedido.items) : pedido.items
    const nuevoCarrito = itemsPedido.map(item => ({
      articulo: {
        id: item.id,
        codigo: item.codigo || '',
        nombre: item.nombre,
        precio: item.precio,
        esPesable: item.esPesable || false,
        descuento1: 0, descuento2: 0, descuento3: 0,
      },
      cantidad: item.cantidad,
      precioOverride: item.precio,
    }))
    setCarrito(nuevoCarrito)
    if (pedido.nombre_cliente) {
      setCliente({
        id_centum: pedido.id_cliente_centum || 0,
        razon_social: pedido.nombre_cliente,
        lista_precio_id: 1,
        email: pedido.email_cliente || '',
        celular: pedido.celular_cliente || '',
      })
    }
    const esPagado = (pedido.observaciones || '').includes('PAGO ANTICIPADO')
    const totalPagado = parseFloat(pedido.total_pagado) || 0
    setPedidoEnProceso({ id: pedido.id, numero: pedido.numero, esPagado, totalPagado })
    setVistaActiva('venta')
  }

  // Callback desde tab Pedidos: cargar pedido al carrito para editar
  function handleEditarPedido(pedido) {
    const itemsPedido = typeof pedido.items === 'string' ? JSON.parse(pedido.items) : pedido.items
    const nuevoCarrito = itemsPedido.map(item => ({
      articulo: {
        id: item.id,
        codigo: item.codigo || '',
        nombre: item.nombre,
        precio: item.precio,
        esPesable: item.esPesable || false,
        descuento1: 0, descuento2: 0, descuento3: 0,
      },
      cantidad: item.cantidad,
      precioOverride: item.precio,
    }))
    setCarrito(nuevoCarrito)
    if (pedido.nombre_cliente) {
      setCliente({
        id_centum: pedido.id_cliente_centum || 0,
        razon_social: pedido.nombre_cliente,
        lista_precio_id: 1,
        email: pedido.email_cliente || '',
        celular: pedido.celular_cliente || '',
      })
    }
    const esPagado = (pedido.observaciones || '').includes('PAGO ANTICIPADO')
    const totalPagado = parseFloat(pedido.total_pagado) || 0
    // Extraer dirección de observaciones
    const obsMatch = (pedido.observaciones || '').match(/Dirección: ([^|]+)/)
    const direccionTexto = obsMatch ? obsMatch[1].trim() : ''
    const pedidoData = {
      id: pedido.id, numero: pedido.numero, esPagado, totalPagado, editando: true,
      observaciones: pedido.observaciones || '',
      tipo: pedido.tipo || 'retiro',
      fecha_entrega: pedido.fecha_entrega || '',
      direccion_entrega: direccionTexto,
      direccionesCliente: [],
      turno_entrega: pedido.turno_entrega || '',
      sucursal_id: pedido.sucursal_id || '',
    }
    setPedidoEnProceso(pedidoData)
    setVistaActiva('venta')

    // Cargar direcciones del cliente en background
    if (pedido.id_cliente_centum) {
      api.get(`/api/clientes/por-centum/${pedido.id_cliente_centum}/direcciones`)
        .then(({ data }) => {
          if (data?.length) {
            setPedidoEnProceso(prev => prev ? { ...prev, direccionesCliente: data } : prev)
          }
        })
        .catch(() => {})
    }
  }

  // Guardar edición de pedido (PUT) desde la vista POS
  async function handleGuardarEdicionPedido() {
    if (!pedidoEnProceso || carrito.length === 0) return

    const items = carrito.map(i => ({
      id: i.articulo.id,
      codigo: i.articulo.codigo,
      nombre: i.articulo.nombre,
      precio: i.precioOverride != null ? i.precioOverride : i.articulo.precio,
      cantidad: i.cantidad,
      esPesable: i.articulo.esPesable || false,
      rubro: i.articulo.rubro?.nombre || null,
    }))
    const nuevoTotal = items.reduce((sum, i) => sum + (i.precio * i.cantidad), 0)
    const totalPagado = pedidoEnProceso.totalPagado || 0

    // Validar perecederos
    if (pedidoEnProceso.fecha_entrega) {
      const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
      const manana = new Date()
      manana.setDate(manana.getDate() + 1)
      const mananaISO = manana.toISOString().split('T')[0]
      const tienePerecedor = carrito.some(i => {
        const rubro = (i.articulo.rubro?.nombre || '').toLowerCase()
        return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
      })
      if (tienePerecedor && pedidoEnProceso.fecha_entrega > mananaISO) {
        alert('Los pedidos con Fiambres, Quesos o Frescos no pueden tener fecha de entrega mayor a mañana.')
        return
      }
    }

    // Validar campos obligatorios para delivery
    if (pedidoEnProceso.tipo === 'delivery') {
      if (!pedidoEnProceso.turno_entrega) {
        alert('Seleccioná un turno de entrega (AM o PM) para pedidos delivery.')
        return
      }
      if (!pedidoEnProceso.direccion_entrega?.trim()) {
        alert('Completá la dirección de entrega para pedidos delivery.')
        return
      }
    }

    // Si el pedido estaba pagado y el nuevo total es menor, confirmar generación de saldo
    if (totalPagado > 0 && nuevoTotal < totalPagado) {
      const diferencia = totalPagado - nuevoTotal
      if (!confirm(`Se generará saldo a favor de ${formatPrecio(diferencia)} para el cliente.\n\n¿Guardar cambios?`)) return
    }

    setGuardandoPedido(true)
    try {
      await api.put(`/api/pos/pedidos/${pedidoEnProceso.id}`, {
        items,
        total: nuevoTotal,
        observaciones: pedidoEnProceso.observaciones || null,
        tipo: pedidoEnProceso.tipo,
        fecha_entrega: pedidoEnProceso.fecha_entrega || null,
        direccion_entrega: pedidoEnProceso.tipo === 'delivery' ? pedidoEnProceso.direccion_entrega : null,
        nombre_cliente: cliente.razon_social || null,
        id_cliente_centum: cliente.id_centum || 0,
        turno_entrega: pedidoEnProceso.tipo === 'delivery' ? (pedidoEnProceso.turno_entrega || null) : null,
        sucursal_id: pedidoEnProceso.tipo === 'delivery' ? 'c254cac8-4c6e-4098-9119-485d7172f281' : pedidoEnProceso.sucursal_id || null,
      })
      alert(`Pedido #${pedidoEnProceso.numero} actualizado`)
      limpiarVenta()
    } catch (err) {
      console.error('Error al guardar edición del pedido:', err)
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoPedido(false)
    }
  }

  // Marcar pedido como entregado en backend
  async function marcarPedidoEntregado(pedidoId) {
    try {
      await api.put(`/api/pos/pedidos/${pedidoId}/estado`, { estado: 'entregado' })
    } catch (err) {
      console.error('Error marcando pedido como entregado:', err)
    }
  }

  // Entregar pedido ya pagado: guardar venta directamente sin ModalCobrar
  async function handleEntregarPedidoPagado() {
    if (!pedidoEnProceso || carrito.length === 0) return

    const totalPagado = pedidoEnProceso.totalPagado || 0
    const diferencia = total - totalPagado

    // Si falta cobrar pero el cliente tiene saldo, descontar automáticamente
    let saldoAplicadoEntrega = 0
    if (diferencia > 0.01 && saldoCliente > 0) {
      saldoAplicadoEntrega = Math.min(saldoCliente, diferencia)
    }
    const faltante = diferencia - saldoAplicadoEntrega

    // Si aún falta cobrar después de aplicar saldo, no permitir
    if (faltante > 0.01) {
      alert(`Falta cobrar ${formatPrecio(faltante)} antes de entregar.`)
      return
    }

    // Si sobró dinero (pagó de más), generar saldo a favor
    if (diferencia < -0.01) {
      if (!confirm(`El cliente pagó ${formatPrecio(totalPagado)} pero el total actual es ${formatPrecio(total)}.\nSe generará saldo a favor de ${formatPrecio(Math.abs(diferencia))}.\n\n¿Continuar?`)) return
    }

    setGuardandoPedido(true)
    try {
      const items = carrito.map(i => ({
        id_articulo: i.articulo.id,
        codigo: i.articulo.codigo,
        nombre: i.articulo.nombre,
        precio_unitario: i.precioOverride != null ? i.precioOverride : precioConDescEmpleado(i.articulo),
        cantidad: i.cantidad,
        iva_tasa: i.articulo.iva?.tasa || 21,
        rubro: i.articulo.rubro?.nombre || null,
        subRubro: i.articulo.subRubro?.nombre || null,
      }))
      const payload = {
        id_cliente_centum: cliente.id_centum,
        nombre_cliente: cliente.razon_social,
        caja_id: terminalConfig?.caja_id || null,
        items,
        promociones_aplicadas: null,
        subtotal: total,
        descuento_total: 0,
        total,
        monto_pagado: totalPagado + saldoAplicadoEntrega,
        vuelto: 0,
        pagos: [
          { tipo: 'Pago anticipado', monto: totalPagado, detalle: null },
          ...(saldoAplicadoEntrega > 0 ? [{ tipo: 'Saldo', monto: saldoAplicadoEntrega, detalle: null }] : []),
        ],
        pedido_pos_id: pedidoEnProceso.id,
      }
      if (saldoAplicadoEntrega > 0) {
        payload.saldo_aplicado = saldoAplicadoEntrega
      }
      await api.post('/api/pos/ventas', payload)
      await marcarPedidoEntregado(pedidoEnProceso.id)
      limpiarVenta()
    } catch (err) {
      console.error('Error al entregar pedido pagado:', err)
      alert('Error al guardar venta: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoPedido(false)
    }
  }

  function handleVentaExitosa() {
    setMostrarCobrar(false)
    // Si hay pedido en proceso, marcarlo como entregado
    if (pedidoEnProceso) {
      marcarPedidoEntregado(pedidoEnProceso.id)
    }
    setCarrito([])
    setCliente({ ...CLIENTE_DEFAULT })
    setBusquedaArt('')
    setPedidoEnProceso(null)
    setGiftCardsEnVenta([])
    syncVentasPendientes().then(() => actualizarPendientes()).catch(() => {})
  }

  function handleCobroPedidoExitoso(datosPago) {
    // Solo se registró el pago (sin crear venta). Guardar el pedido con marca de pagado.
    const wd = pedidoWizardDataRef.current
    setMostrarCobrarPedido(false)

    // Cobro de pedido existente (desde tab Pedidos)
    if (cobrarPedidoExistente) {
      const pedido = cobrarPedidoExistente
      setCobrarPedidoExistente(null);
      (async () => {
        try {
          const resumenPago = datosPago?.pagos ? datosPago.pagos.map(p => `${p.tipo}: $${p.monto}`).join(', ') : ''
          await api.put(`/api/pos/pedidos/${pedido.id}/pago`, {
            total_pagado: pedido.total,
            observaciones: `PAGO ANTICIPADO: ${resumenPago}`,
          })
          setPedidosRefreshKey(k => k + 1)
        } catch (err) {
          console.error('Error actualizando pago pedido:', err)
          alert('Error al registrar pago: ' + (err.response?.data?.error || err.message))
        }
      })()
      return
    }

    if (wd) {
      guardarComoPedidoConCliente(wd.cli, wd.tipo, wd.dirObj, wd.sucObj, true, wd.fecha, datosPago)
      pedidoWizardDataRef.current = null
    }
    // Limpiar wizard state
    setPasoPedido(0)
    setClientePedido(null)
    setTipoPedidoSeleccionado(null)
    setDireccionesPedido([])
    setDireccionSeleccionadaPedido(null)
    setSucursalesPedido([])
    setSucursalSeleccionadaPedido(null)
  }

  // Cobrar pedido existente desde tab Pedidos
  function handleCobrarPedidoEnCaja(pedido) {
    setCobrarPedidoExistente(pedido)
    setMostrarCobrarPedido(true)
  }

  // ---- Buscar cliente para pedido (debounced) ----
  useEffect(() => {
    if (!mostrarBuscarClientePedido) return
    const termino = busquedaClientePedido.trim()
    if (termino.length < 2) { setClientesPedido([]); return }

    const timeout = setTimeout(async () => {
      setBuscandoClientePedido(true)
      try {
        if (isOnline) {
          const { data } = await api.get('/api/clientes', { params: { buscar: termino, limit: 15, solo_dni: true } })
          setClientesPedido(data.clientes || data.data || [])
        } else {
          const cached = await getClientes(termino)
          setClientesPedido(cached.slice(0, 15))
        }
      } catch (err) {
        console.error('Error buscando clientes para pedido:', err)
        if (isNetworkError(err)) {
          try {
            const cached = await getClientes(termino)
            setClientesPedido(cached.slice(0, 15))
          } catch {}
        }
      } finally {
        setBuscandoClientePedido(false)
      }
    }, 350)

    return () => clearTimeout(timeout)
  }, [busquedaClientePedido, mostrarBuscarClientePedido, isOnline])

  // Focus input al abrir modal cliente pedido
  useEffect(() => {
    if (mostrarBuscarClientePedido) {
      setTimeout(() => inputClientePedidoRef.current?.focus(), 100)
    }
  }, [mostrarBuscarClientePedido])

  function cerrarWizardPedido() {
    setMostrarBuscarClientePedido(false)
    setMostrarCobrarPedido(false)
    setPasoPedido(0)
    setClientePedido(null)
    setFechaEntregaPedido('')
    setTurnoPedido('')
    setBloqueosFecha([])
    setBusquedaClientePedido('')
    setClientesPedido([])
    setMostrarCrearClientePedido(false)
    setTipoPedidoSeleccionado(null)
    setDireccionesPedido([])
    setDireccionSeleccionadaPedido(null)
    setSucursalesPedido([])
    setSucursalSeleccionadaPedido(null)
    setMostrarNuevaDirPedido(false)
    setNuevaDirPedido({ direccion: '', localidad: '' })
  }

  function seleccionarClienteParaPedido(cli) {
    if (!cli.id_centum) return
    setClientePedido(cli)
    setPasoPedido(2) // ir a elegir tipo
  }

  function onClientePedidoCreado(clienteNuevo) {
    setMostrarCrearClientePedido(false)
    if (clienteNuevo?.id_centum) {
      seleccionarClienteParaPedido(clienteNuevo)
    }
  }

  async function seleccionarTipoPedido(tipo) {
    if (!clientePedido) return
    setTipoPedidoSeleccionado(tipo)
    setPasoPedido(3) // ir a dirección/sucursal
    // Pre-cargar direcciones/sucursales
    setCargandoDetallePedido(true)
    try {
      if (tipo === 'delivery') {
        const { data } = await api.get(`/api/clientes/${clientePedido.id}/direcciones`)
        setDireccionesPedido(data || [])
        if (data && data.length > 0) setDireccionSeleccionadaPedido(data[0].id)
      } else {
        const { data } = await api.get('/api/sucursales')
        setSucursalesPedido(data || [])
        if (data && data.length > 0) setSucursalSeleccionadaPedido(data[0].id)
      }
    } catch (err) {
      console.error('Error cargando datos paso 2:', err)
    } finally {
      setCargandoDetallePedido(false)
    }
  }

  async function guardarNuevaDirPedido() {
    if (!nuevaDirPedido.direccion.trim()) return
    setGuardandoDirPedido(true)
    try {
      const { data } = await api.post(`/api/clientes/${clientePedido.id}/direcciones`, {
        direccion: nuevaDirPedido.direccion.trim(),
        localidad: nuevaDirPedido.localidad.trim() || null,
      })
      setDireccionesPedido(prev => [...prev, data])
      setDireccionSeleccionadaPedido(data.id)
      setMostrarNuevaDirPedido(false)
      setNuevaDirPedido({ direccion: '', localidad: '' })
    } catch (err) {
      console.error('Error guardando dirección:', err)
      alert('Error al guardar dirección: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoDirPedido(false)
    }
  }

  function confirmarPedidoWizard() {
    // Ir al paso 4: preguntar pago anticipado
    setPasoPedido(4)
  }

  function finalizarPedidoWizard(modo) {
    // modo: 'cobrar' | 'efectivo_entrega' | 'link_pago' | false (solo guardar)
    if (!clientePedido || !tipoPedidoSeleccionado) return
    const cli = {
      id_centum: clientePedido.id_centum,
      razon_social: clientePedido.razon_social,
      lista_precio_id: clientePedido.lista_precio_id || 1,
    }
    const dirObj = tipoPedidoSeleccionado === 'delivery' && direccionSeleccionadaPedido
      ? direccionesPedido.find(d => d.id === direccionSeleccionadaPedido)
      : null
    const sucObj = tipoPedidoSeleccionado === 'retiro' && sucursalSeleccionadaPedido
      ? sucursalesPedido.find(s => s.id === sucursalSeleccionadaPedido)
      : null
    setCliente(cli)

    if (modo === 'cobrar') {
      // Abrir pantalla de cobro — el wizard queda abierto detrás
      setMostrarBuscarClientePedido(false)
      setMostrarCobrarPedido(true)
      pedidoWizardDataRef.current = { cli, tipo: tipoPedidoSeleccionado, dirObj, sucObj, fecha: fechaEntregaPedido }
    } else if (modo === 'efectivo_entrega') {
      cerrarWizardPedido()
      guardarComoPedidoConCliente(cli, tipoPedidoSeleccionado, dirObj, sucObj, false, fechaEntregaPedido, null, 'PAGO EN ENTREGA: EFECTIVO')
    } else if (modo === 'link_pago') {
      cerrarWizardPedido()
      guardarPedidoYGenerarLink(cli, tipoPedidoSeleccionado, dirObj, sucObj, fechaEntregaPedido)
    } else {
      cerrarWizardPedido()
      guardarComoPedidoConCliente(cli, tipoPedidoSeleccionado, dirObj, sucObj, false, fechaEntregaPedido)
    }
  }

  async function guardarPedidoYGenerarLink(cli, tipo, direccion, sucursal, fechaEntrega) {
    if (carrito.length === 0) return
    setGuardandoPedido(true)
    try {
      const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
      const itemsPayload = carrito.map(i => ({
        id: i.articulo.id,
        codigo: i.articulo.codigo,
        nombre: i.articulo.nombre,
        precio: i.precioOverride != null ? i.precioOverride : precioConDescEmpleado(i.articulo),
        cantidad: i.cantidad,
        esPesable: i.articulo.esPesable || false,
        rubro: i.articulo.rubro?.nombre || null,
      }))

      if (fechaEntrega) {
        const manana = new Date()
        manana.setDate(manana.getDate() + 1)
        const mananaISO = manana.toISOString().split('T')[0]
        const tienePerecedor = carrito.some(i => {
          const rubro = (i.articulo.rubro?.nombre || '').toLowerCase()
          return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
        })
        if (tienePerecedor && fechaEntrega > mananaISO) {
          alert('Los pedidos con productos de Fiambres, Quesos o Frescos no pueden tener fecha de entrega mayor a mañana.')
          setGuardandoPedido(false)
          return
        }
      }

      const payload = {
        id_cliente_centum: cli.id_centum,
        nombre_cliente: cli.razon_social,
        items: itemsPayload,
        total,
        tipo: tipo || 'retiro',
        observaciones: 'PAGO PENDIENTE: LINK MP',
      }
      if (direccion) {
        payload.direccion_entrega = direccion.direccion + (direccion.localidad ? `, ${direccion.localidad}` : '')
      }
      if (sucursal) {
        payload.sucursal_retiro = sucursal.nombre
        payload.sucursal_id = sucursal.id
      }
      if (fechaEntrega) {
        payload.fecha_entrega = fechaEntrega
      }
      if (tipo === 'delivery') {
        payload.turno_entrega = turnoPedido || null
        payload.sucursal_id = 'c254cac8-4c6e-4098-9119-485d7172f281' // Fisherton
      }

      const { data } = await api.post('/api/pos/pedidos', payload)
      const pedidoId = data.pedido?.id

      // Generar link MP
      if (pedidoId) {
        try {
          const { data: linkData } = await api.post(`/api/pos/pedidos/${pedidoId}/link-pago`)
          if (linkData.link) {
            try {
              await navigator.clipboard.writeText(linkData.link)
            } catch {
              // Fallback para cuando el documento no tiene foco
              const ta = document.createElement('textarea')
              ta.value = linkData.link
              ta.style.position = 'fixed'
              ta.style.opacity = '0'
              document.body.appendChild(ta)
              ta.focus()
              ta.select()
              document.execCommand('copy')
              document.body.removeChild(ta)
            }
            alert('Link de pago copiado al portapapeles')
          }
        } catch (linkErr) {
          console.error('Error generando link MP:', linkErr)
          alert('Pedido guardado pero hubo un error al generar el link: ' + (linkErr.response?.data?.error || linkErr.message))
        }
      }

      limpiarVenta()
    } catch (err) {
      console.error('Error guardando pedido:', err)
      alert('Error al guardar pedido: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoPedido(false)
    }
  }

  function handleEsPedido() {
    if (carrito.length === 0) return
    // Default fecha: mañana
    const manana = new Date()
    manana.setDate(manana.getDate() + 1)
    setFechaEntregaPedido(manana.toISOString().split('T')[0])
    setPasoPedido(0)
    setMostrarBuscarClientePedido(true)
  }

  // ---- Pedidos POS (página separada en /pos/pedidos) ----

  async function guardarComoPedidoConCliente(cli, tipo, direccion, sucursal, pagado, fechaEntrega, datosPago, observacionExtra) {
    if (carrito.length === 0) return
    if (!cli.id_centum || cli.id_centum === 0) return
    setGuardandoPedido(true)
    try {
      const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
      const itemsPayload = carrito.map(i => ({
        id: i.articulo.id,
        codigo: i.articulo.codigo,
        nombre: i.articulo.nombre,
        precio: i.precioOverride != null ? i.precioOverride : precioConDescEmpleado(i.articulo),
        cantidad: i.cantidad,
        esPesable: i.articulo.esPesable || false,
        rubro: i.articulo.rubro?.nombre || null,
      }))

      // Validar: productos perecederos no pueden tener fecha de entrega > mañana
      if (fechaEntrega) {
        const manana = new Date()
        manana.setDate(manana.getDate() + 1)
        const mananaISO = manana.toISOString().split('T')[0]
        const tienePerecedor = carrito.some(i => {
          const rubro = (i.articulo.rubro?.nombre || '').toLowerCase()
          return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
        })
        if (tienePerecedor && fechaEntrega > mananaISO) {
          alert('Los pedidos con productos de Fiambres, Quesos o Frescos no pueden tener fecha de entrega mayor a mañana.')
          setGuardandoPedido(false)
          return
        }
      }
      const payload = {
        id_cliente_centum: cli.id_centum,
        nombre_cliente: cli.razon_social,
        items: itemsPayload,
        total,
        tipo: tipo || 'retiro',
      }
      if (direccion) {
        payload.direccion_entrega = direccion.direccion + (direccion.localidad ? `, ${direccion.localidad}` : '')
        payload.direccion_entrega_id = direccion.id
      }
      if (sucursal) {
        payload.sucursal_retiro = sucursal.nombre
        payload.sucursal_retiro_id = sucursal.id
        payload.sucursal_id = sucursal.id
      }
      if (pagado) {
        // Guardar info de pago en observaciones (la venta se genera al entregar)
        if (datosPago?.pagos) {
          const resumenPago = datosPago.pagos.map(p => `${p.tipo}: $${p.monto}`).join(', ')
          payload.observaciones = `PAGO ANTICIPADO: ${resumenPago}`
        } else {
          payload.observaciones = 'PAGO ANTICIPADO'
        }
        payload.total_pagado = total
      } else if (observacionExtra) {
        payload.observaciones = observacionExtra
      }
      if (fechaEntrega) {
        payload.fecha_entrega = fechaEntrega
      }
      if (tipo === 'delivery') {
        payload.turno_entrega = turnoPedido || null
        payload.sucursal_id = 'c254cac8-4c6e-4098-9119-485d7172f281' // Fisherton
      }
      await api.post('/api/pos/pedidos', payload)
      limpiarVenta()
    } catch (err) {
      console.error('Error guardando pedido:', err)
      alert('Error al guardar pedido: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoPedido(false)
    }
  }


  const cantidadItems = carrito.reduce((s, i) => s + i.cantidad, 0)

  // Pantallas de configuración de terminal (antes del POS principal)
  if (necesitaConfig) {
    return <ConfigurarTerminal onConfigurar={handleConfigurarTerminal} configActual={null} />
  }

  if (mostrarConfigTerminal) {
    return <ConfigurarTerminal onConfigurar={handleConfigurarTerminal} configActual={terminalConfig} />
  }

  // Verificando si la caja está abierta
  if (verificandoCaja) {
    return (
      <div className="h-screen bg-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
          <span className="text-sm text-gray-400">Verificando caja...</span>
        </div>
      </div>
    )
  }

  // Caja no abierta — mostrar pantalla de apertura
  if (!cierreActivo) {
    return <AbrirCajaPOS terminalConfig={terminalConfig} onCajaAbierta={setCierreActivo} />
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col overflow-hidden" onClick={handlePOSClick}>
      {/* Barra tipo Chrome: tabs + info terminal */}
      <div className="bg-violet-900 flex-shrink-0">
        <div className="flex items-center justify-between">
          {/* Izquierda: botón volver + tabs */}
          <div className="flex items-center">
            <a
              href="/apps"
              className="px-3 py-2.5 text-violet-400 hover:text-white transition-colors"
              title="Volver al menú"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </a>

            {/* Tab Venta */}
            <button
              onClick={() => setVistaActiva('venta')}
              className={`relative px-5 py-2 text-sm font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'venta'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Venta
            </button>

            {/* Tab Pedidos */}
            <button
              onClick={() => setVistaActiva('pedidos')}
              className={`relative px-5 py-2 text-sm font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'pedidos'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Pedidos <span className="text-[9px] opacity-60 ml-1">F3</span>
            </button>

            {/* Tab Saldos */}
            <button
              onClick={() => setVistaActiva('saldos')}
              className={`relative px-5 py-2 text-sm font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'saldos'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Saldos <span className="text-[9px] opacity-60 ml-1">F4</span>
            </button>

            {/* Tab Gift Cards */}
            <button
              onClick={() => setVistaActiva('giftcards')}
              className={`relative px-5 py-2 text-sm font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'giftcards'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Gift Cards <span className="text-[9px] opacity-60 ml-1">F6</span>
            </button>
          </div>

          {/* Derecha: info terminal + config */}
          <div className="flex items-center gap-2 pr-3 text-xs">
            <span className="text-violet-300">{terminalConfig?.sucursal_nombre}</span>
            <span className="bg-violet-700 text-violet-100 px-1.5 py-0.5 rounded font-medium">{terminalConfig?.caja_nombre}</span>
            <span className="text-violet-300">|</span>
            <span className="text-violet-200 font-medium">Cajero: {cierreActivo?.empleado?.nombre || usuario?.nombre}</span>
            {empleadoActivo ? (
              <button
                onClick={() => { setEmpleadoActivo(null); setDescuentosEmpleado({}); setCarrito([]); }}
                className="bg-orange-500 hover:bg-orange-600 text-white px-2.5 py-1 rounded font-semibold transition-colors flex items-center gap-1 animate-pulse"
                title="Desactivar modo empleado"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                {empleadoActivo.nombre}
                {empleadoActivo.disponible != null && (
                  <span className="bg-orange-700 text-orange-100 text-[10px] px-1.5 py-0.5 rounded ml-1">
                    Disp: {formatPrecio(empleadoActivo.disponible - total)}
                  </span>
                )}
                ✕
              </button>
            ) : (
              <button
                onClick={() => setMostrarVentaEmpleado(true)}
                className="bg-orange-900/40 hover:bg-orange-500 text-orange-200 hover:text-white px-2.5 py-1 rounded font-semibold transition-colors flex items-center gap-1"
                title="Venta a empleado (cta cte)"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                Empleado
              </button>
            )}
            <button
              onClick={() => setMostrarProblema(true)}
              className="bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded font-semibold transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
              </svg>
              PROBLEMA <span className="text-[9px] opacity-70">F8</span>
            </button>
            <button
              onClick={() => setMostrarCerrarCaja(true)}
              className="text-violet-400 hover:text-red-300 px-2 py-0.5 rounded transition-colors flex items-center gap-1"
              title="Cerrar caja"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <span>Cerrar Caja</span>
            </button>
            <button
              onClick={() => setMostrarActualizaciones(true)}
              className="text-violet-400 hover:text-white px-2 py-1 rounded transition-colors text-[11px] font-medium"
              title="Ver actualizaciones de precios"
            >
              Actualizaciones
            </button>
            <button
              onClick={sincronizarPrecios}
              disabled={sincronizandoERP}
              className="text-violet-400 hover:text-white p-1 rounded transition-colors disabled:opacity-50"
              title="Sincronizar precios desde Centum (F5)"
            >
              <svg className={`w-3.5 h-3.5 ${sincronizandoERP ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.016 4.66v4.993" />
              </svg>
            </button>
            {esAdmin && (
              <button
                onClick={() => setMostrarConfigTerminal(true)}
                className="text-violet-400 hover:text-white p-1 rounded transition-colors"
                title="Reconfigurar terminal"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* === TAB PEDIDOS === */}
      {vistaActiva === 'pedidos' && (
        <div className="flex-1 overflow-hidden">
          <PedidosPOS key={pedidosRefreshKey} embebido terminalConfig={terminalConfig} onEntregarPedido={handleEntregarPedido} onEditarPedido={handleEditarPedido} onCobrarEnCaja={handleCobrarPedidoEnCaja} />
        </div>
      )}

      {/* === TAB SALDOS === */}
      {vistaActiva === 'saldos' && (
        <div className="flex-1 overflow-hidden">
          <SaldosPOS embebido />
        </div>
      )}

      {/* === TAB GIFT CARDS === */}
      {vistaActiva === 'giftcards' && (
        <div className="flex-1 overflow-hidden">
          <GiftCardsPOS embebido />
        </div>
      )}

      {/* === TAB VENTA === */}
      {vistaActiva === 'venta' && <>
      {/* Banner pedido en proceso */}
      {pedidoEnProceso && (
        <div className="bg-violet-50 border-b border-violet-200">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-sm text-violet-700 font-medium">
              {pedidoEnProceso.editando ? 'Editando' : 'Entregando'} pedido {pedidoEnProceso.numero ? `#${pedidoEnProceso.numero}` : ''} de <strong>{cliente.razon_social}</strong>
              {!pedidoEnProceso.editando && (pedidoEnProceso.esPagado ? ' (ya pagado)' : ' (pendiente de cobro)')}
            </span>
            <button
              onClick={limpiarVenta}
              className="text-xs text-violet-500 hover:text-violet-700 font-medium"
            >
              Cancelar entrega
            </button>
          </div>
          {/* Controles de edición: tipo, fecha, dirección */}
          {pedidoEnProceso.editando && (
            <div className="px-4 pb-2 flex items-center gap-3 flex-wrap">
              {/* Tipo */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPedidoEnProceso(prev => ({ ...prev, tipo: 'retiro', direccion_entrega: '' }))}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${pedidoEnProceso.tipo === 'retiro' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'}`}
                >
                  Retiro
                </button>
                <button
                  onClick={() => setPedidoEnProceso(prev => ({ ...prev, tipo: 'delivery' }))}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${pedidoEnProceso.tipo === 'delivery' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'}`}
                >
                  Delivery
                </button>
              </div>
              {/* Fecha */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-violet-600">Entrega:</span>
                <input
                  type="date"
                  value={pedidoEnProceso.fecha_entrega || ''}
                  onChange={e => setPedidoEnProceso(prev => ({ ...prev, fecha_entrega: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                  className="text-xs border rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-violet-400"
                />
              </div>
              {/* Turno (solo delivery) */}
              {pedidoEnProceso.tipo === 'delivery' && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-violet-600">Turno:</span>
                  <select
                    value={pedidoEnProceso.turno_entrega || ''}
                    onChange={e => setPedidoEnProceso(prev => ({ ...prev, turno_entrega: e.target.value }))}
                    className="text-xs border rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-violet-400"
                  >
                    <option value="">Sin turno</option>
                    <option value="AM">AM (9-13hs)</option>
                    <option value="PM">PM (17-21hs)</option>
                  </select>
                </div>
              )}
              {/* Dirección (solo delivery) */}
              {pedidoEnProceso.tipo === 'delivery' && (
                <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                  <span className="text-xs text-violet-600 flex-shrink-0">Dir:</span>
                  {pedidoEnProceso.direccionesCliente?.length > 0 && !pedidoEnProceso.dirManual ? (
                    <select
                      value={pedidoEnProceso.direccion_entrega || ''}
                      onChange={e => {
                        if (e.target.value === '__otra__') {
                          setPedidoEnProceso(prev => ({ ...prev, direccion_entrega: '', dirManual: true }))
                        } else {
                          setPedidoEnProceso(prev => ({ ...prev, direccion_entrega: e.target.value }))
                        }
                      }}
                      className="flex-1 text-xs border rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-violet-400"
                    >
                      <option value="">Seleccionar dirección...</option>
                      {(() => {
                        const opciones = pedidoEnProceso.direccionesCliente.map(d => ({
                          id: d.id,
                          val: `${d.direccion}${d.localidad ? `, ${d.localidad}` : ''}`,
                          principal: d.es_principal,
                        }))
                        // Si la dirección actual no coincide con ninguna opción, mostrarla también
                        const dirActual = pedidoEnProceso.direccion_entrega || ''
                        const coincide = !dirActual || opciones.some(o => o.val === dirActual)
                        return (
                          <>
                            {!coincide && <option value={dirActual}>{dirActual} (actual)</option>}
                            {opciones.map(o => (
                              <option key={o.id} value={o.val}>{o.val}{o.principal ? ' (principal)' : ''}</option>
                            ))}
                          </>
                        )
                      })()}
                      <option value="__otra__">Otra dirección...</option>
                    </select>
                  ) : (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        type="text"
                        value={pedidoEnProceso.direccion_entrega || ''}
                        onChange={e => setPedidoEnProceso(prev => ({ ...prev, direccion_entrega: e.target.value }))}
                        placeholder="Dirección de entrega..."
                        autoFocus={pedidoEnProceso.dirManual}
                        className="flex-1 text-xs border rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-violet-400"
                      />
                      {pedidoEnProceso.dirManual && pedidoEnProceso.direccionesCliente?.length > 0 && (
                        <button
                          onClick={() => setPedidoEnProceso(prev => ({ ...prev, dirManual: false }))}
                          className="text-[10px] text-violet-600 hover:text-violet-800 whitespace-nowrap"
                        >
                          Ver guardadas
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Indicadores offline */}
      {(!isOnline || ventasPendientes > 0) && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-b">
          {!isOnline && (
            <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Sin conexion
            </span>
          )}
          {ventasPendientes > 0 && (
            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {ventasPendientes} venta{ventasPendientes > 1 ? 's' : ''} pendiente{ventasPendientes > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">

        {/* ====== IZQUIERDA: PANEL CARRITO ====== */}
        <div className={`
          lg:w-[380px] xl:w-[420px] bg-white border-r flex flex-col flex-shrink-0
          ${carritoVisible ? 'fixed inset-0 z-20 lg:relative' : 'hidden lg:flex'}
        `}>
          {/* Tabs de tickets */}
          <div className="flex border-b bg-gray-100">
            {tickets.map((t, idx) => {
              const items = t.carrito.length
              const activo = idx === ticketActivo
              const ts = ticketTimestamps.current[idx]
              const inactivo = !activo && items > 0 && ts > 0
              const minRestantes = inactivo ? Math.max(0, Math.ceil((TICKET_TIMEOUT - (Date.now() - ts)) / 60000)) : null
              return (
                <button
                  key={idx}
                  onClick={() => { setTicketActivo(idx); setBusquedaArt(''); setBusquedaCliente('') }}
                  className={`flex-1 py-2 px-3 text-xs font-semibold transition-colors relative ${
                    activo
                      ? 'bg-white text-violet-700 border-b-2 border-violet-600'
                      : items > 0
                        ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                        : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  Ticket {idx + 1} <span className="text-[9px] opacity-50">F7</span>
                  {items > 0 && (
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      activo ? 'bg-violet-100 text-violet-700' : 'bg-amber-200 text-amber-800'
                    }`}>
                      {items}
                    </span>
                  )}
                  {minRestantes != null && minRestantes <= 3 && (
                    <span className="ml-1 text-[9px] text-red-500 font-normal">{minRestantes}min</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Barra cliente */}
          <div className="px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-1 rounded truncate">
                    {cliente.razon_social}
                  </span>
                  {cliente.id_centum > 0 && cliente.codigo && (
                    <span className="text-gray-600 text-xs font-mono">{cliente.codigo}</span>
                  )}
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                    cliente.condicion_iva === 'RI' ? 'bg-blue-100 text-blue-700'
                    : cliente.condicion_iva === 'MT' ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-200 text-gray-600'
                  }`}>
                    {cliente.condicion_iva === 'RI' ? 'Resp. Inscripto' : cliente.condicion_iva === 'MT' ? 'Monotributo' : 'Cons. Final'}
                  </span>
                  {cliente.id_centum > 0 && (<>
                    <button
                      onClick={async () => {
                        try {
                          const { data } = await api.get(`/api/clientes/refresh/${cliente.id_centum}`)
                          setCliente(prev => ({
                            ...prev,
                            razon_social: data.razon_social,
                            codigo: data.codigo || prev.codigo || '',
                            cuit: data.cuit,
                            condicion_iva: data.condicion_iva || 'CF',
                            email: data.email || '',
                            celular: data.celular || '',
                            lista_precio_id: data.lista_precio_id || 1,
                          }))
                        } catch (err) {
                          console.error('Error refrescando cliente:', err)
                        }
                      }}
                      className="text-gray-500 hover:text-violet-600 flex-shrink-0"
                      title="Actualizar datos del cliente"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setCliente({ ...CLIENTE_DEFAULT })}
                      className="text-gray-500 hover:text-red-500 flex-shrink-0"
                      title="Volver a Consumidor Final"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </>)}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                    cliente.condicion_iva === 'RI' || cliente.condicion_iva === 'MT'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-200 text-gray-600'
                  }`}>
                    Fact {cliente.condicion_iva === 'RI' || cliente.condicion_iva === 'MT' ? 'A' : 'B'}
                  </span>
                  {saldoCliente > 0 && (
                    <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0">
                      Saldo: {formatPrecio(saldoCliente)}
                    </span>
                  )}
                </div>
                {(cliente.condicion_iva === 'RI' || cliente.condicion_iva === 'MT') && !cliente.email && (
                  <div className="mt-1.5 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                    <span className="text-amber-500 text-sm">⚠</span>
                    <span className="text-xs font-medium text-amber-700">Sin email — no se podrá enviar comprobante</span>
                  </div>
                )}
                <div className="relative mt-2">
                  <input
                    ref={inputClienteRef}
                    type="text"
                    placeholder="Cambiar cliente… (F1)"
                    value={busquedaCliente}
                    onChange={e => setBusquedaCliente(e.target.value)}
                    className="w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                  />
                  {buscandoClientes && (
                    <div className="absolute right-2 top-1 text-gray-500 text-[10px]">Buscando...</div>
                  )}
                  {seleccionandoCliente && (
                    <div className="absolute right-2 top-1 text-violet-600 text-[10px] flex items-center gap-1">
                      <div className="animate-spin h-3 w-3 border-2 border-violet-400 border-t-transparent rounded-full" />
                      Verificando...
                    </div>
                  )}
                  {clientesCentum.length > 0 && (
                    <div className="absolute z-20 w-full bg-white border rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {clientesCentum.map(cli => (
                        <button
                          key={cli.id || cli.id_centum}
                          onClick={() => seleccionarCliente(cli)}
                          className="w-full text-left px-2 py-1.5 hover:bg-violet-50 text-xs border-b last:border-b-0"
                        >
                          <span className="font-medium">{cli.razon_social}</span>
                          {cli.cuit && <span className="text-gray-500 ml-1">CUIT: {cli.cuit}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* Cerrar carrito (mobile) */}
              <button
                onClick={() => setCarritoVisible(false)}
                className="lg:hidden text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {cliente.id_centum > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="email"
                  placeholder="Email"
                  value={cliente.email || ''}
                  onChange={e => setCliente({ ...cliente, email: e.target.value })}
                  className="flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                />
                <input
                  type="tel"
                  placeholder="Tel / Cel"
                  value={cliente.celular || ''}
                  onChange={e => setCliente({ ...cliente, celular: e.target.value })}
                  className="flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                />
                <button
                  onClick={guardarContactoCliente}
                  disabled={guardandoContacto}
                  className="bg-violet-600 text-white text-[10px] px-2 py-0.5 rounded hover:bg-violet-700 disabled:opacity-50 flex-shrink-0"
                >
                  {guardandoContacto ? '...' : 'Guardar'}
                </button>
              </div>
            )}
          </div>

          {/* Banner modo empleado */}
          {empleadoActivo && (
            <div className="bg-orange-500 text-white px-3 py-1.5 flex items-center justify-between text-sm font-medium">
              <div className="flex items-center gap-3">
                <span>Retiro empleado: {empleadoActivo.nombre}</span>
                {empleadoActivo.disponible != null && (
                  <span className="bg-orange-700/60 text-orange-100 text-xs px-2 py-0.5 rounded">
                    Disponible: {formatPrecio(Math.max(0, empleadoActivo.disponible - total))}
                  </span>
                )}
              </div>
              <button onClick={() => { setEmpleadoActivo(null); setDescuentosEmpleado({}); setCarrito([]) }} className="text-orange-200 hover:text-white text-xs underline">
                Cancelar
              </button>
            </div>
          )}

          {/* Items del carrito */}
          <div className="flex-1 overflow-y-auto">
            {carrito.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                {empleadoActivo ? 'Agregá artículos para el retiro' : 'Carrito vacío'}
              </div>
            ) : (
              <div className="divide-y">
                {carrito.map((item, itemIdx) => {
                  const precioOriginal = precioConDescEmpleado(item.articulo)
                  const precioUnit = item.precioOverride != null ? item.precioOverride : precioOriginal
                  const lineTotal = precioUnit * item.cantidad
                  const tieneOverride = item.precioOverride != null
                  const estaEditando = editandoPrecio === item.articulo.id
                  const seleccionadoEnCarrito = carritoIdx === itemIdx
                  return (
                    <div key={item.articulo.id} className={`px-3 py-2 ${seleccionadoEnCarrito ? 'bg-violet-100 border-l-4 border-l-violet-600' : 'hover:bg-gray-50/80'}`} ref={seleccionadoEnCarrito ? el => el?.scrollIntoView({ block: 'nearest' }) : undefined}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate flex-1">{item.articulo.nombre}</span>
                        <span className="text-sm font-bold text-gray-800 flex-shrink-0">{formatPrecio(lineTotal)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => cambiarCantidad(item.articulo.id, -1, item.articulo.esPesable)}
                            className="w-6 h-6 rounded bg-gray-300 hover:bg-gray-400 flex items-center justify-center text-gray-700 text-sm font-bold"
                          >−</button>
                          {item.articulo.esPesable ? (
                            <input
                              type="number"
                              step="0.001"
                              min="0.001"
                              value={item.cantidad}
                              onChange={e => {
                                const val = parseFloat(e.target.value)
                                if (!isNaN(val) && val > 0) setCantidadDirecta(item.articulo.id, val)
                              }}
                              onClick={e => e.target.select()}
                              className="w-16 text-center text-sm font-semibold border rounded px-1 py-0.5 focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                            />
                          ) : (
                            <span className="w-7 text-center text-sm font-semibold">{item.cantidad}</span>
                          )}
                          <button
                            onClick={() => cambiarCantidad(item.articulo.id, 1, item.articulo.esPesable)}
                            className="w-6 h-6 rounded bg-violet-100 hover:bg-violet-200 flex items-center justify-center text-violet-700 text-sm font-bold"
                          >+</button>
                        </div>
                        {item.articulo.esPesable && <span className="text-[10px] text-amber-600 font-medium">kg</span>}
                        {estaEditando ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={precioUnit}
                            autoFocus
                            onClick={e => e.target.select()}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                const val = parseFloat(e.target.value)
                                if (!isNaN(val) && val >= 0) {
                                  setPrecioOverride(item.articulo.id, val === precioOriginal ? null : val)
                                }
                                setEditandoPrecio(null)
                              } else if (e.key === 'Escape') {
                                setEditandoPrecio(null)
                              }
                            }}
                            onBlur={e => {
                              const val = parseFloat(e.target.value)
                              if (!isNaN(val) && val >= 0) {
                                setPrecioOverride(item.articulo.id, val === precioOriginal ? null : val)
                              }
                              setEditandoPrecio(null)
                            }}
                            className="w-20 text-center text-xs font-semibold border border-violet-400 rounded px-1 py-0.5 focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                          />
                        ) : (
                          <span
                            onClick={() => setEditandoPrecio(item.articulo.id)}
                            className={`text-xs cursor-pointer hover:underline ${tieneOverride ? 'text-violet-600 font-semibold' : 'text-gray-500'}`}
                            title="Click para editar precio"
                          >
                            {formatPrecio(precioUnit)} {item.articulo.esPesable ? '/kg' : 'c/u'}
                          </span>
                        )}
                        {tieneOverride && !estaEditando && (
                          <button
                            onClick={() => setPrecioOverride(item.articulo.id, null)}
                            className="text-violet-400 hover:text-violet-600 p-0.5"
                            title="Restaurar precio original"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                        <div className="flex-1" />
                        <button
                          onClick={() => quitarDelCarrito(item.articulo.id)}
                          className="text-red-300 hover:text-red-500 p-0.5"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Promos aplicadas */}
            {promosAplicadas.length > 0 && (
              <div className="px-3 py-2 space-y-1 border-t">
                {promosAplicadas.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded px-2 py-1 text-xs text-green-700">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                    </svg>
                    <span className="flex-1 truncate">{p.promoNombre} ({p.detalle})</span>
                    <span className="font-semibold">-{formatPrecio(p.descuento)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Descuentos empleado por rubro */}
            {descEmpleadoDetalle.length > 0 && (
              <div className="px-3 py-2 space-y-1 border-t">
                {descEmpleadoDetalle.map((d, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded px-2 py-1 text-xs text-orange-700">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                    <span className="flex-1 truncate">Desc. empleado {d.porcentaje}% — {d.rubro}</span>
                    <span className="font-semibold">-{formatPrecio(d.descuento)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Gift cards en venta */}
            {giftCardsEnVenta.length > 0 && (
              <div className="px-3 py-2 space-y-1.5 border-t border-amber-200 bg-amber-50/50">
                <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">Gift Cards</span>
                {giftCardsEnVenta.map(gc => (
                  <div key={gc.codigo} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                      </svg>
                      <span className="text-xs font-mono text-gray-700 truncate">{gc.codigo}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-amber-700">{formatPrecio(gc.monto)}</span>
                      <button onClick={() => quitarGiftCardDeVenta(gc.codigo)} className="text-red-300 hover:text-red-500 p-0.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>

          {/* Totales + botones */}
          <div className="border-t bg-gray-50 px-4 py-3">
            <div className="space-y-0.5 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{formatPrecio(descEmpleadoTotal > 0 ? subtotalSinDescEmpleado : subtotal)}</span>
              </div>
              {descEmpleadoTotal > 0 && (
                <div className="flex justify-between text-orange-600">
                  <span>Desc. empleado</span>
                  <span>-{formatPrecio(descEmpleadoTotal)}</span>
                </div>
              )}
              {descuentoTotal > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Promos</span>
                  <span>-{formatPrecio(descuentoTotal)}</span>
                </div>
              )}
              {totalGiftCardsEnVenta > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>Gift Cards</span>
                  <span>+{formatPrecio(totalGiftCardsEnVenta)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold text-gray-800 pt-1 border-t">
                <span>TOTAL</span>
                <span>{formatPrecio(totalConGiftCards)}</span>
              </div>
            </div>

            {(carrito.length > 0 || giftCardsEnVenta.length > 0) && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setMostrarConfirmarCancelar(true)}
                  className="px-3 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors"
                  title="F9"
                >
                  Cancelar <span className="text-[9px] opacity-70">F9</span>
                </button>
                {/* Si está editando un pedido: botón guardar cambios */}
                {pedidoEnProceso && pedidoEnProceso.editando && (
                  <button
                    onClick={handleGuardarEdicionPedido}
                    disabled={guardandoPedido}
                    className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                  >
                    {guardandoPedido ? 'Guardando...' : `Guardar cambios #${pedidoEnProceso.numero}`}
                  </button>
                )}
                {/* Si NO hay pedido en proceso: botones normales */}
                {!pedidoEnProceso && !empleadoActivo && (
                  <>
                    <button
                      onClick={handleEsPedido}
                      disabled={guardandoPedido}
                      className="px-3 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white text-sm font-semibold rounded-lg transition-colors"
                      title="F10"
                    >
                      {guardandoPedido ? 'Guardando...' : <>{`Es pedido `}<span className="text-[9px] opacity-70">F10</span></>}
                    </button>
                    <button
                      onClick={() => setMostrarCobrar(true)}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                      title="F11"
                    >
                      Cobrar {formatPrecio(totalConGiftCards)} <span className="text-[9px] opacity-70">F11</span>
                    </button>
                  </>
                )}
                {/* Modo empleado activo: botón registrar retiro */}
                {!pedidoEnProceso && empleadoActivo && (
                  <button
                    onClick={() => setMostrarVentaEmpleado(true)}
                    className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                  >
                    Registrar retiro {formatPrecio(totalConGiftCards)}
                  </button>
                )}
                {/* Si hay pedido en proceso NO pagado y NO editando: cobrar primero */}
                {pedidoEnProceso && !pedidoEnProceso.editando && !pedidoEnProceso.esPagado && (
                  <button
                    onClick={() => setMostrarCobrar(true)}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                    title="F11"
                  >
                    Cobrar {formatPrecio(totalConGiftCards)}
                  </button>
                )}
                {/* Si hay pedido en proceso YA pagado y NO editando: entregar directo */}
                {pedidoEnProceso && !pedidoEnProceso.editando && pedidoEnProceso.esPagado && (() => {
                  const dif = total - (pedidoEnProceso.totalPagado || 0)
                  const saldoCubreFaltante = dif > 0.01 && saldoCliente >= dif
                  const habilitado = dif <= 0.01 || saldoCubreFaltante
                  return (
                    <button
                      onClick={handleEntregarPedidoPagado}
                      disabled={guardandoPedido || !habilitado}
                      className={`flex-1 ${!habilitado ? 'bg-gray-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400'} text-white font-bold py-2.5 rounded-lg text-base transition-colors`}
                    >
                      {guardandoPedido ? 'Guardando...'
                        : dif > 0.01 && saldoCubreFaltante ? `Entregar (usa saldo ${formatPrecio(dif)})`
                        : dif > 0.01 ? `Falta cobrar ${formatPrecio(dif)}`
                        : dif < -0.01 ? `Entregar (saldo +${formatPrecio(Math.abs(dif))})`
                        : `Entregar ${formatPrecio(total)}`
                      }
                    </button>
                  )
                })()}
              </div>
            )}
          </div>
        </div>

        {/* ====== DERECHA: PANEL PRODUCTOS ====== */}
        <div className="flex-1 flex flex-col min-w-0 p-4">
          {/* Buscador con dropdown autocompletado */}
          <div className="relative mb-4">
            <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-500 z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={inputBusquedaRef}
              type="text"
              placeholder="Buscar por nombre, código o escanear... (F2)"
              value={busquedaArt}
              onChange={handleBusquedaChange}
              onKeyDown={handleBusquedaKeyDown}
              className="w-full bg-white border rounded-xl pl-10 pr-12 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent shadow-sm"
              autoFocus
            />
            {/* Botón teclado virtual */}
            <button
              type="button"
              onClick={() => setMostrarTeclado(v => !v)}
              className={`absolute right-2 top-1.5 p-1.5 rounded-lg transition-colors z-10 ${mostrarTeclado ? 'bg-violet-100 text-violet-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
              title="Teclado virtual"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75A2.25 2.25 0 014.5 4.5h15a2.25 2.25 0 012.25 2.25v10.5A2.25 2.25 0 0119.5 19.5h-15a2.25 2.25 0 01-2.25-2.25V6.75zM6 8.25h.01M6 12h.01M6 15.75h12M9.75 8.25h.01M13.5 8.25h.01M17.25 8.25h.01M9.75 12h.01M13.5 12h.01M17.25 12h.01" />
              </svg>
            </button>
            {cargandoArticulos && (
              <div className="absolute right-10 top-3 text-gray-500 text-xs z-10">Cargando...</div>
            )}

            {/* Dropdown de resultados de búsqueda */}
            {busquedaArt.trim() && !cargandoArticulos && (
              <div className={`${mostrarTeclado ? 'relative max-h-48' : 'absolute z-30 max-h-80'} w-full bg-white border border-gray-300 rounded-xl shadow-xl mt-1 overflow-y-auto`}>
                {resultadosBusqueda.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500 text-center">
                    Sin resultados para "{busquedaArt}"
                  </div>
                ) : (
                  resultadosBusqueda.map((art, idx) => {
                    const precioFinal = precioConDescEmpleado(art)
                    const enCarrito = carrito.find(i => i.articulo.id === art.id)
                    const esFav = favoritos.includes(art.id)
                    const seleccionado = idx === busquedaIdx
                    return (
                      <div
                        key={art.id}
                        ref={seleccionado ? el => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                        onClick={() => { agregarAlCarrito(art); setBusquedaArt(''); setBusquedaIdx(-1); inputBusquedaRef.current?.focus() }}
                        className={`flex items-center justify-between px-4 py-2.5 cursor-pointer border-b last:border-b-0 transition-colors ${
                          seleccionado ? 'bg-violet-200 border-l-4 border-l-violet-600' : enCarrito ? 'bg-violet-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        {esAdmin && (
                        <button
                          onClick={(e) => toggleFavorito(art.id, e)}
                          className={`mr-3 flex-shrink-0 transition-colors ${
                            esFav ? 'text-amber-400 hover:text-amber-500' : 'text-gray-400 hover:text-amber-400'
                          }`}
                        >
                          <svg className="w-5 h-5" fill={esFav ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                          </svg>
                        </button>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{art.nombre}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {art.codigo && <span className="mr-2">{art.codigo}</span>}
                            {art.rubro?.nombre && <span>{art.rubro.nombre}</span>}
                            {art.subRubro?.nombre && <span> / {art.subRubro.nombre}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                          <span className="text-sm font-semibold text-gray-700">{formatPrecio(precioFinal)}</span>
                          {enCarrito && (
                            <span className="bg-violet-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
                              {enCarrito.cantidad}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}

          </div>

          {/* Grilla de favoritos (oculta si teclado virtual abierto) */}
          <div className={`flex-1 overflow-y-auto ${mostrarTeclado ? 'hidden' : ''}`}>
            {cargandoArticulos ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
                <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Cargando artículos...
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                {/* Tile Gift Card — siempre primero */}
                <div
                  onClick={() => setMostrarAgregarGC(true)}
                  className={`relative rounded-xl cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.02] active:scale-95 select-none shadow-sm ${
                    giftCardsEnVenta.length > 0 ? 'ring-2 ring-amber-500 shadow-md' : ''
                  }`}
                  style={{ borderTop: '4px solid #F59E0B', backgroundColor: giftCardsEnVenta.length > 0 ? '#FFFBEB' : '#fff' }}
                >
                  {giftCardsEnVenta.length > 0 && (
                    <span className="absolute -top-2 -right-2 bg-amber-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow z-10">
                      {giftCardsEnVenta.length}
                    </span>
                  )}
                  <div className="p-3 flex flex-col items-center text-center min-h-[100px] justify-center">
                    <svg className="w-7 h-7 text-amber-500 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                    <span className="text-xs font-semibold text-amber-700">Gift Card</span>
                  </div>
                </div>

                {articulosFavoritos.map(art => {
                  const precioFinal = precioConDescEmpleado(art)
                  const enCarrito = carrito.find(i => i.articulo.id === art.id)
                  const color = rubroColorMap[art.rubro?.nombre] || TILE_COLORS[0]

                  return (
                    <div
                      key={art.id}
                      onClick={() => agregarAlCarrito(art)}
                      className={`relative rounded-xl cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.02] active:scale-95 select-none ${
                        enCarrito ? 'ring-2 ring-violet-500 shadow-md' : 'shadow-sm'
                      }`}
                      style={{ borderTop: `4px solid ${color.border}`, backgroundColor: color.bg }}
                    >
                      {enCarrito && (
                        <span className="absolute -top-2 -right-2 bg-violet-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow z-10">
                          {enCarrito.cantidad}
                        </span>
                      )}
                      <div className="p-3 flex flex-col items-center text-center min-h-[100px] justify-center">
                        <span className="text-base font-bold text-gray-800">{formatPrecio(precioFinal)}</span>
                        <span className="text-xs text-gray-600 mt-1.5 line-clamp-2 leading-tight">{art.nombre}</span>
                        {art.codigo && <span className="text-[10px] text-gray-500 mt-1 font-mono">{art.codigo}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Teclado virtual — fijo abajo del panel */}
          {mostrarTeclado && (
            <div className="flex-shrink-0 pt-2">
              <TecladoVirtual
                valor={busquedaArt}
                onChange={(v) => { setBusquedaArt(v); setBusquedaIdx(-1) }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Botón flotante carrito (mobile) */}
      <button
        onClick={() => setCarritoVisible(!carritoVisible)}
        className="lg:hidden fixed bottom-4 right-4 z-30 bg-violet-600 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
        {cantidadItems > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {cantidadItems}
          </span>
        )}
      </button>
      </>}

      {/* Modal agregar gift card a la venta */}
      {mostrarAgregarGC && (
        <div data-modal className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setMostrarAgregarGC(false); setGcError('') }}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
                Vender Gift Card
              </h3>
              <button onClick={() => { setMostrarAgregarGC(false); setGcError('') }} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Código (escanear barcode)</label>
                <input
                  type="text"
                  value={gcCodigo}
                  onChange={e => setGcCodigo(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (gcCodigo.trim()) document.getElementById('gc-monto-input')?.focus() } }}
                  placeholder="Escanear o tipear código..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Monto</label>
                <input
                  id="gc-monto-input"
                  type="number"
                  value={gcMonto}
                  onChange={e => setGcMonto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (gcMonto && parseFloat(gcMonto) > 0) agregarGiftCardAVenta() } }}
                  placeholder="$0"
                  min="0"
                  step="0.01"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Comprador (opcional)</label>
                <input
                  type="text"
                  value={gcComprador}
                  onChange={e => setGcComprador(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarGiftCardAVenta() } }}
                  placeholder="Nombre..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              {gcError && <div className="text-red-500 text-sm">{gcError}</div>}
            </div>
            <div className="p-4 border-t flex gap-2">
              <button
                onClick={() => { setMostrarAgregarGC(false); setGcCodigo(''); setGcMonto(''); setGcComprador(''); setGcError('') }}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={agregarGiftCardAVenta}
                disabled={!gcCodigo.trim() || !gcMonto || parseFloat(gcMonto) <= 0}
                className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
              >
                Agregar al cobro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar cancelación */}
      {mostrarConfirmarCancelar && (
        <div className="fixed inset-0 z-[999] bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-xs w-full mx-4 text-center">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Cancelar venta?</h3>
            <div className="flex gap-3">
              <button
                onClick={() => setMostrarConfirmarCancelar(false)}
                className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                No <span className="text-[10px] opacity-60">Esc</span>
              </button>
              <button
                onClick={ejecutarCancelacion}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
              >
                Si <span className="text-[10px] opacity-60">Enter</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Actualizaciones */}
      {mostrarActualizaciones && (
        <ActualizacionesPOS onCerrar={() => setMostrarActualizaciones(false)} />
      )}

      {/* Modal Cerrar Caja */}
      {mostrarCerrarCaja && cierreActivo && (
        <ModalCerrarCaja
          cierreId={cierreActivo.id}
          onClose={() => setMostrarCerrarCaja(false)}
          onCajaCerrada={() => {
            setMostrarCerrarCaja(false)
            setCierreActivo(null)
          }}
        />
      )}

      {/* Modal Problema */}
      {mostrarProblema && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-modal>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="bg-red-600 px-6 py-4 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                </svg>
                <h2 className="text-white font-bold text-lg">
                  {problemaPaso === 0 ? 'Reportar problema' : problemaPaso === 1 ? 'Buscar factura' : problemaPaso === 2 ? 'Seleccionar productos' : problemaPaso === 3 ? 'Describir problema' : problemaPaso === 4 ? 'Identificar cliente' : problemaPaso === 5 ? 'Confirmar devolución' : problemaPaso === 10 ? 'Cliente correcto' : problemaPaso === 11 ? 'Confirmar corrección' : problemaPaso === 20 ? 'Precio correcto' : problemaPaso === 21 ? 'Confirmar diferencia' : problemaPaso === 30 ? 'Cambio de producto' : ''}
                </h2>
              </div>
              <button onClick={cerrarModalProblema} className="text-white/70 hover:text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Paso 0: Seleccionar tipo de problema */}
            {problemaPaso === 0 && (
              <div className="p-5">
                <p className="text-sm text-gray-500 mb-4">Selecciona el tipo de problema:</p>
                <div className="space-y-2">
                  {[
                    { id: 'devolucion', label: 'Cliente devuelve producto en mal estado', icon: 'M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3' },
                    { id: 'cliente_erroneo', label: 'Se facturo a un cliente erroneo', icon: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z' },
                    { id: 'cantidad_mal', label: 'Se facturo mal la cantidad de un articulo', icon: 'M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z' },
                    { id: 'precio_mal', label: 'Se facturo mal el precio de un articulo', icon: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z' },
                    { id: 'cambio', label: 'El cliente desea cambiar el producto', icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5' },
                  ].map(op => (
                    <button
                      key={op.id}
                      onClick={() => setProblemaSeleccionado(op.id)}
                      className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                        problemaSeleccionado === op.id
                          ? 'border-red-500 bg-red-50'
                          : 'border-gray-200 hover:border-red-300 hover:bg-red-50/50'
                      }`}
                    >
                      <svg className={`w-5 h-5 flex-shrink-0 ${problemaSeleccionado === op.id ? 'text-red-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={op.icon} />
                      </svg>
                      <span className={`text-sm font-medium ${problemaSeleccionado === op.id ? 'text-red-700' : 'text-gray-700'}`}>{op.label}</span>
                    </button>
                  ))}
                </div>

                <div className="flex gap-3 mt-5">
                  <button
                    onClick={cerrarModalProblema}
                    className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={!problemaSeleccionado}
                    onClick={() => {
                      if (problemaSeleccionado === 'cambio') {
                        setProblemaPaso(30)
                      } else {
                        setProblemaPaso(1)
                        buscarVentasProblema()
                        if (problemaSucursales.length === 0) {
                          api.get('/api/sucursales').then(r => setProblemaSucursales(r.data || [])).catch(() => {})
                        }
                      }
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                  >
                    Continuar
                  </button>
                </div>
              </div>
            )}

            {/* Paso 1: Buscar factura */}
            {problemaPaso === 1 && (
              <div className="p-5 flex flex-col min-h-0 flex-1">
                {/* Filtros */}
                <div className="space-y-2 mb-3 flex-shrink-0">
                  {/* Fila 0: Buscar por N° Factura */}
                  <div>
                    <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">N° Factura (POS o Centum)</label>
                    <input
                      type="text"
                      value={problemaBusFactura}
                      onChange={e => {
                        setProblemaBusFactura(e.target.value)
                        if (e.target.value.trim()) {
                          setProblemaBusqueda('')
                          setProblemaBusArticulo('')
                          setProblemaSucursal('')
                        }
                        buscarVentasProblemaDebounced({ numero_factura: e.target.value })
                      }}
                      placeholder="Ej: 1234 o B PV2-7740"
                      autoFocus
                      className="block w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    />
                  </div>
                  {!problemaBusFactura.trim() && <>
                  {/* Fila 1: Fecha + Cliente */}
                  <div className="flex gap-2">
                    <div className="flex-shrink-0">
                      <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Fecha</label>
                      <input
                        type="date"
                        value={problemaFecha}
                        onChange={e => {
                          const f = e.target.value
                          setProblemaFecha(f)
                          buscarVentasProblemaDebounced({ fecha: f || '' })
                        }}
                        className="block w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Cliente</label>
                      <input
                        type="text"
                        value={problemaBusqueda}
                        onChange={e => {
                          setProblemaBusqueda(e.target.value)
                          buscarVentasProblemaDebounced({ buscar: e.target.value })
                        }}
                        placeholder="Nombre del cliente..."
                        className="block w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  {/* Fila 2: Articulo + Sucursal */}
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Articulo</label>
                      <input
                        type="text"
                        value={problemaBusArticulo}
                        onChange={e => {
                          setProblemaBusArticulo(e.target.value)
                          buscarVentasProblemaDebounced({ articulo: e.target.value })
                        }}
                        placeholder="Nombre de articulo..."
                        className="block w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </div>
                    <div className="flex-shrink-0 w-36">
                      <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Sucursal</label>
                      <select
                        value={problemaSucursal}
                        onChange={e => {
                          setProblemaSucursal(e.target.value)
                          buscarVentasProblemaDebounced({ sucursal_id: e.target.value })
                        }}
                        className="block w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
                      >
                        <option value="">Todas</option>
                        {problemaSucursales.map(s => (
                          <option key={s.id} value={s.id}>{s.nombre}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  </>}
                </div>

                {/* Contador resultados */}
                {!problemaBuscando && problemaVentas.length > 0 && (
                  <div className="text-xs text-gray-400 mb-2 flex-shrink-0">{problemaVentas.length} factura{problemaVentas.length !== 1 ? 's' : ''}</div>
                )}

                {/* Resultados */}
                <div className="flex-1 overflow-y-auto min-h-0 max-h-72 space-y-2">
                  {problemaBuscando ? (
                    <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mr-2" />
                      Buscando...
                    </div>
                  ) : problemaVentas.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">
                      No se encontraron facturas
                    </div>
                  ) : (
                    problemaVentas.filter(v => v.tipo !== 'nota_credito').map(v => {
                      const items = typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || [])
                      const pagos = typeof v.pagos === 'string' ? JSON.parse(v.pagos) : (v.pagos || [])
                      const fecha = new Date(v.created_at)
                      const sel = problemaVentaSel?.id === v.id
                      return (
                        <button
                          key={v.id}
                          onClick={() => {
                            setProblemaVentaSel(v)
                            // Consultar items ya devueltos de esta venta
                            api.get(`/api/pos/ventas/${v.id}/devoluciones`).then(r => {
                              setProblemaYaDevuelto(r.data?.ya_devuelto || {})
                            }).catch(() => setProblemaYaDevuelto({}))
                          }}
                          className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                            sel ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-red-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-semibold text-gray-800">
                              {v.numero_venta ? <span className="text-blue-600 mr-1">#{v.numero_venta}</span> : null}
                              {v.nombre_cliente || 'Consumidor Final'}
                            </span>
                            <span className="text-sm font-bold text-gray-700">{formatPrecio(v.total)}</span>
                          </div>
                          <div className="text-xs text-gray-400">
                            {fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}{' '}
                            {fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                            {v.centum_comprobante && <span className="text-violet-500 font-medium"> · {v.centum_comprobante}</span>}
                            {v.sucursales?.nombre && <span> · {v.sucursales.nombre}</span>}
                            {v.perfiles?.nombre && <span> · {v.perfiles.nombre}</span>}
                          </div>
                          {pagos.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {[...new Set(pagos.map(p => p.tipo))].map(tipo => (
                                <span key={tipo} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-medium">
                                  {tipo}
                                </span>
                              ))}
                              {v.saldo_aplicado > 0 && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-medium">
                                  Saldo
                                </span>
                              )}
                            </div>
                          )}
                          <div className="text-xs text-gray-400 mt-0.5 truncate">
                            {items.map(i => `${i.cantidad}x ${i.nombre}`).join(', ')}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>

                {/* Botones */}
                <div className="flex gap-3 mt-4 flex-shrink-0">
                  <button
                    onClick={() => { setProblemaPaso(0); setProblemaBusqueda(''); setProblemaBusFactura(''); setProblemaBusArticulo(''); setProblemaSucursal(''); setProblemaVentas([]); setProblemaVentaSel(null) }}
                    className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Volver
                  </button>
                  <button
                    disabled={!problemaVentaSel}
                    onClick={() => {
                      if (problemaSeleccionado === 'cliente_erroneo') {
                        // Ir directo a identificar cliente correcto
                        setProblemaCliente(null)
                        setProblemaBusCliente('')
                        setProblemaClientesRes([])
                        setProblemaPaso(10) // paso especial cliente erróneo
                      } else {
                        setProblemaPaso(2)
                        setProblemaItemsSel({})
                      }
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                  >
                    Seleccionar
                  </button>
                </div>
              </div>
            )}

            {/* Paso 2: seleccionar productos a devolver */}
            {problemaPaso === 2 && problemaVentaSel && (() => {
              const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
              return (
                <div className="p-5 flex flex-col min-h-0 flex-1">
                  {/* Info venta */}
                  <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-700">
                        {problemaVentaSel.numero_venta ? <span className="text-blue-600 mr-1">#{problemaVentaSel.numero_venta}</span> : null}
                        {problemaVentaSel.nombre_cliente || 'Consumidor Final'}
                      </span>
                      <span className="text-sm font-bold text-gray-600">{formatPrecio(problemaVentaSel.total)}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {new Date(problemaVentaSel.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}{' '}
                      {new Date(problemaVentaSel.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>

                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex-shrink-0">
                    Selecciona los productos a devolver
                  </div>

                  {/* Lista de productos */}
                  <div className="flex-1 overflow-y-auto min-h-0 max-h-72 space-y-2">
                    {items.map((item, idx) => {
                      const cantSel = problemaItemsSel[idx] || 0
                      const selected = cantSel > 0
                      const cantYaDevuelta = problemaYaDevuelto[idx] || 0
                      const cantDisponible = (item.cantidad || 1) - cantYaDevuelta
                      const cantMax = cantDisponible
                      const totalmenteDevuelto = cantDisponible <= 0
                      return (
                        <div
                          key={idx}
                          className={`px-4 py-3 rounded-xl border-2 transition-all ${
                            totalmenteDevuelto ? 'border-gray-200 bg-gray-100 opacity-50' : selected ? 'border-red-500 bg-red-50' : 'border-gray-200'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <button
                              disabled={totalmenteDevuelto}
                              onClick={() => {
                                if (totalmenteDevuelto) return
                                setProblemaItemsSel(prev => {
                                  const copy = { ...prev }
                                  if (selected) { delete copy[idx] } else { copy[idx] = 1 }
                                  return copy
                                })
                              }}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                                totalmenteDevuelto ? 'border-gray-300 bg-gray-200' : selected ? 'bg-red-500 border-red-500' : 'border-gray-300'
                              }`}
                            >
                              {selected && !totalmenteDevuelto && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-medium truncate ${totalmenteDevuelto ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{item.nombre}</div>
                              <div className="text-xs text-gray-400">
                                {item.cantidad}x {formatPrecio(item.precio_unitario || item.precioUnitario || item.precio)} = {formatPrecio((item.precio_unitario || item.precioUnitario || item.precio) * item.cantidad)}
                              </div>
                              {totalmenteDevuelto && (
                                <div className="text-xs text-red-500 font-medium mt-0.5">Ya devuelto</div>
                              )}
                              {cantYaDevuelta > 0 && !totalmenteDevuelto && (
                                <div className="text-xs text-amber-600 font-medium mt-0.5">Ya devuelto: {cantYaDevuelta} — disponible: {cantDisponible}</div>
                              )}
                            </div>
                          </div>
                          {selected && cantMax > 1 && (
                            <div className="flex items-center gap-2 mt-2 ml-8">
                              <span className="text-xs text-red-600 font-medium">Cant. a devolver:</span>
                              <button
                                onClick={() => setProblemaItemsSel(prev => {
                                  const v = (prev[idx] || 1) - 1
                                  if (v <= 0) { const copy = { ...prev }; delete copy[idx]; return copy }
                                  return { ...prev, [idx]: v }
                                })}
                                className="w-7 h-7 rounded-lg border border-red-300 bg-white flex items-center justify-center text-red-600 font-bold text-sm hover:bg-red-50"
                              >−</button>
                              <span className="text-sm font-bold text-red-700 w-6 text-center">{cantSel}</span>
                              <button
                                onClick={() => setProblemaItemsSel(prev => {
                                  const v = Math.min((prev[idx] || 1) + 1, cantMax)
                                  return { ...prev, [idx]: v }
                                })}
                                disabled={cantSel >= cantMax}
                                className="w-7 h-7 rounded-lg border border-red-300 bg-white flex items-center justify-center text-red-600 font-bold text-sm hover:bg-red-50 disabled:opacity-30"
                              >+</button>
                              <span className="text-xs text-gray-400">/ {cantMax}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Resumen selección */}
                  {Object.keys(problemaItemsSel).length > 0 && (
                    <div className="bg-red-50 rounded-lg px-3 py-2 mt-3 flex-shrink-0">
                      <span className="text-xs text-red-600 font-medium">
                        {Object.keys(problemaItemsSel).length} producto{Object.keys(problemaItemsSel).length !== 1 ? 's' : ''} · {Object.values(problemaItemsSel).reduce((a, b) => a + b, 0)} unidad{Object.values(problemaItemsSel).reduce((a, b) => a + b, 0) !== 1 ? 'es' : ''}
                      </span>
                    </div>
                  )}

                  {/* Botones */}
                  <div className="flex gap-3 mt-4 flex-shrink-0">
                    <button
                      onClick={() => { setProblemaPaso(1); setProblemaItemsSel({}) }}
                      className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Volver
                    </button>
                    <button
                      disabled={Object.keys(problemaItemsSel).length === 0}
                      onClick={() => {
                        if (problemaSeleccionado === 'cantidad_mal' || problemaSeleccionado === 'cambio') {
                          const v = problemaVentaSel
                          if (v.id_cliente_centum && v.id_cliente_centum !== 0 && v.nombre_cliente && v.nombre_cliente !== 'Consumidor Final') {
                            setProblemaCliente({ id_centum: v.id_cliente_centum, razon_social: v.nombre_cliente })
                          } else { setProblemaCliente(null) }
                          setProblemaBusCliente(''); setProblemaClientesRes([])
                          setProblemaPaso(4)
                        } else if (problemaSeleccionado === 'precio_mal') {
                          setProblemaPreciosCorregidos({})
                          setProblemaPaso(20)
                        } else {
                          setProblemaPaso(3)
                          setProblemaDescripciones({})
                        }
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Paso 3: describir problema de cada producto */}
            {problemaPaso === 3 && problemaVentaSel && (() => {
              const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
              const indices = Object.keys(problemaItemsSel).map(Number)
              const todasCompletas = indices.every(idx => (problemaDescripciones[idx] || '').trim().length > 0)
              return (
                <div className="p-5 flex flex-col min-h-0 flex-1">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3 flex-shrink-0">
                    Describe lo que observas en cada producto
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 max-h-80 space-y-4">
                    {indices.map(idx => {
                      const item = items[idx]
                      const cant = problemaItemsSel[idx]
                      return (
                        <div key={idx} className="bg-white rounded-xl border border-gray-200 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold text-gray-800">{item.nombre}</span>
                            <span className="text-xs text-red-600 font-medium bg-red-50 px-2 py-0.5 rounded-full">
                              {cant} {cant > 1 ? 'unidades' : 'unidad'}
                            </span>
                          </div>
                          <textarea
                            value={problemaDescripciones[idx] || ''}
                            onChange={e => setProblemaDescripciones(prev => ({ ...prev, [idx]: e.target.value }))}
                            placeholder="Ej: Se observa color oscuro, el cliente comenta sabor agrio..."
                            rows={2}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                          />
                        </div>
                      )
                    })}
                  </div>

                  {/* Botones */}
                  <div className="flex gap-3 mt-4 flex-shrink-0">
                    <button
                      onClick={() => setProblemaPaso(2)}
                      className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Volver
                    </button>
                    <button
                      disabled={!todasCompletas}
                      onClick={() => {
                        // Pre-fill cliente si la venta ya tiene uno
                        const v = problemaVentaSel
                        if (v.id_cliente_centum && v.id_cliente_centum !== 0 && v.nombre_cliente && v.nombre_cliente !== 'Consumidor Final') {
                          setProblemaCliente({ id_centum: v.id_cliente_centum, razon_social: v.nombre_cliente })
                        } else {
                          setProblemaCliente(null)
                        }
                        setProblemaBusCliente('')
                        setProblemaClientesRes([])
                        setProblemaPaso(4)
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Paso 4: identificar cliente */}
            {problemaPaso === 4 && (() => {
              return (
                <div className="p-5 flex flex-col min-h-0 flex-1">
                  {/* Cliente ya identificado */}
                  {problemaCliente ? (
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Cliente identificado</div>
                      <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-gray-800">{problemaCliente.razon_social}</div>
                          {problemaCliente.cuit && (
                            <div className="text-xs text-gray-400 mt-0.5">CUIT: {problemaCliente.cuit}</div>
                          )}
                          {problemaCliente.celular && (
                            <div className="text-xs text-gray-400">Tel: {problemaCliente.celular}</div>
                          )}
                        </div>
                        <button
                          onClick={() => { setProblemaCliente(null); setProblemaBusCliente('') }}
                          className="text-xs text-red-500 hover:text-red-700 font-medium"
                        >
                          Cambiar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col min-h-0 flex-1">
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Buscar cliente</div>
                      <div className="flex-shrink-0 mb-3">
                        <input
                          type="text"
                          value={problemaBusCliente}
                          onChange={e => {
                            const val = e.target.value
                            setProblemaBusCliente(val)
                            clearTimeout(problemaCliTimerRef.current)
                            if (val.trim().length < 2) { setProblemaClientesRes([]); return }
                            problemaCliTimerRef.current = setTimeout(async () => {
                              setProblemaBuscandoCli(true)
                              try {
                                const { data } = await api.get('/api/clientes', { params: { buscar: val.trim(), limit: 10 } })
                                setProblemaClientesRes(data.clientes || data.data || [])
                              } catch { setProblemaClientesRes([]) }
                              finally { setProblemaBuscandoCli(false) }
                            }, 400)
                          }}
                          placeholder="Nombre, CUIT o razón social..."
                          autoFocus
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                        />
                      </div>

                      <div className="flex-1 overflow-y-auto min-h-0 max-h-56 space-y-2">
                        {problemaBuscandoCli ? (
                          <div className="flex items-center justify-center py-6 text-gray-400 text-sm">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mr-2" />
                            Buscando...
                          </div>
                        ) : problemaClientesRes.length > 0 ? (
                          problemaClientesRes.map(cli => (
                            <button
                              key={cli.id || cli.id_centum}
                              onClick={() => { setProblemaCliente(cli); setProblemaClientesRes([]) }}
                              className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-200 hover:border-red-300 transition-all"
                            >
                              <div className="text-sm font-medium text-gray-800">{cli.razon_social}</div>
                              <div className="text-xs text-gray-400">
                                {cli.cuit && <span>CUIT: {cli.cuit}</span>}
                                {cli.celular && <span> · Tel: {cli.celular}</span>}
                              </div>
                            </button>
                          ))
                        ) : problemaBusCliente.trim().length >= 2 && !problemaBuscandoCli ? (
                          <div className="text-center py-6 text-gray-400 text-sm">
                            No se encontraron clientes
                          </div>
                        ) : null}
                      </div>

                      {/* Botón crear cliente */}
                      <button
                        onClick={() => setProblemaCrearCliente(true)}
                        className="mt-3 w-full py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm font-medium text-gray-500 hover:border-red-400 hover:text-red-600 transition-colors flex items-center justify-center gap-2 flex-shrink-0"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Crear cliente nuevo
                      </button>
                    </div>
                  )}

                  {/* Botones */}
                  <div className="flex gap-3 mt-4 flex-shrink-0">
                    <button
                      onClick={() => setProblemaPaso(3)}
                      className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Volver
                    </button>
                    <button
                      disabled={!problemaCliente}
                      onClick={() => setProblemaPaso(5)}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                    >
                      Continuar
                    </button>
                  </div>

                  {/* Modal crear cliente superpuesto */}
                  {problemaCrearCliente && (
                    <NuevoClienteModal
                      onClose={() => setProblemaCrearCliente(false)}
                      onCreado={(cli) => {
                        setProblemaCliente(cli)
                        setProblemaCrearCliente(false)
                      }}
                      cuitInicial={problemaBusCliente.trim()}
                    />
                  )}
                </div>
              )
            })()}

            {/* Paso 5: resumen y confirmar devolución */}
            {problemaPaso === 5 && problemaVentaSel && (() => {
              const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
              const indices = Object.keys(problemaItemsSel).map(Number)
              const subtotalVenta = parseFloat(problemaVentaSel.subtotal) || 0
              const totalVenta = parseFloat(problemaVentaSel.total) || 0

              // Calcular subtotal de items devueltos
              let subtotalDevuelto = 0
              const detalleItems = indices.map(idx => {
                const item = items[idx]
                const cant = problemaItemsSel[idx]
                const precioUnit = item.precio_unitario || item.precioUnitario || item.precio || 0
                const sub = precioUnit * cant
                subtotalDevuelto += sub
                return { ...item, cantDevolver: cant, subtotal: sub, descripcion: problemaDescripciones[idx] }
              })

              const proporcion = subtotalVenta > 0 ? subtotalDevuelto / subtotalVenta : 0
              const saldoAFavor = Math.round(proporcion * totalVenta * 100) / 100
              const huboDescuento = totalVenta < subtotalVenta

              return (
                <div className="p-5 flex flex-col min-h-0 flex-1">
                  <div className="flex-1 overflow-y-auto min-h-0 max-h-96 space-y-4">
                    {/* Info venta original */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Venta original</div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Subtotal</span>
                          <span className="font-medium">{formatPrecio(subtotalVenta)}</span>
                        </div>
                        {huboDescuento && (
                          <div className="flex justify-between text-emerald-600">
                            <span>Descuentos</span>
                            <span className="font-medium">-{formatPrecio(subtotalVenta - totalVenta)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-bold border-t mt-1 pt-1">
                          <span>Total pagado</span>
                          <span>{formatPrecio(totalVenta)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Cliente */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Cliente</div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <span className="text-sm font-semibold text-gray-800">{problemaCliente?.razon_social}</span>
                      </div>
                    </div>

                    {/* Productos a devolver */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Productos a devolver</div>
                      <div className="space-y-2">
                        {detalleItems.map((item, i) => (
                          <div key={i} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            <div className="flex justify-between text-sm">
                              <span className="font-medium text-gray-800">{item.cantDevolver}x {item.nombre}</span>
                              <span className="font-medium text-gray-600">{formatPrecio(item.subtotal)}</span>
                            </div>
                            {item.descripcion && <div className="text-xs text-gray-500 mt-0.5 italic">"{item.descripcion}"</div>}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Cálculo del saldo */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Saldo a generar</div>
                      <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl px-4 py-3">
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>Valor productos devueltos</span>
                          <span>{formatPrecio(subtotalDevuelto)}</span>
                        </div>
                        {huboDescuento && (
                          <div className="flex justify-between text-sm text-gray-500">
                            <span>Proporción del total pagado ({Math.round(proporcion * 100)}%)</span>
                            <span>de {formatPrecio(totalVenta)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-bold text-lg border-t border-emerald-300 mt-2 pt-2 text-emerald-700">
                          <span>Saldo a favor</span>
                          <span>{formatPrecio(saldoAFavor)}</span>
                        </div>
                        {huboDescuento && (
                          <div className="text-[10px] text-emerald-600 mt-1">
                            Se calcula sobre lo efectivamente pagado (con descuentos aplicados)
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Observación */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Observación (opcional)</div>
                      <textarea
                        value={problemaObservacion}
                        onChange={e => setProblemaObservacion(e.target.value)}
                        placeholder="Alguna nota adicional..."
                        rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                      />
                    </div>
                  </div>

                  {/* Botones */}
                  <div className="flex gap-3 mt-4 flex-shrink-0">
                    <button
                      onClick={() => setProblemaPaso(4)}
                      disabled={problemaConfirmando}
                      className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      Volver
                    </button>
                    <button
                      disabled={problemaConfirmando}
                      onClick={async () => {
                        setProblemaConfirmando(true)
                        try {
                          const tipoProblemaLabel = problemaSeleccionado === 'cantidad_mal' ? 'Cantidad mal facturada' : problemaSeleccionado === 'cambio' ? 'Cambio de producto' : 'Producto en mal estado'
                          const itemsDevueltos = indices.map(idx => ({
                            indice: idx,
                            nombre: items[idx].nombre,
                            cantidad: problemaItemsSel[idx],
                            descripcion: problemaDescripciones[idx]?.trim() || undefined,
                          }))
                          const { data } = await api.post('/api/pos/devolucion', {
                            venta_id: problemaVentaSel.id,
                            id_cliente_centum: problemaCliente.id_centum,
                            nombre_cliente: problemaCliente.razon_social,
                            tipo_problema: tipoProblemaLabel,
                            observacion: problemaObservacion.trim() || undefined,
                            items_devueltos: itemsDevueltos,
                            caja_id: terminalConfig?.caja_id || null,
                          })
                          // Imprimir 2 tickets: cliente + cajero
                          // Usar items_nc del backend (tienen precio con descuento aplicado)
                          const itemsTicket = (data.items_nc || []).map(it => ({
                            nombre: it.nombre,
                            cantidad: it.cantidad,
                            precioOriginal: it.precio_unitario || it.precioUnitario || it.precio || 0,
                            precioPagado: it.precioUnitario || it.precio || 0,
                            descripcion: it.descripcionProblema,
                          }))
                          imprimirTicketDevolucion({
                            items: itemsTicket,
                            cliente: problemaCliente.razon_social,
                            saldoAFavor: data.saldo_generado,
                            tipoProblema: tipoProblemaLabel,
                            observacion: problemaObservacion.trim() || undefined,
                            ventaOriginal: { numero: problemaVentaSel.numero_venta, comprobante: problemaVentaSel.centum_comprobante },
                            numeroNC: data.numero_nc,
                            huboDescuento: data.factor_descuento < 0.999,
                            subtotalDevuelto: data.subtotal_devuelto,
                          })
                          alert(`Devolución registrada. Se generó un saldo a favor de ${formatPrecio(data.saldo_generado)} para ${problemaCliente.razon_social}`)
                          cerrarModalProblema()
                        } catch (err) {
                          alert('Error al procesar devolución: ' + (err.response?.data?.error || err.message))
                        } finally {
                          setProblemaConfirmando(false)
                        }
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                      {problemaConfirmando && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                      {problemaConfirmando ? 'Procesando...' : 'Confirmar devolución'}
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Paso 10: Cliente erróneo — identificar cliente correcto */}
            {problemaPaso === 10 && problemaVentaSel && (() => {
              return (
                <div className="p-5 flex flex-col min-h-0 flex-1">
                  {/* Info venta original */}
                  <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 flex-shrink-0">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-gray-400">Facturado a:</div>
                        <span className="text-sm font-semibold text-gray-700">
                          {problemaVentaSel.numero_venta ? <span className="text-blue-600 mr-1">#{problemaVentaSel.numero_venta}</span> : null}
                          {problemaVentaSel.nombre_cliente || 'Consumidor Final'}
                        </span>
                      </div>
                      <span className="text-sm font-bold text-gray-600">{formatPrecio(problemaVentaSel.total)}</span>
                    </div>
                  </div>

                  <div className="text-xs font-medium text-red-500 uppercase tracking-wide mb-3 flex-shrink-0">
                    Selecciona el cliente correcto
                  </div>

                  {/* Cliente ya seleccionado */}
                  {problemaCliente ? (
                    <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-gray-800">{problemaCliente.razon_social}</div>
                        {problemaCliente.cuit && <div className="text-xs text-gray-400 mt-0.5">CUIT: {problemaCliente.cuit}</div>}
                        {problemaCliente.celular && <div className="text-xs text-gray-400">Tel: {problemaCliente.celular}</div>}
                      </div>
                      <button
                        onClick={() => { setProblemaCliente(null); setProblemaBusCliente('') }}
                        className="text-xs text-red-500 hover:text-red-700 font-medium"
                      >
                        Cambiar
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col min-h-0 flex-1">
                      <div className="flex-shrink-0 mb-3">
                        <input
                          type="text"
                          value={problemaBusCliente}
                          onChange={e => {
                            const val = e.target.value
                            setProblemaBusCliente(val)
                            clearTimeout(problemaCliTimerRef.current)
                            if (val.trim().length < 2) { setProblemaClientesRes([]); return }
                            problemaCliTimerRef.current = setTimeout(async () => {
                              setProblemaBuscandoCli(true)
                              try {
                                const { data } = await api.get('/api/clientes', { params: { buscar: val.trim(), limit: 10 } })
                                setProblemaClientesRes(data.clientes || data.data || [])
                              } catch { setProblemaClientesRes([]) }
                              finally { setProblemaBuscandoCli(false) }
                            }, 400)
                          }}
                          placeholder="Nombre, CUIT o razón social..."
                          autoFocus
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                        />
                      </div>

                      <div className="flex-1 overflow-y-auto min-h-0 max-h-56 space-y-2">
                        {problemaBuscandoCli ? (
                          <div className="flex items-center justify-center py-6 text-gray-400 text-sm">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mr-2" />
                            Buscando...
                          </div>
                        ) : problemaClientesRes.length > 0 ? (
                          problemaClientesRes.map(cli => (
                            <button
                              key={cli.id || cli.id_centum}
                              onClick={() => { setProblemaCliente(cli); setProblemaClientesRes([]) }}
                              className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-200 hover:border-red-300 transition-all"
                            >
                              <div className="text-sm font-medium text-gray-800">{cli.razon_social}</div>
                              <div className="text-xs text-gray-400">
                                {cli.cuit && <span>CUIT: {cli.cuit}</span>}
                                {cli.celular && <span> · Tel: {cli.celular}</span>}
                              </div>
                            </button>
                          ))
                        ) : problemaBusCliente.trim().length >= 2 && !problemaBuscandoCli ? (
                          <div className="text-center py-6 text-gray-400 text-sm">No se encontraron clientes</div>
                        ) : null}
                      </div>

                      <button
                        onClick={() => setProblemaCrearCliente(true)}
                        className="mt-3 w-full py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm font-medium text-gray-500 hover:border-red-400 hover:text-red-600 transition-colors flex items-center justify-center gap-2 flex-shrink-0"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Crear cliente nuevo
                      </button>
                    </div>
                  )}

                  <div className="flex gap-3 mt-4 flex-shrink-0">
                    <button
                      onClick={() => setProblemaPaso(1)}
                      className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Volver
                    </button>
                    <button
                      disabled={!problemaCliente}
                      onClick={() => setProblemaPaso(11)}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                    >
                      Continuar
                    </button>
                  </div>

                  {problemaCrearCliente && (
                    <NuevoClienteModal
                      onClose={() => setProblemaCrearCliente(false)}
                      onCreado={(cli) => { setProblemaCliente(cli); setProblemaCrearCliente(false) }}
                      cuitInicial={problemaBusCliente.trim()}
                    />
                  )}
                </div>
              )
            })()}

            {/* Paso 11: Cliente erróneo — confirmar corrección */}
            {problemaPaso === 11 && problemaVentaSel && problemaCliente && (() => {
              const pagos = typeof problemaVentaSel.pagos === 'string' ? JSON.parse(problemaVentaSel.pagos) : (problemaVentaSel.pagos || [])
              const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
              return (
                <div className="p-5 flex flex-col min-h-0 flex-1">
                  <div className="flex-1 overflow-y-auto min-h-0 max-h-96 space-y-4">
                    {/* Cambio de cliente */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Corrección de cliente</div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          <div className="text-[10px] text-red-400 uppercase font-medium">Incorrecto</div>
                          <div className="text-sm font-semibold text-gray-700">{problemaVentaSel.nombre_cliente || 'Consumidor Final'}</div>
                        </div>
                        <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                        <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                          <div className="text-[10px] text-emerald-500 uppercase font-medium">Correcto</div>
                          <div className="text-sm font-semibold text-gray-700">{problemaCliente.razon_social}</div>
                        </div>
                      </div>
                    </div>

                    {/* Detalle de la venta */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Detalle de la venta</div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Fecha</span>
                          <span className="font-medium">
                            {new Date(problemaVentaSel.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}{' '}
                            {new Date(problemaVentaSel.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm font-bold border-t pt-1">
                          <span>Total</span>
                          <span>{formatPrecio(problemaVentaSel.total)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Productos */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Productos</div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                        {items.map((i, idx) => (
                          <div key={idx}>{i.cantidad}x {i.nombre}</div>
                        ))}
                      </div>
                    </div>

                    {/* Formas de pago */}
                    {pagos.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Forma de pago</div>
                        <div className="flex flex-wrap gap-1">
                          {pagos.map((p, idx) => (
                            <span key={idx} className="inline-flex items-center px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs font-medium">
                              {p.tipo} {formatPrecio(p.monto)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Qué se va a hacer */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Se realizará</div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          <span className="text-xs font-bold text-red-600 bg-red-200 px-1.5 py-0.5 rounded">NC</span>
                          <span className="text-xs text-gray-600">Nota de crédito a <strong>{problemaVentaSel.nombre_cliente || 'Consumidor Final'}</strong> por {formatPrecio(problemaVentaSel.total)}</span>
                        </div>
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                          <span className="text-xs font-bold text-emerald-600 bg-emerald-200 px-1.5 py-0.5 rounded">V</span>
                          <span className="text-xs text-gray-600">Nueva venta a <strong>{problemaCliente.razon_social}</strong> por {formatPrecio(problemaVentaSel.total)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-4 flex-shrink-0">
                    <button
                      onClick={() => setProblemaPaso(10)}
                      disabled={problemaConfirmando}
                      className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      Volver
                    </button>
                    <button
                      disabled={problemaConfirmando}
                      onClick={async () => {
                        setProblemaConfirmando(true)
                        try {
                          await api.post('/api/pos/correccion-cliente', {
                            venta_id: problemaVentaSel.id,
                            id_cliente_centum: problemaCliente.id_centum,
                            nombre_cliente: problemaCliente.razon_social,
                          })
                          alert(`Corrección realizada:\n• Nota de crédito generada para ${problemaVentaSel.nombre_cliente || 'Consumidor Final'}\n• Nueva venta generada para ${problemaCliente.razon_social}`)
                          cerrarModalProblema()
                        } catch (err) {
                          alert('Error al corregir cliente: ' + (err.response?.data?.error || err.message))
                        } finally {
                          setProblemaConfirmando(false)
                        }
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                      {problemaConfirmando && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                      {problemaConfirmando ? 'Procesando...' : 'Confirmar corrección'}
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Paso 30: Cambio — confirmar buen estado del producto */}
            {problemaPaso === 30 && (
              <div className="p-5 flex flex-col items-center justify-center flex-1">
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-gray-800 mb-2 text-center">Confirmar estado del producto</h3>
                <p className="text-sm text-gray-500 text-center mb-6 max-w-xs">
                  ¿El producto que devuelve el cliente se encuentra en buen estado?
                </p>
                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => setProblemaPaso(0)}
                    className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    No, cancelar
                  </button>
                  <button
                    onClick={() => {
                      setProblemaPaso(1)
                      buscarVentasProblema()
                      if (problemaSucursales.length === 0) {
                        api.get('/api/sucursales').then(r => setProblemaSucursales(r.data || [])).catch(() => {})
                      }
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
                  >
                    Sí, confirmo
                  </button>
                </div>
              </div>
            )}

            {/* Paso 20: Precio mal — ingresar precio correcto */}
            {problemaPaso === 20 && problemaVentaSel && (() => {
              const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
              const indices = Object.keys(problemaItemsSel).map(Number)
              const todosCompletos = indices.every(idx => {
                const val = problemaPreciosCorregidos[idx]
                return val !== undefined && val !== '' && parseFloat(val) >= 0
              })
              return (
                <div className="p-5 flex flex-col min-h-0 flex-1">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3 flex-shrink-0">
                    Ingresa el precio que figura en góndola
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 max-h-80 space-y-3">
                    {indices.map(idx => {
                      const item = items[idx]
                      const precioOriginal = item.precio_unitario || item.precioUnitario || item.precio || 0
                      const precioCorr = problemaPreciosCorregidos[idx]
                      const cantItem = item.cantidad || 1
                      const diferencia = precioCorr !== undefined && precioCorr !== '' ? (precioOriginal - parseFloat(precioCorr)) * cantItem : null
                      return (
                        <div key={idx} className="bg-white rounded-xl border border-gray-200 p-4">
                          <div className="text-sm font-semibold text-gray-800 mb-2">{item.nombre}</div>
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <label className="text-[10px] text-gray-400 uppercase font-medium">Cobrado</label>
                              <div className="text-sm font-bold text-red-600">{formatPrecio(precioOriginal)}</div>
                            </div>
                            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                            <div className="flex-1">
                              <label className="text-[10px] text-gray-400 uppercase font-medium">Precio góndola</label>
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={problemaPreciosCorregidos[idx] ?? ''}
                                  onChange={e => setProblemaPreciosCorregidos(prev => ({ ...prev, [idx]: e.target.value }))}
                                  placeholder="0.00"
                                  className="w-full pl-7 pr-2 py-2 border border-gray-300 rounded-lg text-sm font-bold text-emerald-700 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                                />
                              </div>
                            </div>
                          </div>
                          {diferencia !== null && diferencia > 0 && (
                            <div className="mt-2 text-xs text-emerald-600 font-medium bg-emerald-50 rounded px-2 py-1 text-center">
                              Diferencia a favor: {formatPrecio(diferencia)}
                            </div>
                          )}
                          {diferencia !== null && diferencia <= 0 && (
                            <div className="mt-2 text-xs text-amber-600 font-medium bg-amber-50 rounded px-2 py-1 text-center">
                              {diferencia === 0 ? 'Sin diferencia' : 'El precio de góndola es mayor al cobrado'}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex gap-3 mt-4 flex-shrink-0">
                    <button
                      onClick={() => setProblemaPaso(2)}
                      className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Volver
                    </button>
                    <button
                      disabled={!todosCompletos}
                      onClick={() => {
                        const v = problemaVentaSel
                        if (v.id_cliente_centum && v.id_cliente_centum !== 0 && v.nombre_cliente && v.nombre_cliente !== 'Consumidor Final') {
                          setProblemaCliente({ id_centum: v.id_cliente_centum, razon_social: v.nombre_cliente })
                        } else { setProblemaCliente(null) }
                        setProblemaBusCliente(''); setProblemaClientesRes([])
                        setProblemaPaso(21)
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Paso 21: Precio mal — identificar cliente + confirmar */}
            {problemaPaso === 21 && problemaVentaSel && (() => {
              const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
              const indices = Object.keys(problemaItemsSel).map(Number)

              // Calcular diferencia total
              let totalDiferencia = 0
              const detalleItems = indices.map(idx => {
                const item = items[idx]
                const cant = item.cantidad || 1
                const precioCobrado = item.precio_unitario || item.precioUnitario || item.precio || 0
                const precioGondola = parseFloat(problemaPreciosCorregidos[idx]) || 0
                const dif = (precioCobrado - precioGondola) * cant
                totalDiferencia += dif
                return { nombre: item.nombre, cantidad: cant, precioCobrado, precioGondola, diferencia: dif, indice: idx }
              })

              // Aplicar proporción de descuento de la venta original
              const subtotalVenta = parseFloat(problemaVentaSel.subtotal) || 0
              const totalVenta = parseFloat(problemaVentaSel.total) || 0
              const factorDescuento = subtotalVenta > 0 ? totalVenta / subtotalVenta : 1
              const saldoAFavor = Math.round(totalDiferencia * factorDescuento * 100) / 100
              const huboDescuento = factorDescuento < 1

              return (
                <div className="p-5 flex flex-col min-h-0 flex-1">
                  <div className="flex-1 overflow-y-auto min-h-0 max-h-96 space-y-4">
                    {/* Cliente */}
                    {!problemaCliente ? (
                      <div>
                        <div className="text-xs font-medium text-red-500 uppercase tracking-wide mb-3">Identificar cliente</div>
                        <div className="flex-shrink-0 mb-3">
                          <input
                            type="text"
                            value={problemaBusCliente}
                            onChange={e => {
                              const val = e.target.value
                              setProblemaBusCliente(val)
                              clearTimeout(problemaCliTimerRef.current)
                              if (val.trim().length < 2) { setProblemaClientesRes([]); return }
                              problemaCliTimerRef.current = setTimeout(async () => {
                                setProblemaBuscandoCli(true)
                                try {
                                  const { data } = await api.get('/api/clientes', { params: { buscar: val.trim(), limit: 10 } })
                                  setProblemaClientesRes(data.clientes || data.data || [])
                                } catch { setProblemaClientesRes([]) }
                                finally { setProblemaBuscandoCli(false) }
                              }, 400)
                            }}
                            placeholder="Nombre, CUIT o razón social..."
                            autoFocus
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                          />
                        </div>
                        <div className="max-h-40 overflow-y-auto space-y-2">
                          {problemaBuscandoCli ? (
                            <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mr-2" />Buscando...
                            </div>
                          ) : problemaClientesRes.map(cli => (
                            <button key={cli.id || cli.id_centum} onClick={() => { setProblemaCliente(cli); setProblemaClientesRes([]) }}
                              className="w-full text-left px-4 py-2 rounded-xl border-2 border-gray-200 hover:border-red-300 transition-all">
                              <div className="text-sm font-medium text-gray-800">{cli.razon_social}</div>
                              <div className="text-xs text-gray-400">{cli.cuit && `CUIT: ${cli.cuit}`}{cli.celular && ` · Tel: ${cli.celular}`}</div>
                            </button>
                          ))}
                          {problemaBusCliente.trim().length >= 2 && !problemaBuscandoCli && problemaClientesRes.length === 0 && (
                            <div className="text-center py-4 text-gray-400 text-sm">No se encontraron clientes</div>
                          )}
                        </div>
                        <button onClick={() => setProblemaCrearCliente(true)}
                          className="mt-3 w-full py-2 rounded-xl border-2 border-dashed border-gray-300 text-sm font-medium text-gray-500 hover:border-red-400 hover:text-red-600 transition-colors flex items-center justify-center gap-2">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                          Crear cliente nuevo
                        </button>
                        {problemaCrearCliente && (
                          <NuevoClienteModal onClose={() => setProblemaCrearCliente(false)}
                            onCreado={(cli) => { setProblemaCliente(cli); setProblemaCrearCliente(false) }}
                            cuitInicial={problemaBusCliente.trim()} />
                        )}
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Cliente</div>
                          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center justify-between">
                            <span className="text-sm font-semibold text-gray-800">{problemaCliente.razon_social}</span>
                            <button onClick={() => { setProblemaCliente(null); setProblemaBusCliente('') }} className="text-xs text-red-500 font-medium">Cambiar</button>
                          </div>
                        </div>

                        {/* Detalle diferencias */}
                        <div>
                          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Diferencias de precio</div>
                          <div className="space-y-2">
                            {detalleItems.map((d, i) => (
                              <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
                                <div className="text-sm font-medium text-gray-800">{d.cantidad !== 1 ? `${d.cantidad}x ` : ''}{d.nombre}</div>
                                <div className="flex items-center gap-2 mt-1 text-xs">
                                  <span className="text-red-600">Cobrado: {formatPrecio(d.precioCobrado)}</span>
                                  <span className="text-gray-400">→</span>
                                  <span className="text-emerald-600">Góndola: {formatPrecio(d.precioGondola)}</span>
                                  <span className="ml-auto font-bold text-emerald-700">+{formatPrecio(d.diferencia)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Saldo a generar */}
                        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl px-4 py-3">
                          {huboDescuento && (
                            <div className="flex justify-between text-sm text-gray-500 mb-1">
                              <span>Diferencia bruta</span>
                              <span>{formatPrecio(totalDiferencia)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold text-lg text-emerald-700">
                            <span>Saldo a favor</span>
                            <span>{formatPrecio(saldoAFavor)}</span>
                          </div>
                          {huboDescuento && (
                            <div className="text-[10px] text-emerald-600 mt-1">Ajustado al descuento aplicado en la venta original</div>
                          )}
                        </div>

                        {/* Observación */}
                        <div>
                          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Observación (opcional)</div>
                          <textarea value={problemaObservacion} onChange={e => setProblemaObservacion(e.target.value)}
                            placeholder="Alguna nota adicional..." rows={2}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none" />
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex gap-3 mt-4 flex-shrink-0">
                    <button onClick={() => setProblemaPaso(20)} disabled={problemaConfirmando}
                      className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                      Volver
                    </button>
                    <button
                      disabled={!problemaCliente || saldoAFavor <= 0 || problemaConfirmando}
                      onClick={async () => {
                        setProblemaConfirmando(true)
                        try {
                          const { data } = await api.post('/api/pos/devolucion-precio', {
                            venta_id: problemaVentaSel.id,
                            id_cliente_centum: problemaCliente.id_centum,
                            nombre_cliente: problemaCliente.razon_social,
                            observacion: problemaObservacion.trim() || undefined,
                            items_corregidos: detalleItems.map(d => ({
                              indice: d.indice,
                              nombre: d.nombre,
                              cantidad: d.cantidad,
                              precio_cobrado: d.precioCobrado,
                              precio_correcto: d.precioGondola,
                            })),
                            caja_id: terminalConfig?.caja_id || null,
                          })
                          alert(`Corrección registrada. Se generó un saldo a favor de ${formatPrecio(data.saldo_generado)} para ${problemaCliente.razon_social}`)
                          cerrarModalProblema()
                        } catch (err) {
                          alert('Error: ' + (err.response?.data?.error || err.message))
                        } finally { setProblemaConfirmando(false) }
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                      {problemaConfirmando && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                      {problemaConfirmando ? 'Procesando...' : 'Confirmar'}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}


      {/* Modal de cobro */}
      {mostrarCobrar && (
        <ModalCobrar
          total={totalConGiftCards}
          subtotal={subtotal}
          descuentoTotal={descuentoTotal}
          ivaTotal={0}
          carrito={carrito}
          cliente={cliente}
          promosAplicadas={promosAplicadas}
          onConfirmar={handleVentaExitosa}
          onCerrar={() => setMostrarCobrar(false)}
          isOnline={isOnline}
          onVentaOffline={actualizarPendientes}
          pedidoPosId={pedidoEnProceso?.id || null}
          saldoCliente={saldoCliente}
          giftCardsEnVenta={giftCardsEnVenta}
        />
      )}

      {/* Modal venta empleado — seleccionar o confirmar */}
      {mostrarVentaEmpleado && (
        <ModalVentaEmpleado
          mode={empleadoActivo ? 'confirmar' : 'seleccionar'}
          carrito={carrito}
          empleadoActivo={empleadoActivo}
          descuentosEmpleado={descuentosEmpleado}
          precioConDescEmpleado={precioConDescEmpleado}
          terminalConfig={terminalConfig}
          cajero={cierreActivo?.empleado ? { nombre: cierreActivo.empleado.nombre, id: cierreActivo.empleado.id } : usuario}
          onCerrar={() => setMostrarVentaEmpleado(false)}
          onEmpleadoSeleccionado={(emp, descs) => {
            setEmpleadoActivo(emp)
            setDescuentosEmpleado(descs)
            setMostrarVentaEmpleado(false)
          }}
          onExito={() => {
            setMostrarVentaEmpleado(false)
            setCarrito([])
            setCliente({ ...CLIENTE_DEFAULT })
            setBusquedaArt('')
            setGiftCardsEnVenta([])
            setEmpleadoActivo(null)
            setDescuentosEmpleado({})
          }}
        />
      )}

      {/* Modal de cobro para pedido (pago anticipado o cobro en caja) */}
      {mostrarCobrarPedido && (
        <ModalCobrar
          total={cobrarPedidoExistente ? cobrarPedidoExistente.total : total}
          subtotal={cobrarPedidoExistente ? cobrarPedidoExistente.total : subtotal}
          descuentoTotal={cobrarPedidoExistente ? 0 : descuentoTotal}
          ivaTotal={0}
          carrito={cobrarPedidoExistente ? (typeof cobrarPedidoExistente.items === 'string' ? JSON.parse(cobrarPedidoExistente.items) : cobrarPedidoExistente.items || []) : carrito}
          cliente={cobrarPedidoExistente ? { id_centum: cobrarPedidoExistente.id_cliente_centum || 0, razon_social: cobrarPedidoExistente.nombre_cliente || 'Consumidor Final', condicion_iva: 'CF' } : cliente}
          promosAplicadas={cobrarPedidoExistente ? [] : promosAplicadas}
          onConfirmar={handleCobroPedidoExitoso}
          onCerrar={() => { setMostrarCobrarPedido(false); setCobrarPedidoExistente(null); pedidoWizardDataRef.current = null }}
          isOnline={isOnline}
          onVentaOffline={actualizarPendientes}
          soloPago
        />
      )}

      {/* Pedidos ahora es una página separada en /pos/pedidos */}

      {/* Modal buscar cliente para pedido */}
      {/* Modal wizard pedido: paso 0 = cliente, paso 1 = tipo */}
      {mostrarBuscarClientePedido && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={cerrarWizardPedido}>
          <div
            className="bg-white rounded-xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800">
                  {pasoPedido === 0 ? 'Fecha de entrega' : pasoPedido === 1 ? 'Seleccionar cliente' : pasoPedido === 2 ? 'Tipo de pedido' : pasoPedido === 3 ? (tipoPedidoSeleccionado === 'delivery' ? 'Direccion de entrega' : 'Sucursal de retiro') : 'Pago anticipado'}
                </h2>
                <button onClick={cerrarWizardPedido} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {pasoPedido === 1 && (
                <button onClick={() => { setPasoPedido(0); setFechaEntregaPedido('') }} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Cambiar fecha
                </button>
              )}
              {pasoPedido === 2 && (
                <button onClick={() => { setPasoPedido(1); setClientePedido(null) }} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Cambiar cliente
                </button>
              )}
              {pasoPedido === 3 && (
                <button onClick={() => { setPasoPedido(2); setTipoPedidoSeleccionado(null) }} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Cambiar tipo
                </button>
              )}
              {pasoPedido === 4 && (
                <button onClick={() => setPasoPedido(3)} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Volver
                </button>
              )}
              {/* Progress dots */}
              <div className="flex gap-1.5 mt-2">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className={`h-1 flex-1 rounded-full ${i <= pasoPedido ? 'bg-amber-500' : 'bg-gray-200'}`} />
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto flex-1 space-y-3">

              {/* PASO 0: Fecha de entrega */}
              {pasoPedido === 0 && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fecha de entrega / retiro
                    </label>
                    <input
                      type="date"
                      value={fechaEntregaPedido}
                      onChange={e => setFechaEntregaPedido(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  {(() => {
                    const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
                    const tienePerecedor = carrito.some(i => {
                      const rubro = (i.articulo.rubro?.nombre || '').toLowerCase()
                      return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
                    })
                    if (tienePerecedor) {
                      const manana = new Date()
                      manana.setDate(manana.getDate() + 1)
                      const mananaISO = manana.toISOString().split('T')[0]
                      const excede = fechaEntregaPedido && fechaEntregaPedido > mananaISO
                      return (
                        <div className={`text-xs px-3 py-2 rounded-lg ${excede ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                          {excede
                            ? 'El pedido contiene Fiambres, Quesos o Frescos. La fecha no puede ser mayor a mañana.'
                            : 'El pedido contiene productos perecederos (max. mañana).'}
                        </div>
                      )
                    }
                    return null
                  })()}
                  <button
                    onClick={() => {
                      if (!fechaEntregaPedido) return
                      // Validar perecederos
                      const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
                      const manana = new Date()
                      manana.setDate(manana.getDate() + 1)
                      const mananaISO = manana.toISOString().split('T')[0]
                      const tienePerecedor = carrito.some(i => {
                        const rubro = (i.articulo.rubro?.nombre || '').toLowerCase()
                        return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
                      })
                      if (tienePerecedor && fechaEntregaPedido > mananaISO) return
                      // Cargar bloqueos para la fecha seleccionada
                      api.get('/api/pos/bloqueos', { params: { fecha: fechaEntregaPedido } })
                        .then(({ data }) => {
                          const diaSemana = new Date(fechaEntregaPedido + 'T12:00:00').getDay()
                          const activos = (data || []).filter(b => {
                            if (!b.activo) return false
                            if (b.tipo === 'fecha' && b.fecha === fechaEntregaPedido) return true
                            if (b.tipo === 'semanal' && b.dia_semana === diaSemana) return true
                            return false
                          })
                          setBloqueosFecha(activos)
                        })
                        .catch(() => setBloqueosFecha([]))
                      // Si ya tiene cliente real, saltar al paso 2 (tipo)
                      if (cliente.id_centum && cliente.id_centum !== 0) {
                        setClientePedido(cliente)
                        setPasoPedido(2)
                      } else {
                        setPasoPedido(1)
                      }
                    }}
                    disabled={!fechaEntregaPedido}
                    className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors mt-2"
                  >
                    Continuar
                  </button>
                </>
              )}

              {/* PASO 1: Buscar cliente */}
              {pasoPedido === 1 && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm">
                    <span className="text-gray-500">Fecha:</span>{' '}
                    <span className="font-medium text-gray-800">{new Date(fechaEntregaPedido + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                  </div>
                  <input
                    ref={inputClientePedidoRef}
                    type="text"
                    value={busquedaClientePedido}
                    onChange={e => setBusquedaClientePedido(e.target.value)}
                    placeholder="Buscar por DNI o CUIT..."
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                  />
                  {buscandoClientePedido && (
                    <div className="flex justify-center py-4">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-600" />
                    </div>
                  )}
                  {!buscandoClientePedido && clientesPedido.length > 0 && (
                    <div className="space-y-1">
                      {clientesPedido.map(c => (
                        <button
                          key={c.id || c.id_centum}
                          onClick={() => seleccionarClienteParaPedido(c)}
                          disabled={!c.id_centum}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            c.id_centum
                              ? 'border-gray-100 hover:border-amber-300 hover:bg-amber-50/50'
                              : 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-800 truncate">{c.razon_social}</span>
                            {!c.id_centum && (
                              <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Sin Centum</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {c.cuit && <span>{c.cuit}</span>}
                            {c.direccion && <span> · {c.direccion}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {!buscandoClientePedido && busquedaClientePedido.trim().length >= 2 && clientesPedido.length === 0 && (
                    <div className="text-center py-4 space-y-3">
                      <p className="text-sm text-gray-400">No se encontraron clientes</p>
                      <button
                        onClick={() => setMostrarCrearClientePedido(true)}
                        className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 text-gray-500 hover:text-amber-700 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                        <span className="text-sm font-medium">Crear nuevo cliente</span>
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* PASO 2: Tipo de pedido */}
              {pasoPedido === 2 && clientePedido && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-gray-500">Fecha:</span>{' '}
                      <span className="font-medium text-gray-800">{new Date(fechaEntregaPedido + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Cliente:</span>{' '}
                      <span className="font-medium text-gray-800">{clientePedido.razon_social}</span>
                    </div>
                  </div>
                  {bloqueosFecha.length > 0 && (
                    <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mt-2">
                      <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        <div className="text-sm text-amber-800">
                          {bloqueosFecha.map((b, i) => (
                            <div key={i} className="font-medium">
                              {b.motivo || `Bloqueo ${b.turno === 'todo' ? 'todo el día' : b.turno.toUpperCase()}`}
                              {b.turno !== 'todo' && <span className="font-normal text-amber-600"> — turno {b.turno.toUpperCase()}</span>}
                              {b.aplica_a !== 'todos' && <span className="font-normal text-amber-600"> ({b.aplica_a})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <button
                      onClick={() => seleccionarTipoPedido('delivery')}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 transition-all"
                    >
                      <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.079-.504 1.004-1.1A17.05 17.05 0 0015.064 8.39a2.25 2.25 0 00-1.89-1.014H12m-1.5 11.374h6" />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">Delivery</span>
                    </button>
                    <button
                      onClick={() => seleccionarTipoPedido('retiro')}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 transition-all"
                    >
                      <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0V7.875C3 6.839 3.839 6 4.875 6h14.25C20.16 6 21 6.839 21 7.875v1.474" />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">Retiro por Sucursal</span>
                    </button>
                  </div>
                </>
              )}

              {/* PASO 3: Dirección (delivery) o Sucursal (retiro) */}
              {pasoPedido === 3 && clientePedido && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-gray-500">Fecha:</span>{' '}
                      <span className="font-medium text-gray-800">{new Date(fechaEntregaPedido + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Cliente:</span>{' '}
                      <span className="font-medium text-gray-800">{clientePedido.razon_social}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Tipo:</span>{' '}
                      <span className="font-medium text-gray-800">{tipoPedidoSeleccionado === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}</span>
                    </div>
                  </div>

                  {cargandoDetallePedido ? (
                    <div className="flex justify-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-600" />
                    </div>
                  ) : tipoPedidoSeleccionado === 'delivery' ? (
                    <>
                      {/* Direcciones del cliente */}
                      {direccionesPedido.length === 0 && !mostrarNuevaDirPedido && (
                        <p className="text-sm text-gray-400 py-2">Este cliente no tiene direcciones cargadas.</p>
                      )}
                      {direccionesPedido.length > 0 && (
                        <div className="space-y-1">
                          {direccionesPedido.map(d => (
                            <button
                              key={d.id}
                              onClick={() => { setDireccionSeleccionadaPedido(d.id); setMostrarNuevaDirPedido(false) }}
                              className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                                direccionSeleccionadaPedido === d.id
                                  ? 'border-amber-400 bg-amber-50'
                                  : 'border-gray-100 hover:border-gray-300'
                              }`}
                            >
                              <span className="text-sm text-gray-800">{d.direccion}</span>
                              {d.localidad && <span className="text-xs text-gray-400 ml-1">({d.localidad})</span>}
                              {d.es_principal && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-2">Principal</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Nueva dirección */}
                      {mostrarNuevaDirPedido ? (
                        <div className="mt-2 bg-gray-50 rounded-lg p-3 space-y-2">
                          <input
                            type="text"
                            value={nuevaDirPedido.direccion}
                            onChange={e => setNuevaDirPedido(prev => ({ ...prev, direccion: e.target.value }))}
                            placeholder="Direccion *"
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                            autoFocus
                          />
                          <input
                            type="text"
                            value={nuevaDirPedido.localidad}
                            onChange={e => setNuevaDirPedido(prev => ({ ...prev, localidad: e.target.value }))}
                            placeholder="Localidad"
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setMostrarNuevaDirPedido(false); setNuevaDirPedido({ direccion: '', localidad: '' }) }}
                              className="flex-1 text-sm py-2 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={guardarNuevaDirPedido}
                              disabled={guardandoDirPedido || !nuevaDirPedido.direccion.trim()}
                              className="flex-1 text-sm py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                            >
                              {guardandoDirPedido ? 'Guardando...' : 'Guardar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setMostrarNuevaDirPedido(true); setDireccionSeleccionadaPedido(null) }}
                          className="w-full mt-2 flex items-center justify-center gap-1.5 p-2.5 rounded-lg border-2 border-dashed border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 text-gray-500 hover:text-amber-700 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                          <span className="text-sm font-medium">Nueva direccion</span>
                        </button>
                      )}

                      {/* Turno de entrega */}
                      {(() => {
                        const esHoy = fechaEntregaPedido === new Date().toISOString().split('T')[0]
                        const horaActual = new Date().getHours()
                        const amDisabled = esHoy && horaActual >= 9
                        const pmDisabled = esHoy && horaActual >= 17
                        return (
                          <div className="mt-3">
                            <p className="text-xs text-gray-500 mb-1.5">Turno de entrega</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => !amDisabled && setTurnoPedido('AM')}
                                disabled={amDisabled}
                                className={`flex-1 p-3 rounded-lg border-2 text-center transition-colors ${
                                  amDisabled
                                    ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                                    : turnoPedido === 'AM'
                                      ? 'border-amber-400 bg-amber-50'
                                      : 'border-gray-100 hover:border-gray-300'
                                }`}
                              >
                                <span className={`text-sm font-semibold ${amDisabled ? 'text-gray-400' : 'text-gray-800'}`}>AM</span>
                                <span className="block text-[11px] text-gray-400">9 a 13hs</span>
                                {amDisabled && <span className="block text-[10px] text-red-400 mt-0.5">Fuera de horario</span>}
                              </button>
                              <button
                                onClick={() => !pmDisabled && setTurnoPedido('PM')}
                                disabled={pmDisabled}
                                className={`flex-1 p-3 rounded-lg border-2 text-center transition-colors ${
                                  pmDisabled
                                    ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                                    : turnoPedido === 'PM'
                                      ? 'border-amber-400 bg-amber-50'
                                      : 'border-gray-100 hover:border-gray-300'
                                }`}
                              >
                                <span className={`text-sm font-semibold ${pmDisabled ? 'text-gray-400' : 'text-gray-800'}`}>PM</span>
                                <span className="block text-[11px] text-gray-400">17 a 21hs</span>
                                {pmDisabled && <span className="block text-[10px] text-red-400 mt-0.5">Fuera de horario</span>}
                              </button>
                            </div>
                          </div>
                        )
                      })()}

                      {/* Botón confirmar delivery */}
                      <button
                        onClick={confirmarPedidoWizard}
                        disabled={!direccionSeleccionadaPedido || !turnoPedido || guardandoPedido}
                        className="w-full mt-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                      >
                        {guardandoPedido ? 'Guardando...' : 'Confirmar pedido'}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Sucursales para retiro */}
                      {sucursalesPedido.length > 0 && (
                        <div className="space-y-1">
                          {sucursalesPedido.map(s => (
                            <button
                              key={s.id}
                              onClick={() => setSucursalSeleccionadaPedido(s.id)}
                              className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                                sucursalSeleccionadaPedido === s.id
                                  ? 'border-amber-400 bg-amber-50'
                                  : 'border-gray-100 hover:border-gray-300'
                              }`}
                            >
                              <span className="text-sm font-medium text-gray-800">{s.nombre}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Botón confirmar retiro */}
                      <button
                        onClick={confirmarPedidoWizard}
                        disabled={!sucursalSeleccionadaPedido || guardandoPedido}
                        className="w-full mt-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                      >
                        {guardandoPedido ? 'Guardando...' : 'Confirmar pedido'}
                      </button>
                    </>
                  )}
                </>
              )}

              {/* PASO 4: Pago anticipado */}
              {pasoPedido === 4 && clientePedido && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-gray-500">Cliente:</span>{' '}
                      <span className="font-medium text-gray-800">{clientePedido.razon_social}</span>
                    </div>
                    {fechaEntregaPedido && (
                      <div>
                        <span className="text-gray-500">Fecha:</span>{' '}
                        <span className="font-medium text-gray-800">
                          {new Date(fechaEntregaPedido + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500">Tipo:</span>{' '}
                      <span className="font-medium text-gray-800">{tipoPedidoSeleccionado === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}</span>
                    </div>
                    {tipoPedidoSeleccionado === 'delivery' && direccionSeleccionadaPedido && (
                      <div>
                        <span className="text-gray-500">Direccion:</span>{' '}
                        <span className="font-medium text-gray-800">
                          {(() => { const d = direccionesPedido.find(x => x.id === direccionSeleccionadaPedido); return d ? `${d.direccion}${d.localidad ? `, ${d.localidad}` : ''}` : '' })()}
                        </span>
                      </div>
                    )}
                    {tipoPedidoSeleccionado === 'retiro' && sucursalSeleccionadaPedido && (
                      <div>
                        <span className="text-gray-500">Sucursal:</span>{' '}
                        <span className="font-medium text-gray-800">
                          {sucursalesPedido.find(s => s.id === sucursalSeleccionadaPedido)?.nombre || ''}
                        </span>
                      </div>
                    )}
                    {tipoPedidoSeleccionado === 'delivery' && turnoPedido && (
                      <div>
                        <span className="text-gray-500">Turno:</span>{' '}
                        <span className="font-medium text-gray-800">{turnoPedido === 'AM' ? 'AM (9-13hs)' : 'PM (17-21hs)'}</span>
                      </div>
                    )}
                    <div className="pt-1 border-t border-gray-200 mt-1">
                      <span className="text-gray-500">Total:</span>{' '}
                      <span className="font-bold text-gray-800">{formatPrecio(total)}</span>
                    </div>
                  </div>

                  {tipoPedidoSeleccionado === 'delivery' ? (
                    <>
                      <div className="text-center py-1">
                        <p className="text-sm font-medium text-gray-700">Forma de pago</p>
                      </div>
                      <div className="space-y-2">
                        <button
                          onClick={() => finalizarPedidoWizard('cobrar')}
                          disabled={guardandoPedido}
                          className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-green-200 hover:border-green-400 hover:bg-green-50 transition-all disabled:opacity-50"
                        >
                          <svg className="w-7 h-7 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                          </svg>
                          <span className="text-sm font-medium text-green-700">Cobrar ahora</span>
                        </button>
                        <button
                          onClick={() => finalizarPedidoWizard('efectivo_entrega')}
                          disabled={guardandoPedido}
                          className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-amber-200 hover:border-amber-400 hover:bg-amber-50 transition-all disabled:opacity-50"
                        >
                          <svg className="w-7 h-7 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.079-.504 1.004-1.1A17.05 17.05 0 0015.064 8.39a2.25 2.25 0 00-1.89-1.014H12m-1.5 11.374h6" />
                          </svg>
                          <span className="text-sm font-medium text-amber-700">Paga en la entrega en efectivo</span>
                        </button>
                        <button
                          onClick={() => finalizarPedidoWizard('link_pago')}
                          disabled={guardandoPedido}
                          className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-blue-200 hover:border-blue-400 hover:bg-blue-50 transition-all disabled:opacity-50"
                        >
                          <svg className="w-7 h-7 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.06a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364l1.757 1.757" />
                          </svg>
                          <span className="text-sm font-medium text-blue-700">Link de pago</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-center py-2">
                        <p className="text-sm font-medium text-gray-700">¿Desea abonar por anticipado?</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => finalizarPedidoWizard(false)}
                          disabled={guardandoPedido}
                          className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all disabled:opacity-50"
                        >
                          <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          <span className="text-sm font-medium text-gray-700">No, solo guardar</span>
                        </button>
                        <button
                          onClick={() => finalizarPedidoWizard('cobrar')}
                          disabled={guardandoPedido}
                          className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-green-200 hover:border-green-400 hover:bg-green-50 transition-all disabled:opacity-50"
                        >
                          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                          </svg>
                          <span className="text-sm font-medium text-green-700">Si, cobrar ahora</span>
                        </button>
                      </div>
                    </>
                  )}
                  {guardandoPedido && (
                    <div className="flex justify-center py-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-600" />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Modal crear cliente (se superpone) */}
          {mostrarCrearClientePedido && (
            <NuevoClienteModal
              onClose={() => setMostrarCrearClientePedido(false)}
              onCreado={onClientePedidoCreado}
              cuitInicial={busquedaClientePedido.trim()}
            />
          )}
        </div>
      )}
      {/* Popup peso manual para pesables */}
      {popupPesable && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-1">Ingresar peso</h3>
            <p className="text-sm text-gray-500 mb-4 truncate">{popupPesable.articulo.nombre}</p>
            <div className="flex items-center gap-2 mb-5">
              <input
                autoFocus
                type="number"
                step="0.001"
                min="0.001"
                value={popupPesableKg}
                onChange={e => setPopupPesableKg(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmarPesable()
                  if (e.key === 'Escape') { setPopupPesable(null); setTimeout(() => inputBusquedaRef.current?.focus(), 50) }
                }}
                placeholder="0.000"
                className="flex-1 border-2 border-gray-300 focus:border-violet-500 rounded-xl px-4 py-3 text-2xl font-mono text-center outline-none"
              />
              <span className="text-lg font-semibold text-gray-500">kg</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setPopupPesable(null); setTimeout(() => inputBusquedaRef.current?.focus(), 50) }}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                disabled={!popupPesableKg || parseFloat(popupPesableKg) <= 0}
                onClick={confirmarPesable}
                className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
              >
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pantalla roja fullscreen — artículo no encontrado */}
      {alertaBarcode && (
        <div className="fixed inset-0 z-[100] bg-red-600 flex flex-col items-center justify-center text-white" onClick={() => { setAlertaBarcode(null); stopAlertSound() }}>
          <svg className="w-24 h-24 mb-6 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-4xl font-black mb-3">ARTÍCULO NO ENCONTRADO</span>
          <span className="text-2xl font-mono opacity-80">{alertaBarcode}</span>
        </div>
      )}

      {/* Pantalla amarilla fullscreen — artículo duplicado (balanza o barcode) */}
      {alertaDuplicado && (
        <div className="fixed inset-0 z-[100] bg-amber-500 flex flex-col items-center justify-center text-white"
          tabIndex={0}
          ref={el => el?.focus()}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (alertaDuplicado.pesoKg) {
                setCarrito(prev => [...prev, { articulo: alertaDuplicado.articulo, cantidad: alertaDuplicado.pesoKg }])
              } else {
                agregarAlCarrito(alertaDuplicado.articulo)
              }
              setAlertaDuplicado(null)
              setTimeout(() => inputBusquedaRef.current?.focus(), 50)
            } else if (e.key === 'Escape') {
              setAlertaDuplicado(null)
              setTimeout(() => inputBusquedaRef.current?.focus(), 50)
            }
          }}>
          <svg className="w-24 h-24 mb-6 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-4xl font-black mb-3">ARTÍCULO DUPLICADO</span>
          <span className="text-xl opacity-90 mb-2">{alertaDuplicado.articulo.nombre}</span>
          {alertaDuplicado.pesoKg && (
            <span className="text-2xl font-mono opacity-80 mb-8">{alertaDuplicado.pesoKg} kg</span>
          )}
          {alertaDuplicado.cantidad && !alertaDuplicado.pesoKg && (
            <span className="text-2xl font-mono opacity-80 mb-8">x{alertaDuplicado.cantidad}</span>
          )}
          <span className="text-xl mb-8">¿Deseas agregar igual?</span>
          <div className="flex gap-6">
            <button
              onClick={() => { setAlertaDuplicado(null); setTimeout(() => inputBusquedaRef.current?.focus(), 50) }}
              className="px-10 py-4 bg-white/20 hover:bg-white/30 rounded-2xl text-2xl font-bold transition-colors"
            >
              No
            </button>
            <button
              onClick={() => {
                if (alertaDuplicado.pesoKg) {
                  setCarrito(prev => [...prev, { articulo: alertaDuplicado.articulo, cantidad: alertaDuplicado.pesoKg }])
                } else {
                  agregarAlCarrito(alertaDuplicado.articulo)
                }
                setAlertaDuplicado(null)
                setTimeout(() => inputBusquedaRef.current?.focus(), 50)
              }}
              className="px-10 py-4 bg-white text-amber-600 hover:bg-amber-50 rounded-2xl text-2xl font-bold transition-colors"
            >
              Sí, agregar
            </button>
          </div>
        </div>
      )}

      {/* Modal confirmación eliminación de artículo */}
    </div>
  )
}

// Error boundary para diagnosticar pantalla blanca
class POSErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex items-center justify-center bg-red-50 p-8">
          <div className="bg-white rounded-xl shadow p-6 max-w-lg">
            <h2 className="text-red-600 font-bold text-lg mb-2">Error en POS</h2>
            <pre className="text-sm text-red-800 whitespace-pre-wrap">{this.state.error.message}</pre>
            <pre className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{this.state.error.stack}</pre>
            <button onClick={() => window.location.reload()} className="mt-4 bg-red-600 text-white px-4 py-2 rounded">Recargar</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const POSWithErrorBoundary = () => (
  <POSErrorBoundary>
    <POS />
  </POSErrorBoundary>
)

export default POSWithErrorBoundary
