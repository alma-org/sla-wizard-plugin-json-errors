#!/usr/bin/env node
/**
 * CLI wrapper for tests: loads sla-wizard, registers the json-errors plugin,
 * then delegates to sla-wizard's CLI runner.
 *
 * Usage: node cli-with-plugin.js <command> [options]
 */
const slaWizard = require('sla-wizard')
const plugin = require('../index.js')

slaWizard.use(plugin)

slaWizard.program.parse(process.argv)
