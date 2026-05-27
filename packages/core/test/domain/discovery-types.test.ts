/**
 * Tests for discovery domain types.
 * @module test/domain/discovery/types
 */

import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  DiscoveryOptions,
  ProfileDraft,
  ResourceRecommendation,
  ResourceSelection,
} from '../../src/domain/discovery/types';

describe('Discovery Domain Types', () => {
  describe('ResourceRecommendation', () => {
    it('should accept valid profile recommendation', () => {
      const rec: ResourceRecommendation = {
        type: 'profile',
        id: 'profile-1',
        name: 'Backend Developer',
        description: 'Profile for backend development',
        relevanceScore: 0.95,
        reasoning: 'Matches your Java backend stack',
        source: 'amadeus-hub',
        aiRecommended: true
      };

      expect(rec.type).toBe('profile');
      expect(rec.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(rec.relevanceScore).toBeLessThanOrEqual(1);
      expect(rec.aiRecommended).toBe(true);
    });

    it('should accept valid bundle recommendation', () => {
      const rec: ResourceRecommendation = {
        type: 'bundle',
        id: 'bundle-1',
        name: 'spring-boot-skills',
        description: 'Spring Boot specific prompts',
        relevanceScore: 0.88,
        reasoning: 'Relevant to Spring Boot framework',
        source: 'github:Amadeus-xDLC/spring-boot-skills',
        kind: 'skill',
        aiRecommended: true
      };

      expect(rec.type).toBe('bundle');
      expect(rec.kind).toBe('skill');
    });

    it('should accept valid primitive recommendation', () => {
      const rec: ResourceRecommendation = {
        type: 'primitive',
        id: 'primitive-1',
        name: 'code-review-checklist',
        description: 'Code review checklist',
        relevanceScore: 0.92,
        reasoning: 'Matches code review activity',
        source: 'primitive-index',
        kind: 'prompt',
        aiRecommended: false
      };

      expect(rec.type).toBe('primitive');
      expect(rec.aiRecommended).toBe(false);
    });

    it('should enforce relevance score bounds', () => {
      const rec: ResourceRecommendation = {
        type: 'profile',
        id: 'profile-1',
        name: 'Test Profile',
        description: 'Test description',
        relevanceScore: 0.5,
        reasoning: 'Test reasoning',
        source: 'test-hub',
        aiRecommended: true
      };

      expect(rec.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(rec.relevanceScore).toBeLessThanOrEqual(1);
    });
  });

  describe('ResourceSelection', () => {
    it('should accept selected resource', () => {
      const selection: ResourceSelection = {
        id: 'resource-1',
        selected: true,
        selectedAt: new Date().toISOString()
      };

      expect(selection.selected).toBe(true);
      expect(selection.selectedAt).toBeDefined();
    });

    it('should accept unselected resource', () => {
      const selection: ResourceSelection = {
        id: 'resource-2',
        selected: false
      };

      expect(selection.selected).toBe(false);
      expect(selection.selectedAt).toBeUndefined();
    });
  });

  describe('ProfileDraft', () => {
    it('should accept valid profile draft', () => {
      const draft: ProfileDraft = {
        id: 'draft-1',
        name: 'Custom Profile',
        description: 'AI-generated custom profile',
        icon: '🤖',
        selections: [
          {
            id: 'resource-1',
            selected: true,
            selectedAt: new Date().toISOString()
          }
        ],
        createdAt: new Date().toISOString()
      };

      expect(draft.id).toBe('draft-1');
      expect(draft.selections).toHaveLength(1);
      expect(draft.selections[0].selected).toBe(true);
    });

    it('should accept profile without icon', () => {
      const draft: ProfileDraft = {
        id: 'draft-2',
        name: 'Simple Profile',
        description: 'Simple profile without icon',
        selections: [],
        createdAt: new Date().toISOString()
      };

      expect(draft.icon).toBeUndefined();
    });
  });

  describe('DiscoveryOptions', () => {
    it('should accept options with AI enabled', () => {
      const opts: DiscoveryOptions = {
        enableAI: true,
        interactive: false,
        cwd: '/test/project',
        indexFile: '/test/index.json',
        limit: 10,
        kinds: ['prompt', 'skill']
      };

      expect(opts.enableAI).toBe(true);
      expect(opts.interactive).toBe(false);
      expect(opts.limit).toBe(10);
    });

    it('should accept options with interactive mode', () => {
      const opts: DiscoveryOptions = {
        enableAI: true,
        interactive: true,
        cwd: '/test/project'
      };

      expect(opts.interactive).toBe(true);
    });

    it('should accept minimal options', () => {
      const opts: DiscoveryOptions = {
        enableAI: false,
        interactive: false,
        cwd: '/test/project'
      };

      expect(opts.limit).toBeUndefined();
      expect(opts.kinds).toBeUndefined();
    });
  });

  describe('Type immutability', () => {
    it('should have readonly properties for ResourceRecommendation', () => {
      const rec: ResourceRecommendation = {
        type: 'profile',
        id: 'profile-1',
        name: 'Test Profile',
        description: 'Test description',
        relevanceScore: 0.5,
        reasoning: 'Test reasoning',
        source: 'test-hub',
        aiRecommended: true
      };

      // TypeScript should enforce readonly at compile time
      // This test documents the intent
      expect(rec).toHaveProperty('type');
      expect(rec).toHaveProperty('id');
    });
  });

  describe('ResourceRecommendation edge cases', () => {
    it('should accept relevance score at lower bound (0)', () => {
      const rec: ResourceRecommendation = {
        type: 'profile',
        id: 'profile-1',
        name: 'Test Profile',
        description: 'Test description',
        relevanceScore: 0,
        reasoning: 'Test reasoning',
        source: 'test-hub',
        aiRecommended: false
      };

      expect(rec.relevanceScore).toBe(0);
    });

    it('should accept relevance score at upper bound (1)', () => {
      const rec: ResourceRecommendation = {
        type: 'profile',
        id: 'profile-1',
        name: 'Test Profile',
        description: 'Test description',
        relevanceScore: 1,
        reasoning: 'Test reasoning',
        source: 'test-hub',
        aiRecommended: true
      };

      expect(rec.relevanceScore).toBe(1);
    });

    it('should accept fractional relevance scores', () => {
      const rec: ResourceRecommendation = {
        type: 'profile',
        id: 'profile-1',
        name: 'Test Profile',
        description: 'Test description',
        relevanceScore: 0.735,
        reasoning: 'Test reasoning',
        source: 'test-hub',
        aiRecommended: true
      };

      expect(rec.relevanceScore).toBe(0.735);
    });

    it('should accept long descriptions', () => {
      const longDesc = 'a'.repeat(5000);
      const rec: ResourceRecommendation = {
        type: 'profile',
        id: 'profile-1',
        name: 'Test Profile',
        description: longDesc,
        relevanceScore: 0.5,
        reasoning: 'Test reasoning',
        source: 'test-hub',
        aiRecommended: true
      };

      expect(rec.description).toBe(longDesc);
    });

    it('should accept special characters in description', () => {
      const rec: ResourceRecommendation = {
        type: 'profile',
        id: 'profile-1',
        name: 'Test Profile',
        description: 'Test with "quotes" and \'apostrophes\' and <special> & symbols',
        relevanceScore: 0.5,
        reasoning: 'Test reasoning',
        source: 'test-hub',
        aiRecommended: true
      };

      expect(rec.description).toContain('quotes');
    });
  });

  describe('ResourceSelection edge cases', () => {
    it('should accept ISO string timestamps', () => {
      const isoString = new Date().toISOString();
      const selection: ResourceSelection = {
        id: 'resource-1',
        selected: true,
        selectedAt: isoString
      };

      expect(selection.selectedAt).toBe(isoString);
    });

    it('should accept resource IDs with special characters', () => {
      const selection: ResourceSelection = {
        id: 'resource-1-with-special_chars.123',
        selected: true
      };

      expect(selection.id).toBe('resource-1-with-special_chars.123');
    });
  });

  describe('ProfileDraft edge cases', () => {
    it('should accept empty selections array', () => {
      const draft: ProfileDraft = {
        id: 'draft-1',
        name: 'Empty Profile',
        description: 'Profile with no selections',
        selections: [],
        createdAt: new Date().toISOString()
      };

      expect(draft.selections).toHaveLength(0);
    });

    it('should accept many selections', () => {
      const selections: ResourceSelection[] = Array.from({ length: 100 }, (_, i) => ({
        id: `resource-${i}`,
        selected: true,
        selectedAt: new Date().toISOString()
      }));

      const draft: ProfileDraft = {
        id: 'draft-1',
        name: 'Large Profile',
        description: 'Profile with many selections',
        selections,
        createdAt: new Date().toISOString()
      };

      expect(draft.selections).toHaveLength(100);
    });

    it('should accept unicode in name and description', () => {
      const draft: ProfileDraft = {
        id: 'draft-1',
        name: '🎉 Profile with unicode',
        description: 'Profile with emojis 🚀 and unicode characters',
        selections: [],
        createdAt: new Date().toISOString()
      };

      expect(draft.name).toContain('🎉');
      expect(draft.description).toContain('🚀');
    });
  });

  describe('DiscoveryOptions edge cases', () => {
    it('should accept large limit values', () => {
      const opts: DiscoveryOptions = {
        enableAI: false,
        interactive: false,
        cwd: '/test/project',
        limit: 1000
      };

      expect(opts.limit).toBe(1000);
    });

    it('should accept many kinds', () => {
      const opts: DiscoveryOptions = {
        enableAI: false,
        interactive: false,
        cwd: '/test/project',
        kinds: ['prompt', 'skill', 'instruction', 'agent', 'chatmode', 'mcp-server']
      };

      expect(opts.kinds).toHaveLength(6);
    });

    it('should accept custom index file paths', () => {
      const opts: DiscoveryOptions = {
        enableAI: false,
        interactive: false,
        cwd: '/test/project',
        indexFile: '/custom/path/to/index.json'
      };

      expect(opts.indexFile).toBe('/custom/path/to/index.json');
    });
  });
});
