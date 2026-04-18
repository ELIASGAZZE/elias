const express = require('express')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const router = express.Router()

// Clave privada: siempre desde archivo (incluido en el repo)
const keyPath = path.join(__dirname, '../../qz-private-key.pem')
let privateKey = null
try {
  privateKey = fs.readFileSync(keyPath, 'utf-8')
} catch (err) {
  console.error('QZ: No se pudo leer qz-private-key.pem:', err.message)
}

// Firma mensajes para QZ Tray — permite conexión trusted sin popups
router.get('/sign', (req, res) => {
  if (!privateKey) return res.status(500).send('QZ private key not configured')

  const toSign = req.query.request
  if (!toSign) return res.status(400).send('Missing request parameter')

  try {
    const sign = crypto.createSign('SHA512')
    sign.update(toSign)
    const signature = sign.sign(privateKey, 'base64')
    res.set('Content-Type', 'text/plain')
    res.send(signature)
  } catch (err) {
    console.error('QZ sign error:', err.message)
    res.status(500).send('Sign error')
  }
})

module.exports = router
