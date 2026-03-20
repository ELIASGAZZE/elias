#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// MCP Server — POS Padano
// ─────────────────────────────────────────────────────────────────────────────
// Modos:
//   1. Integrado en Express: require('./mcp-server').mountMcp(app)
//   2. Standalone stdio:     node mcp-server.js
//
// Variables de entorno:
//   MCP_API_URL   — URL del backend (default: http://localhost:3001)
//   MCP_USER      — Usuario auth
//   MCP_PASSWORD   — Contraseña auth
// ─────────────────────────────────────────────────────────────────────────────

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { z } = require('zod')
const express = require('express')
const tools = require('./mcp-tools-config')

// ── Config ───────────────────────────────────────────────────────────────────

function getApiUrl() {
  return process.env.MCP_API_URL || `http://localhost:${process.env.PORT || 3001}`
}

const MCP_USER = process.env.MCP_USER || 'elias'
const MCP_PASSWORD = process.env.MCP_PASSWORD || 'admin123'

// ── Auth ─────────────────────────────────────────────────────────────────────

let authToken = null
let tokenExpiry = 0

async function getToken() {
  if (authToken && Date.now() < tokenExpiry) return authToken

  const res = await fetch(`${getApiUrl()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: MCP_USER, password: MCP_PASSWORD }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Login failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  authToken = data.token || data.accessToken
  tokenExpiry = Date.now() + 55 * 60 * 1000
  return authToken
}

// ── API caller ───────────────────────────────────────────────────────────────

async function callAPI(toolConfig, params) {
  const { method, path, queryParams = [], noAuth } = toolConfig

  let url = `${getApiUrl()}${path}`
  const bodyParams = { ...params }

  for (const [key, val] of Object.entries(params)) {
    if (url.includes(`:${key}`)) {
      url = url.replace(`:${key}`, encodeURIComponent(val))
      delete bodyParams[key]
    }
  }

  const qsEntries = []
  for (const qp of queryParams) {
    if (bodyParams[qp] !== undefined && bodyParams[qp] !== null) {
      qsEntries.push(`${qp}=${encodeURIComponent(bodyParams[qp])}`)
      delete bodyParams[qp]
    }
  }
  if (qsEntries.length) url += `?${qsEntries.join('&')}`

  const headers = { 'Content-Type': 'application/json' }
  if (!noAuth) {
    headers['Authorization'] = `Bearer ${await getToken()}`
  }

  const fetchOpts = { method, headers }
  if (method !== 'GET' && method !== 'DELETE' && Object.keys(bodyParams).length > 0) {
    fetchOpts.body = JSON.stringify(bodyParams)
  }

  const res = await fetch(url, fetchOpts)
  const contentType = res.headers.get('content-type') || ''

  let responseData
  if (contentType.includes('application/json')) {
    responseData = await res.json()
  } else {
    responseData = await res.text()
  }

  if (!res.ok) {
    return {
      error: true,
      status: res.status,
      message: typeof responseData === 'object'
        ? (responseData.error || responseData.message || JSON.stringify(responseData))
        : responseData,
    }
  }

  return responseData
}

// ── Zod schema builder ──────────────────────────────────────────────────────

function buildZodSchema(params) {
  const shape = {}
  for (const [key, def] of Object.entries(params)) {
    let field
    switch (def.type) {
      case 'number':
        field = z.number().describe(def.description || key)
        break
      case 'boolean':
        field = z.boolean().describe(def.description || key)
        break
      case 'array':
        field = z.array(z.any()).describe(def.description || key)
        break
      case 'object':
        field = z.record(z.any()).describe(def.description || key)
        break
      default:
        field = z.string().describe(def.description || key)
    }

    if (def.enum) {
      field = z.enum(def.enum).describe(def.description || key)
    }

    if (!def.required) {
      field = field.optional()
    }

    shape[key] = field
  }
  return shape
}

// ── Create MCP server instance ──────────────────────────────────────────────

function createMcpServer() {
  const server = new McpServer({
    name: 'POS Padano',
    version: '1.0.0',
    description: 'Sistema completo de gestión POS Padano — ventas, clientes, empleados, compras, auditoría, y más.',
  })

  for (const toolConfig of tools) {
    const zodShape = buildZodSchema(toolConfig.params)

    server.tool(
      toolConfig.name,
      toolConfig.description,
      zodShape,
      async (params) => {
        try {
          const result = await callAPI(toolConfig, params)
          return {
            content: [{
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            }],
          }
        } catch (err) {
          return {
            content: [{
              type: 'text',
              text: `Error: ${err.message}`,
            }],
            isError: true,
          }
        }
      }
    )
  }

  return server
}

// ── Mount on Express app (for integration in index.js) ──────────────────────

function mountMcp(app) {
  const crypto = require('crypto')
  const transports = {}

  // Tokens válidos (en memoria — se pierden al reiniciar, Cowork reconecta)
  const validTokens = new Set()
  // Códigos de autorización pendientes (code → redirect_uri)
  const authCodes = new Map()

  // ── OAuth 2.0 Discovery ──────────────────────────────────────────────
  // Cowork busca esto para saber dónde autenticarse
  app.get('/mcp/.well-known/oauth-authorization-server', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/mcp/authorize`,
      token_endpoint: `${baseUrl}/mcp/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
    })
  })

  // También servir en la ruta estándar (algunos clientes buscan acá)
  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/mcp/authorize`,
      token_endpoint: `${baseUrl}/mcp/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
    })
  })

  // ── OAuth Authorization endpoint ─────────────────────────────────────
  // Auto-aprueba y redirige con un code
  app.get('/mcp/authorize', (req, res) => {
    const { redirect_uri, state } = req.query
    if (!redirect_uri) {
      return res.status(400).send('Missing redirect_uri')
    }

    const code = crypto.randomUUID()
    authCodes.set(code, { redirect_uri, created: Date.now() })

    // Limpiar codes viejos (> 5 min)
    for (const [c, data] of authCodes) {
      if (Date.now() - data.created > 5 * 60 * 1000) authCodes.delete(c)
    }

    const url = new URL(redirect_uri)
    url.searchParams.set('code', code)
    if (state) url.searchParams.set('state', state)
    res.redirect(url.toString())
  })

  // ── OAuth Token endpoint ─────────────────────────────────────────────
  // Intercambia code por access_token
  app.post('/mcp/token', express.urlencoded({ extended: false }), (req, res) => {
    const { grant_type, code, refresh_token } = req.body

    if (grant_type === 'authorization_code') {
      if (!code || !authCodes.has(code)) {
        return res.status(400).json({ error: 'invalid_grant' })
      }
      authCodes.delete(code)
    }

    // Generar token
    const token = crypto.randomUUID()
    validTokens.add(token)

    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 86400,
      refresh_token: crypto.randomUUID(),
    })
  })

  // ── OAuth Protected Resource metadata ────────────────────────────────
  app.get('/mcp/.well-known/oauth-protected-resource', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`
    res.json({
      resource: baseUrl,
      authorization_servers: [baseUrl],
    })
  })

  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`
    res.json({
      resource: baseUrl,
      authorization_servers: [baseUrl],
    })
  })

  // ── Streamable HTTP endpoint (Cowork) ──────────────────────────────
  // POST /mcp — JSON-RPC requests (initialize, tool calls, etc)
  app.post('/mcp', async (req, res) => {
    try {
      const server = createMcpServer()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      })
      res.on('close', () => {
        transport.close()
        server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch (err) {
      console.error('[MCP] Streamable HTTP error:', err.message)
      if (!res.headersSent) {
        res.status(500).json({ error: err.message })
      }
    }
  })

  // GET /mcp — SSE stream for server notifications (Streamable HTTP spec)
  app.get('/mcp', async (req, res) => {
    // Si pide SSE (Accept: text/event-stream), abrimos stream
    const accept = req.headers.accept || ''
    if (accept.includes('text/event-stream')) {
      const server = createMcpServer()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      res.on('close', () => {
        transport.close()
        server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } else {
      // Health check si no es SSE
      res.json({
        status: 'ok',
        tools: tools.length,
        activeSessions: Object.keys(transports).length,
      })
    }
  })

  // DELETE /mcp — close session
  app.delete('/mcp', async (req, res) => {
    res.status(200).end()
  })

  // ── Legacy SSE endpoint (Claude Code CLI via HTTP) ────────────────────
  app.get('/mcp/sse', async (req, res) => {
    const server = createMcpServer()
    const transport = new SSEServerTransport('/mcp/messages', res)
    transports[transport.sessionId] = { server, transport }

    res.on('close', () => {
      delete transports[transport.sessionId]
    })

    await server.connect(transport)
  })

  app.post('/mcp/messages', async (req, res) => {
    const sessionId = req.query.sessionId
    const session = transports[sessionId]
    if (!session) {
      return res.status(400).json({ error: 'No active session. Connect to /mcp/sse first.' })
    }
    await session.transport.handlePostMessage(req, res)
  })

  // ── MCP health ───────────────────────────────────────────────────────
  app.get('/mcp/health', (req, res) => {
    res.json({
      status: 'ok',
      tools: tools.length,
      activeSessions: Object.keys(transports).length,
      activeTokens: validTokens.size,
    })
  })

  console.log(`[MCP] Montado en /mcp — ${tools.length} tools (OAuth + Streamable HTTP)`)
}

// ── Standalone mode (stdio for Claude Code CLI) ─────────────────────────────

if (require.main === module && !process.argv.includes('--http')) {
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  server.connect(transport).catch((err) => {
    process.stderr.write(`MCP Server fatal error: ${err.message}\n`)
    process.exit(1)
  })
}

module.exports = { mountMcp }
