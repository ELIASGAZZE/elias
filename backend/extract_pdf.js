const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs = require('fs');

async function extractText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let fullText = '';

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += `\n--- PAGE ${i} ---\n` + pageText;
  }

  return fullText;
}

(async () => {
  // Extract examples PDF
  console.log('Extracting examples PDF...');
  const text = await extractText('C:/Users/WINDOWS/Downloads/ApiPublica/API Pública - Anexo Ejemplos.pdf');
  fs.writeFileSync('C:/Users/WINDOWS/Documents/elias/backend/api_ejemplos.txt', text);
  console.log('Written', text.length, 'chars to api_ejemplos.txt');

  // Find PedidoVenta sections
  const idx = text.indexOf('edidoVenta');
  if (idx > -1) {
    console.log('\n=== PedidoVenta found at char', idx, '===');
    console.log(text.substring(Math.max(0, idx - 300), Math.min(text.length, idx + 5000)));
  }

  // Also extract main PDF
  console.log('\n\nExtracting main API PDF...');
  const text2 = await extractText('C:/Users/WINDOWS/Downloads/ApiPublica/API Pública.pdf');
  fs.writeFileSync('C:/Users/WINDOWS/Documents/elias/backend/api_publica.txt', text2);
  console.log('Written', text2.length, 'chars to api_publica.txt');

  const idx2 = text2.indexOf('edidoVenta');
  if (idx2 > -1) {
    console.log('\n=== PedidoVenta found in main PDF at char', idx2, '===');
    console.log(text2.substring(Math.max(0, idx2 - 300), Math.min(text2.length, idx2 + 5000)));
  }

  process.exit(0);
})();
