/**
 * Container integration tests for sla-wizard-plugin-json-errors.
 *
 * Starts real Docker containers (echo backend + mock telemeter + nginx) to
 * verify that all nginx error responses (401, 403, 404, 429) return JSON
 * bodies instead of the default nginx HTML error pages.
 *
 * Requires Docker to be running. Run with:
 *   npm run test:container
 */
const path = require('path')
const fs = require('fs')
const http = require('http')
const { GenericContainer, Network, Wait } = require('testcontainers')
const slaWizard = require('sla-wizard')
const plugin = require('../index.js')

slaWizard.use(plugin)

const OAS_PATH = path.join(__dirname, '../test-specs/oas.yaml')
const SLA_DIR  = path.join(__dirname, '../test-specs/slas')
const CONTAINER_OUT_DIR = path.join(__dirname, './test-container-output')

// API keys from the test SLA fixtures
const API_KEY_USER1 = 'testkey1abc123def456' // plan: normal, limit: 5 req/min
const API_KEY_USER2 = 'testkey2xyz789ghi012' // plan: pro,    limit: 10 req/min
const API_KEY_INVALID = '00000000000000000000000000000000'

// ─── Inline server code ───────────────────────────────────────────────────────

// Minimal Node.js HTTP server that echoes the received path, method, and body.
const ECHO_SERVER_CODE = [
  "const h=require('http');",
  "h.createServer((req,res)=>{",
  "  let b='';",
  "  req.on('data',d=>b+=d);",
  "  req.on('end',()=>{",
  "    const r=JSON.stringify({path:req.url,method:req.method,body:b});",
  "    res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(r)});",
  "    res.end(r);",
  "  });",
  "}).listen(8000,()=>process.stdout.write('ECHO_READY\\n'));",
].join('')

// Mock alma-telemeter: validates API keys and enforces per-key request counts.
// Returns 200 + X-RateLimit-* headers when under limit; 403 when limit exceeded
// or key is unknown. Exposes POST /reset to clear all counters.
const TELEMETER_CODE = [
  "const h=require('http');",
  "let counts={};",
  "const KEYS={'testkey1abc123def456':5,'testkey2xyz789ghi012':10};",
  "h.createServer((req,res)=>{",
  "  if(req.method==='POST'&&req.url==='/reset'){",
  "    let b='';req.on('data',d=>b+=d);",
  "    req.on('end',()=>{counts={};res.writeHead(200);res.end();});",
  "    return;",
  "  }",
  "  const key=req.headers['x-api-key']||'';",
  "  const limit=KEYS[key];",
  "  if(!limit){res.writeHead(403);res.end();return;}",
  "  counts[key]=(counts[key]||0)+1;",
  "  if(counts[key]>limit){",
  "    res.writeHead(403,{",
  "      'X-RateLimit-Limit':String(limit),",
  "      'X-RateLimit-Remaining':'0',",
  "      'X-RateLimit-Reset':String(Math.floor(Date.now()/1000)+60)",
  "    });",
  "    res.end();return;",
  "  }",
  "  const rem=limit-counts[key];",
  "  res.writeHead(200,{",
  "    'X-RateLimit-Limit':String(limit),",
  "    'X-RateLimit-Remaining':String(rem),",
  "    'X-RateLimit-Reset':String(Math.floor(Date.now()/1000)+60)",
  "  });",
  "  res.end();",
  "}).listen(2047,()=>process.stdout.write('TELEMETER_READY\\n'));",
].join('')

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a full nginx config (nginx.conf + conf.d/) with the json-errors
 * plugin applied, then patch the proxy_pass and telemeter URLs to point at
 * the actual container hostnames on the shared Docker network.
 */
function buildNginxConfig(outDir, backendUrl, telemeterUrl) {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }

  slaWizard.configNginxJsonErrors({ outDir, oas: OAS_PATH, sla: SLA_DIR })

  const patchUrls = (content) =>
    content
      .replace(/proxy_pass\s+http:\/\/localhost:8000;/g, `proxy_pass ${backendUrl};`)
      .replace(/http:\/\/127\.0\.0\.1:2047/g, telemeterUrl)

  const nginxConfPath = path.join(outDir, 'nginx.conf')
  if (fs.existsSync(nginxConfPath)) {
    fs.writeFileSync(nginxConfPath, patchUrls(fs.readFileSync(nginxConfPath, 'utf8')))
  }

  const confDPath = path.join(outDir, 'conf.d')
  if (fs.existsSync(confDPath)) {
    for (const file of fs.readdirSync(confDPath).filter(f => f.endsWith('.conf'))) {
      const filePath = path.join(confDPath, file)
      fs.writeFileSync(filePath, patchUrls(fs.readFileSync(filePath, 'utf8')))
    }
  }
}

/**
 * Thin Promise wrapper around Node's http.request.
 * Returns { status, body, headers }.
 */
function request({ host, port, path: urlPath, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const opts = { host, port, path: urlPath, method, headers }
    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', chunk => (data += chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Container Integration Tests — JSON error responses', () => {
  let network
  let backendContainer
  let telemeterContainer
  let nginxContainer
  let nginxHost
  let nginxPort
  let telemeterHost
  let telemeterPort

  beforeAll(async () => {
    // 1. Shared Docker network so containers can reach each other by alias
    network = await new Network().start()

    // 2. Echo backend: tiny Node.js HTTP server
    backendContainer = await new GenericContainer('node:18-alpine')
      .withNetwork(network)
      .withNetworkAliases('backend')
      .withCommand(['node', '-e', ECHO_SERVER_CODE])
      .withExposedPorts(8000)
      .withWaitStrategy(Wait.forLogMessage('ECHO_READY'))
      .start()

    // 3. Mock telemeter: validates API keys and enforces rate limits
    telemeterContainer = await new GenericContainer('node:18-alpine')
      .withNetwork(network)
      .withNetworkAliases('telemeter')
      .withCommand(['node', '-e', TELEMETER_CODE])
      .withExposedPorts(2047)
      .withWaitStrategy(Wait.forLogMessage('TELEMETER_READY'))
      .start()

    telemeterHost = telemeterContainer.getHost()
    telemeterPort = telemeterContainer.getMappedPort(2047)

    // 4. Generate nginx config and patch container URLs
    buildNginxConfig(CONTAINER_OUT_DIR, 'http://backend:8000', 'http://telemeter:2047')

    // 5. Collect all config files to mount into the nginx container
    const nginxConfPath = path.join(CONTAINER_OUT_DIR, 'nginx.conf')
    const confDFiles = fs.readdirSync(path.join(CONTAINER_OUT_DIR, 'conf.d'))
      .filter(f => f.endsWith('.conf'))
      .map(f => ({
        source: path.join(CONTAINER_OUT_DIR, 'conf.d', f),
        target: `/etc/nginx/conf.d/${f}`,
      }))

    // Write an empty file to override nginx:alpine's default.conf.
    // nginx:alpine ships /etc/nginx/conf.d/default.conf with a full server {}
    // block. Our nginx.conf includes conf.d/*.conf *inside* its own server block,
    // so inheriting default.conf would produce an illegal nested server block and
    // crash nginx on startup.
    const emptyDefaultConf = path.join(CONTAINER_OUT_DIR, 'empty-default.conf')
    fs.writeFileSync(emptyDefaultConf, '')

    // 6. nginx container with our generated config
    nginxContainer = await new GenericContainer('nginx:alpine')
      .withNetwork(network)
      .withCopyFilesToContainer([
        { source: nginxConfPath, target: '/etc/nginx/nginx.conf' },
        { source: emptyDefaultConf, target: '/etc/nginx/conf.d/default.conf' },
        ...confDFiles,
      ])
      .withExposedPorts(80)
      .withWaitStrategy(Wait.forListeningPorts())
      .start()

    nginxHost = nginxContainer.getHost()
    nginxPort = nginxContainer.getMappedPort(80)
  }, 300_000)

  afterAll(async () => {
    const stop = (c) => c && c.stop().catch(() => {})
    await stop(nginxContainer)
    await stop(telemeterContainer)
    await stop(backendContainer)
    await stop(network)
    if (fs.existsSync(CONTAINER_OUT_DIR)) {
      fs.rmSync(CONTAINER_OUT_DIR, { recursive: true, force: true })
    }
  }, 60_000)

  // ─── 401 Unauthorized ──────────────────────────────────────────────────────

  it('returns 401 when no API key header is provided', async () => {
    const res = await request({ host: nginxHost, port: nginxPort, path: '/api/v1/items' })
    expect(res.status).toBe(401)
  }, 30_000)

  it('401 response body is valid JSON', async () => {
    const res = await request({ host: nginxHost, port: nginxPort, path: '/api/v1/items' })
    expect(() => JSON.parse(res.body)).not.toThrow()
  }, 30_000)

  it('401 JSON body has error=Unauthorized', async () => {
    const res = await request({ host: nginxHost, port: nginxPort, path: '/api/v1/items' })
    const body = JSON.parse(res.body)
    expect(body.error).toBe('Unauthorized')
  }, 30_000)

  it('401 JSON body has message="API key required"', async () => {
    const res = await request({ host: nginxHost, port: nginxPort, path: '/api/v1/items' })
    const body = JSON.parse(res.body)
    expect(body.message).toBe('API key required')
  }, 30_000)

  it('401 JSON body has status=401', async () => {
    const res = await request({ host: nginxHost, port: nginxPort, path: '/api/v1/items' })
    const body = JSON.parse(res.body)
    expect(body.status).toBe(401)
  }, 30_000)

  // ─── 403 Forbidden ─────────────────────────────────────────────────────────

  it('returns 403 when an unrecognised API key is provided', async () => {
    const res = await request({
      host: nginxHost,
      port: nginxPort,
      path: '/api/v1/items',
      headers: { apikey: API_KEY_INVALID },
    })
    expect(res.status).toBe(403)
  }, 30_000)

  it('403 response body is valid JSON', async () => {
    const res = await request({
      host: nginxHost,
      port: nginxPort,
      path: '/api/v1/items',
      headers: { apikey: API_KEY_INVALID },
    })
    expect(() => JSON.parse(res.body)).not.toThrow()
  }, 30_000)

  it('403 JSON body has error=Forbidden and message="Invalid API key or Forbidden access"', async () => {
    const res = await request({
      host: nginxHost,
      port: nginxPort,
      path: '/api/v1/items',
      headers: { apikey: API_KEY_INVALID },
    })
    const body = JSON.parse(res.body)
    expect(body.error).toBe('Forbidden')
    expect(body.message).toBe('Invalid API key or Forbidden access')
    expect(body.status).toBe(403)
  }, 30_000)

  // ─── 404 Not Found ─────────────────────────────────────────────────────────

  it('returns 404 for a path not defined in the SLA', async () => {
    const res = await request({
      host: nginxHost,
      port: nginxPort,
      path: '/nonexistent/route/xyz',
      headers: { apikey: API_KEY_USER2 },
    })
    expect(res.status).toBe(404)
  }, 30_000)

  it('404 response body is valid JSON with error=NotFound', async () => {
    const res = await request({
      host: nginxHost,
      port: nginxPort,
      path: '/nonexistent/route/xyz',
      headers: { apikey: API_KEY_USER2 },
    })
    const body = JSON.parse(res.body)
    expect(body.error).toBe('NotFound')
    expect(body.status).toBe(404)
  }, 30_000)

  // ─── 200 proxy pass-through ────────────────────────────────────────────────

  it('valid API key and known endpoint proxies successfully (200)', async () => {
    const res = await request({
      host: nginxHost,
      port: nginxPort,
      path: '/api/v1/items',
      headers: { apikey: API_KEY_USER2 },
    })
    expect(res.status).toBe(200)
  }, 30_000)

  it('proxied response contains echo of the request path', async () => {
    const res = await request({
      host: nginxHost,
      port: nginxPort,
      path: '/api/v1/users',
      headers: { apikey: API_KEY_USER2 },
    })
    expect(res.status).toBe(200)
    const echo = JSON.parse(res.body)
    expect(echo.path).toBeDefined()
  }, 30_000)

  // ─── 429 Too Many Requests ─────────────────────────────────────────────────

  it('returns 429 JSON when rate limit is exceeded', async () => {
    // Reset telemeter counts so USER1 quota is fresh
    await request({
      host: telemeterHost,
      port: telemeterPort,
      path: '/reset',
      method: 'POST',
    })

    // USER1 has a limit of 5 req/min — send 6 requests
    let lastRes
    for (let i = 0; i < 6; i++) {
      lastRes = await request({
        host: nginxHost,
        port: nginxPort,
        path: '/api/v1/items',
        headers: { apikey: API_KEY_USER1 },
      })
    }

    expect(lastRes.status).toBe(429)
  }, 30_000)

  it('429 response body is valid JSON', async () => {
    // Reset and exhaust USER1's limit again
    await request({
      host: telemeterHost,
      port: telemeterPort,
      path: '/reset',
      method: 'POST',
    })
    let lastRes
    for (let i = 0; i < 6; i++) {
      lastRes = await request({
        host: nginxHost,
        port: nginxPort,
        path: '/api/v1/items',
        headers: { apikey: API_KEY_USER1 },
      })
    }
    expect(() => JSON.parse(lastRes.body)).not.toThrow()
  }, 30_000)
})
