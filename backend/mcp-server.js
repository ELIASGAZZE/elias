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
const { z } = require('zod')
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
  const transports = {}

  // SSE endpoint — Cowork connects here
  app.get('/mcp/sse', async (req, res) => {
    const server = createMcpServer()
    const transport = new SSEServerTransport('/mcp/messages', res)
    transports[transport.sessionId] = { server, transport }

    res.on('close', () => {
      delete transports[transport.sessionId]
    })

    await server.connect(transport)
  })

  // Messages endpoint — Cowork sends tool calls here
  app.post('/mcp/messages', async (req, res) => {
    const sessionId = req.query.sessionId
    const session = transports[sessionId]
    if (!session) {
      return res.status(400).json({ error: 'No active session. Connect to /mcp/sse first.' })
    }
    await session.transport.handlePostMessage(req, res)
  })

  // MCP health
  app.get('/mcp/health', (req, res) => {
    res.json({
      status: 'ok',
      tools: tools.length,
      activeSessions: Object.keys(transports).length,
    })
  })

  console.log(`[MCP] Montado en /mcp/sse — ${tools.length} tools registrados`)
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
