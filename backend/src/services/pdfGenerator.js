// Generador de PDF que funciona en servidores sin Chrome (Render, etc.)
// Usa @sparticuz/chromium en producción y puppeteer local en desarrollo

async function generarPDF(html) {
  let browser
  try {
    if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
      // En Render/producción: usar chromium serverless
      const chromium = require('@sparticuz/chromium')
      const puppeteer = require('puppeteer-core')
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      })
    } else {
      // Local: usar puppeteer normal (tiene Chrome bundled)
      const puppeteer = require('puppeteer')
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    }

    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    })
    return Buffer.from(pdfBuffer)
  } finally {
    if (browser) await browser.close()
  }
}

module.exports = { generarPDF }
