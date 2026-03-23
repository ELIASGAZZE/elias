// Script para detectar y unificar clientes duplicados por CUIT
// Regla: mantener el que tiene id_centum, eliminar el otro
// Si ambos tienen id_centum, mantener el de código más bajo (WEB-xxx o el original)

// Run from backend dir: cd backend && node ../tmp/fix_dupes.js
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

async function main() {
  // Get all active clients with CUIT
  const { data: clientes, error } = await supabase
    .from('clientes')
    .select('id, codigo, razon_social, cuit, id_centum, activo, created_at')
    .eq('activo', true)
    .not('cuit', 'is', null)
    .order('created_at', { ascending: true })

  if (error) throw error
  console.log('Total clientes activos con CUIT:', clientes.length)

  // Group by normalized CUIT
  const byCuit = {}
  for (const c of clientes) {
    const cuit = c.cuit.replace(/\D/g, '')
    if (!cuit || cuit.length < 7) continue
    if (!byCuit[cuit]) byCuit[cuit] = []
    byCuit[cuit].push(c)
  }

  const dupes = Object.entries(byCuit).filter(([_, arr]) => arr.length > 1)
  console.log('CUITs duplicados:', dupes.length)

  if (dupes.length === 0) {
    console.log('No hay duplicados!')
    return
  }

  let unificados = 0
  let eliminados = 0

  for (const [cuit, arr] of dupes) {
    // Elegir el "ganador": preferir el que tiene id_centum, luego el código más bajo
    arr.sort((a, b) => {
      // Prioridad 1: tiene id_centum
      if (a.id_centum && !b.id_centum) return -1
      if (!a.id_centum && b.id_centum) return 1
      // Prioridad 2: código no CLI (es original de Centum)
      const aEsCli = (a.codigo || '').startsWith('CLI-')
      const bEsCli = (b.codigo || '').startsWith('CLI-')
      if (!aEsCli && bEsCli) return -1
      if (aEsCli && !bEsCli) return 1
      // Prioridad 3: más antiguo
      return new Date(a.created_at) - new Date(b.created_at)
    })

    const ganador = arr[0]
    const perdedores = arr.slice(1)

    for (const p of perdedores) {
      console.log(`  CUIT ${cuit}: mantener "${ganador.razon_social}" (${ganador.codigo}, centum:${ganador.id_centum}), eliminar "${p.razon_social}" (${p.codigo}, centum:${p.id_centum})`)

      // Verificar si el perdedor tiene ventas o referencias
      const { count: ventasCount } = await supabase
        .from('ventas_pos')
        .select('id', { count: 'exact', head: true })
        .eq('cliente_id', p.id)

      if (ventasCount > 0) {
        // Reasignar ventas al ganador
        const { error: errVentas } = await supabase
          .from('ventas_pos')
          .update({ cliente_id: ganador.id })
          .eq('cliente_id', p.id)
        if (errVentas) {
          console.warn(`    Error reasignando ventas: ${errVentas.message}`)
          continue
        }
        console.log(`    Reasignadas ${ventasCount} ventas`)
      }

      // Desactivar perdedor (soft delete)
      const { error: errDel } = await supabase
        .from('clientes')
        .update({ activo: false })
        .eq('id', p.id)

      if (errDel) {
        console.warn(`    Error desactivando: ${errDel.message}`)
      } else {
        eliminados++
      }
    }
    unificados++
  }

  console.log(`\nResultado: ${unificados} CUITs unificados, ${eliminados} duplicados desactivados`)
}

main().catch(e => console.error(e.message))
