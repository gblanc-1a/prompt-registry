/**
 * MCP server port interface.
 *
 * Abstract interface for Model Context Protocol server integration.
 * Infrastructure layer will provide concrete implementations.
 * @module ports/mcp-server
 */

/**
 * MCP tool definition.
 */
export interface McpTool {
  /** Tool name */
  readonly name: string;
  /** Tool description */
  readonly description: string;
  /** Input schema (JSON Schema) */
  readonly inputSchema: Record<string, unknown>;
  /** Tool handler function */
  readonly handler: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/**
 * MCP server interface.
 *
 * Abstract interface for MCP server implementation.
 * Concrete implementations will handle specific MCP protocol versions.
 */
export interface McpServer {
  /**
   * Start the MCP server.
   * @returns Promise that resolves when server is ready.
   */
  start(): Promise<void>;

  /**
   * Stop the MCP server.
   * @returns Promise that resolves when server is stopped.
   */
  stop(): Promise<void>;

  /**
   * Register a tool with the server.
   * @param tool - Tool definition.
   */
  registerTool(tool: McpTool): void;
}
