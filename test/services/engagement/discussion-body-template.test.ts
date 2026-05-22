/**
 * Tests for the rating discussion title/body template module.
 * Verifies title formatting, body construction, and metadata parsing
 * round-trips between buildRatingDiscussionBody and parseBundleMetadata.
 */

import * as assert from 'node:assert';
import {
  buildRatingDiscussionBody,
  buildRatingDiscussionTitle,
  METADATA_MARKER,
  parseBundleMetadata,
  SCHEMA_VERSION,
} from '../../../src/services/engagement/discussion-body-template';

suite('discussion-body-template', () => {
  suite('buildRatingDiscussionTitle()', () => {
    test('formats as [rating] sourceId/bundleId', () => {
      const title = buildRatingDiscussionTitle('hub-source', 'awesome-bundle');
      assert.strictEqual(title, '[rating] hub-source/awesome-bundle');
    });
  });

  suite('buildRatingDiscussionBody()', () => {
    test('includes the display name, marker, and YAML metadata fields', () => {
      const body = buildRatingDiscussionBody({
        sourceId: 'hub-source',
        bundleId: 'awesome-bundle',
        displayName: 'Awesome Bundle'
      });

      assert.ok(body.includes('Awesome Bundle'), 'body should include display name');
      assert.ok(body.includes(METADATA_MARKER), 'body should include metadata marker');
      assert.ok(body.includes('bundle_id: awesome-bundle'), 'body should include bundle_id field');
      assert.ok(body.includes('source_id: hub-source'), 'body should include source_id field');
      assert.ok(
        body.includes(`schema_version: ${SCHEMA_VERSION}`),
        'body should include schema_version field'
      );
    });
  });

  suite('parseBundleMetadata()', () => {
    test('round-trips with buildRatingDiscussionBody', () => {
      const body = buildRatingDiscussionBody({
        sourceId: 'hub-source',
        bundleId: 'awesome-bundle',
        displayName: 'Awesome Bundle'
      });

      const parsed = parseBundleMetadata(body);
      assert.deepStrictEqual(parsed, {
        source_id: 'hub-source',
        bundle_id: 'awesome-bundle'
      });
    });

    test('returns undefined when marker is missing', () => {
      const body = '# Discussion\n\n```yaml\nsource_id: x\nbundle_id: y\n```\n';
      assert.strictEqual(parseBundleMetadata(body), undefined);
    });

    test('returns undefined when YAML inside the fence is malformed', () => {
      const body = `${METADATA_MARKER}\n\n\`\`\`yaml\nsource_id: : bad\n  - : :\n\`\`\`\n`;
      assert.strictEqual(parseBundleMetadata(body), undefined);
    });

    test('returns undefined when required fields are missing', () => {
      const body = `${METADATA_MARKER}\n\n\`\`\`yaml\nsource_id: hub-source\n\`\`\`\n`;
      assert.strictEqual(parseBundleMetadata(body), undefined);
    });

    test('returns undefined when required fields are not strings', () => {
      const body = `${METADATA_MARKER}\n\n\`\`\`yaml\nsource_id: hub-source\nbundle_id: 42\n\`\`\`\n`;
      assert.strictEqual(parseBundleMetadata(body), undefined);
    });

    test('returns undefined when YAML fence is missing after marker', () => {
      const body = `${METADATA_MARKER}\n\nNo fence here.\n`;
      assert.strictEqual(parseBundleMetadata(body), undefined);
    });

    test('returns undefined when source_id or bundle_id is an empty string', () => {
      const emptySource = `${METADATA_MARKER}\n\n\`\`\`yaml\nsource_id: ""\nbundle_id: bid\n\`\`\`\n`;
      assert.strictEqual(parseBundleMetadata(emptySource), undefined);

      const emptyBundle = `${METADATA_MARKER}\n\n\`\`\`yaml\nsource_id: sid\nbundle_id: ""\n\`\`\`\n`;
      assert.strictEqual(parseBundleMetadata(emptyBundle), undefined);
    });
  });
});
