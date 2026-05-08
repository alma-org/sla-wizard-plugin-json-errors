const fs = require('fs');
const path = require('path');

// All error codes this plugin handles. 403 is intentionally included:
//   - server-level error_page 403 @json_403 handles the "invalid API key" if-block case
//   - location-level error_page 403 =429 @rate_limited (set by auth-request plugin)
//     overrides the server-level directive inside location blocks, so rate-limited
//     requests still get the correct 429 JSON body from @rate_limited. No conflict.
const ERROR_CODES = [
  { code: 401, error: 'Unauthorized',        message: 'API key required'                  },
  { code: 403, error: 'Forbidden',           message: 'Invalid API key or Forbidden access'                   },
  { code: 404, error: 'NotFound',            message: 'Endpoint not found'                },
  { code: 500, error: 'InternalServerError', message: 'An internal error occurred'        },
  { code: 502, error: 'BadGateway',          message: 'Bad gateway'       },
  { code: 503, error: 'ServiceUnavailable',  message: 'Service unavailable'   },
  { code: 504, error: 'GatewayTimeout',      message: 'Service timed out'         },
];

/**
 * Transforms nginx.conf to return JSON for all standard HTTP errors.
 *
 * Two changes applied to the server block:
 *
 * 1. After the `listen` directive: insert `default_type application/json` and
 *    one `error_page` directive per handled status code. nginx will intercept
 *    any matching response (including inline `return 401/403` from if-blocks)
 *    and serve the corresponding named location.
 *
 * 2. Before `include conf.d/*.conf;`: insert one `location @json_<code>` named
 *    location per handled status code, each returning a JSON body.
 *
 * @param {string} content - Content of nginx.conf
 * @returns {string} Transformed content
 */
function applyJsonErrorsToNginxConf(content) {
  // Insert default_type + error_page directives right after `listen <port>;`
  content = content.replace(
    /^([^\S\n]*)(listen\s+\d+;)/m,
    (_, indent, listenLine) => {
      const errorPageLines = ERROR_CODES.map(({ code }) => `${indent}error_page ${code} @json_${code};`);
      return [
        `${indent}${listenLine}`,
        `${indent}default_type application/json;`,
        ``,
        ...errorPageLines,
      ].join('\n');
    },
  );

  // Insert named @json_<code> location blocks before `include conf.d/*.conf;`
  content = content.replace(
    /^([^\S\n]*)(include\s+conf\.d\/\*\.conf;)/m,
    (_, indent, includeLine) => {
      const i  = indent;
      const i4 = indent + '    ';

      const locationBlocks = ERROR_CODES.flatMap(({ code, error, message }) => [
        `${i}location @json_${code} {`,
        `${i4}default_type application/json;`,
        `${i4}return ${code} '{"error":"${error}","message":"${message}","status":${code}}';`,
        `${i}}`,
        ``,
      ]);

      return [...locationBlocks, `${i}${includeLine}`].join('\n');
    },
  );

  return content;
}

/**
 * Applies JSON error transformations to nginx.conf in outDir.
 * conf.d files are not modified — error_page is a server-level concern.
 *
 * @param {string} outDir - Output directory containing nginx.conf
 */
function applyJsonErrorTransformations(outDir) {
  const nginxConfPath = path.join(outDir, 'nginx.conf');
  if (!fs.existsSync(nginxConfPath)) return;

  fs.writeFileSync(
    nginxConfPath,
    applyJsonErrorsToNginxConf(fs.readFileSync(nginxConfPath, 'utf8')),
  );
}

module.exports = { applyJsonErrorsToNginxConf, applyJsonErrorTransformations };
