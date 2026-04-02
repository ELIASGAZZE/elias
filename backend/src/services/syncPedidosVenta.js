// Servicio de sincronización de Pedidos de Venta desde Centum BI (SQL Server) → App Delivery
// Usa las vistas PedidosVenta_VIEW, PedidoVenta_Items_VIEW, PedidoVenta_Estados_VIEW
// y SeccionesSucursalesFisicas_VIEW para mapear sucursales.
const sql = require('mssql')
const supabase = require('../config/supabase')
const { getPool } = require('../config/centum')
const { registrarLlamada } = require('./apiLogger')
const logger = require('../config/logger')

// Helper: agrega parámetros INT a un request para cláusulas IN y devuelve los placeholders
function addIntParams(request, ids, prefix) {
  const placeholders = ids.map((id, idx) => {
    const name = `${prefix}${idx}`
    request.input(name, sql.Int, id)
    return `@${name}`
  })
  return placeholders.join(',')
}

/**
 * Sincroniza pedidos de venta desde Centum BI → pedidos_delivery.
 * Solo procesa sucursales locales que tienen centum_sucursal_id configurado.
 *
 * Flujo:
 * 1. Obtener sucursales locales con centum_sucursal_id
 * 2. Buscar secciones de esas sucursales en Centum BI
 * 3. Traer pedidos recientes (últimos 60 días) no anulados de esas secciones
 * 4. Para cada pedido: crear si es nuevo, actualizar estado si ya existe
 *
 * Retorna { nuevos, actualizados, errores, detalles }
 */
async function sincronizarPedidosVenta(origen = 'sync') {
  const inicioTotal = Date.now()
  let nuevos = 0
  let actualizados = 0
  let errores = 0
  const detalles = []

  try {
    // 1. Obtener sucursales locales con centum_sucursal_id
    const { data: sucursales, error: errSuc } = await supabase
      .from('sucursales')
      .select('id, nombre, centum_sucursal_id')
      .not('centum_sucursal_id', 'is', null)

    if (errSuc) throw errSuc
    if (!sucursales || sucursales.length === 0) {
      return { nuevos: 0, actualizados: 0, errores: 0, detalles: ['No hay sucursales con centum_sucursal_id'] }
    }

    // Mapa SucursalFisicaID → sucursal local
    const sucursalMap = {}
    const sucursalFisicaIds = []
    for (const s of sucursales) {
      sucursalMap[s.centum_sucursal_id] = s
      sucursalFisicaIds.push(s.centum_sucursal_id)
    }

    // 2. Conectar a Centum BI y buscar secciones de esas sucursales
    const db = await getPool()

    const secReq = db.request()
    const secPlaceholders = addIntParams(secReq, sucursalFisicaIds, 'suc')
    const seccionesResult = await secReq.query(`
      SELECT SeccionSucursalFisicaID, SucursalFisicaID
      FROM SeccionesSucursalesFisicas_VIEW
      WHERE SucursalFisicaID IN (${secPlaceholders})
      AND ActivoSeccionSucursalFisica = 1
    `)

    const secciones = seccionesResult.recordset
    if (secciones.length === 0) {
      return { nuevos: 0, actualizados: 0, errores: 0, detalles: ['No se encontraron secciones para las sucursales configuradas'] }
    }

    // Mapa SeccionSucursalFisicaID → SucursalFisicaID → sucursal local
    const seccionToSucursal = {}
    const seccionIds = []
    for (const sec of secciones) {
      seccionToSucursal[sec.SeccionSucursalFisicaID] = sucursalMap[sec.SucursalFisicaID]
      seccionIds.push(sec.SeccionSucursalFisicaID)
    }

    // 3. Traer pedidos recientes no anulados de esas secciones (últimos 60 días)
    const fechaDesde = new Date()
    fechaDesde.setDate(fechaDesde.getDate() - 60)
    const fechaDesdeStr = fechaDesde.toISOString().split('T')[0]

    const pedReq = db.request()
    pedReq.input('fechaDesde', sql.Date, fechaDesdeStr)
    const pedPlaceholders = addIntParams(pedReq, seccionIds, 'sec')
    const pedidosResult = await pedReq.query(`
        SELECT p.PedidoVentaID, p.NumeroDocumento, p.FechaDocumento, p.FechaEntrega,
          p.SeccionSucursalFisicaID, p.ClienteID, p.Total, p.Observacion, p.Anulado
        FROM PedidosVenta_VIEW p
        WHERE p.SeccionSucursalFisicaID IN (${pedPlaceholders})
        AND p.FechaDocumento >= @fechaDesde
        AND p.Anulado = 0
        ORDER BY p.PedidoVentaID DESC
      `)

    const pedidosCentum = pedidosResult.recordset

    // Procesar pedidos activos (no anulados)
    const pedidosNuevos = []
    if (pedidosCentum.length > 0) {
      // Obtener IDs de pedidos que ya existen localmente
      const pedidoIds = pedidosCentum.map(p => p.PedidoVentaID)
      const { data: existentes } = await supabase
        .from('pedidos_delivery')
        .select('id, id_pedido_centum, estado_centum')
        .in('id_pedido_centum', pedidoIds)

      const existenteMap = {}
      if (existentes) {
        for (const e of existentes) {
          existenteMap[e.id_pedido_centum] = e
        }
      }

      // Obtener últimos estados de todos los pedidos
      const estReq = db.request()
      const estPlaceholders = addIntParams(estReq, pedidoIds, 'pid')
      const estadosResult = await estReq.query(`
        SELECT e.PedidoventaID, e.Estado
        FROM PedidoVenta_Estados_VIEW e
        INNER JOIN (
          SELECT PedidoventaID, MAX(PedidoVentaEstadoID) AS MaxEstadoID
          FROM PedidoVenta_Estados_VIEW
          WHERE PedidoventaID IN (${estPlaceholders})
          GROUP BY PedidoventaID
        ) ult ON e.PedidoventaID = ult.PedidoventaID AND e.PedidoVentaEstadoID = ult.MaxEstadoID
      `)

      const estadoMap = {}
      for (const e of estadosResult.recordset) {
        estadoMap[e.PedidoventaID] = e.Estado?.trim() || null
      }

      // Separar pedidos nuevos de existentes
      for (const pedido of pedidosCentum) {
      const existente = existenteMap[pedido.PedidoVentaID]
      const estadoCentum = estadoMap[pedido.PedidoVentaID] || null

      if (existente) {
        // Solo actualizar si el estado cambió
        if (existente.estado_centum !== estadoCentum) {
          try {
            await supabase
              .from('pedidos_delivery')
              .update({ estado_centum: estadoCentum })
              .eq('id', existente.id)
            actualizados++
          } catch (err) {
            errores++
          }
        }
      } else {
        pedidosNuevos.push({ ...pedido, estadoCentum })
      }
      }
    } // fin if pedidosCentum.length > 0

    // 4. Procesar pedidos nuevos
    if (pedidosNuevos.length > 0) {
      // Obtener items de todos los pedidos nuevos de una sola query
      const nuevosIds = pedidosNuevos.map(p => p.PedidoVentaID)
      const itemReq = db.request()
      const itemPlaceholders = addIntParams(itemReq, nuevosIds, 'nid')
      const itemsResult = await itemReq.query(`
        SELECT PedidoVentaID, ArticuloID, Cantidad, Precio
        FROM PedidoVenta_Items_VIEW
        WHERE PedidoVentaID IN (${itemPlaceholders})
      `)

      // Agrupar items por pedido
      const itemsPorPedido = {}
      for (const item of itemsResult.recordset) {
        if (!itemsPorPedido[item.PedidoVentaID]) itemsPorPedido[item.PedidoVentaID] = []
        itemsPorPedido[item.PedidoVentaID].push(item)
      }

      // Obtener todos los ClienteID únicos de pedidos nuevos
      const clienteIdsCentum = [...new Set(pedidosNuevos.map(p => p.ClienteID).filter(Boolean))]

      // Buscar clientes locales
      const { data: clientesLocales } = await supabase
        .from('clientes')
        .select('id, id_centum')
        .in('id_centum', clienteIdsCentum)

      const clienteMap = {}
      if (clientesLocales) {
        for (const c of clientesLocales) {
          clienteMap[c.id_centum] = c.id
        }
      }

      // Clientes que no existen localmente → buscar info en Centum BI y crear
      const clientesSinLocal = clienteIdsCentum.filter(id => !clienteMap[id])
      if (clientesSinLocal.length > 0) {
        try {
          const cliReq = db.request()
          const cliPlaceholders = addIntParams(cliReq, clientesSinLocal, 'cli')
          const clientesBIResult = await cliReq.query(`
            SELECT ClienteID, RazonSocialCliente, CUITCliente, DireccionCliente,
              LocalidadCliente, TelefonoCliente
            FROM Clientes_VIEW
            WHERE ClienteID IN (${cliPlaceholders})
          `)

          for (const cli of clientesBIResult.recordset) {
            try {
              const { data: nuevo, error: errCli } = await supabase
                .from('clientes')
                .insert({
                  razon_social: cli.RazonSocialCliente?.trim() || `Cliente Centum #${cli.ClienteID}`,
                  cuit: cli.CUITCliente?.trim() || null,
                  direccion: cli.DireccionCliente?.trim() || null,
                  localidad: cli.LocalidadCliente?.trim() || null,
                  telefono: cli.TelefonoCliente?.trim() || null,
                  id_centum: cli.ClienteID,
                })
                .select('id')
                .single()

              if (!errCli && nuevo) {
                clienteMap[cli.ClienteID] = nuevo.id
              } else {
                // UNIQUE constraint → buscar de nuevo
                const { data: retry } = await supabase
                  .from('clientes')
                  .select('id')
                  .eq('id_centum', cli.ClienteID)
                  .maybeSingle()
                if (retry) clienteMap[cli.ClienteID] = retry.id
              }
            } catch (errCliInsert) {
              detalles.push(`Error creando cliente ${cli.ClienteID}: ${errCliInsert.message}`)
            }
          }
        } catch (errCliQuery) {
          detalles.push(`Error consultando clientes BI: ${errCliQuery.message}`)
        }
      }

      // Obtener todos los ArticuloID únicos de items
      const articuloIdsCentum = [...new Set(
        Object.values(itemsPorPedido).flat().map(i => i.ArticuloID).filter(Boolean)
      )]

      // Buscar artículos locales
      const articuloMap = {}
      if (articuloIdsCentum.length > 0) {
        // Supabase .in() tiene límite, hacemos lotes de 500
        for (let i = 0; i < articuloIdsCentum.length; i += 500) {
          const lote = articuloIdsCentum.slice(i, i + 500)
          const { data: artLocales } = await supabase
            .from('articulos')
            .select('id, id_centum')
            .in('id_centum', lote)

          if (artLocales) {
            for (const a of artLocales) {
              articuloMap[a.id_centum] = a.id
            }
          }
        }
      }

      // Insertar cada pedido nuevo
      for (const pedido of pedidosNuevos) {
        try {
          const sucursalLocal = seccionToSucursal[pedido.SeccionSucursalFisicaID]
          if (!sucursalLocal) {
            errores++
            continue
          }

          // Formatear número de documento: "X00005-00001147" → "PV 5-1147"
          let numeroDocumento = null
          if (pedido.NumeroDocumento) {
            const match = pedido.NumeroDocumento.match(/X?0*(\d+)-0*(\d+)/)
            if (match) {
              numeroDocumento = `PV ${parseInt(match[1])}-${parseInt(match[2])}`
            } else {
              numeroDocumento = pedido.NumeroDocumento
            }
          }

          const { data: nuevoPedido, error: errInsert } = await supabase
            .from('pedidos_delivery')
            .insert({
              id_pedido_centum: pedido.PedidoVentaID,
              numero_documento: numeroDocumento,
              cliente_id: clienteMap[pedido.ClienteID] || null,
              sucursal_id: sucursalLocal.id,
              estado: 'pendiente_pago',
              estado_centum: pedido.estadoCentum,
              direccion_entrega: null,
              observaciones: pedido.Observacion?.trim() || null,
              fecha_entrega: pedido.FechaEntrega || null,
            })
            .select('id')
            .single()

          if (errInsert) {
            // Si es UNIQUE constraint (pedido ya existe), skip
            if (errInsert.code === '23505') continue
            throw errInsert
          }

          // Insertar items
          const items = itemsPorPedido[pedido.PedidoVentaID] || []
          const itemsParaInsertar = []
          for (const item of items) {
            const articuloLocalId = articuloMap[item.ArticuloID]
            if (!articuloLocalId) continue

            itemsParaInsertar.push({
              pedido_id: nuevoPedido.id,
              articulo_id: articuloLocalId,
              cantidad: item.Cantidad || 1,
              precio: item.Precio != null ? Math.round(item.Precio * 100) / 100 : null,
            })
          }

          if (itemsParaInsertar.length > 0) {
            await supabase.from('items_delivery').insert(itemsParaInsertar)
          }

          nuevos++
        } catch (errPedido) {
          errores++
          detalles.push(`Error pedido ${pedido.PedidoVentaID}: ${errPedido.message}`)
        }
      }
    }

    // 5. Detectar pedidos anulados en Centum y cancelarlos localmente
    let cancelados = 0
    const { data: localesConCentum } = await supabase
      .from('pedidos_delivery')
      .select('id, id_pedido_centum')
      .not('id_pedido_centum', 'is', null)
      .neq('estado', 'cancelado')

    if (localesConCentum && localesConCentum.length > 0) {
      const idsLocales = localesConCentum.map(p => p.id_pedido_centum)
      // Consultar cuáles están anulados en Centum
      const anulReq = db.request()
      const anulPlaceholders = addIntParams(anulReq, idsLocales, 'loc')
      const anuladosResult = await anulReq.query(`
        SELECT PedidoVentaID FROM PedidosVenta_VIEW
        WHERE PedidoVentaID IN (${anulPlaceholders})
        AND Anulado = 1
      `)

      const idsAnulados = new Set(anuladosResult.recordset.map(r => r.PedidoVentaID))
      if (idsAnulados.size > 0) {
        const localesParaCancelar = localesConCentum.filter(p => idsAnulados.has(p.id_pedido_centum))
        for (const p of localesParaCancelar) {
          try {
            await supabase
              .from('pedidos_delivery')
              .update({ estado: 'cancelado', estado_centum: 'Anulado' })
              .eq('id', p.id)
            cancelados++
          } catch (err) {
            errores++
          }
        }
        if (cancelados > 0) {
          logger.info(`[SyncPedidos] ${cancelados} pedidos cancelados (anulados en Centum)`)
        }
      }
    }

    const duracion = Date.now() - inicioTotal
    if (nuevos > 0 || errores > 0 || cancelados > 0) {
      logger.info(`[SyncPedidos] ${duracion}ms: ${nuevos} nuevos, ${actualizados} act, ${cancelados} cancel, ${errores} err`)
    }

    registrarLlamada({
      servicio: 'centum_bi_pedidos', endpoint: 'PedidosVenta_VIEW',
      metodo: 'QUERY', estado: errores > 0 ? 'parcial' : 'ok',
      duracion_ms: duracion, items_procesados: nuevos + actualizados + cancelados, origen,
    })

    return { nuevos, actualizados, cancelados, errores, detalles }
  } catch (err) {
    const duracion = Date.now() - inicioTotal
    registrarLlamada({
      servicio: 'centum_bi_pedidos', endpoint: 'PedidosVenta_VIEW',
      metodo: 'QUERY', estado: 'error', duracion_ms: duracion,
      error_mensaje: err.message, origen,
    })
    throw err
  }
}

module.exports = { sincronizarPedidosVenta }
