const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

const CLI_PATH = path.join(__dirname, 'cli-with-plugin.js')
const OAS_PATH = path.join(__dirname, '../test-specs/oas.yaml')
const SLA_DIR  = path.join(__dirname, '../test-specs/slas')
const OUT_DIR  = path.join(__dirname, './test-cli-output')

beforeAll(() => {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true })
  }
})

afterAll(() => {
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true })
  }
})

// ─── config-nginx-json-errors ─────────────────────────────────────────────────

describe('config-nginx-json-errors command', () => {
  const outDir = path.join(OUT_DIR, 'cli-config-nginx-json-errors')

  beforeAll(() => {
    execSync(
      `node "${CLI_PATH}" config-nginx-json-errors -o "${outDir}" --oas "${OAS_PATH}" --sla "${SLA_DIR}"`,
    )
  })

  it('exits 0 and generates nginx.conf', () => {
    expect(fs.existsSync(path.join(outDir, 'nginx.conf'))).toBe(true)
  })

  it('generates conf.d/ with at least one .conf file', () => {
    const files = fs.readdirSync(path.join(outDir, 'conf.d')).filter(f => f.endsWith('.conf'))
    expect(files.length).toBeGreaterThan(0)
  })

  it('nginx.conf contains all 7 error_page directives', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    for (const code of [401, 403, 404, 500, 502, 503, 504]) {
      expect(content).toContain(`error_page ${code} @json_${code};`)
    }
  })

  it('nginx.conf contains all 7 location @json_* blocks', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    for (const code of [401, 403, 404, 500, 502, 503, 504]) {
      expect(content).toContain(`location @json_${code} {`)
    }
  })

  it('stdout contains the success checkmark message', () => {
    const stdout = execSync(
      `node "${CLI_PATH}" config-nginx-json-errors -o "${outDir}" --oas "${OAS_PATH}" --sla "${SLA_DIR}"`,
    ).toString()
    expect(stdout).toContain('✓')
  })

  it('nginx.conf contains default_type application/json', () => {
    const content = fs.readFileSync(path.join(outDir, 'nginx.conf'), 'utf8')
    expect(content).toContain('default_type application/json;')
  })

  it('nginx.conf uses custom --telemeterUrl when provided', () => {
    const customOutDir = path.join(OUT_DIR, 'cli-config-nginx-json-errors-custom-telemeter')
    execSync(
      `node "${CLI_PATH}" config-nginx-json-errors -o "${customOutDir}" --oas "${OAS_PATH}" --sla "${SLA_DIR}" --telemeterUrl http://custom-telemeter:9999/rate-limit`,
    )
    const content = fs.readFileSync(path.join(customOutDir, 'nginx.conf'), 'utf8')
    expect(content).toContain('proxy_pass http://custom-telemeter:9999/rate-limit;')
  })
})

// ─── add-to-json-errors-confd ─────────────────────────────────────────────────

describe('add-to-json-errors-confd command', () => {
  const outDir = path.join(OUT_DIR, 'cli-add-to-json-errors-confd')

  beforeAll(() => {
    execSync(
      `node "${CLI_PATH}" add-to-json-errors-confd -o "${outDir}" --oas "${OAS_PATH}" --sla "${SLA_DIR}"`,
    )
  })

  it('exits 0 and does NOT generate nginx.conf', () => {
    expect(fs.existsSync(path.join(outDir, 'nginx.conf'))).toBe(false)
  })

  it('generates conf.d/ with at least one .conf file', () => {
    const files = fs.readdirSync(path.join(outDir, 'conf.d')).filter(f => f.endsWith('.conf'))
    expect(files.length).toBeGreaterThan(0)
  })
})

// ─── --help ───────────────────────────────────────────────────────────────────

describe('--help output', () => {
  it('lists config-nginx-json-errors command', () => {
    let output = ''
    try {
      execSync(`node "${CLI_PATH}" --help`)
    } catch (e) {
      output = e.stdout ? e.stdout.toString() : e.message
    }
    if (!output) {
      output = execSync(`node "${CLI_PATH}" --help`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString()
    }
    expect(output).toContain('config-nginx-json-errors')
  })

  it('lists add-to-json-errors-confd command', () => {
    let output = ''
    try {
      output = execSync(`node "${CLI_PATH}" --help`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString()
    } catch (e) {
      output = e.stdout ? e.stdout.toString() : ''
    }
    expect(output).toContain('add-to-json-errors-confd')
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws when --outDir is missing from config-nginx-json-errors', () => {
    expect(() =>
      execSync(
        `node "${CLI_PATH}" config-nginx-json-errors --oas "${OAS_PATH}" --sla "${SLA_DIR}"`,
        { stdio: 'pipe' },
      ),
    ).toThrow()
  })

  it('throws when --outDir is missing from add-to-json-errors-confd', () => {
    expect(() =>
      execSync(
        `node "${CLI_PATH}" add-to-json-errors-confd --oas "${OAS_PATH}" --sla "${SLA_DIR}"`,
        { stdio: 'pipe' },
      ),
    ).toThrow()
  })
})
