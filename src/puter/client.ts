import { AuthManager } from './auth.js';
import { PuterApiError, PuterAuthError } from './types.js';
import { logger } from '../utils/logger.js';
import { PUTER_API_BASE } from '../constants.js';

export interface DriverCallParams {
  interface: string;
  driver?: string;
  service?: string;
  method: string;
  args: Record<string, unknown>;
  /** Pass `test_mode: true` in the request body to use Puter's free test API. */
  testMode?: boolean;
}

export interface DriverCallResult {
  success: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * Normalized image-generation result.
 * - `base64`/`mimeType` are set when the provider returned a data-URI (inline).
 * - `url` is set when the provider returned a hosted share URL (link only).
 * - `dataUrl` mirrors `base64`/`mimeType` as a full data-URI.
 */
export interface ImageResult {
  base64?: string;
  mimeType?: string;
  dataUrl?: string;
  url?: string;
}

export interface ImageModelInfo {
  id: string;
  provider?: string;
  name?: string;
  quality?: string[];
}

export interface ChatMessage {
  role: 'system' | 'assistant' | 'user' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type?: string;
    function: { name: string; arguments: string };
  }>;
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type PuterToolCall = {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
};

/**
 * A single line of Puter's NDJSON stream for a chat completion.
 * See `src/backend/drivers/ai-chat/ChatCompletionDriver.ts` — streaming
 * responses are `application/x-ndjson`, one JSON object per line.
 */
export type ChatStreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; usage?: Record<string, number> }
  | { type: 'error'; message: string };

export interface ChatOptions {
  /** Puter model id, e.g. `openai/gpt-4o-mini` (default: server default). */
  model?: string;
  /** Explicit provider override (normally inferred from the model id). */
  provider?: string;
  /** Explicit driver override (e.g. `openrouter`); defaults to `ai-chat`. */
  driver?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ChatTool[];
  stream?: boolean;
  testMode?: boolean;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  /** Called for every parsed NDJSON chunk while streaming. */
  onChunk?: (chunk: ChatStreamChunk) => void;
}

export interface ChatResult {
  message: {
    role: string;
    content: string;
    tool_calls?: PuterToolCall[];
  };
  usage?: Record<string, number>;
}

export interface ChatModelInfo {
  id: string;
  provider?: string;
  name?: string;
}

const DATA_URI_PATTERN = /^data:image\/([a-zA-Z0-9.+-]+);base64,([\s\S]+)$/;
const CHAT_COMPLETION_INTERFACE = 'puter-chat-completion';

export class PuterClient {
  private authManager: AuthManager;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;
  }

  /**
   * Call the Puter driver API directly.
   *
   * Endpoint: POST /drivers/call
   * Auth: Bearer token in Authorization header
   * Content-Type: application/json
   *
   * The API uses an "interface/driver/method/args" pattern where:
   * - interface: the driver type (e.g., "puter-image-generation")
   * - driver: the driver name (e.g., "ai-image")
   * - method: the operation (e.g., "generate")
   * - args: operation-specific parameters
   *
   * Note: the response `result` for image generation is a string — either a
   * data-URI (`data:image/jpeg;base64,...`) or a hosted URL — which is
   * normalized into an `ImageResult` below.
   */
  async callDriver(params: DriverCallParams): Promise<DriverCallResult> {
    const token = await this.authManager.getToken();

    if (!token) {
      throw new PuterAuthError(
        'No auth token found. Run: puter-mcp --login to authenticate.'
      );
    }

    const body: Record<string, unknown> = {
      interface: params.interface,
      method: params.method,
      args: params.args,
    };

    // Puter API accepts both "driver" and "service" for specifying the provider
    if (params.driver) body.driver = params.driver;
    if (params.service) body.service = params.service;
    if (params.testMode) body.test_mode = true;

    logger.debug('Calling Puter driver:', JSON.stringify(body));

    const response = await fetch(`${PUTER_API_BASE}/drivers/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://puter.com',
        'Referer': 'https://puter.com/',
      },
      body: JSON.stringify(body),
    });

    // Non-200 means transport-level error — surface the API's error message
    if (!response.ok) {
      let message = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const text = await response.text();
        const data = JSON.parse(text) as { error?: string; message?: string; code?: string };
        const detail = data.error || data.message;
        if (detail) message = `${detail} (HTTP ${response.status})`;
        throw new PuterApiError(message, response.status, data.code);
      } catch (e) {
        if (e instanceof PuterApiError) throw e;
        throw new PuterApiError(message, response.status);
      }
    }

    const contentType = response.headers.get('content-type') || '';

    // If it looks like JSON, try to parse it as such
    if (contentType.includes('application/json')) {
      const data = await response.json() as { success: boolean; error?: { message: string; code: string } };

      if (data.success === false) {
        throw new PuterApiError(
          data.error?.message || 'Unknown Puter API error',
          200,
          data.error?.code
        );
      }
      return this.normalizeResult(data as DriverCallResult);
    }

    // Otherwise, treat as binary/image
    const buffer = await response.arrayBuffer();

    // Check for JSON error in binary response (sometimes happens with 4xx/5xx but missing content-type)
    try {
      const text = Buffer.from(buffer).toString('utf-8');
      if (text.startsWith('{') && text.includes('"success":false')) {
         const data = JSON.parse(text);
         throw new PuterApiError(
          data.error?.message || 'Unknown Puter API error',
          200,
          data.error?.code
        );
      }
    } catch (e) {
      // Not JSON, proceed as image
      if (e instanceof PuterApiError) throw e;
    }

    const base64 = Buffer.from(buffer).toString('base64');
    // Default to png if mime type is generic/missing/undefined
    let mimeType = 'image/png';
    if (contentType && contentType !== 'undefined' && contentType.startsWith('image/')) {
      mimeType = contentType.split(';')[0].trim();
    }

    return {
      success: true,
      result: {
        base64,
        mimeType,
        dataUrl: `data:${mimeType};base64,${base64}`,
      },
    };
  }

  /**
   * Normalize the driver response so `result` is always an `ImageResult`
   * object, regardless of whether Puter returned a data-URI string, a hosted
   * URL string, or (legacy) an object/raw bytes.
   */
  private normalizeResult(data: DriverCallResult): DriverCallResult {
    const result = data.result;

    if (typeof result === 'string') {
      const dataUri = result.match(DATA_URI_PATTERN);
      if (dataUri) {
        return {
          success: true,
          result: {
            base64: dataUri[2],
            mimeType: `image/${dataUri[1]}`,
            dataUrl: result,
          } as ImageResult,
        };
      }
      if (result.startsWith('http://') || result.startsWith('https://')) {
        return {
          success: true,
          result: { url: result } as ImageResult,
        };
      }
    }

    // Object-shaped result (legacy) — pass through as-is.
    return data;
  }

  /**
   * Fetch the live image-generation model catalog from Puter's public,
   * no-auth listing endpoint (mirrors puter-js `listModels`).
   */
  async listModels(): Promise<ImageModelInfo[]> {
    const token = await this.authManager.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${PUTER_API_BASE}/puterai/image/models/details`, { headers });

    if (!response.ok) {
      throw new PuterApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status
      );
    }

    const data = await response.json() as { models?: Array<Record<string, unknown>> };
    if (!Array.isArray(data.models)) return [];

    return data.models
      .filter((m) => typeof m.id === 'string')
      .map((m) => ({
        id: m.id as string,
        provider: typeof m.provider === 'string' ? m.provider : undefined,
        name: typeof m.name === 'string' ? m.name : undefined,
        quality: Array.isArray(m.allowedQualityLevels)
          ? (m.allowedQualityLevels as string[]).filter((q) => typeof q === 'string')
          : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Fetch the live chat model catalog (mirrors puter-js `listModels`).
   * Uses Puter's public details endpoint and filters hidden ids.
   */
  async listChatModels(): Promise<ChatModelInfo[]> {
    const token = await this.authManager.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(
      `${PUTER_API_BASE}/puterai/chat/models/details`,
      { headers }
    );

    if (!response.ok) {
      throw new PuterApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status
      );
    }

    const data = await response.json() as { models?: Array<Record<string, unknown>> };
    if (!Array.isArray(data.models)) return [];

    const HIDDEN_IDS = new Set(['fake', 'abuse', 'costly', 'model-fallback-test-1']);
    return data.models
      .filter(
        (m) =>
          typeof m.id === 'string' &&
          !HIDDEN_IDS.has(m.id)
      )
      .map((m) => ({
        id: m.id as string,
        provider: typeof m.provider === 'string' ? m.provider : undefined,
        name: typeof m.name === 'string' ? m.name : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private buildRequestBody(
    params: DriverCallParams,
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      interface: params.interface,
      method: params.method,
      args: { ...params.args, stream },
    };
    if (params.driver) body.driver = params.driver;
    if (params.service) body.service = params.service;
    if (params.testMode) body.test_mode = true;
    return body;
  }

  private async requestHeaders(): Promise<Record<string, string>> {
    const token = await this.authManager.getToken();
    if (!token) {
      throw new PuterAuthError(
        'No auth token found. Run: puter-mcp --login to authenticate.'
      );
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://puter.com',
      'Referer': 'https://puter.com/',
    };
  }

  /**
   * Normalize a chat completion result. Non-streaming responses come back as
   * `{ success, result: { message, usage } }`.
   */
  private normalizeChatResult(data: DriverCallResult): ChatResult {
    const result = data.result as
      | { message: ChatResult['message']; usage?: Record<string, number> }
      | undefined;
    if (!result || !result.message || typeof result.message !== 'object') {
      throw new PuterApiError('Chat completion failed: no result returned');
    }
    return {
      message: {
        role: result.message.role || 'assistant',
        content:
          typeof result.message.content === 'string'
            ? result.message.content
            : '',
        tool_calls: Array.isArray(result.message.tool_calls)
          ? result.message.tool_calls
          : undefined,
      },
      usage: result.usage,
    };
  }

  /**
   * Run a chat completion against Puter's `puter-chat-completion` interface.
   * When `options.stream` is true the NDJSON chunks are delivered via
   * `options.onChunk` and the resolved `ChatResult` is assembled from them.
   */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const args: Record<string, unknown> = { messages };
    if (options.model) args.model = options.model;
    if (options.provider) args.provider = options.provider;
    if (options.temperature !== undefined) args.temperature = options.temperature;
    if (options.maxTokens !== undefined) args.max_tokens = options.maxTokens;
    if (options.tools && options.tools.length > 0) args.tools = options.tools;
    if (options.reasoningEffort) args.reasoning_effort = options.reasoningEffort;
    args.stream = options.stream === true;

    const params: DriverCallParams = {
      interface: CHAT_COMPLETION_INTERFACE,
      driver: options.driver,
      method: 'complete',
      args,
      testMode: options.testMode,
    };

    if (options.stream) {
      return this.callChatStream(params, options.onChunk);
    }

    const result = await this.callDriver(params);
    return this.normalizeChatResult(result);
  }

  /**
   * Stream a chat completion. The `/drivers/call` endpoint responds with
   * `application/x-ndjson` (one JSON object per line) when `args.stream`
   * is true. Chunk types: `text`, `tool_use`, `done`, `error`.
   */
  private async callChatStream(
    params: DriverCallParams,
    onChunk?: (chunk: ChatStreamChunk) => void
  ): Promise<ChatResult> {
    const headers = await this.requestHeaders();
    const body = this.buildRequestBody(params, true);

    logger.debug('Calling Puter driver (stream):', JSON.stringify(body));

    const response = await fetch(`${PUTER_API_BASE}/drivers/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const text = await response.text();
        const data = JSON.parse(text) as { error?: string; message?: string; code?: string };
        const detail = data.error || data.message;
        if (detail) message = `${detail} (HTTP ${response.status})`;
        throw new PuterApiError(message, response.status, data.code);
      } catch (e) {
        if (e instanceof PuterApiError) throw e;
        throw new PuterApiError(message, response.status);
      }
    }

    if (!response.body) {
      throw new PuterApiError('Streaming chat failed: empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let content = '';
    let usage: Record<string, number> | undefined;
    const toolCalls: PuterToolCall[] = [];

    const handleChunk = (chunk: ChatStreamChunk): void => {
      onChunk?.(chunk);
      switch (chunk.type) {
        case 'text':
          content += chunk.text;
          break;
        case 'tool_use':
          toolCalls.push({
            id: chunk.id,
            type: 'function',
            function: {
              name: chunk.name,
              arguments: JSON.stringify(chunk.input ?? {}),
            },
          });
          break;
        case 'done':
          usage = chunk.usage;
          break;
        case 'error':
          throw new PuterApiError(chunk.message || 'Unknown streaming error');
      }
    };

    // Parse the NDJSON line stream incrementally.
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const rawLine = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!rawLine) continue;
        try {
          const parsed = JSON.parse(rawLine) as ChatStreamChunk;
          handleChunk(parsed);
        } catch (e) {
          if (e instanceof PuterApiError) throw e;
          logger.warn('Ignoring malformed stream line:', rawLine);
        }
      }
    }

    return {
      message: { role: 'assistant', content, tool_calls: toolCalls.length ? toolCalls : undefined },
      usage,
    };
  }

  /**
   * Generate an image from a text prompt.
   * Returns a normalized `ImageResult` (inline base64 or hosted URL).
   */
  async generateImage(
    prompt: string,
    options: {
      model?: string;
      quality?: string;
      size?: string;
      inputImage?: string;       // base64 for img2img
      inputImageMimeType?: string;
    } = {}
  ): Promise<ImageResult> {
    // Build the args object
    const args: Record<string, unknown> = {
      prompt,
      model: options.model || 'gpt-image-1-mini'
    };

    if (options.quality) args.quality = options.quality;
    if (options.size) args.size = options.size;
    if (options.inputImage) {
      args.input_image = options.inputImage;
      args.input_image_mime_type = options.inputImageMimeType || 'image/png';
    }

    const result = await this.callDriver({
      interface: 'puter-image-generation',
      driver: 'ai-image',
      method: 'generate',
      args,
    });

    if (!result.success || !result.result) {
      throw new PuterApiError('Image generation failed: no result returned');
    }

    return result.result as ImageResult;
  }
}
