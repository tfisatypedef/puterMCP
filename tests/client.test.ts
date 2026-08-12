import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PuterClient } from '../src/puter/client.js';
import { AuthManager } from '../src/puter/auth.js';
import { PuterApiError, PuterAuthError } from '../src/puter/types.js';

// Mock AuthManager
vi.mock('../src/puter/auth.js');

// Mock global fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('PuterClient', () => {
  let authManager: AuthManager;
  let client: PuterClient;

  beforeEach(() => {
    vi.resetAllMocks();
    authManager = new AuthManager();
    client = new PuterClient(authManager);
  });

  it('should throw PuterAuthError if no token is available', async () => {
    (authManager.getToken as any).mockResolvedValue(undefined);

    await expect(client.callDriver({
      interface: 'test',
      method: 'test',
      args: {}
    })).rejects.toThrow(PuterAuthError);
  });

  it('should make a successful API call', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, result: { foo: 'bar' } }),
    });

    const result = await client.callDriver({
      interface: 'test-interface',
      method: 'test-method',
      args: { param: 1 }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.puter.com/drivers/call',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({
          interface: 'test-interface',
          method: 'test-method',
          args: { param: 1 }
        })
      })
    );

    expect(result).toEqual({ success: true, result: { foo: 'bar' } });
  });

  it('should handle API errors (HTTP 200 but success: false)', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: false,
        error: { message: 'API Error', code: 'ERR_TEST' }
      }),
    });

    await expect(client.callDriver({
      interface: 'test',
      method: 'test',
      args: {}
    })).rejects.toThrow('API Error');
  });

  it('should handle HTTP errors', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => JSON.stringify({ error: 'Insufficient credits for image generation', code: 'insufficient_credits' }),
    });

    await expect(client.callDriver({
      interface: 'test',
      method: 'test',
      args: {}
    })).rejects.toThrow('Insufficient credits for image generation (HTTP 500)');
  });

  it('should fall back to status text when HTTP error body is not JSON', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'boom',
    });

    await expect(client.callDriver({
      interface: 'test',
      method: 'test',
      args: {}
    })).rejects.toThrow('HTTP 500: Internal Server Error');
  });

  it('should handle image responses correctly', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    const mockBuffer = Buffer.from('fake-image-data');
    
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png; charset=utf-8' },
      arrayBuffer: async () => mockBuffer,
    });

    const result = await client.callDriver({
      interface: 'image-gen',
      method: 'generate',
      args: {}
    });

    expect(result.success).toBe(true);
    expect((result.result as any).mimeType).toBe('image/png');
    expect((result.result as any).base64).toBe(mockBuffer.toString('base64'));
  });

  it('should normalize a data-URI string result into base64 + mimeType', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    const dataUri = 'data:image/jpeg;base64,aGVsbG8=';

    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, result: dataUri }),
    });

    const result = await client.callDriver({
      interface: 'puter-image-generation',
      driver: 'ai-image',
      method: 'generate',
      args: { prompt: 'test', model: 'gpt-image-1-mini' }
    });

    expect(result.result).toEqual({
      base64: 'aGVsbG8=',
      mimeType: 'image/jpeg',
      dataUrl: dataUri,
    });
  });

  it('should normalize a web-URL string result into a url field', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    const url = 'https://api.together.ai/shrt/abc123';

    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, result: url }),
    });

    const result = await client.callDriver({
      interface: 'puter-image-generation',
      driver: 'ai-image',
      method: 'generate',
      args: { prompt: 'test', model: 'black-forest-labs/FLUX.1-schnell' }
    });

    expect(result.result).toEqual({ url });
  });

  it('should fetch the live model catalog via listModels', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');

    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        models: [
          { id: 'gpt-image-1-mini', provider: 'openai-image-generation', name: 'GPT Image 1 Mini', allowedQualityLevels: ['low', 'high'] },
          { id: 'gemini-3-pro-image-preview', provider: 'gemini-image-generation', name: 'Gemini 3 Pro Image' },
        ],
      }),
    });

    const models = await client.listModels();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.puter.com/puterai/image/models/details',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer valid-token',
        }),
      })
    );
    expect(models).toHaveLength(2);
    // listModels sorts by id ascending: gemini-3-pro-image-preview < gpt-image-1-mini
    expect(models[0]).toMatchObject({ id: 'gemini-3-pro-image-preview', quality: undefined });
    expect(models[1]).toMatchObject({ id: 'gpt-image-1-mini', quality: ['low', 'high'] });
  });

  it('should mark free chat models from the live cost field', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        models: [
          { id: 'gpt-5-nano', costs: { prompt_tokens: 5, completion_tokens: 40 } },
          { id: 'glm-4.7-flash', costs: { prompt_tokens: 0, completion_tokens: 0 } },
        ],
      }),
    });
    const models = await client.listChatModels();
    expect(models).toEqual([
      { id: 'glm-4.7-flash', provider: undefined, name: undefined, free: true },
      { id: 'gpt-5-nano', provider: undefined, name: undefined, free: false },
    ]);
  });

  it('should retry with the free fallback model on 402 insufficient_funds', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    const requested: string[] = [];
    fetchMock.mockImplementation((_url: string, init: any) => {
      const body = JSON.parse(init.body);
      const model: string = body.args?.model ?? '';
      requested.push(model);
      if (model === 'gpt-5-nano') {
        return Promise.resolve({
          ok: false,
          status: 402,
          statusText: 'Payment Required',
          headers: { get: () => 'application/json' },
          text: async () =>
            JSON.stringify({ error: 'No usage left for request.', code: 'insufficient_funds' }),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          result: {
            message: { role: 'assistant', content: 'free reply' },
            usage: { prompt_tokens: 2, completion_tokens: 3 },
          },
        }),
      });
    });

    const result = await client.chatWithFreeFallback(
      [{ role: 'user', content: 'hi' }],
      { model: 'gpt-5-nano' }
    );

    expect(requested).toEqual(['gpt-5-nano', 'glm-4.7-flash']);
    expect(result.model).toBe('glm-4.7-flash');
    expect(result.message.content).toBe('free reply');
  });

  it('should NOT retry when the failure is not about credits', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: 'boom' }),
    });

    await expect(
      client.chatWithFreeFallback([{ role: 'user', content: 'hi' }], { model: 'gpt-5-nano' })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry when the requested model is already the fallback', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: 'No usage left for request.', code: 'insufficient_funds' }),
    });

    await expect(
      client.chatWithFreeFallback([{ role: 'user', content: 'hi' }], { model: 'glm-4.7-flash' })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should capture usage from the streaming `usage` chunk', async () => {
    (authManager.getToken as any).mockResolvedValue('valid-token');
    const lines = [
      '{"type":"text","text":"hi"}',
      '{"type":"usage","usage":{"prompt_tokens":1,"completion_tokens":2}}',
    ];
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines.join('\n') + '\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/x-ndjson' },
      body: stream,
    });

    const chunks: any[] = [];
    const result = await client.chat(
      [{ role: 'user', content: 'hi' }],
      { stream: true, onChunk: (chunk) => chunks.push(chunk) }
    );

    expect(chunks[chunks.length - 1]).toEqual({
      type: 'usage',
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    });
    expect(result.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2 });
  });
});
