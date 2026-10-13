import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ControllerBackend } from './controller-backend';
import { GAMEPAD_TOOL_DEFINITIONS, executeGamepadTool } from './gamepad-skill';

export function createGamepadMcpServer(backend?: ControllerBackend): Server {
  const controller = backend || new ControllerBackend();

  const server = new Server(
    {
      name: 'virtual-gamepad-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List all 6 zero-prior atomic gamepad tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: GAMEPAD_TOOL_DEFINITIONS.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
      })),
    };
  });

  // Execute tool call
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params;
    const result = await executeGamepadTool(name, args || {}, controller);

    if (!result.ok) {
      throw new McpError(ErrorCode.InvalidParams, result.message);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: result.message,
              state: result.state,
            },
            null,
            2
          ),
        },
      ],
    };
  });

  return server;
}

// Standalone runner if executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('gamepad-mcp-server.ts')) {
  const server = createGamepadMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error('[VirtualGamepad-MCP] Server listening over stdio...');
  }).catch(err => {
    console.error('[VirtualGamepad-MCP] Failed to start server:', err);
    process.exit(1);
  });
}
