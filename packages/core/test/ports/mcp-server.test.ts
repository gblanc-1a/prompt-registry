/**
 * Tests for MCP server port interface.
 * @module test/ports/mcp-server
 */

import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  McpServer,
  McpTool,
} from '../../src/ports/mcp-server';

describe('MCP Server Port Interface', () => {
  describe('McpServer', () => {
    it('should define start method', () => {
      const server: McpServer = {
        start: vi.fn(),
        stop: vi.fn(),
        registerTool: vi.fn()
      };

      expect(server).toHaveProperty('start');
      expect(typeof server.start).toBe('function');
    });

    it('should define stop method', () => {
      const server: McpServer = {
        start: vi.fn(),
        stop: vi.fn(),
        registerTool: vi.fn()
      };

      expect(server).toHaveProperty('stop');
      expect(typeof server.stop).toBe('function');
    });

    it('should define registerTool method', () => {
      const server: McpServer = {
        start: vi.fn(),
        stop: vi.fn(),
        registerTool: vi.fn()
      };

      expect(server).toHaveProperty('registerTool');
      expect(typeof server.registerTool).toBe('function');
    });
  });

  describe('McpTool', () => {
    it('should accept tool with all properties', () => {
      const tool: McpTool = {
        name: 'search_resources',
        description: 'Search for resources',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          }
        },
        handler: vi.fn()
      };

      expect(tool.name).toBe('search_resources');
      expect(tool.description).toBe('Search for resources');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it('should accept tool handler function', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'success' });
      const tool: McpTool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {},
        handler
      };

      const result = await tool.handler({ input: 'test' });
      expect(result).toEqual({ result: 'success' });
      expect(handler).toHaveBeenCalledWith({ input: 'test' });
    });

    it('should accept complex input schema', () => {
      const tool: McpTool = {
        name: 'complex_tool',
        description: 'Tool with complex schema',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            type: { type: 'string', enum: ['profile', 'bundle', 'primitive'] },
            context: {
              type: 'object',
              properties: {
                techStack: { type: 'array', items: { type: 'string' } }
              }
            }
          },
          required: ['query']
        },
        handler: vi.fn()
      };

      expect(tool.inputSchema).toHaveProperty('type');
      expect(tool.inputSchema).toHaveProperty('properties');
    });

    it('should accept tool with empty input schema', () => {
      const tool: McpTool = {
        name: 'simple_tool',
        description: 'Simple tool',
        inputSchema: {},
        handler: vi.fn()
      };

      expect(tool.inputSchema).toEqual({});
    });

    it('should accept tool name with special characters', () => {
      const tool: McpTool = {
        name: 'search_resources_v2',
        description: 'Search tool v2',
        inputSchema: {},
        handler: vi.fn()
      };

      expect(tool.name).toBe('search_resources_v2');
    });

    it('should accept long description', () => {
      const longDesc = 'a'.repeat(1000);
      const tool: McpTool = {
        name: 'test_tool',
        description: longDesc,
        inputSchema: {},
        handler: vi.fn()
      };

      expect(tool.description).toBe(longDesc);
    });

    it('should accept handler that throws error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Tool error'));
      const tool: McpTool = {
        name: 'failing_tool',
        description: 'Tool that fails',
        inputSchema: {},
        handler
      };

      await expect(tool.handler({ input: 'test' })).rejects.toThrow('Tool error');
    });
  });

  describe('McpServer edge cases', () => {
    it('should handle start method returning Promise', async () => {
      const startMock = vi.fn().mockResolvedValue(undefined);
      const server: McpServer = {
        start: startMock,
        stop: vi.fn(),
        registerTool: vi.fn()
      };

      await server.start();
      expect(startMock).toHaveBeenCalled();
    });

    it('should handle stop method returning Promise', async () => {
      const stopMock = vi.fn().mockResolvedValue(undefined);
      const server: McpServer = {
        start: vi.fn(),
        stop: stopMock,
        registerTool: vi.fn()
      };

      await server.stop();
      expect(stopMock).toHaveBeenCalled();
    });

    it('should handle registerTool method with tool', () => {
      const tool: McpTool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {},
        handler: vi.fn()
      };
      const registerMock = vi.fn();
      const server: McpServer = {
        start: vi.fn(),
        stop: vi.fn(),
        registerTool: registerMock
      };

      server.registerTool(tool);
      expect(registerMock).toHaveBeenCalledWith(tool);
    });
  });
});
