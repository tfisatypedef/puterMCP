import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PuterClient } from '../puter/client.js';
import { AuthManager } from '../puter/auth.js';
import { PuterApiError } from '../puter/types.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_MODEL, FALLBACK_ERROR_PATTERNS, MODEL_FALLBACK_CHAIN } from '../constants.js';

const buildModelChain = (preferred?: string): string[] => {
  const base = MODEL_FALLBACK_CHAIN.length ? MODEL_FALLBACK_CHAIN : [DEFAULT_MODEL];
  if (!preferred) return base;
  return [preferred, ...base.filter((model) => model !== preferred)];
};

const shouldFallback = (error: unknown): boolean => {
  if (error instanceof PuterApiError) {
    const status = error.statusCode;
    if (status && [402, 403, 429, 503, 504].includes(status)) return true;
  }
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return FALLBACK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
};

export function registerGenerateImageTool(server: McpServer): void {
  const authManager = new AuthManager();
  const client = new PuterClient(authManager);

  server.tool(
    'generate_image',
    `Generate an image from a text prompt using Puter's free AI image generation.
Supports 30+ models including GPT Image, DALL-E 2/3, Gemini Nano Banana,
Flux.1, Stable Diffusion, and more. Falls back across models on quota or
availability errors. Returns the image inline as base64 content for direct
rendering in MCP clients. No API keys required — uses your Puter account.`,
    {
      prompt: z.string()
        .describe('Text description of the image to generate. Be detailed and specific for best results.'),
      model: z.string()
        .optional()
        .default(DEFAULT_MODEL)
        .describe(
          'Image generation model to use. Options include: ' +
          '"dall-e-3" (default), "gpt-image-1", "gpt-image-1-mini", ' +
          '"gemini-2.5-flash-image-preview" (Nano Banana), ' +
          '"gemini-3-pro-image-preview" (Nano Banana Pro), ' +
          '"gemini-3.1-flash-image-preview" (Nano Banana 2), ' +
          '"black-forest-labs/FLUX.1-schnell", ' +
          '"stabilityai/stable-diffusion-3-medium", ' +
          'and many more. Use list_models tool to see all options.'
        ),
      quality: z.string()
        .optional()
        .describe(
          'Quality setting. For GPT Image: "high", "medium", or "low". ' +
          'For DALL-E 3: "hd" or "standard". Not all models support this.'
        ),
    },
    async (args) => {
      try {
        // Check authentication
        if (!authManager.hasToken()) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ **Not authenticated with Puter.**\n\n' +
                  'To authenticate:\n' +
                  '1. Go to https://puter.com and open Developer Tools (F12) → Console\n' +
                  '2. Type `puter.authToken` and copy the value\n' +
                  '3. Run: `npx puter-mcp --token <your-token>`',
              },
            ],
            isError: true,
          };
        }

        const chain = buildModelChain(args.model);
        logger.info(`Generating image: model=${chain[0]}, prompt="${args.prompt.substring(0, 50)}..."`);

        let lastError: unknown;
        for (const model of chain) {
          try {
            const result = await client.generateImage(args.prompt, {
              model,
              quality: args.quality,
            });

            // Inline image when the provider returned base64 data.
            if (result.base64) {
              return {
                content: [
                  {
                    type: 'image',
                    data: result.base64,
                    mimeType: result.mimeType || 'image/png',
                  },
                  {
                    type: 'text',
                    text: `✅ **Image generated successfully**\n` +
                      `- **Model:** ${model}\n` +
                      `- **Prompt:** "${args.prompt}"`,
                  },
                ],
              };
            }

            // Otherwise the provider returned a hosted URL — return it as a link.
            if (result.url) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `✅ **Image generated successfully**\n` +
                      `- **Model:** ${model}\n` +
                      `- **Prompt:** "${args.prompt}"\n` +
                      `- **Image:** ${result.url}`,
                  },
                ],
              };
            }

            throw new Error('Image generation returned no usable result');
          } catch (error) {
            lastError = error;
            if (shouldFallback(error) && model !== chain[chain.length - 1]) {
              const message = error instanceof Error ? error.message : String(error);
              logger.warn(`Model failed, falling back: model=${model}, error="${message}"`);
              continue;
            }
            throw error;
          }
        }
        throw lastError instanceof Error
          ? new Error(`All models failed. Last error: ${lastError.message}`)
          : new Error('All models failed.');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Image generation failed:', message);

        return {
          content: [
            {
              type: 'text',
              text: `❌ **Image generation failed**\n\nError: ${message}\n\n` +
                'Common issues:\n' +
                '- Invalid or expired auth token (re-run with --login)\n' +
                '- Unsupported model name (use list_models to check)\n' +
                '- Puter service temporarily unavailable',
            },
          ],
          isError: true,
        };
      }
    }
  );
}
