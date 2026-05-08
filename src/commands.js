const authRequestRatelimit = require('sla-wizard-plugin-auth-request-ratelimit');
const { applyJsonErrorTransformations } = require('./nginx-transform');

/**
 * Full config generation with JSON errors + auth_request rate limiting.
 * Delegates the full generation chain to sla-wizard-plugin-auth-request-ratelimit
 * (which itself chains through custom-baseurl → nginx-strip → nginx-confd),
 * then post-processes nginx.conf to replace HTML error responses with JSON.
 *
 * @param {Object} options - Command options (outDir, oas, sla, …)
 * @param {Object} ctx     - sla-wizard context
 */
function configNginxJsonErrors(options, ctx) {
  authRequestRatelimit.configNginxAuthRequest(options, ctx);
  applyJsonErrorTransformations(options.outDir);
  console.log('✓ JSON error response transformations applied');
}

/**
 * conf.d-only generation with auth_request rate limiting.
 * JSON error directives live in nginx.conf (server-level error_page) so
 * no additional transform is needed for conf.d-only updates.
 *
 * @param {Object} options - Command options (outDir, oas, sla, …)
 * @param {Object} ctx     - sla-wizard context
 */
function addToJsonErrorsConfd(options, ctx) {
  authRequestRatelimit.addToAuthRequestConfd(options, ctx);
}

module.exports = { configNginxJsonErrors, addToJsonErrorsConfd };
