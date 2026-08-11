import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ChatMessage } from '../puter/client.js';
import { AuthManager } from '../puter/auth.js';
import { PuterClient } from '../puter/client.js';
import { logger } from '../utils/logger.js';

const CHAT_MODEL_RE = /^[a-zA-Z0-9_.:-]+\/[a-zA-Z0-9_.:-]+$/;

const toolCallsToString = (
  toolCalls?: ChatMessage['tool_calls']
): string => {
  if (!toolCalls || toolCalls.length === 0) return '';
  return (
    '\n\n**Tool calls:**\n' +
    toolCalls
      .map(
        (tc) =>
          `- \`${tc.function.name}\`(${tc.function.arguments})`
      )
      .join('\n')
  );
};

export function registerChatTool(server: McpServer): void {
  const authManager = new AuthManager();
  const client = new PuterClient(authManager);

  server.tool(
    'chat',
    `Chat with Puter's free LLM models (gpt, claude, gemini, grok, and more).
Returns the assistant's text response alongside the model that was used.`,
    {
      messages: z
        .array(
          z.object({
            role: z
              .enum(['system', 'assistant', 'user', 'tool'])
              .describe('Message role: system, assistant, user, or tool.'),
            content: z.string().describe('Message content.'),
          })
        )
        .min(1)
        .describe('Conversation history (oldest first).'),
      model: z
        .string()
        .regex(CHAT_MODEL_RE, 'Expected a Puter model id, e.g. openai/gpt-4o-mini')
        .optional()
        .describe('Puter model id (defaults to Puter\'s server default).'),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe('Sampling temperature.'),
      maxTokens: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum tokens for the response.'),
      testMode: z
        .boolean()
        .optional()
        .default(false)
        .describe('Use Puter\'s free test API (no credits consumed).'),
    },
    async (args) => {
      try {
        const messages: ChatMessage[] = args.messages;
        const result = await client.chat(messages, {
          model: args.model,
          temperature: args.temperature,
          maxTokens: args.maxTokens,
          testMode: args.testMode,
        });

        let text = result.message.content || '';
        text += toolCallsToString(result.message.tool_calls);

        return {
          content: [
            {
              type: 'text',
              text:
                `**Model:** ${args.model || 'puter-chat (default)'}\n\n` +
                text +
                (result.usage
                  ? `\n\n_Usage: input ${result.usage.input_tokens ?? '?'} tokens, output ${result.usage.output_tokens ?? '?'} tokens._`
                  : ''),
            },
          ],
        };
      } catch (error) {
        logger.error('Chat tool failed:', error);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                error instanceof Error
                  ? `Chat failed: ${error.message}`
                  : 'Chat failed: unknown error',
            },
          ],
        };
      }
    }
  );
}

export function registerListChatModelsTool(server: McpServer): void {
  const authManager = new AuthManager();
  const client = new PuterClient(authManager);

  server.tool(
    'list_chat_models',
    'List available LLM models supported by puterMCP via Puter.',
    {
      provider: z
        .string()
        .optional()
        .describe('Optional provider filter, e.g. openai-completion, anthropic, google.'),
    },
    async (args) => {
      try {
        let models = await client.listChatModels();
        if (args.provider) {
          models = models.filter((m) => m.provider === args.provider);
        }

        const formatted = models
          .map((m) => {
            let line = `- **${m.id}**`;
            if (m.provider) line += ` (${m.provider}${m.name ? ` — ${m.name}` : ''})`;
            else if (m.name) line += ` — ${m.name}`;
            return line;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text:
                `## Available Chat Models\n\n` +
                `**Total:** ${models.length} models\n\n` +
                (formatted || '_No models found._') +
                `\n\n_Use the model ID with the \`chat\` tool's \`model\` parameter._`,
            },
          ],
        };
      } catch (error) {
        logger.error('list_chat_models tool failed:', error);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                error instanceof Error
                  ? `Failed to list chat models: ${error.message}`
                  : 'Failed to list chat models: unknown error',
            },
          ],
        };
      }
    }
  );
}