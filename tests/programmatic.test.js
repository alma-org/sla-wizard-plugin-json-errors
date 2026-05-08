const path = require('path')
const fs = require('fs')
const slaWizard = require('sla-wizard')
const plugin = require('../index.js')

slaWizard.use(plugin)

const OAS_PATH = path.join(__dirname, '../test-specs/oas.yaml')
const SLA_DIR  = path.join(__dirname, '../test-specs/slas')
const OUT_DIR  = path.join(__dirname, './test-prog-output')

const ERROR_CODES = [401, 403, 404, 500, 502, 503, 504]

// ─── Module exports ───────────────────────────────────────────────────────────

describe('module exports', () => {
  it('exports apply as a function', () => {
    expect(typeof plugin.apply).toBe('function')
  })

  it('exports configNginxJsonErrors as a function', () => {
    expect(typeof plugin.configNginxJsonErrors).toBe('function')
  })

  it('exports addToJsonErrorsConfd as a function', () => {
    expect(typeof plugin.addToJsonErrorsConfd).toBe('function')
  })

  it('exports applyJsonErrorsToNginxConf as a function', () => {
    expect(typeof plugin.applyJsonErrorsToNginxConf).toBe('function')
  })

  it('exports applyJsonErrorTransformations as a function', () => {
    expect(typeof plugin.applyJsonErrorTransformations).toBe('function')
  })

  it('exposes configNginxJsonErrors on slaWizard after use()', () => {
    expect(typeof slaWizard.configNginxJsonErrors).toBe('function')
  })

  it('exposes addToJsonErrorsConfd on slaWizard after use()', () => {
    expect(typeof slaWizard.addToJsonErrorsConfd).toBe('function')
  })
})

// ─── configNginxJsonErrors ────────────────────────────────────────────────────

describe('configNginxJsonErrors', () => {
  const outDir = path.join(OUT_DIR, 'config-nginx-json-errors')

  beforeAll(() => {
    if (!fs.existsSync(OUT_DIR)) {
      fs.mkdirSync(OUT_DIR, { recursive: true })
    }
    slaWizard.configNginxJsonErrors({ outDir, oas: OAS_PATH, sla: SLA_DIR })
  })

  afterAll(() => {
    if (fs.existsSync(OUT_DIR)) {
      fs.rmSync(OUT_DIR, { recursive: true, force: true })
    }
  })

  it('generates nginx.conf', () => {
    expect(fs.existsSync(path.join(outDir, 'nginx.conf'))).toBe(true)
  })

  it('generates conf.d/ directory', () => {
    expect(fs.existsSync(path.join(outDir, 'conf.d'))).toBe(true)
  })

  it('conf.d/ contains at least one .conf file', () => {
    const files = fs.readdirSync(path.join(outDir, 'conf.d')).filter(f => f.endsWith('.conf'))
    expect(files.length).toBeGreaterThan(0)
  })

  it('nginx.conf contains default_type application/json at server level', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    expect(content).toContain('default_type application/json;')
  })

  it('nginx.conf contains all 7 error_page directives', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    for (const code of ERROR_CODES) {
      expect(content).toContain(`error_page ${code} @json_${code};`)
    }
  })

  it('nginx.conf contains all 7 location @json_* named blocks', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    for (const code of ERROR_CODES) {
      expect(content).toContain(`location @json_${code} {`)
    }
  })

  it('nginx.conf retains include conf.d/*.conf directive', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    expect(content).toContain('include conf.d/*.conf')
  })

  it('nginx.conf retains listen directive', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    expect(content).toMatch(/listen\s+\d+;/)
  })

  it('each @json_* block has the correct JSON body with status field', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    for (const code of ERROR_CODES) {
      expect(content).toContain(`"status":${code}`)
    }
  })

  it('error_page directives appear before location @json_* blocks', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    const firstErrorPage = content.indexOf('error_page 401 @json_401;')
    const firstLocation  = content.indexOf('location @json_401 {')
    expect(firstErrorPage).toBeGreaterThan(-1)
    expect(firstLocation).toBeGreaterThan(-1)
    expect(firstErrorPage).toBeLessThan(firstLocation)
  })

  it('location @json_* blocks appear before include conf.d/*.conf', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    const lastLocation = content.indexOf('location @json_504 {')
    const includeIdx   = content.indexOf('include conf.d/*.conf')
    expect(lastLocation).toBeGreaterThan(-1)
    expect(includeIdx).toBeGreaterThan(-1)
    expect(lastLocation).toBeLessThan(includeIdx)
  })
})

// ─── addToJsonErrorsConfd ─────────────────────────────────────────────────────

describe('addToJsonErrorsConfd', () => {
  const outDir = path.join(OUT_DIR, 'add-to-json-errors-confd')

  beforeAll(() => {
    if (!fs.existsSync(OUT_DIR)) {
      fs.mkdirSync(OUT_DIR, { recursive: true })
    }
    slaWizard.addToJsonErrorsConfd({ outDir, oas: OAS_PATH, sla: SLA_DIR })
  })

  afterAll(() => {
    if (fs.existsSync(OUT_DIR)) {
      fs.rmSync(OUT_DIR, { recursive: true, force: true })
    }
  })

  it('does NOT generate nginx.conf', () => {
    expect(fs.existsSync(path.join(outDir, 'nginx.conf'))).toBe(false)
  })

  it('generates conf.d/ directory', () => {
    expect(fs.existsSync(path.join(outDir, 'conf.d'))).toBe(true)
  })

  it('conf.d/ contains at least one .conf file', () => {
    const files = fs.readdirSync(path.join(outDir, 'conf.d')).filter(f => f.endsWith('.conf'))
    expect(files.length).toBeGreaterThan(0)
  })
})
