import * as assert from 'node:assert';
import {
  getConfidenceLevel,
} from '../../src/utils/rating-algorithms';

suite('Rating Algorithms', () => {
  suite('getConfidenceLevel()', () => {
    test('should return low for fewer than 5 votes', () => {
      assert.strictEqual(getConfidenceLevel(0), 'low');
      assert.strictEqual(getConfidenceLevel(4), 'low');
    });

    test('should return medium for 5-19 votes', () => {
      assert.strictEqual(getConfidenceLevel(5), 'medium');
      assert.strictEqual(getConfidenceLevel(19), 'medium');
    });

    test('should return high for 20-99 votes', () => {
      assert.strictEqual(getConfidenceLevel(20), 'high');
      assert.strictEqual(getConfidenceLevel(99), 'high');
    });

    test('should return very_high for 100+ votes', () => {
      assert.strictEqual(getConfidenceLevel(100), 'very_high');
      assert.strictEqual(getConfidenceLevel(1000), 'very_high');
    });
  });
});
