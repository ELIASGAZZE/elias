// Servicio de consulta al padrón de AFIP/ARCA via Afip SDK
const Afip = require('@afipsdk/afip.js')

const AFIP_ACCESS_TOKEN = process.env.AFIP_ACCESS_TOKEN
const AFIP_CUIT = process.env.AFIP_CUIT || '20409378472'

let afipInstance = null

function getAfip() {
  if (!afipInstance && AFIP_ACCESS_TOKEN) {
    afipInstance = new Afip({
      access_token: AFIP_ACCESS_TOKEN,
      CUIT: parseInt(AFIP_CUIT),
    })
  }
  return afipInstance
}

/**
 * Determina la condición frente al IVA según los impuestos inscriptos.
 * idImpuesto 30 = IVA → RI
 * idImpuesto 20 = Monotributo
 * idImpuesto 32 = IVA Exento
 */
function determinarCondicionIVA(datosRegimenGeneral, datosMonotributo) {
  const impuestos = datosRegimenGeneral?.impuesto || []
  const idsImpuesto = impuestos.map(i => i.idImpuesto)

  if (idsImpuesto.includes(30)) return 'RI'       // IVA Responsable Inscripto
  if (idsImpuesto.includes(32)) return 'EX'       // IVA Exento
  if (datosMonotributo || idsImpuesto.includes(20)) return 'MT' // Monotributo
  return 'CF' // Consumidor Final
}

/**
 * Calcula el dígito verificador de un CUIT.
 * @param {string} prefijo - '20', '27', '23', '24', etc.
 * @param {string} dni - DNI (se paddea a 8 dígitos)
 * @returns {number|null} - Dígito verificador o null si inválido para este prefijo
 */
function calcularDigitoVerificador(prefijo, dni) {
  const dniPad = dni.padStart(8, '0')
  const base = prefijo + dniPad
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let suma = 0
  for (let i = 0; i < 10; i++) {
    suma += parseInt(base[i]) * pesos[i]
  }
  const resto = suma % 11
  if (resto === 0) return 0
  if (resto === 1) return null // inválido para este prefijo
  return 11 - resto
}

/**
 * Genera posibles CUITs a partir de un DNI.
 * Prueba prefijos comunes para personas físicas: 20, 27, 23, 24.
 * @param {string} dni - DNI (7-8 dígitos)
 * @returns {string[]} - Array de CUITs posibles (11 dígitos)
 */
function dniAPosiblesCuits(dni) {
  const dniLimpio = dni.replace(/\D/g, '')
  const dniPad = dniLimpio.padStart(8, '0')
  const prefijos = ['20', '27', '23', '24']
  const cuits = []
  for (const pref of prefijos) {
    const dv = calcularDigitoVerificador(pref, dniPad)
    if (dv !== null) {
      cuits.push(`${pref}${dniPad}${dv}`)
    }
  }
  return cuits
}

/**
 * Consulta datos de un contribuyente por CUIT o DNI en AFIP.
 * Si recibe un DNI (7-8 dígitos), genera posibles CUITs y prueba cada uno.
 * @param {number|string} cuit - CUIT (11 dígitos) o DNI (7-8 dígitos)
 * @returns {Promise<Object|null>} - Datos normalizados o null si no existe
 */
async function consultarCUIT(cuit) {
  const afip = getAfip()
  if (!afip) throw new Error('AFIP no configurado (falta AFIP_ACCESS_TOKEN)')

  const soloDigitos = String(cuit).replace(/\D/g, '')
  if (!soloDigitos || soloDigitos.length < 7) {
    return null
  }

  // Si es DNI (menos de 11 dígitos), generar posibles CUITs y probar
  let cuitsAProbar = []
  if (soloDigitos.length < 11) {
    cuitsAProbar = dniAPosiblesCuits(soloDigitos)
    if (cuitsAProbar.length === 0) return null
  } else {
    cuitsAProbar = [soloDigitos]
  }

  let data = null
  let cuitEncontrado = null
  for (const c of cuitsAProbar) {
    try {
      const resultado = await afip.RegisterInscriptionProof.getTaxpayerDetails(parseInt(c))
      if (resultado && resultado.datosGenerales) {
        data = resultado
        cuitEncontrado = c
        break
      }
    } catch (err) {
      // CUIT no existe, probar siguiente
      continue
    }
  }

  if (!data) return null

  // Si tiene errorConstancia pero con datos mínimos
  if (data.errorConstancia && !data.datosGenerales) {
    const ec = data.errorConstancia
    return {
      cuit: cuitEncontrado || soloDigitos,
      razon_social: ec.razonSocial || [ec.apellido, ec.nombre].filter(Boolean).join(' ') || null,
      tipo_persona: null,
      condicion_iva: 'CF',
      domicilio: null,
      localidad: null,
      provincia: null,
      codigo_postal: null,
      estado: null,
      error_afip: ec.error?.join('. ') || null,
    }
  }

  const dg = data.datosGenerales || {}
  const dom = dg.domicilioFiscal || {}

  const esJuridica = dg.tipoPersona === 'JURIDICA'
  const nombre = esJuridica
    ? dg.razonSocial
    : [dg.apellido, dg.nombre].filter(Boolean).join(' ') || dg.razonSocial

  return {
    cuit: String(dg.idPersona || cuitEncontrado || soloDigitos),
    razon_social: nombre || null,
    tipo_persona: dg.tipoPersona || null,
    condicion_iva: determinarCondicionIVA(data.datosRegimenGeneral, data.datosMonotributo),
    domicilio: dom.direccion || null,
    localidad: dom.localidad || null,
    provincia: dom.descripcionProvincia || null,
    codigo_postal: dom.codPostal || null,
    estado: dg.estadoClave || null,
    error_afip: data.errorConstancia?.error?.join('. ') || null,
  }
}

module.exports = { consultarCUIT }
