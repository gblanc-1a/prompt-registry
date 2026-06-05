/**
 * Domain Layer — Primitive types.
 *
 * Core primitive data shapes used across all features (indexing, search,
 * validation). Feature layers depend on these types; these types have no
 * feature-layer dependencies.
 * @module domain/primitive
 */

import type {
  BundleRef,
} from '../bundle/types';

export type PrimitiveKind =
  | 'prompt'
  | 'instruction'
  | 'chat-mode'
  | 'agent'
  | 'skill'
  | 'plugin'
  | 'hook'
  | 'mcp-server';

export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = [
  'prompt',
  'instruction',
  'chat-mode',
  'agent',
  'skill',
  'plugin',
  'hook',
  'mcp-server'
] as const;

export interface Primitive {
  id: string;
  bundle: BundleRef;
  kind: PrimitiveKind;
  path: string;
  title: string;
  description: string;
  tags: string[];
  authors?: string[];
  applyTo?: string;
  tools?: string[];
  model?: string;
  bodyPreview: string;
  contentHash: string;
  rating?: number;
  updatedAt?: string;
}
