/**
 * Tests for Copilot SDK port interface.
 * @module test/ports/copilot-sdk
 */

import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  CopilotSdk,
  CopilotSession,
  PermissionRequest,
  PermissionResponse,
  SessionOptions,
} from '../../src/ports/copilot-sdk';

describe('Copilot SDK Port Interface', () => {
  describe('CopilotSdk', () => {
    it('should define isAvailable method', () => {
      const sdk: CopilotSdk = {
        isAvailable: vi.fn(),
        createSession: vi.fn()
      };

      expect(sdk).toHaveProperty('isAvailable');
      expect(typeof sdk.isAvailable).toBe('function');
    });

    it('should define createSession method', () => {
      const sdk: CopilotSdk = {
        isAvailable: vi.fn(),
        createSession: vi.fn()
      };

      expect(sdk).toHaveProperty('createSession');
      expect(typeof sdk.createSession).toBe('function');
    });
  });

  describe('CopilotSession', () => {
    it('should define sendAndWait method', () => {
      const session: CopilotSession = {
        sendAndWait: vi.fn(),
        sendWithStream: vi.fn(),
        close: vi.fn()
      };

      expect(session).toHaveProperty('sendAndWait');
      expect(typeof session.sendAndWait).toBe('function');
    });

    it('should define sendWithStream method', () => {
      const session: CopilotSession = {
        sendAndWait: vi.fn(),
        sendWithStream: vi.fn(),
        close: vi.fn()
      };

      expect(session).toHaveProperty('sendWithStream');
      expect(typeof session.sendWithStream).toBe('function');
    });

    it('should define close method', () => {
      const session: CopilotSession = {
        sendAndWait: vi.fn(),
        sendWithStream: vi.fn(),
        close: vi.fn()
      };

      expect(session).toHaveProperty('close');
      expect(typeof session.close).toBe('function');
    });
  });

  describe('SessionOptions', () => {
    it('should accept options with model', () => {
      const options: SessionOptions = {
        model: 'gpt-4',
        skillDirectories: ['/skills'],
        onPermissionRequest: vi.fn()
      };

      expect(options.model).toBe('gpt-4');
    });

    it('should accept options without model', () => {
      const options: SessionOptions = {
        skillDirectories: ['/skills'],
        onPermissionRequest: vi.fn()
      };

      expect(options.model).toBeUndefined();
    });

    it('should accept skill directories', () => {
      const options: SessionOptions = {
        skillDirectories: ['/skills', '/custom-skills'],
        onPermissionRequest: vi.fn()
      };

      expect(options.skillDirectories).toHaveLength(2);
    });

    it('should accept permission request handler', () => {
      const handler = vi.fn();
      const options: SessionOptions = {
        skillDirectories: ['/skills'],
        onPermissionRequest: handler
      };

      expect(options.onPermissionRequest).toBe(handler);
    });
  });

  describe('PermissionRequest', () => {
    it('should accept permission request', () => {
      const request: PermissionRequest = {
        kind: 'file-read'
      };

      expect(request.kind).toBe('file-read');
    });
  });

  describe('PermissionResponse', () => {
    it('should accept approved response', () => {
      const response: PermissionResponse = {
        kind: 'approved'
      };

      expect(response.kind).toBe('approved');
    });

    it('should accept denied response', () => {
      const response: PermissionResponse = {
        kind: 'denied'
      };

      expect(response.kind).toBe('denied');
    });
  });

  describe('SessionOptions edge cases', () => {
    it('should accept empty skill directories', () => {
      const options: SessionOptions = {
        skillDirectories: [],
        onPermissionRequest: vi.fn()
      };

      expect(options.skillDirectories).toHaveLength(0);
    });

    it('should accept many skill directories', () => {
      const skillDirs = Array.from({ length: 50 }, (_, i) => `/skills/skill-${i}`);
      const options: SessionOptions = {
        skillDirectories: skillDirs,
        onPermissionRequest: vi.fn()
      };

      expect(options.skillDirectories).toHaveLength(50);
    });

    it('should accept model with special characters', () => {
      const options: SessionOptions = {
        model: 'gpt-4-turbo-preview',
        skillDirectories: ['/skills'],
        onPermissionRequest: vi.fn()
      };

      expect(options.model).toBe('gpt-4-turbo-preview');
    });

    it('should accept permission handler that returns Promise', async () => {
      const handler = vi.fn().mockResolvedValue({ kind: 'approved' as const });
      const options: SessionOptions = {
        skillDirectories: ['/skills'],
        onPermissionRequest: handler
      };

      const response = await options.onPermissionRequest({ kind: 'file-read' });
      expect(response.kind).toBe('approved');
    });
  });

  describe('PermissionRequest edge cases', () => {
    it('should accept all permission kinds', () => {
      const kinds: PermissionRequest['kind'][] = [
        'file-read',
        'file-write',
        'network-request',
        'custom'
      ];

      for (const kind of kinds) {
        const request: PermissionRequest = { kind };
        expect(request.kind).toBe(kind);
      }
    });
  });
});
