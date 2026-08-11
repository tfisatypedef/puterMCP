#!/usr/bin/env node

import { createServer } from '../dist/server.js';
import { createBridgeServer } from '../dist/bridge/server.js';
import { AuthManager } from '../dist/puter/auth.js';

const args = process.argv.slice(2);

// Handle --login flag (deprecated, show manual instructions)
if (args.includes('--login')) {
  console.error('[puterMCP] Browser authentication is deprecated.');
  console.error('[puterMCP] Please authenticate manually:');
  console.error('  1. Go to https://puter.com and open Developer Tools (F12)');
  console.error('  2. Type `puter.authToken` in the Console and copy the value');
  console.error('  3. Run: `npx puter-mcp --token <your-token>`');
  process.exit(1);
}

// Handle --token flag for manual token setting
if (args.includes('--token')) {
  const tokenIndex = args.indexOf('--token') + 1;
  if (tokenIndex >= args.length) {
    console.error('[puterMCP] Error: --token requires a value');
    process.exit(1);
  }
  const authManager = new AuthManager();
  authManager.setToken(args[tokenIndex]);
  console.error('[puterMCP] ✅ Token saved successfully!');
  process.exit(0);
}

// Handle --help
if (args.includes('--help') || args.includes('-h')) {
  console.error(`
puterMCP — MCP server + OpenAI-compatible bridge for Puter's free AI APIs

Usage:
  npx puter-mcp                  Start the MCP server (stdio transport)
  npx puter-mcp --bridge [port]  Start the OpenAI-compatible HTTP bridge (default port 47831)
  npx puter-mcp --token <t>      Set auth token manually
  npx puter-mcp --help           Show this help

Environment Variables:
  PUTER_AUTH_TOKEN           Auth token (overrides stored config)
  PUTER_BRIDGE_PORT          Bridge port (default 47831)
  PUTER_TEST_MODE            Use Puter's free test API for all bridge requests (true/false)
  PUTER_MCP_LOG_LEVEL        Log level: debug, info, warn, error

MCP Client Configuration:
  Claude Desktop (claude_desktop_config.json):
    {
      "mcpServers": {
        "puter": {
          "command": "npx",
          "args": ["-y", "puter-mcp"]
        }
      }
    }

opencode Provider Configuration (opencode.json):
  {
    "provider": {
      "puter": {
        "npm": "@ai-sdk/openai-compatible",
        "name": "Puter (free)",
        "options": { "baseURL": "http://127.0.0.1:47831/v1" },
        "models": { "openai/gpt-4o-mini": { "name": "GPT-4o mini (Puter)" } }
      }
    }
  }
  `);
  process.exit(0);
}

// Handle --bridge: run the OpenAI-compatible HTTP bridge
if (args.includes('--bridge')) {
  const portIndex = args.indexOf('--bridge') + 1;
  let port = Number(process.env.PUTER_BRIDGE_PORT || 47831);
  if (portIndex < args.length && /^\d+$/.test(args[portIndex])) {
    port = Number(args[portIndex]);
  }

  const server = createBridgeServer();
  server.listen(port, () => {
    console.error(`[puterMCP] OpenAI-compatible bridge listening on http://127.0.0.1:${port}`);
    console.error(`[puterMCP]   GET  /v1/models`);
    console.error(`[puterMCP]   POST /v1/chat/completions`);
    console.error(`[puterMCP] Configure opencode with baseURL http://127.0.0.1:${port}/v1`);
  });
}

// Default: start MCP server
await createServer();
