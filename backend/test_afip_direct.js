require('dotenv').config();
const fs = require('fs');
const { execSync } = require('child_process');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');

const CERT_PATH = './certs/COMERCIAL PADANO_7627c4ab3209aadb.crt';
const KEY_PATH = './certs/afip.key';
const CUIT = '30718852788';

async function getWSAAToken(service) {
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
  <service>${service}</service>
</loginTicketRequest>`;

  fs.writeFileSync('/tmp/tra.xml', tra);

  const signed = execSync(
    `openssl cms -sign -in /tmp/tra.xml -signer "${CERT_PATH}" -inkey ${KEY_PATH} -nodetach -outform DER | base64 -w 0`,
    { encoding: 'utf8', timeout: 10000 }
  );

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
    timeout: 30000
  });

  const parsed = await parseStringPromise(res.data, { explicitArray: false });
  const loginReturn = parsed['soapenv:Envelope']['soapenv:Body']['loginCmsResponse']['loginCmsReturn'];
  const creds = await parseStringPromise(loginReturn, { explicitArray: false });

  return {
    token: creds.loginTicketResponse.credentials.token,
    sign: creds.loginTicketResponse.credentials.sign,
  };
}

async function consultarPersona(token, sign, idPersona) {
  const soapReq = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
  <soapenv:Body>
    <a5:getPersona_v2>
      <token>${token}</token>
      <sign>${sign}</sign>
      <cuitRepresentada>${CUIT}</cuitRepresentada>
      <idPersona>${idPersona}</idPersona>
    </a5:getPersona_v2>
  </soapenv:Body>
</soapenv:Envelope>`;

  const res = await axios.post(
    'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
    soapReq,
    { headers: { 'Content-Type': 'text/xml', 'SOAPAction': '' }, timeout: 15000 }
  );

  console.log('RAW XML:', res.data.substring(0, 2000));
  const parsed = await parseStringPromise(res.data, { explicitArray: false, tagNameProcessors: [(name) => name.replace(/^.*:/, '')] });
  const body = parsed['Envelope']['Body'];
  return body;
}

(async () => {
  try {
    console.log('Autenticando...');
    const { token, sign } = await getWSAAToken('ws_sr_constancia_inscripcion');
    console.log('Token OK\n');

    const cuits = ['30718852788'];
    for (const c of cuits) {
      console.log(`Consultando ${c}...`);
      try {
        const result = await consultarPersona(token, sign, c);
        console.log('OK:', JSON.stringify(result, null, 2));
      } catch (err) {
        const msg = err.response?.data?.match(/<faultstring>(.*?)<\/faultstring>/)?.[1] || err.message;
        console.log('ERROR:', msg);
      }
      console.log('');
    }
  } catch (err) {
    console.error('Auth error:', err.message);
    if (err.response) console.error('Data:', err.response.data?.substring(0, 1000));
  }
})();
