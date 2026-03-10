require('dotenv').config();
const fs = require('fs');
const forge = require('node-forge');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');

const certPem = fs.readFileSync('./certs/COMERCIAL PADANO_7627c4ab3209aadb.crt', 'utf8');
const keyPem = fs.readFileSync('./certs/afip.key', 'utf8');
const CUIT = '30718852788';

function signCMS(content, certPem, keyPem) {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(content, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() }
    ]
  });
  p7.sign();

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

async function getWSAAToken() {
  const now = new Date();
  const gen = new Date(now.getTime() - 600000).toISOString();
  const exp = new Date(now.getTime() + 600000).toISOString();
  const uid = Math.floor(Math.random() * 999999999);

  const tra = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uid}</uniqueId>
    <generationTime>${gen}</generationTime>
    <expirationTime>${exp}</expirationTime>
  </header>
  <service>ws_sr_constancia_inscripcion</service>
</loginTicketRequest>`;

  const signed = signCMS(tra, certPem, keyPem);

  const soapEnv = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${signed}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await axios.post('https://wsaa.afip.gov.ar/ws/services/LoginCms', soapEnv, {
    headers: { 'Content-Type': 'text/xml', 'SOAPAction': '' },
    timeout: 30000,
  });

  const parsed = await parseStringPromise(res.data, { explicitArray: false });
  const loginReturn = parsed['soapenv:Envelope']['soapenv:Body']['loginCmsResponse']['loginCmsReturn'];
  const creds = await parseStringPromise(loginReturn, { explicitArray: false });

  return {
    token: creds.loginTicketResponse.credentials.token,
    sign: creds.loginTicketResponse.credentials.sign,
  };
}

(async () => {
  try {
    console.log('Autenticando con node-forge...');
    const { token, sign } = await getWSAAToken();
    console.log('Token OK!\n');

    const testCuit = '30718852788';
    console.log(`Consultando ${testCuit}...`);

    const soapReq = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
  <soapenv:Body>
    <a5:getPersona_v2>
      <token>${token}</token>
      <sign>${sign}</sign>
      <cuitRepresentada>${CUIT}</cuitRepresentada>
      <idPersona>${testCuit}</idPersona>
    </a5:getPersona_v2>
  </soapenv:Body>
</soapenv:Envelope>`;

    const res = await axios.post(
      'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
      soapReq,
      { headers: { 'Content-Type': 'text/xml', 'SOAPAction': '' }, timeout: 15000, responseType: 'arraybuffer' }
    );

    const decoded = new TextDecoder('iso-8859-1').decode(res.data);
    const parsed = await parseStringPromise(decoded, { explicitArray: false });
    const persona = parsed['soap:Envelope']['soap:Body']['ns2:getPersona_v2Response']?.personaReturn;
    const dg = persona?.datosGenerales;
    console.log('Razón Social:', dg?.razonSocial);
    console.log('Domicilio:', dg?.domicilioFiscal?.direccion);
    console.log('Estado:', dg?.estadoClave);
    console.log('\nOK!');
  } catch (err) {
    console.error('Error:', err.message);
    if (err.response?.data) {
      const text = typeof err.response.data === 'string' ? err.response.data : Buffer.from(err.response.data).toString();
      console.error('Response:', text.substring(0, 500));
    }
  }
})();
