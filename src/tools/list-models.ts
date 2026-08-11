import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SUPPORTED_MODELS } from '../constants.js';
import { PuterClient } from '../puter/client.js';
import { AuthManager } from '../puter/auth.js';
import { logger } from '../utils/logger.js';

const CATEGORY_BY_PROVIDER: Record<string, 'openai' | 'google' | 'flux' | 'stable-diffusion' | 'other'> = {
  'openai-image-generation': 'openai',
  'gemini-image-generation': 'google',
  'together-image-generation': 'other',
  'xai-image-generation': 'other',
  'replicate-image-generation': 'other',
  'cloudflare-image-generation': 'other',
};

const categoryForModel = (id: string, provider?: string): 'openai' | 'google' | 'flux' | 'stable-diffusion' | 'other' => {
  if (provider && CATEGORY_BY_PROVIDER[provider]) return CATEGORY_BY_PROVIDER[provider];
  const lower = id.toLowerCase();
  if (lower.startsWith('gpt-image') || lower.startsWith('dall-e')) return 'openai';
  if (lower.startsWith('gemini-') || lower.startsWith('google/')) return 'google';
  if (lower.includes('flux')) return 'flux';
  if (lower.includes('stable-diffusion')) return 'stable-diffusion';
  return 'other';
};

export function registerListModelsTool(server: McpServer): void {
  const authManager = new AuthManager();
  const client = new PuterClient(authManager);

  server.tool(
    'list_models',
    'List all available image generation models supported by puterMCP via Puter.',
    {
      category: z.enum(['all', 'openai', 'google', 'flux', 'stable-diffusion', 'other'])
        .optional()
        .default('all')
        .describe('Filter models by category.'),
    },
    async (args) => {
      // Prefer the live catalog from Puter's public listing endpoint;
      // fall back to the bundled static snapshot.
      let models = SUPPORTED_MODELS;
      try {
        const live = await client.listModels();
        if (live.length > 0) {
          models = live.map((m) => ({
            id: m.id,
            displayName: m.name,
            category: categoryForModel(m.id, m.provider),
            quality: m.quality,
          }));
        }
      } catch (error) {
        logger.warn('Live model list unavailable, using static catalog:', error);
      }

      if (args.category !== 'all') {
        models = models.filter((m) => m.category === args.category);
      }

      const formatted = models
        .map((m) => {
          let line = `- **${m.id}**`;
          if (m.displayName) line += ` — ${m.displayName}`;
          if (m.quality && m.quality.length > 0) line += ` | Quality options: ${m.quality.join(', ')}`;
          if (m.notes) line += ` | ${m.notes}`;
          return line;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `## Available Image Generation Models\n\n` +
              `**Category:** ${args.category}\n` +
              `**Total:** ${models.length} models\n\n` +
              formatted +
              `\n\n_Use the model ID with the \`generate_image\` tool's \`model\` parameter._`,
          },
        ],
      };
    }
  );
}
