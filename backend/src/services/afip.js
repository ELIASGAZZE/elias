// Servicio de consulta al padrón de ARCA (ex-AFIP) — conexión directa SOAP
// No usa SDK intermedio, se conecta directo al WSAA + WS Padrón A5
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const axios = require('axios')
const { parseStringPromise } = require('xml2js')

const CERT_PATH = path.join(__dirname, '../../certs/COMERCIAL PADANO_7627c4ab3209aadb.crt')
const KEY_PATH = path.join(__dirname, '../../certs/afip.key')
const CUIT_REPRESENTADA = '30718852788' // CUIT Comercial Padano

// Cache del token WSAA (dura ~12 horas)
let tokenCache = null

// En producción (Render), los certs vienen como env vars
// En local, se leen de archivos
function getCert() {
  if (process.env.AFIP_CERT) return process.env.AFIP_CERT.replace(/\\n/g, '\n')
  if (fs.existsSync(CERT_PATH)) return fs.readFileSync(CERT_PATH, 'utf8')
  return null
}

function getKey() {
  if (process.env.AFIP_KEY) return process.env.AFIP_KEY.replace(/\\n/g, '\n')
  if (fs.existsSync(KEY_PATH)) return fs.readFileSync(KEY_PATH, 'utf8')
  return null
}

function certsDisponibles() {
  return !!(getCert() && getKey())
}

/**
 * Obtiene token y sign del WSAA de ARCA.
 * Cachea el resultado hasta que expire.
 */
async function getWSAAToken() {
  // Si ya tenemos token vigente, reusar
  if (tokenCache && tokenCache.expiration > new Date()) {
    return tokenCache
  }

  if (!certsDisponibles()) {
    throw new Error('Certificados AFIP no encontrados')
  }

  const now = new Date()
  const gen = new Date(now.getTime() - 600000).toISOString()
  const exp = new Date(now.getTime() + 600000).toISOString()
  const uid = Math.floor(Math.random() * 999999999)

  const tra = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uid}</uniqueId>
    <generationTime>${gen}</generationTime>
    <expirationTime>${exp}</expirationTime>
  </header>
  <service>ws_sr_constancia_inscripcion</service>
</loginTicketRequest>`

  // Escribir TRA, cert y key a temp, firmar con OpenSSL CMS
  const tmpDir = require('os').tmpdir()
  const tmpTra = path.join(tmpDir, `tra_${uid}.xml`)
  const tmpCert = path.join(tmpDir, `afip_cert_${uid}.crt`)
  const tmpKey = path.join(tmpDir, `afip_key_${uid}.key`)

  fs.writeFileSync(tmpTra, tra)
  fs.writeFileSync(tmpCert, getCert())
  fs.writeFileSync(tmpKey, getKey(), { mode: 0o600 })

  let signed
  try {
    signed = execSync(
      `openssl cms -sign -in "${tmpTra}" -signer "${tmpCert}" -inkey "${tmpKey}" -nodetach -outform DER | base64 -w 0`,
      { encoding: 'utf8', timeout: 15000 }
    )
  } finally {
    try { fs.unlinkSync(tmpTra) } catch {}
    try { fs.unlinkSync(tmpCert) } catch {}
    try { fs.unlinkSync(tmpKey) } catch {}
  }

  const soapEnv = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${signed}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`

  const res = await axios.post('https://wsaa.afip.gov.ar/ws/services/LoginCms', soapEnv, {
    headers: { 'Content-Type': 'text/xml', 'SOAPAction': '' },
    timeout: 30000,
  })

  const parsed = await parseStringPromise(res.data, { explicitArray: false })
  const loginReturn = parsed['soapenv:Envelope']['soapenv:Body']['loginCmsResponse']['loginCmsReturn']
  const creds = await parseStringPromise(loginReturn, { explicitArray: false })

  tokenCache = {
    token: creds.loginTicketResponse.credentials.token,
    sign: creds.loginTicketResponse.credentials.sign,
    expiration: new Date(now.getTime() + 11 * 60 * 60 * 1000), // ~11 horas
  }

  console.log('[AFIP] Token WSAA obtenido, expira:', tokenCache.expiration.toISOString())
  return tokenCache
}

/**
 * Consulta persona en el padrón A5 de ARCA.
 */
async function consultarPersonaSOAP(idPersona) {
  const { token, sign } = await getWSAAToken()

  const soapReq = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
  <soapenv:Body>
    <a5:getPersona_v2>
      <token>${token}</token>
      <sign>${sign}</sign>
      <cuitRepresentada>${CUIT_REPRESENTADA}</cuitRepresentada>
      <idPersona>${idPersona}</idPersona>
    </a5:getPersona_v2>
  </soapenv:Body>
</soapenv:Envelope>`

  const res = await axios.post(
    'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
    soapReq,
    { headers: { 'Content-Type': 'text/xml', 'SOAPAction': '' }, timeout: 15000, responseType: 'arraybuffer' }
  )
  // AFIP devuelve ISO-8859-1, decodificar correctamente
  res.data = new TextDecoder('iso-8859-1').decode(res.data)

  const parsed = await parseStringPromise(res.data, { explicitArray: false })
  return parsed['soap:Envelope']['soap:Body']['ns2:getPersona_v2Response']?.personaReturn
}

/**
 * Determina la condición frente al IVA según los impuestos inscriptos.
 */
function determinarCondicionIVA(datosRegimenGeneral, datosMonotributo) {
  const impuestos = Array.isArray(datosRegimenGeneral?.impuesto)
    ? datosRegimenGeneral.impuesto
    : datosRegimenGeneral?.impuesto ? [datosRegimenGeneral.impuesto] : []
  const ids = impuestos.map(i => parseInt(i.idImpuesto))

  if (ids.includes(30)) return 'RI'
  if (ids.includes(32)) return 'EX'
  if (datosMonotributo || ids.includes(20)) return 'MT'
  return 'CF'
}

/**
 * Calcula el dígito verificador de un CUIT.
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
  if (resto === 1) return null
  return 11 - resto
}

/**
 * Genera posibles CUITs a partir de un DNI.
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
 * Consulta datos de un contribuyente por CUIT o DNI en ARCA.
 * Si recibe un DNI (7-8 dígitos), genera posibles CUITs y prueba cada uno.
 */
async function consultarCUIT(cuit) {
  if (!certsDisponibles()) {
    throw new Error('Certificados AFIP no configurados')
  }

  const soloDigitos = String(cuit).replace(/\D/g, '')
  if (!soloDigitos || soloDigitos.length < 7) {
    return null
  }

  let cuitsAProbar = []
  if (soloDigitos.length < 11) {
    cuitsAProbar = dniAPosiblesCuits(soloDigitos)
    if (cuitsAProbar.length === 0) return null
  } else {
    cuitsAProbar = [soloDigitos]
  }

  for (const c of cuitsAProbar) {
    try {
      console.log(`[AFIP] Consultando CUIT ${c}...`)
      const data = await consultarPersonaSOAP(c)

      if (!data || !data.datosGenerales) continue

      const dg = data.datosGenerales || {}
      const dom = dg.domicilioFiscal || {}

      const esJuridica = dg.tipoPersona === 'JURIDICA'
      const nombre = esJuridica
        ? dg.razonSocial
        : [dg.apellido, dg.nombre].filter(Boolean).join(' ') || dg.razonSocial

      return {
        cuit: String(dg.idPersona || c),
        razon_social: nombre || null,
        tipo_persona: dg.tipoPersona || null,
        condicion_iva: determinarCondicionIVA(data.datosRegimenGeneral, data.datosMonotributo),
        domicilio: dom.direccion || null,
        localidad: dom.localidad || null,
        provincia: dom.descripcionProvincia || null,
        codigo_postal: dom.codPostal || null,
        estado: dg.estadoClave || null,
        error_afip: data.errorConstancia?.error ?
          (Array.isArray(data.errorConstancia.error) ? data.errorConstancia.error.join('. ') : data.errorConstancia.error)
          : null,
      }
    } catch (err) {
      const faultMsg = err.response?.data?.match?.(/<faultstring>(.*?)<\/faultstring>/)?.[1]
      console.log(`[AFIP] Error para ${c}: ${faultMsg || err.message}`)

      // Si es "No existe persona", probar siguiente CUIT
      if (faultMsg?.includes('No existe persona')) continue

      // Si es error de token, invalidar cache y reintentar una vez
      if (faultMsg?.includes('token') || faultMsg?.includes('Token')) {
        tokenCache = null
        try {
          const data = await consultarPersonaSOAP(c)
          if (data?.datosGenerales) {
            const dg = data.datosGenerales
            const dom = dg.domicilioFiscal || {}
            const esJuridica = dg.tipoPersona === 'JURIDICA'
            const nombre = esJuridica ? dg.razonSocial : [dg.apellido, dg.nombre].filter(Boolean).join(' ') || dg.razonSocial
            return {
              cuit: String(dg.idPersona || c),
              razon_social: nombre || null,
              tipo_persona: dg.tipoPersona || null,
              condicion_iva: determinarCondicionIVA(data.datosRegimenGeneral, data.datosMonotributo),
              domicilio: dom.direccion || null,
              localidad: dom.localidad || null,
              provincia: dom.descripcionProvincia || null,
              codigo_postal: dom.codPostal || null,
              estado: dg.estadoClave || null,
              error_afip: null,
            }
          }
        } catch { /* ignorar retry */ }
      }

      continue
    }
  }

  return null
}

module.exports = { consultarCUIT }
