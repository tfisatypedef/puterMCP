import * as http from 'node:http';
import { AuthManager } from '../puter/auth.js';
import { PuterClient, ChatMessage } from '../puter/client.js';
import { PuterApiError, PuterAuthError } from '../puter/types.js';
import { logger } from '../utils/logger.js';
import {
  OpenAIChatRequest,
  createSSEState,
  translateError,
  translateRequest,
  translateResponse,
  translateStreamChunk,
} from './translate.js';

export interface BridgeOptions {
  port?: number;
  /** Force Puter's free `test_mode` for every request (overridable per-request via the `X-Puter-Test-Mode` header). */
  testMode?: boolean;
}

const sendJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const sendError = (res: http.ServerResponse, err: unknown): void => {
  if (err instanceof PuterAuthError) {
    sendJson(res, 401, translateError(401, err.message, 'authentication_error'));
    return;
  }
  if (err instanceof PuterApiError) {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode <= 599
      ? err.statusCode
      : 500;
    sendJson(res, status, translateError(status, err.message, err.code));
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error('Bridge error:', err);
  sendJson(res, 500, translateError(500, message, 'internal_error'));
};

const readBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf-8');
      if (raw.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });

/**
 * Start an OpenAI-compatible HTTP bridge in front of Puter's chat interface.
 *
 * Endpoints:
 *   GET  /v1/models               -> OpenAI model list
 *   POST /v1/chat/completions     -> OpenAI chat completion (stream + non-stream)
 */
export function createBridgeServer(options: BridgeOptions = {}): http.Server {
  const authManager = new AuthManager();
  const client = new PuterClient(authManager);
  const defaultTestMode =
    options.testMode ?? process.env.PUTER_TEST_MODE === 'true';

  const handleModels = async (res: http.ServerResponse): Promise<void> => {
    try {
      const models = await client.listChatModels();
      const sorted = [...models].sort(
        (a, b) => (Number(b.free) - Number(a.free)) || a.id.localeCompare(b.id)
      );
      sendJson(res, 200, {
        object: 'list',
        data: sorted.map((m) => ({
          id: m.id,
          object: 'model',
          created: 0,
          owned_by: m.provider ?? 'puter',
        })),
      });
    } catch (err) {
      sendError(res, err);
    }
  };

  const handleChat = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    let body: OpenAIChatRequest;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw) as OpenAIChatRequest;
    } catch (_err) {
      sendJson(
        res,
        400,
        translateError(400, 'Invalid JSON body', 'invalid_request')
      );
      return;
    }

    if (!Array.isArray(body.messages)) {
      sendJson(
        res,
        400,
        translateError(400, '"messages" is required and must be an array', 'invalid_request')
      );
      return;
    }

    const { messages, options } = translateRequest(body);
    const model = body.model || 'puter-chat';
    const testModeHeader = req.headers['x-puter-test-mode'];
    const testMode =
      testModeHeader === 'true'
        ? true
        : testModeHeader === 'false'
          ? false
          : defaultTestMode;

    if (body.stream === true) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const state = createSSEState(model);
      let errored = false;

      const sendSse = (data: string): void => {
        res.write(`data: ${data}\n\n`);
      };

      try {
        await client.chatWithFreeFallback(messages as ChatMessage[], {
          ...options,
          stream: true,
          testMode,
          onChunk: (chunk) => {
            if (chunk.type === 'error') {
              errored = true;
              return;
            }
            for (const line of translateStreamChunk(chunk, state)) {
              sendSse(line);
            }
          },
        });
        if (!errored) res.write('data: [DONE]\n\n');
        res.end();
      } catch (err) {
        if (!res.writableEnded) {
          const status =
            err instanceof PuterApiError && err.statusCode
              ? err.statusCode
              : 500;
          sendSse(
            JSON.stringify(
              translateError(status, err instanceof Error ? err.message : String(err), 'stream_error')
            )
          );
          res.end();
        }
      }
      return;
    }

    try {
      const result = await client.chatWithFreeFallback(messages as ChatMessage[], {
        ...options,
        testMode,
      });
      sendJson(res, 200, translateResponse(result, result.model || model));
    } catch (err) {
      sendError(res, err);
    }
  };

  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      void handleModels(res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      void handleChat(req, res);
      return;
    }

    sendJson(
      res,
      404,
      translateError(404, `Unknown endpoint: ${req.method} ${url.pathname}`, 'not_found')
    );
  });
}
