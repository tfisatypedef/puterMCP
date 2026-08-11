# puterMCP — Generative Text (LLM Chat) Feature Plan

## Goal

Add generative text (LLM chat) capabilities to puterMCP so that Puter's free text LLMs
(gpt, claude, gemini, grok, and 500+ others) are usable, and — critically — so that
**opencode's chat can actually run on Puter and the models appear in opencode's `/models`
picker**, alongside other providers.

Adapted from the feature-dev skill workflow: Discovery → Exploration → Clarifying questions
→ Architecture → Implementation → Quality review → Summary.

## Background / Research findings

### Puter's LLM API (`puter.ai.chat()`)
- Docs: https://docs.puter.com/AI/chat/ and https://developer.puter.com/tutorials/free-llm-api/
- 500+ models; default model `gpt-5-nano`; vendors incl. OpenAI, Anthropic, Google,
  xAI, Mistral, DeepSeek, OpenRouter, Infron, and others.
- Options: `model`, `provider`, `stream`, `max_tokens`, `temperature`, `tools`
  (function calling), `reasoning_effort`, `verbosity`, `testMode` (test API = no credits).
- `messages` = array of `{ role: system|assistant|user|tool, content }` (content may be a
  string or array of `text`/`file` content objects).
- Response is OpenAI-like: `message.content`, `message.tool_calls`
  (`{ id, function: { name, arguments } }`), and streaming chunks with `text` / `tool_use`.
- The official Puter MCP server (https://mcp.puter.com/) exposes fs/workers/KV/hosting/apps
  tools but **no chat tool** — text generation is genuinely missing in MCP-land. This repo
  will add it.
- Puter exposes **no native OpenAI-compatible REST endpoint**. Puter.js uses the same
  `interface`/`driver`/`method`/`args` driver-call pattern this repo already uses for images
  (`POST https://api.puter.com/drivers/call`). Chat interface is expected to be
  `puter-chat-completion` (method `complete`) — **confirm exact interface/method/driver and
  the streaming wire format from the puter-js source during implementation.**

### This repo (existing, working)
- `src/puter/client.ts` — `callDriver()` does `POST {PUTER_API_BASE}/drivers/call` with
  Bearer token + `Origin`/`Referer` headers; response normalization for image results.
  Image generation (`context: 'puter-image-generation'`, `driver: 'ai-image'`) works
  server-side. Chat is the identical mechanism with a different interface.
- `src/puter/auth.ts` — `AuthManager` resolves token from `PUTER_AUTH_TOKEN` env or
  `~/.puter-mcp/config.json`.
- `src/server.ts` — registers MCP tools over stdio.
- `scripts/mcp-smoke.js`, `tests/` (vitest; live tests gated on `PUTER_AUTH_TOKEN`).

### opencode integration
- opencode custom provider: `"npm": "@ai-sdk/openai-compatible"`, `options.baseURL`,
  `models` map. Models appear in `/models` picker; requires the endpoint to speak
  `/v1/chat/completions` (+ `/v1/models`). Since Puter isn't OpenAI-compatible, a small
  local translation bridge is required. Docs: https://opencode.ai/docs/providers/
  ("Custom provider" section).

## Decisions (confirmed with user)

1. **Integration surface**: Local OpenAI-compatible bridge **plus** an MCP `chat` tool
   (bridge for opencode `/models`; MCP tool supports any MCP client).
2. **Agentic depth (v1)**: full — messages, streaming (SSE), tool/function calling,
   temperature/max_tokens.
3. **Verification**: prefer Puter `testMode` (no credits) where possible; unit-test the
   rest. Account currently has 0 credits → live success depends on testMode/credited token.
4. **Project status**: drop the `deprecated`/archived markers; revive and document.

## Architecture

```
opencode ───(OpenAI /v1)──▶ [HTTP bridge :47831] ──▶ PuterClient.chat() ──▶ api.puter.com/drivers/call
                              (src/bridge/)              (src/puter/client.ts)
                                                                          interface: 'puter-chat-completion'
                                                                          method: 'complete'
```

### Files (new/changed)

1. **`src/puter/client.ts`** — add `chat(messages, options)`:
   - non-stream: returns normalized `ChatResult`.
   - stream: `callDriverStream` POST + parse streamed chunks (SSE/NDJSON) → `onChunk`.
   - Reuses Bearer + Origin/Referer.
2. **`src/bridge/translate.ts`** (new) — pure translation functions:
   - OpenAI `/v1/chat/completions` request → Puter chat args.
   - Puter `ChatResponse` → OpenAI `chat.completion` (choices, message.content, tool_calls).
   - Puter stream chunk → OpenAI SSE `delta` (`content`, `tool_calls`).
   - Errors → OpenAI error JSON with correct status codes.
3. **`src/bridge/server.ts`** (new) — `http.createServer`:
   - `POST /v1/chat/completions` (SSE when `stream:true`).
   - `GET /v1/models` — chat model list (live via Puter API if available, else curated).
   - Token from `AuthManager` (env or stored config) → opencode `apiKey` may be a dummy.
   - Env: `PUTER_BRIDGE_PORT` (default 47831), `PUTER_TEST_MODE` (default false;
     overridable per-request via `X-Puter-Test-Mode` header).
4. **`src/tools/chat.ts`** (new) — MCP tools:
   - `chat`: `messages: [{role, content}]`, `model?`, `temperature?`, `maxTokens?`,
     `testMode?` → non-streaming text result naming the model used.
   - `list_chat_models`: list Puter chat models (reuses bridge model listing logic).
5. **`src/server.ts`** — register `chat` and `list_chat_models`.
6. **`bin/puter-mcp.mjs`** — add `--bridge [port]` flag to run the HTTP bridge
   (stdio MCP server stays the default).
7. **Tests**:
   - `tests/bridge.test.ts` — translation units + `/v1/models` + `/v1/chat/completions`
     (mocked fetch), incl. streaming and tool-call round-trip and error mapping.
   - `tests/chat-live.test.ts` — token-gated live test using `testMode:true`.
   - Adjust existing tests/smoke if tool count/registration changes.
8. **Status/README**:
   - `package.json`: remove `"deprecated": true`; update description/keywords.
   - `README.md`: remove archived banner; document free LLM chat, bridge setup, and the
     opencode provider config:
     ```jsonc
     "provider": {
       "puter": {
         "npm": "@ai-sdk/openai-compatible",
         "name": "Puter (free)",
         "options": { "baseURL": "http://127.0.0.1:47831/v1" },
         "models": {
           "openai/gpt-5-nano": { "name": "GPT-5 Nano (Puter)" }
           // ... curated set; ids MUST match GET /v1/models
         }
       }
     }
     ```
9. **User opencode config** (`~/.config/opencode/opencode.jsonc`) — add the `puter`
   provider block alongside the existing `puter` MCP server entry.

### Build order

1. `chat()` (+ `callDriverStream`) in `src/puter/client.ts`.
2. `translate.ts` + `tests/bridge.test.ts` (pure units, mocked fetch).
3. `bridge/server.ts` (+ endpoint tests).
4. MCP `chat` + `list_chat_models` tools; register in `server.ts`.
5. `bin` `--bridge` flag.
6. README + package.json revive.
7. opencode config provider block.
8. Verify (see below).

## Risks / unknowns (resolve from puter-js source, then confirm live)

- Exact chat `interface`/`method` and whether a `driver` field is needed.
  (Image required `driver: 'ai-image'`; chat likely uses only the interface.)
- `/drivers/call` streaming wire format (SSE vs NDJSON) and chunk field names
  (`text`, `tool_use`, `error`, `done`).
- Chat model-listing endpoint availability for `/v1/models` (else curated fallback).
- Server-side rate limits (old README warned about them); mitigated via `testMode`.
- Credit economics: chat is User-Pays; the current account is at 0 credits, so a live
  non-test success ultimately needs a credited token.

## Success check

- `npm run build && npm run lint && npm test` all green.
- Bridge boots: `curl /v1/models` lists models; `curl /v1/chat/completions` (testMode)
  returns a completion or a clean mapped error.
- MCP tool list includes `puter_chat` / `puter_list_chat_models`.
- `~/.opencode/bin/opencode mcp list` still shows `puter` connected; Puter provider models
  appear in opencode's `/models` picker.

## Implementation log (what was actually done)

Implemented on 2026-08-11. Everything in the plan shipped; the notable **differences from
the plan** are called out inline.

### Changes made

1. **`src/puter/client.ts`** — added chat capability:
   - `chat(messages, options)` — non-stream + stream.
   - Streaming is implemented as a private `callChatStream()` (not `callDriverStream` as
     the plan named it), plus shared `buildRequestBody()`/`requestHeaders()` helpers.
   - `DriverCallParams` gained an optional `testMode` field → `body.test_mode = true`.
   - `args.stream` is always set (`true`/`false`) for chat calls.
   - `listChatModels()` uses `GET {PUTER_API_BASE}/puterai/chat/models/details` (Bearer
     header included when a token exists) and filters hidden ids
     (`fake`, `abuse`, `costly`, `model-fallback-test-1`).
   - NDJSON parser tolerates malformed lines and surfaces `error` chunks as errors.

2. **`src/bridge/translate.ts`** (new) — as planned. `translateRequest` returns
   `{ messages, options }` (model/temperature/maxTokens/tools), not a raw `args` blob.
   `translateResponse`/`translateStreamChunk`/`translateError`/`createSSEState` all match
   the plan. `tool_use` chunks serialize their `input` object to JSON-string `arguments`.

3. **`src/bridge/server.ts`** (new) — as planned:
   - `GET /v1/models` uses the **live** Puter details endpoint directly (no curated
     fallback was needed — it returned 866 models during the smoke test).
   - `POST /v1/chat/completions` with SSE (stream) and JSON (non-stream).
   - No-token → OpenAI-style `401 authentication_error`; Puter HTTP errors → OpenAI error
     JSON with status preserved (e.g. `402 insufficient_funds`, `401 reauth_required`).
   - `X-Puter-Test-Mode: true/false` per-request override, else `PUTER_TEST_MODE` env,
     else default.

4. **`src/tools/chat.ts`** (new) — MCP `chat` + `list_chat_models` as planned;
   `chat` validates model ids with `/^[a-zA-Z0-9_.:-]+\/[a-zA-Z0-9_.:-]+$/`.

5. **`src/server.ts`** — registers `chat` and `list_chat_models` (verified: MCP handshake
   lists `generate_image, list_models, chat, list_chat_models`).

6. **`bin/puter-mcp.mjs`** — `--bridge [port]` added; confirmed the process must NOT call
   `process.exit(0)` after `listen()` (would kill the server). Help text updated.

7. **Tests** — plan named `tests/chat.test.ts`, `tests/translate.test.ts`,
   `tests/bridge.test.ts`, and live additions. **Per user request ("no need to add
   tests") these were NOT kept** — the unit/bridge tests were removed and
   `tests/live.test.ts` was left with only its original image tests. Verification is
   limited to `npm run build`, `npm run lint`, the MCP handshake, and the bridge smoke
   tests (all captured under "Verification results" below).

8. **README + package.json** — revived exactly as planned (`deprecated` removed,
   description/keywords updated, archived banner deleted, bridge + provider docs added).

9. **`~/.config/opencode/opencode.jsonc`** — `puter` provider added with **14 models
   verified live** against `GET /v1/models` (real id format is **unprefixed**, e.g.
   `gpt-5-nano`, not `openai/gpt-5-nano` as the plan's example suggested). README sample
   config updated to match.

### Wire-format confirmation (from Plan "Risks / unknowns")

- Chat interface/method: `interface: 'puter-chat-completion'`, `method: 'complete'`; a
  `driver` is optional (default driver `ai-chat` infers provider from the model id).
- `test_mode` is a **top-level** body field (sibling of `interface`/`method`/`args`).
- Streaming response: `content-type: application/x-ndjson`, one JSON object per line with
  `type: text | tool_use | done | error` (`tool_use` carries `{ id, name, input }`).
- Chat model catalog: `GET /puterai/chat/models/details` → `{ models: [{ id, provider }] }`.

### Verification results

- `npm run build && npm run lint && npm test` — all green (13 passed, 3 live tests
  skipped: no token in environment).
- Bridge boot + `curl /v1/models` → 200, 866 models.
- `curl /v1/chat/completions`:
  - no token → clean OpenAI-style `401 authentication_error`;
  - dummy token → Puter `401 reauth_required` mapped cleanly to OpenAI error JSON
    (full end-to-end path bridge → `/drivers/call` verified; only a credited token is
    missing for a live successful completion).
- MCP stdio handshake lists all four tools.
- `opencode.jsonc` parses as valid JSON.

### Still-open item

- A successful live chat completion (non-test) requires a Puter token **with credits**
  (account currently at 0 credits). `testMode` was not exercised live for the same reason.

## Final note (custom bridge caveat)

- The bridge adds a long-running local HTTP process. Port fixed to 47831 by default,
  overridable via `PUTER_BRIDGE_PORT`.
- Keep scope surgical: do not refactor existing image-gen code beyond shared helpers.