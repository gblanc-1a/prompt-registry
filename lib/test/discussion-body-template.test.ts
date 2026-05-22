import {
  strict as assert,
} from 'node:assert';
import {
  METADATA_MARKER,
  parseBundleMetadata,
} from '../src/discussion-body-template';

describe('lib/discussion-body-template', () => {
  describe('parseBundleMetadata', () => {
    it('parses a metadata block', () => {
      const body = `Hello\n\n${METADATA_MARKER}\n\`\`\`yaml\nbundle_id: b1\nsource_id: s1\n\`\`\`\n`;
      assert.deepStrictEqual(parseBundleMetadata(body), { source_id: 's1', bundle_id: 'b1' });
    });

    it('returns undefined when marker is missing', () => {
      assert.strictEqual(parseBundleMetadata('no marker'), undefined);
    });

    it('returns undefined when fenced yaml block is missing after marker', () => {
      assert.strictEqual(parseBundleMetadata(`${METADATA_MARKER}\n\nno fence here`), undefined);
    });

    it('returns undefined when YAML is malformed', () => {
      const body = `${METADATA_MARKER}\n\`\`\`yaml\n: : not-valid : :\n\`\`\``;
      assert.strictEqual(parseBundleMetadata(body), undefined);
    });

    it('returns undefined when required fields are missing', () => {
      const body = `${METADATA_MARKER}\n\`\`\`yaml\nfoo: bar\n\`\`\``;
      assert.strictEqual(parseBundleMetadata(body), undefined);
    });

    it('returns undefined when source_id or bundle_id is an empty string', () => {
      const emptySource = `${METADATA_MARKER}\n\`\`\`yaml\nsource_id: ""\nbundle_id: bid\n\`\`\``;
      assert.strictEqual(parseBundleMetadata(emptySource), undefined);

      const emptyBundle = `${METADATA_MARKER}\n\`\`\`yaml\nsource_id: sid\nbundle_id: ""\n\`\`\``;
      assert.strictEqual(parseBundleMetadata(emptyBundle), undefined);
    });
  });
});
