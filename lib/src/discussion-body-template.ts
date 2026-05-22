/**
 * Bundle metadata parser for rating discussion bodies.
 *
 * Mirrors the parser in
 * `src/services/engagement/discussion-body-template.ts` from the extension
 * tree. The lib workspace has its own tsconfig and cannot import from `src/`,
 * so the parsing logic is duplicated here. Keep both in sync when the
 * metadata format changes.
 */

import * as yaml from 'js-yaml';

export const METADATA_MARKER = '<!-- prompt-registry:metadata -->';

/* eslint-disable @typescript-eslint/naming-convention -- snake_case matches YAML wire format */
/**
 * Parsed bundle metadata from a rating discussion body.
 */
export interface BundleMetadata {
  source_id: string;
  bundle_id: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Extract the bundle metadata block from a rating discussion body.
 * Returns undefined when the marker is absent, the YAML fence is missing,
 * the YAML is malformed, or the required fields are not non-empty strings.
 * @param body Raw markdown body of the discussion.
 */
export function parseBundleMetadata(body: string): BundleMetadata | undefined {
  const markerIdx = body.indexOf(METADATA_MARKER);
  if (markerIdx === -1) {
    return undefined;
  }
  const after = body.slice(markerIdx + METADATA_MARKER.length);
  const fenceMatch = after.match(/```yaml\s*\n([\s\S]*?)\n```/);
  if (!fenceMatch) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(fenceMatch[1]);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  const sourceId = obj.source_id;
  const bundleId = obj.bundle_id;
  if (
    typeof sourceId !== 'string'
    || typeof bundleId !== 'string'
    || sourceId.length === 0
    || bundleId.length === 0
  ) {
    return undefined;
  }
  return { source_id: sourceId, bundle_id: bundleId };
}
