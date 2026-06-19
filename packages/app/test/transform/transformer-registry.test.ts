/**
 * Unit tests for TransformerRegistry.
 */
import { describe, it, expect } from 'vitest';
import { TransformerRegistry } from '../../src/transform/transformer-registry';
import { NoOpTransformer } from '../../src/transform/transformers/noop-transformer';
import { KiroTransformer } from '../../src/transform/transformers/kiro-transformer';
import type { Target } from '@prompt-registry/core';

describe('TransformerRegistry', () => {
  it('should return NoOpTransformer for unknown target type', () => {
    const registry = new TransformerRegistry();
    const transformer = registry.getTransformer('vscode' as any);
    expect(transformer).toBeInstanceOf(NoOpTransformer);
  });

  it('should return registered transformer for known target type', () => {
    const customTransformer = new NoOpTransformer();
    const registry = new TransformerRegistry({ vscode: customTransformer });
    const transformer = registry.getTransformer('vscode' as any);
    expect(transformer).toBe(customTransformer);
  });

  it('should allow registering transformers', () => {
    const registry = new TransformerRegistry();
    const customTransformer = new NoOpTransformer();
    registry.register('windsurf' as any, customTransformer);
    const transformer = registry.getTransformer('windsurf' as any);
    expect(transformer).toBe(customTransformer);
  });

  it('should create registry with built-in transformers', () => {
    const registry = TransformerRegistry.withBuiltIns();
    const kiroTransformer = registry.getTransformer('kiro');
    expect(kiroTransformer).toBeInstanceOf(KiroTransformer);
  });

  it('should return NoOpTransformer for unregistered built-in target', () => {
    const registry = TransformerRegistry.withBuiltIns();
    const transformer = registry.getTransformer('vscode');
    expect(transformer).toBeInstanceOf(NoOpTransformer);
  });
});
