const path = require('path')
const fs = require('fs')
const os = require('os')
const { applyJsonErrorsToNginxConf, applyJsonErrorTransformations } = require('../src/nginx-transform')

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MINIMAL = [
  'server {',
  '    listen 80;',
  '    include conf.d/*.conf;',
  '}',
].join('\n')

const MINIMAL_2SPACE = [
  'server {',
  '  listen 80;',
  '  include conf.d/*.conf;',
  '}',
].join('\n')

const FULL_NGINX = [
  'user nginx;',
  'worker_processes auto;',
  '',
  'events {',
  '    worker_connections 1024;',
  '}',
  '',
  'http {',
  '    server {',
  '        listen 80;',
  '        location = /auth {',
  '            internal;',
  '            proxy_pass http://127.0.0.1:2047/check;',
  '        }',
  '        location @rate_limited {',
  '            default_type application/json;',
  '            return 429 \'{"error":"TooManyRequests"}\';',
  '        }',
  '        include conf.d/*.conf;',
  '    }',
  '}',
].join('\n')

const ERROR_CODES = [401, 403, 404, 500, 502, 503, 504]

// ─── applyJsonErrorsToNginxConf ───────────────────────────────────────────────

describe('applyJsonErrorsToNginxConf', () => {
  describe('listen directive handling', () => {
    it('inserts default_type application/json after listen directive', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('default_type application/json;')
    })

    it('inserts all 7 error_page directives', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      for (const code of ERROR_CODES) {
        expect(result).toContain(`error_page ${code} @json_${code};`)
      }
    })

    it('error_page references exactly match location names', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      for (const code of ERROR_CODES) {
        expect(result).toContain(`error_page ${code} @json_${code};`)
        expect(result).toContain(`location @json_${code} {`)
      }
    })

    it('preserves listen 80 line in output', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('listen 80;')
    })

    it('preserves server block opening brace', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('server {')
    })

    it('preserves content after the listen block', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('include conf.d/*.conf;')
    })

    it('works with port 8080 instead of 80', () => {
      const input = MINIMAL.replace('listen 80;', 'listen 8080;')
      const result = applyJsonErrorsToNginxConf(input)
      expect(result).toContain('default_type application/json;')
      expect(result).toContain('error_page 401 @json_401;')
      expect(result).toContain('listen 8080;')
    })

    it('works with port 443', () => {
      const input = MINIMAL.replace('listen 80;', 'listen 443;')
      const result = applyJsonErrorsToNginxConf(input)
      expect(result).toContain('default_type application/json;')
      expect(result).toContain('listen 443;')
    })
  })

  describe('location block generation', () => {
    it('inserts all 7 location @json_* blocks', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      for (const code of ERROR_CODES) {
        expect(result).toContain(`location @json_${code} {`)
      }
    })

    it('keeps include conf.d/*.conf present after transformation', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('include conf.d/*.conf;')
    })

    it('401 JSON body is exact', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('{"error":"Unauthorized","message":"API key required","status":401}')
    })

    it('403 JSON body is exact', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('{"error":"Forbidden","message":"Invalid API key or Forbidden access","status":403}')
    })

    it('404 JSON body is exact', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('{"error":"NotFound","message":"Endpoint not found","status":404}')
    })

    it('500 JSON body is exact', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('{"error":"InternalServerError","message":"An internal error occurred","status":500}')
    })

    it('502 JSON body is exact', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('{"error":"BadGateway","message":"Bad gateway","status":502}')
    })

    it('503 JSON body is exact', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('{"error":"ServiceUnavailable","message":"Service unavailable","status":503}')
    })

    it('504 JSON body is exact', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toContain('{"error":"GatewayTimeout","message":"Service timed out","status":504}')
    })

    it('each location block contains its own default_type application/json', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      for (const code of ERROR_CODES) {
        // Extract location block and verify it has default_type
        const blockStart = result.indexOf(`location @json_${code} {`)
        const blockEnd = result.indexOf('\n}', blockStart)
        const block = result.slice(blockStart, blockEnd)
        expect(block).toContain('default_type application/json;')
      }
    })

    it('each location block contains a return directive with the correct status code', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      for (const code of ERROR_CODES) {
        const blockStart = result.indexOf(`location @json_${code} {`)
        const blockEnd = result.indexOf('\n}', blockStart)
        const block = result.slice(blockStart, blockEnd)
        expect(block).toContain(`return ${code}`)
      }
    })

    it('error_page directives appear before location @json_* blocks in output', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      const errorPageIdx = result.indexOf('error_page 401 @json_401;')
      const locationIdx = result.indexOf('location @json_401 {')
      expect(errorPageIdx).toBeGreaterThan(-1)
      expect(locationIdx).toBeGreaterThan(-1)
      expect(errorPageIdx).toBeLessThan(locationIdx)
    })

    it('location @json_* blocks appear before include conf.d/*.conf in output', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      const lastLocationIdx = result.indexOf('location @json_504 {')
      const includeIdx = result.indexOf('include conf.d/*.conf;')
      expect(lastLocationIdx).toBeGreaterThan(-1)
      expect(includeIdx).toBeGreaterThan(-1)
      expect(lastLocationIdx).toBeLessThan(includeIdx)
    })
  })

  describe('indentation preservation', () => {
    it('4-space indent: error_page lines use same indent as listen line', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toMatch(/^    error_page 401 @json_401;$/m)
      expect(result).toMatch(/^    error_page 504 @json_504;$/m)
    })

    it('4-space indent: location @json_* lines use same indent as include line', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toMatch(/^    location @json_401 \{$/m)
      expect(result).toMatch(/^    location @json_504 \{$/m)
    })

    it('4-space indent: content inside location blocks uses 8-space indent', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL)
      expect(result).toMatch(/^        default_type application\/json;$/m)
      expect(result).toMatch(/^        return 401 '/m)
    })

    it('2-space indent: error_page lines use 2-space indent', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL_2SPACE)
      expect(result).toMatch(/^  error_page 401 @json_401;$/m)
    })

    it('2-space indent: location @json_* lines use 2-space indent', () => {
      const result = applyJsonErrorsToNginxConf(MINIMAL_2SPACE)
      expect(result).toMatch(/^  location @json_401 \{$/m)
    })
  })

  describe('edge cases', () => {
    it('with no listen directive, still inserts location @json_* blocks before include conf.d', () => {
      const input = 'server {\n    include conf.d/*.conf;\n}'
      const result = applyJsonErrorsToNginxConf(input)
      expect(result).toContain('location @json_401 {')
      expect(result).toContain('include conf.d/*.conf;')
      expect(result).not.toContain('error_page 401')
    })

    it('with no include conf.d directive, still inserts error_page directives after listen', () => {
      const input = 'server {\n    listen 80;\n}'
      const result = applyJsonErrorsToNginxConf(input)
      expect(result).toContain('error_page 401 @json_401;')
      expect(result).toContain('default_type application/json;')
      expect(result).not.toContain('location @json_401')
    })

    it('returns empty string unchanged', () => {
      const result = applyJsonErrorsToNginxConf('')
      expect(result).toBe('')
    })

    it('transforms a full realistic nginx.conf with nested blocks correctly', () => {
      const result = applyJsonErrorsToNginxConf(FULL_NGINX)
      expect(result).toContain('default_type application/json;')
      for (const code of ERROR_CODES) {
        expect(result).toContain(`error_page ${code} @json_${code};`)
        expect(result).toContain(`location @json_${code} {`)
      }
      expect(result).toContain('include conf.d/*.conf;')
      // Existing content preserved
      expect(result).toContain('worker_processes auto;')
      expect(result).toContain('location = /auth {')
      expect(result).toContain('location @rate_limited {')
    })

    it('does not insert directives into nested blocks (worker_connections untouched)', () => {
      const result = applyJsonErrorsToNginxConf(FULL_NGINX)
      // error_page should NOT appear inside the events block
      const eventsStart = result.indexOf('events {')
      const eventsEnd = result.indexOf('}', eventsStart)
      const eventsBlock = result.slice(eventsStart, eventsEnd)
      expect(eventsBlock).not.toContain('error_page')
    })
  })
})

// ─── applyJsonErrorTransformations ───────────────────────────────────────────

describe('applyJsonErrorTransformations', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sla-json-errors-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads nginx.conf from outDir and writes transformed content back', () => {
    fs.writeFileSync(path.join(tmpDir, 'nginx.conf'), MINIMAL, 'utf8')
    applyJsonErrorTransformations(tmpDir)
    const result = fs.readFileSync(path.join(tmpDir, 'nginx.conf'), 'utf8')
    expect(result).toContain('default_type application/json;')
    expect(result).toContain('error_page 401 @json_401;')
  })

  it('is a no-op and does not throw when nginx.conf does not exist', () => {
    expect(() => applyJsonErrorTransformations(tmpDir)).not.toThrow()
  })

  it('output contains all 7 error_page directives after transformation', () => {
    fs.writeFileSync(path.join(tmpDir, 'nginx.conf'), MINIMAL, 'utf8')
    applyJsonErrorTransformations(tmpDir)
    const result = fs.readFileSync(path.join(tmpDir, 'nginx.conf'), 'utf8')
    for (const code of ERROR_CODES) {
      expect(result).toContain(`error_page ${code} @json_${code};`)
    }
  })

  it('output contains all 7 location @json_* blocks after transformation', () => {
    fs.writeFileSync(path.join(tmpDir, 'nginx.conf'), MINIMAL, 'utf8')
    applyJsonErrorTransformations(tmpDir)
    const result = fs.readFileSync(path.join(tmpDir, 'nginx.conf'), 'utf8')
    for (const code of ERROR_CODES) {
      expect(result).toContain(`location @json_${code} {`)
    }
  })

  it('preserves other content in the file', () => {
    const input = [
      'user nginx;',
      '',
      'http {',
      '    server {',
      '        listen 80;',
      '        location = /auth { internal; }',
      '        include conf.d/*.conf;',
      '    }',
      '}',
    ].join('\n')
    fs.writeFileSync(path.join(tmpDir, 'nginx.conf'), input, 'utf8')
    applyJsonErrorTransformations(tmpDir)
    const result = fs.readFileSync(path.join(tmpDir, 'nginx.conf'), 'utf8')
    expect(result).toContain('user nginx;')
    expect(result).toContain('location = /auth { internal; }')
  })

  it('does not modify conf.d files (error handling is server-level only)', () => {
    fs.mkdirSync(path.join(tmpDir, 'conf.d'))
    const confContent = 'limit_req_zone $apikey zone=test:10m rate=5r/m;'
    fs.writeFileSync(path.join(tmpDir, 'conf.d', 'test.conf'), confContent, 'utf8')
    fs.writeFileSync(path.join(tmpDir, 'nginx.conf'), MINIMAL, 'utf8')
    applyJsonErrorTransformations(tmpDir)
    const confResult = fs.readFileSync(path.join(tmpDir, 'conf.d', 'test.conf'), 'utf8')
    expect(confResult).toBe(confContent)
  })
})
