'use strict';

const { execSync } = require('child_process');

// Get version from git tags (priority order):
// 1. APP_VERSION environment variable (can be set from git tags during deployment)
// 2. Git tag via git describe (if in a git repository)
// 3. package.json version (fallback)
let appVersion = process.env.APP_VERSION;

if (!appVersion) {
  try {
    // Try to get version from git tags
    const gitTag = execSync('git describe --tags --always --dirty', {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    appVersion = gitTag.replace(/^v/, ''); // Remove 'v' prefix if present
  } catch (e) {
    // Git command failed, try package.json
    try {
      const packageJson = require('./package.json');
      appVersion = packageJson.version || 'unknown';
    } catch (err) {
      appVersion = 'unknown';
    }
  }
}

/**
 * New Relic agent configuration.
 *
 * See lib/config/default.js in the agent distribution for a more complete
 * description of configuration variables and their defaults.
 */
exports.config = {
  /**
   * Array of application names.
   */
  app_name: [process.env.NEW_RELIC_APP_NAME || 'AI Tools Monitor'],
  /**
   * Your New Relic license key.
   */
  license_key: process.env.NEW_RELIC_LICENSE_KEY || '',
  /**
   * This setting controls distributed tracing.
   * Distributed tracing lets you see the path that a request takes through your
   * distributed system. Enabling distributed tracing changes the behavior of some
   * New Relic features, so carefully consult the transition guide before you enable
   * this feature: https://docs.newrelic.com/docs/transition-guide-distributed-tracing
   * Default is true.
   */
  distributed_tracing: {
    /**
     * Enables/disables distributed tracing.
     *
     * @env NEW_RELIC_DISTRIBUTED_TRACING_ENABLED
     */
    enabled: true,
  },
  /**
   * When true, all request headers except for those listed in attributes.exclude
   * will be captured for all traces, unless otherwise specified in a destination's
   * attributes include/exclude lists.
   */
  allow_all_headers: true,
  attributes: {
    /**
     * Prefix of attributes to exclude from all destinations. Allows * as wildcard
     * at end, and ; as a 'or' operator.
     */
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
      'request.headers.proxyAuthorization',
      'request.headers.setCookie*',
      'request.headers.x*',
      'response.headers.cookie',
      'response.headers.authorization',
      'response.headers.proxyAuthorization',
      'response.headers.setCookie*',
      'response.headers.x*',
    ],
  },
  /**
   * Enable logging for local development
   */
  logging: {
    level: process.env.NEW_RELIC_LOG_LEVEL || 'info',
    filepath: process.env.NEW_RELIC_LOG_FILE || 'stdout',
  },
  /**
   * Enable application logging forwarding to New Relic
   */
  application_logging: {
    enabled: true,
    forwarding: {
      enabled: true,
      max_samples_stored: 10000,
    },
    local_decorating: {
      enabled: true,
    },
  },
  /**
   * Labels allow you to add custom metadata to your application in New Relic.
   * These labels appear in the New Relic UI and can be used for filtering and grouping.
   * 
   * Version detection priority:
   * 1. APP_VERSION environment variable (set from git tags during deployment)
   * 2. Git tag via 'git describe --tags --always' (automatic if in git repo)
   * 3. package.json version (fallback)
   * 
   * @env APP_VERSION - Application version from git tags (e.g., APP_VERSION=$(git describe --tags --always))
   */
  labels: {
    version: appVersion,
    environment: process.env.NODE_ENV || 'development',
  },
};


