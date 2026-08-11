import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerGenerateImageTool } from './tools/generate-image.js';
import { registerListModelsTool } from './tools/list-models.js';
import { registerChatTool, registerListChatModelsTool } from './tools/chat.js';

export async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: 'puter-mcp',
    version: '0.1.0',
  }, {
    capabilities: {
      tools: {},
      logging: {},
    }
  });

  // Register all tools
  registerGenerateImageTool(server);
  registerListModelsTool(server);
  registerChatTool(server);
  registerListChatModelsTool(server);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  return server;
}
