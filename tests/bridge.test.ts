import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as http from 'node:http';
import { createBridgeServer } from '../src/bridge/server.js';

vi.mock('../src/puter/auth.js', () => ({
  AuthManager: class {
    async getToken(): Promise<string | undefined> {
      return 'test-token';
    }
    setToken(): void {}
    hasToken(): boolean {
      return true;
    }
  },
}));

const fetchMock = vi.fn();
global.fetch = fetchMock as any;

const okJson = (json: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: { get: () => 'application/json' },
  json: async () => json,
});

const ndjsonStream = (lines: string[]) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines.join('\n') + '\n'));
      controller.close();
    },
  });

const request = (
  server: http.Server,
  path: string,
  body?: unknown,
  raw?: string
): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const port = (server.address() as { port: number }).port;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: body || raw ? 'POST' : 'GET',
        headers: body || raw ? { 'Content-Type': 'application/json' } : {},
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
      }
    );
    req.on('error', reject);
    if (raw) req.write(raw);
    else if (body) req.write(JSON.stringify(body));
    req.end();
  });

const listen = (server: http.Server, host: string): Promise<void> =>
  new Promise((resolve) => server.listen(0, host, () => resolve()));

describe('OpenAI-compatible bridge', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('binds to loopback only when host is 127.0.0.1', async () => {
    const server = createBridgeServer();
    await listen(server, '127.0.0.1');
    const addr = server.address() as { address: string; family: string };
    expect(addr.address).toBe('127.0.0.1');
    expect(addr.family).toBe('IPv4');
    server.close();
  });

  it('returns a JSON 400 for a non-JSON chat body', async () => {
    const server = createBridgeServer();
    await listen(server, '127.0.0.1');
    const res = await request(server, '/v1/chat/completions', undefined, 'not json{{{');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Invalid JSON body');
    server.close();
  });

  it('returns a JSON 400 when messages is missing', async () => {
    const server = createBridgeServer();
    await listen(server, '127.0.0.1');
    const res = await request(server, '/v1/chat/completions', { model: 'gpt-5-nano' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('must be an array');
    server.close();
  });

  it('returns an OpenAI-style 401 when Puter rejects the token', async () => {
    const server = createBridgeServer();
    await listen(server, '127.0.0.1');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: 'reauth required', code: 'reauth_required' }),
    });
    const res = await request(server, '/v1/chat/completions', {
      model: 'gpt-5-nano',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.status).toBe(401);
    expect(res.text).toContain('reauth_required');
    server.close();
  });

  it('retries with the free fallback model on 402 insufficient_funds (non-stream)', async () => {
    const server = createBridgeServer();
    await listen(server, '127.0.0.1');
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
      return Promise.resolve(
        okJson({
          success: true,
          result: {
            message: { role: 'assistant', content: 'free reply' },
            usage: { prompt_tokens: 2, completion_tokens: 3 },
          },
        })
      );
    });

    const res = await request(server, '/v1/chat/completions', {
      model: 'gpt-5-nano',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.text);
    expect(parsed.choices[0].message.content).toBe('free reply');
    expect(parsed.model).toBe('glm-4.7-flash');
    expect(requested).toEqual(['gpt-5-nano', 'glm-4.7-flash']);
    server.close();
  });

  it('emits a single SSE error line when the stream carries an error chunk', async () => {
    const server = createBridgeServer();
    await listen(server, '127.0.0.1');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/x-ndjson' },
      body: ndjsonStream(['{"type":"error","message":"boom"}']),
    });

    const res = await request(server, '/v1/chat/completions', {
      model: 'gpt-5-nano',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    const dataLines = res.text.split('\n').filter((l) => l.startsWith('data: '));
    expect(dataLines).toHaveLength(1);
    expect(dataLines[0]).toContain('boom');
    expect(res.text).not.toContain('[DONE]');
    server.close();
  });

  it('emits a finish_reason stop chunk before [DONE] (Puter sends `usage`, not `done`)', async () => {
    const server = createBridgeServer();
    await listen(server, '127.0.0.1');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/x-ndjson' },
      body: ndjsonStream([
        '{"type":"text","text":"hi"}',
        '{"type":"usage","usage":{"prompt_tokens":1,"completion_tokens":2}}',
      ]),
    });

    const res = await request(server, '/v1/chat/completions', {
      model: 'gpt-5-nano',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    const lines = res.text.trim().split('\n');
    expect(lines[lines.length - 1]).toBe('data: [DONE]');
    const payloads = lines
      .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
      .map((l) => JSON.parse(l.slice(6)));
    const lastPayload = payloads[payloads.length - 1];
    expect(lastPayload.choices[0].finish_reason).toBe('stop');
    server.close();
  });
});
