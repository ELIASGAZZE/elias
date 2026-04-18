const express = require('express')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const router = express.Router()

// Clave privada: desde env var (Render) o archivo local (dev)
const privateKey = process.env.QZ_PRIVATE_KEY
  ? process.env.QZ_PRIVATE_KEY.replace(/\\n/g, '\n')
  : fs.readFileSync(path.join(__dirname, '../../qz-private-key.pem'), 'utf-8')

// Firma mensajes para QZ Tray — permite conexión trusted sin popups
router.get('/sign', (req, res) => {
  const toSign = req.query.request
  if (!toSign) return res.status(400).send('Missing request parameter')

  const sign = crypto.createSign('SHA512')
  sign.update(toSign)
  const signature = sign.sign(privateKey, 'base64')
  res.set('Content-Type', 'text/plain')
  res.send(signature)
})

module.exports = router
