/**
 * Slice 1's placement fixture.
 *
 * The legacy fixture covers prompts and instructions only. This one carries
 * the three cases slice 1's placement claims rest on:
 *
 *  - an id that differs from its filename stem (`reviewer` declared for
 *    `agents/code-reviewer.agent.md`), the only case where manifest-driven
 *    naming is observable;
 *  - a path-prefix/manifest-kind mismatch (`prompts/typescript-standards
 *    .instructions.md` typed `instructions`), which prefix routing would
 *    place in `prompts/` and manifest routing places in `instructions/`;
 *  - a `README.md` the layout's skipPaths must keep out of the target.
 */
import type {
  ExtractedFiles,
} from '@ai-primitives-hub/core';
import {
  dump as dumpYaml,
} from 'js-yaml';

const bytes = (content: string): Uint8Array => new TextEncoder().encode(content);

export const createSlice1Bundle = (
  options: { id?: string; version?: string } = {}
): ExtractedFiles => {
  const id = options.id ?? 'web-dev';
  const version = options.version ?? '1.0.0';
  const manifest = {
    id,
    version,
    name: 'Web Dev',
    prompts: [
      { id: 'hello', file: 'prompts/hello.prompt.md', type: 'prompt' },
      { id: 'ts-standards', file: 'prompts/typescript-standards.instructions.md', type: 'instructions' },
      { id: 'reviewer', file: 'agents/code-reviewer.agent.md', type: 'agent' }
    ]
  };

  return new Map([
    ['deployment-manifest.yml', bytes(dumpYaml(manifest))],
    ['prompts/hello.prompt.md', bytes('# Hello\n')],
    ['prompts/typescript-standards.instructions.md', bytes('# TS Standards\n')],
    ['agents/code-reviewer.agent.md', bytes('# Reviewer\n')],
    ['README.md', bytes('# Not installed\n')]
  ]);
};
