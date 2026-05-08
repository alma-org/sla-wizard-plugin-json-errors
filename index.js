const { DEFAULT_TELEMETER_URL } = require('sla-wizard-plugin-auth-request-ratelimit');
const { configNginxJsonErrors, addToJsonErrorsConfd } = require('./src/commands');
const { applyJsonErrorsToNginxConf, applyJsonErrorTransformations } = require('./src/nginx-transform');

/**
 * Plugin that converts all nginx HTML error responses to JSON.
 *
 * Sits at the top of the sla-wizard plugin chain:
 *   configNginxJsonErrors
 *     → sla-wizard-plugin-auth-request-ratelimit (configNginxAuthRequest)
 *       → sla-wizard-plugin-custom-baseurl (configNginxBaseUrl)
 *         → sla-wizard-plugin-nginx-strip (configNginxStrip)
 *           → sla-wizard-nginx-confd (configNginxConfd)
 *
 * nginx.conf changes applied (server block):
 *   - default_type application/json  (fallback content type)
 *   - error_page 401/403/404/500/502/503/504 → named locations
 *   - location @json_<code> blocks returning JSON bodies
 *
 * Interaction with auth-request plugin:
 *   - server-level error_page 403 @json_403 handles invalid-API-key if-block
 *   - location-level error_page 403 =429 @rate_limited (set by auth-request)
 *     overrides the server directive inside location blocks → rate-limit 429
 *     responses are unaffected
 *
 * @param {Object} program - Commander program instance
 * @param {Object} ctx     - sla-wizard context
 */
function apply(program, ctx) {
  program
    .command('config-nginx-json-errors')
    .description(
      'Generate nginx config with JSON error responses and auth_request rate limiting',
    )
    .requiredOption('-o, --outDir <outputDirectory>', 'Output directory for nginx.conf and conf.d/')
    .option('--sla <slaPath>', 'Single SLA, folder of SLAs, or URL', './specs/sla.yaml')
    .option('--oas <pathToOAS>', 'Path to an OAS v3 file', './specs/oas.yaml')
    .option('--customTemplate <customTemplate>', 'Custom proxy configuration template')
    .option('--authLocation <authLocation>', 'Auth parameter location: header, query, url', 'header')
    .option('--authName <authName>', 'Auth parameter name', 'apikey')
    .option('--proxyPort <proxyPort>', 'Port the proxy listens on', 80)
    .option('--telemeterUrl <url>', 'alma-telemeter rate-limit endpoint URL', DEFAULT_TELEMETER_URL)
    .action((options) => configNginxJsonErrors(options, ctx));

  program
    .command('add-to-json-errors-confd')
    .description(
      'Generate conf.d files with auth_request rate limiting (JSON error pages already in nginx.conf)',
    )
    .requiredOption('-o, --outDir <outputDirectory>', 'Output directory for conf.d/')
    .option('--sla <slaPath>', 'Single SLA, folder of SLAs, or URL', './specs/sla.yaml')
    .option('--oas <pathToOAS>', 'Path to an OAS v3 file', './specs/oas.yaml')
    .option('--customTemplate <customTemplate>', 'Custom proxy configuration template')
    .option('--authLocation <authLocation>', 'Auth parameter location: header, query, url', 'header')
    .option('--authName <authName>', 'Auth parameter name', 'apikey')
    .option('--proxyPort <proxyPort>', 'Port the proxy listens on', 80)
    .action((options) => addToJsonErrorsConfd(options, ctx));
}

module.exports = {
  apply,
  configNginxJsonErrors,
  addToJsonErrorsConfd,
  applyJsonErrorsToNginxConf,
  applyJsonErrorTransformations,
};
