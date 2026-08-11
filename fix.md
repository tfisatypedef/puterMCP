# puterMCP Fix Plan

## Problem

puterMCP (deprecated/archived) does not work against Puter's current API. Root causes traced through the actual Puter source (`HeyPuter/puter`):

### 1. Stale hardcoded model catalog (root cause)
The repo **never pulls** models from Puter. `SUPPORTED_MODELS`, `DEFAULT_MODEL`, and `MODEL_FALLBACK_CHAIN` in `src/constants.ts` are hardcoded strings from an older Puter API generation. `list_models` prints them verbatim; `resolveModelToDriver()` maps by prefix.

Puter's backend builds its **live** catalog at boot from provider configs (`ImageGenerationDriver.#buildModelMap`, keyed by lowercased id/aliases). Sending a stale id produces:
- **HTTP 400 `Model not found: <id>`** for removed models (`dall-e-3`, `dall-e-2`, `FLUX.1-pro`, `FLUX.1-dev`, `FLUX.1-kontext-dev`, `FLUX.1-Canny-pro`, `FLUX.1-dev-lora`, `FLUX.1-schnell-Free`) — from `ImageGenerationDriver.generate()`.
- **HTTP 404 NOT_FOUND** for renamed/retired upstream models (e.g. `gemini-2.5-flash-image-preview` 404s at Google's Gemini API; see HeyPuter/puter issue #2301).

### 2. Response-shape drift
`ImageGenerationDriver` now returns `result` as a **string** (a `data:image/<mime>;base64,…` URI or a web URL). puter-js `txt2img` does `transform: result => url = result`. The repo expects `{ base64, mimeType }` or raw bytes, so `.base64`/`.mimeType` come back `undefined` and the tool emits an invalid MCP image block (`-32602 Invalid tools/call result`).

### 3. Dead default
`DEFAULT_MODEL = 'dall-e-3'` → 400. Puter's own default is now `gpt-image-1-mini`.

### 4. Broken unit suite
`tests/auth.test.ts` mocks `node:path` without `dirname`, but `src/puter/auth.ts:13` calls `path.dirname` → the whole suite crashes at import.

### Notes
- The request framing is already correct: `interface: 'puter-image-generation'`, `method: 'generate'`. puter-js passes `driver: 'ai-image'` (the canonical `driverName`); the repo passes provider-name aliases which the driver accepts, so the driver slot is not the problem — but we'll switch to `'ai-image'` for robustness.
- Current valid catalog confirmed verbatim from `src/backend/drivers/ai-image/providers/{openai,gemini,together}/models.ts`.

## Fix

1. **`src/constants.ts`** — refresh static snapshot to the current valid catalog:
   - `DEFAULT_MODEL` → `gpt-image-1-mini`
   - `MODEL_FALLBACK_CHAIN` → `['gpt-image-1-mini', 'gpt-image-2', 'gpt-image-1.5', 'black-forest-labs/FLUX.1-schnell']`
   - `SUPPORTED_MODELS` → current set (gpt-image-2/1.5/1-mini/1; gemini-3.1-flash-image-preview, gemini-3-pro-image-preview, gemini-2.5-flash-image(-preview), imagen-4.0-fast/4.0/ultra, flash-image-2.5/3.1; FLUX.1-schnell/1.1-pro/kontext-max/kontext-pro/krea-dev, FLUX.2-dev/flex/max/pro, Seedream-3.0/4.0, HiDream I1 Dev/Fast/Full, DreamShaper, Qwen-Image/2.0/2.0-Pro, Juggernaut-pro-flux/Lightning-Flux, Wan2.6-image, ideogram-3.0/4.0, SD3-medium, SDXL-base-1.0). Remove dead IDs.

2. **`src/puter/client.ts`** —
   - Send `driver: 'ai-image'` always (canonical, matches puter-js).
   - Normalize responses when `success:true` and `result` is a string:
     - `data:image/<mime>;base64,…` → `{ base64, mimeType, dataUrl }` (inline)
     - `http(s)://…` → `{ url }` (text link; no extra download call)
     - object result → unchanged (backward compat)
   - Add `listModels()` → `GET https://api.puter.com/puterai/image/models/details` (public, `requireAuth: false`; mirrors puter-js), returning `{ id, provider, name, quality[] }`.

3. **`src/tools/generate-image.ts`** — inline image when `base64` present; clickable text link when only `url`; keep auth check, fallback chain, and clean error surfacing.

4. **`src/tools/list-models.ts`** — try `client.listModels()` (live catalog); on failure/empty fall back to `SUPPORTED_MODELS`; keep category filter.

5. **`tests/auth.test.ts`** — add `dirname` to the `node:path` mock.

6. **Tests/smoke** — `tests/client.test.ts`: add data-URI and web-URL response cases + a `listModels` test; `tests/live.test.ts` and `scripts/mcp-smoke.js`: swap `dall-e-3` → `gpt-image-1-mini`.

7. **Verify** —
   - `npm run build && npm run lint && npm test`
   - Exactly **one** live `generate_image` (`gpt-image-1-mini`) via the SDK client to confirm a valid inline image is returned.
   - `opencode mcp list` still shows the server `connected`.

## Constraints

- Do **not** waste Puter API credits probing models. The model catalog comes from the public no-auth listing endpoint (`/puterai/image/models/details`) or the bundled static snapshot — never from generation calls.
- Only the single verification generation call above is made against the live API.

## Execution status (updated)

Completed: constants refresh, client.ts driver/normalization/listModels, generate-image.ts, list-models.ts, auth.test.ts mock fix, test/smoke updates, error-message surfacing from API bodies.

Verified: `npm run build` clean, `npm run lint` clean, unit tests 13/13 pass (live tests skip without token). Live e2e via SDK client: server connects, `list_models` returns the live 59-model catalog, `generate_image` returns a clean text error (`Insufficient credits for image generation (HTTP 402)`) instead of the previous `-32602` protocol error. `opencode mcp list` shows `puter connected`.

Not verified: a successful inline-image response. The Puter account is out of free credits (402), so the single verification call could not return an image. Retry requires a token with credits.
