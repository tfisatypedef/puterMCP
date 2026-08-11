import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const token = process.env.TEST_PUTER_TOKEN;
if (!token) {
  console.error('Missing TEST_PUTER_TOKEN');
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['bin/puter-mcp.mjs'],
  cwd: process.cwd(),
  env: {
    PUTER_AUTH_TOKEN: token,
  },
  stderr: 'pipe',
});

const client = new Client({ name: 'mcp-smoke', version: '1.0.0' });

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: 'generate_image',
    arguments: {
      prompt: 'A futuristic cyberpunk city with neon lights and flying cars, high detail, 8k resolution',
      model: 'gpt-image-1-mini',
    },
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Smoke test failed:', error);
} finally {
  await transport.close();
}
