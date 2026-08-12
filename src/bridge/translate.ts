import {
  ChatMessage,
  ChatResult,
  ChatStreamChunk,
  ChatTool,
} from '../puter/client.js';

/**
 * OpenAI-compatible <-> Puter chat translation layer.
 *
 * Pure functions used by the HTTP bridge (`src/bridge/server.ts`) so that any
 * OpenAI-compatible client (e.g. opencode's `@ai-sdk/openai-compatible`
 * provider) can drive Puter's `puter-chat-completion` interface.
 */

export interface OpenAIContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface OpenAIMessage {
  role: string;
  content: string | OpenAIContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

export interface OpenAIChatRequest {
  model?: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  tools?: unknown;
  stream?: boolean;
}

export interface TranslatedRequest {
  messages: ChatMessage[];
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: ChatTool[];
  };
}

/** Collapse OpenAI's array content parts into a single text string. */
const contentToString = (content: string | OpenAIContentPart[]): string => {
  if (typeof content === 'string') return content;
  const text = content
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('');
  return text;
};

/**
 * Translate an OpenAI `/v1/chat/completions` request body into Puter chat args.
 */
export const translateRequest = (req: OpenAIChatRequest): TranslatedRequest => {
  const messages: ChatMessage[] = (req.messages || []).map((m) => ({
    role: (['system', 'assistant', 'user', 'tool'].includes(m.role)
      ? m.role
      : 'user') as ChatMessage['role'],
    content: contentToString(m.content),
    ...(m.name ? { name: m.name } : {}),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    ...(m.tool_calls
      ? { tool_calls: m.tool_calls as ChatMessage['tool_calls'] }
      : {}),
  }));

  const options: TranslatedRequest['options'] = {};

  if (req.model) options.model = req.model;
  if (req.temperature !== undefined) options.temperature = req.temperature;
  if (req.max_tokens !== undefined) {
    options.maxTokens = req.max_tokens;
  } else if (req.max_completion_tokens !== undefined) {
    options.maxTokens = req.max_completion_tokens;
  }
  if (Array.isArray(req.tools) && req.tools.length > 0) {
    options.tools = req.tools as ChatTool[];
  }

  return { messages, options };
};

const FINISH_STOP = 'stop';
const FINISH_TOOL = 'tool_calls';

/**
 * Translate a Puter `ChatResult` into an OpenAI `chat.completion` response.
 */
export const translateResponse = (
  result: ChatResult,
  model: string
): Record<string, unknown> => {
  const toolCalls = Array.isArray(result.message.tool_calls)
    ? result.message.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }))
    : undefined;

  return {
    id: `chatcmpl-${Math.random().toString(36).slice(2)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: result.message.content || null,
          ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls && toolCalls.length > 0 ? FINISH_TOOL : FINISH_STOP,
      },
    ],
    ...(result.usage && Object.keys(result.usage).length > 0
      ? {
          usage: {
            prompt_tokens: result.usage.prompt_tokens,
            completion_tokens: result.usage.completion_tokens,
          },
        }
      : {}),
  };
};

/**
 * OpenAI error response shape.
 */
export const translateError = (
  status: number,
  message: string,
  code?: string
): Record<string, unknown> => ({
  error: {
    message,
    type: 'invalid_request_error',
    ...(code ? { code } : {}),
    param: null,
  },
});

export interface SSEState {
  /** Per-choice tool-call index for delta streaming. */
  toolCallIndex: number;
  /** Model id echoed in every chunk. */
  model: string;
  /** Shared completion id. */
  id: string;
}

export const createSSEState = (model: string): SSEState => ({
  toolCallIndex: 0,
  model,
  id: `chatcmpl-${Math.random().toString(36).slice(2)}`,
});

/**
 * Translate a Puter NDJSON chunk into one or more OpenAI SSE `data:` lines.
 * Returns an array of raw `data: ...` payloads (without the trailing blank
 * line; the caller appends `\n`).
 */
export const translateStreamChunk = (
  chunk: ChatStreamChunk,
  state: SSEState
): string[] => {
  const base = {
    id: state.id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: state.model,
  };

  switch (chunk.type) {
    case 'text': {
      const payload = {
        ...base,
        choices: [
          { index: 0, delta: { content: chunk.text }, finish_reason: null },
        ],
      };
      return [JSON.stringify(payload)];
    }
    case 'tool_use': {
      const payload = {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: state.toolCallIndex++,
                  id: chunk.id,
                  type: 'function',
                  function: {
                    name: chunk.name,
                    arguments: JSON.stringify(chunk.input ?? {}),
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      return [JSON.stringify(payload)];
    }
    case 'done':
    case 'usage': {
      // Puter ends streams with a `usage` chunk (some providers still send
      // `done`); both must emit the final OpenAI `finish_reason` delta.
      const finish = state.toolCallIndex > 0 ? FINISH_TOOL : FINISH_STOP;
      const payload = {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
      };
      return [JSON.stringify(payload)];
    }
    case 'error':
      // Represented as an SSE event with a JSON error payload, then the
      // caller terminates the stream.
      return [];
    default:
      return [];
  }
};
