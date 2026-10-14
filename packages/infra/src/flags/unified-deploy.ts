/**
 * `unifiedDeploy` feature flag — CLI surface.
 *
 * Gates the shared `app/deploy` path during the bundle-lifecycle
 * cutover. Default off: with the flag off, `main` stays releasable and
 * no code reads or writes lockfile 3.0.0 state (design 2, 5.12).
 *
 * Parsing follows `parseGitHubAppAuthEnabled` exactly — same accepted
 * spellings, same throw on anything else — so the two CLI flags cannot
 * disagree about what "1" means. The extension's surface is the
 * `promptregistry.unifiedDeploy` setting and is wired in slice 5.
 * @module flags/unified-deploy
 */

/** Environment variable name for the CLI flag surface. */
export const UNIFIED_DEPLOY_ENABLED = 'AI_PRIMITIVES_HUB_UNIFIED_DEPLOY';

/**
 * Parse the flag from an env bag.
 * @param env - Environment variables (typically `ctx.env`).
 * @returns Whether the shared deploy path is enabled.
 * @throws {Error} When the variable is set to an unrecognized value.
 */
export function parseUnifiedDeployEnabled(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  const value = env[UNIFIED_DEPLOY_ENABLED];
  if (value === undefined || value.length === 0) {
    return false;
  }
  const normalized = value.toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  throw new Error(`Invalid ${UNIFIED_DEPLOY_ENABLED}: expected 1, true, yes, 0, false, or no.`);
}

/**
 * Return whether the shared deploy path is explicitly enabled.
 * @param env - Environment variables.
 */
export function isUnifiedDeployEnabled(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  return parseUnifiedDeployEnabled(env);
}
