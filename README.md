# sla-wizard-plugin-json-errors

sla-wizard plugin that converts all nginx HTML error responses (401, 403, 404, 500, 502, 503, 504) to structured JSON.

## Overview

By default, nginx returns HTML bodies for HTTP errors. This plugin post-processes the generated `nginx.conf` to replace those with consistent JSON responses, making API error handling predictable for clients.

It sits at the top of the sla-wizard plugin chain:

```text
configNginxJsonErrors
  → sla-wizard-plugin-auth-request-ratelimit (configNginxAuthRequest)
    → sla-wizard-plugin-custom-baseurl (configNginxBaseUrl)
      → sla-wizard-plugin-nginx-strip (configNginxStrip)
        → sla-wizard-nginx-confd (configNginxConfd)
```

## What it does to `nginx.conf`

Two changes are applied to the server block:

**After the `listen` directive** — adds `default_type` and `error_page` redirects to named locations:

```nginx
listen 80;
default_type application/json;

error_page 401 @json_401;
error_page 403 @json_403;
error_page 404 @json_404;
error_page 500 @json_500;
error_page 502 @json_502;
error_page 503 @json_503;
error_page 504 @json_504;
```

**Before `include conf.d/*.conf;`** — adds named location blocks, one per error code:

```nginx
location @json_401 {
    default_type application/json;
    return 401 '{"error":"Unauthorized","message":"API key required","status":401}';
}

location @json_403 {
    default_type application/json;
    return 403 '{"error":"Forbidden","message":"Invalid API key or Forbidden access","status":403}';
}

# … one block per error code …

include conf.d/*.conf;
```

`conf.d` files are never modified — `error_page` is a server-level concern.

## JSON response format

| Code | `error`               | `message`                           |
|------|-----------------------|-------------------------------------|
| 401  | `Unauthorized`        | API key required                    |
| 403  | `Forbidden`           | Invalid API key or Forbidden access |
| 404  | `NotFound`            | Endpoint not found                  |
| 500  | `InternalServerError` | An internal error occurred          |
| 502  | `BadGateway`          | Bad gateway                         |
| 503  | `ServiceUnavailable`  | Service unavailable                 |
| 504  | `GatewayTimeout`      | Service timed out                   |

All responses follow the shape:

```json
{
  "error": "ErrorName",
  "message": "Human-readable description",
  "status": 404
}
```

## 403 / 429 interaction

When used with `sla-wizard-plugin-auth-request-ratelimit`:

- **Server-level** `error_page 403 @json_403` catches invalid API key responses from the `if`-block in the server context.
- **Location-level** `error_page 403 =429 @rate_limited` (set by the auth-request plugin) overrides the server directive inside location blocks, so rate-limited requests get the 429 JSON body from `@rate_limited` — not the 403 body. No conflict.

## Installation

```bash
npm install sla-wizard-plugin-json-errors
```

## CLI usage

Register the plugin with sla-wizard, then use either command.

### `config-nginx-json-errors`

Full generation: produces `nginx.conf` (with JSON error pages) and `conf.d/` (with rate-limit configs).

```bash
sla-wizard config-nginx-json-errors \
  -o ./output \
  --oas ./specs/oas.yaml \
  --sla ./specs/sla.yaml \
  --telemeterUrl http://alma-telemeter:2047/internal/rate-limit
```

### `add-to-json-errors-confd`

conf.d-only generation: updates `conf.d/` when `nginx.conf` already has the JSON error directives (e.g. the server block is managed separately).

```bash
sla-wizard add-to-json-errors-confd \
  -o ./output \
  --oas ./specs/oas.yaml \
  --sla ./specs/sla.yaml
```

### Options

| Option | Description | Default |
| ------ | ----------- | ------- |
| `-o, --outDir <path>` | Output directory for `nginx.conf` and `conf.d/` | *(required)* |
| `--sla <path>` | Single SLA file, folder of SLAs, or URL | `./specs/sla.yaml` |
| `--oas <path>` | Path to an OAS v3 file | `./specs/oas.yaml` |
| `--customTemplate <path>` | Custom proxy configuration template | — |
| `--authLocation <location>` | Auth parameter location: `header`, `query`, or `url` | `header` |
| `--authName <name>` | Auth parameter name | `apikey` |
| `--proxyPort <port>` | Port the proxy listens on | `80` |
| `--telemeterUrl <url>` | alma-telemeter rate-limit endpoint URL (`config-nginx-json-errors` only) | `$TELEMETER_URL` env var, or `http://127.0.0.1:2047/internal/rate-limit` |

## Programmatic usage

```js
const slaWizard = require('sla-wizard');
const plugin = require('sla-wizard-plugin-json-errors');

slaWizard.use(plugin);

// Full generation: nginx.conf + conf.d/
slaWizard.configNginxJsonErrors({
  outDir: './output',
  oas: './specs/oas.yaml',
  sla: './specs/sla.yaml',
  telemeterUrl: 'http://alma-telemeter:2047/internal/rate-limit', // optional
});

// conf.d-only generation
slaWizard.addToJsonErrorsConfd({
  outDir: './output',
  oas: './specs/oas.yaml',
  sla: './specs/sla.yaml',
});
```

### Low-level API

The transform functions are also exported directly for use without the full sla-wizard pipeline:

```js
const {
  applyJsonErrorsToNginxConf,   // (content: string) => string
  applyJsonErrorTransformations, // (outDir: string) => void
} = require('sla-wizard-plugin-json-errors');

// Transform a nginx.conf string in memory
const transformed = applyJsonErrorsToNginxConf(fs.readFileSync('nginx.conf', 'utf8'));

// Read, transform, and write nginx.conf in-place
applyJsonErrorTransformations('./output');
```

`applyJsonErrorTransformations` is a no-op if `nginx.conf` does not exist in `outDir`.

## Tests

```bash
npm test
```

Four test suites are included:

| File | Coverage |
| ---- | -------- |
| `tests/nginx-transform.test.js` | Unit tests for `applyJsonErrorsToNginxConf` and `applyJsonErrorTransformations` — indentation, ordering, edge cases |
| `tests/programmatic.test.js` | Integration tests for `configNginxJsonErrors` and `addToJsonErrorsConfd` using real OAS/SLA fixtures |
| `tests/cli.test.js` | CLI integration tests |
| `tests/container.test.js` | Container-level end-to-end tests (requires Docker) |

## License

GPL-3.0 — see [LICENSE](LICENSE).
