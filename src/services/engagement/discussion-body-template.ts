/**
 * Shared title format, body template, and metadata parser for
 * GitHub Discussion-backed bundle ratings.
 *
 * Both the extension's discussion-creation path and the lib `compute-ratings`
 * collector consume this module so titles and metadata stay in sync.
 */

import * as yaml from 'js-yaml';

/** HTML comment that anchors the YAML metadata block within a discussion body. */
export const METADATA_MARKER = '<!-- prompt-registry:metadata -->';

/** Schema version embedded in every discussion body's metadata block. */
export const SCHEMA_VERSION = 1;

/**
 * Build the canonical rating discussion title for a bundle.
 * @param sourceId Hub source identifier the bundle is published under.
 * @param bundleId Bundle identifier within the source.
 * @returns Title string in the form `[rating] {sourceId}/{bundleId}`.
 */
export function buildRatingDiscussionTitle(sourceId: string, bundleId: string): string {
  return `[rating] ${sourceId}/${bundleId}`;
}

/** Inputs required to render a rating discussion body. */
export interface BuildBodyInput {
  /** Hub source identifier the bundle is published under. */
  sourceId: string;
  /** Bundle identifier within the source. */
  bundleId: string;
  /** Human-readable bundle name shown in the discussion body header. */
  displayName: string;
}

/**
 * Build the markdown body for a rating discussion, including a fenced
 * YAML metadata block keyed by {@link METADATA_MARKER}.
 * @param input Bundle identification and display name.
 * @param input.sourceId Hub source identifier the bundle is published under.
 * @param input.bundleId Bundle identifier within the source.
 * @param input.displayName Human-readable bundle name shown in the body header.
 * @returns Markdown body suitable for posting as a GitHub Discussion.
 */
export function buildRatingDiscussionBody(input: BuildBodyInput): string {
  const { sourceId, bundleId, displayName } = input;

  const metadata = {
    bundle_id: bundleId,
    source_id: sourceId,
    display_name: displayName,
    created_by: 'prompt-registry',
    schema_version: SCHEMA_VERSION
  };

  const yamlBlock = yaml.dump(metadata).trimEnd();

  return [
    `# Ratings for ${displayName}`,
    '',
    'React with thumbs up or thumbs down to rate this bundle. Discussion comments are welcome for qualitative feedback.',
    '',
    METADATA_MARKER,
    '',
    '```yaml',
    yamlBlock,
    '```',
    ''
  ].join('\n');
}

/* eslint-disable @typescript-eslint/naming-convention -- snake_case matches YAML wire format */
/** Bundle identity extracted from a rating discussion body's metadata block. */
export interface BundleMetadata {
  /** Hub source identifier the bundle is published under. */
  source_id: string;
  /** Bundle identifier within the source. */
  bundle_id: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Parse the bundle metadata block from a rating discussion body.
 * Locates the metadata marker, then the first fenced YAML block after it.
 * @param body Full markdown body of the discussion.
 * @returns Bundle identity when both fields are non-empty strings, otherwise
 * `undefined` (covers missing marker, missing fence, malformed YAML, and
 * missing or non-string required fields).
 */
export function parseBundleMetadata(body: string): BundleMetadata | undefined {
  const markerIndex = body.indexOf(METADATA_MARKER);
  if (markerIndex === -1) {
    return undefined;
  }

  const afterMarker = body.slice(markerIndex + METADATA_MARKER.length);
  const fenceMatch = /```yaml\s*\n([\s\S]*?)\n```/.exec(afterMarker);
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

  /* eslint-disable @typescript-eslint/naming-convention -- snake_case matches YAML wire format */
  const { source_id, bundle_id } = parsed as { source_id?: unknown; bundle_id?: unknown };
  if (
    typeof source_id !== 'string'
    || typeof bundle_id !== 'string'
    || source_id.length === 0
    || bundle_id.length === 0
  ) {
    return undefined;
  }
  return { source_id, bundle_id };
  /* eslint-enable @typescript-eslint/naming-convention */
}
