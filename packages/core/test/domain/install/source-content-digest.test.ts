import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  sourceContentDigest,
} from '../../../src/domain/install/source-content-digest';
import type {
  ExtractedFiles,
} from '../../../src/ports/bundle-extractor';

const filesInOrder = (...paths: string[]): ExtractedFiles => new Map(
  paths.map((path) => [path, new TextEncoder().encode(path)] as const)
);

const binaryFiles = (value: number): ExtractedFiles => new Map([
  ['assets/icon.bin', new Uint8Array([0, value, 255])]
]);

describe('sourceContentDigest', () => {
  it('hashes raw inventory independently of insertion order', () => {
    expect(sourceContentDigest(filesInOrder('a', 'b')))
      .toBe(sourceContentDigest(filesInOrder('b', 'a')));
    expect(sourceContentDigest(binaryFiles(0)))
      .not.toBe(sourceContentDigest(binaryFiles(1)));
  });

  it('uses length-delimited UTF-8 paths and raw file bytes', () => {
    expect(sourceContentDigest(new Map([['a', new Uint8Array([1])]])))
      .toBe('47f5f508be805163353ea42ed45f1013f88cbc27de69ecbaec4d6d551f19ac3b');
  });

  it('sorts paths by UTF-8 byte order rather than UTF-16 string order', () => {
    expect(sourceContentDigest(new Map([
      ['\u{10000}', new TextEncoder().encode('A')],
      ['\uE000', new TextEncoder().encode('B')]
    ]))).toBe('f5877cfd0d4a1fe29d7851e74ee153109ef8532c5b878c6c36dfd90b03680c00');
  });

  it('preserves case-sensitive paths', () => {
    expect(sourceContentDigest(new Map([['Assets/icon.bin', new Uint8Array([1])]])))
      .not.toBe(sourceContentDigest(new Map([['assets/icon.bin', new Uint8Array([1])]])));
  });

  it('rejects absolute, traversing, or noncanonical POSIX paths', () => {
    for (const path of ['/absolute/file', '../escape', 'folder/../file', './file', 'folder//file', 'folder/', 'C:/file', 'folder\\file']) {
      expect(() => sourceContentDigest(new Map([[path, new Uint8Array([1])]])))
        .toThrow();
    }
  });
});
