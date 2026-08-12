# puterMCP Review + Free-Usage Fix Plan

## Scope

Review of commit `5155600` (HEAD) "feat: add LLM chat + OpenAI-compatible bridge on Puter" (9 files, +1240/−30, baseline parent `2a431e9`), plus research into how to use Puter's free usage. Sources: `docs.puter.com`, `developer.puter.com/tutorials/free-unlimited-openai-api/`, and the `HeyPuter/puter` backend source (`AIChatService.complete()`, `MeteringService`, `zai/models.ts`).

## Review findings

### Critical

**1. Bridge binds to all network interfaces — Puter token / credit drain exposed**
- Location: `bin/puter-mcp.mjs` → `src/bridge/server.ts:84` — `server.listen(port)` with no host.
- Node binds this to `::` (all interfaces). Verified:
  - `listen(port)` binds to `{ address: '::' }` (LAN-reachable)
  - `listen(port, '127.0.0.1')` binds to `127.0.0.1` (intended)
- `/v1/chat/completions` has **no auth** and uses the stored Puter token, so any LAN-reachable host can spend the user's Puter balance. The help text prints `http://127.0.0.1:${port}`, which is misleading.
- Fix: `server.listen(port, '127.0.0.1')`.

### Important

**2. MCP `chat` tool regex rejects the model ids the tool itself lists**
- Location: `src/tools/chat.ts:8` — `CHAT_MODEL_RE = /^[a-zA-Z0-9_.:-]+\/[a-zA-Z0-9_.:-]+$/` requires a `/`.
- Verified live against `GET /puterai/chat/models/details` (866 models): **162 ids are unprefixed** (`gpt-5-nano`, `gpt-4o-mini`, `glm-4.7-flash`, …) and fail the regex — including the documented default model. The tool's own example `openai/gpt-4o-mini` is **not** in the catalog (only `openrouter:openai/gpt-4o-mini` / `infron:openai/gpt-4o-mini` exist).
- Repro: `list_chat_models` → copy `gpt-5-nano` → `chat(model: "gpt-5-nano")` → zod error.
- Fix: accept unprefixed ids (`^[a-zA-Z0-9_.:-]+(?:\/[a-zA-Z0-9_.:-]+)?$`).

**3. `testMode` documented as "free, no credits consumed" — false per Puter's backend**
- Location: `src/tools/chat.ts:66` ("Use Puter's free test API (no credits consumed)") and README.
- Puter's `AIChatService.complete()` calls `meteringService.hasEnoughCredits(actor, ...)` **unconditionally**; `test_mode` only skips moderation and routes to the `abuse` model. It does **not** bypass the credit gate. A 0-credit token gets `402 insufficient_funds` regardless of `testMode`. This contradicts the marketing at docs.puter.com and misleads users on the free-usage path.
- Fix: correct the docs/tool description (testMode ≠ free).

**4. Duplicate SSE error events on stream failure**
- Location: `src/bridge/server.ts:143-160`.
- `callChatStream`'s `handleChunk` (client.ts:481-502) calls `onChunk` *before* throwing on `error` chunks, so the bridge sends one error SSE line from `onChunk`, then `client.chat()` rejects and the catch sends a **second** one (always `500`, even if the real error was 402).
- Fix: don't emit in `onChunk` for `error`; let the thrown error reach the catch, which sends one error using `err.statusCode` when valid.

*Caveat (not reported):* `normalizeChatResult` (client.ts:390-394) drops non-string `content`; some models return content arrays (`{type:'text'}` blocks), which would yield empty replies. Confidence < 80 without a live credited call — verify during implementation.

## Free-usage research

- **User-Pays model**: every Puter user gets a **free monthly allowance**; usage bills against it. "0 credits" = that account's allowance is exhausted. A fresh/credited token (or the monthly reset) restores paid-model usage.
- **Zero-cost models bypass the credit gate**: `glm-4.5-flash`, `glm-4.7-flash`, `glm-4.6v-flash`, `autoglm-phone-multilingual` (all `zai` provider, `usdPerMToken(0,0,0)` in `zai/models.ts`). `hasEnoughCredits(actor, 0) ⇒ remaining ≥ 0` is always true (`MeteringService.getRemainingUsage` is clamped to ≥ 0), so **these work even at 0 credits**.
- **testMode ≠ free** (Finding 3).
- All 14 model ids in `~/.config/opencode/opencode.jsonc` are valid in the live catalog; `/v1/models` returns 866 ids.

## Fix / implementation plan

1. **Review fixes**
   - `bin/puter-mcp.mjs` / `src/bridge/server.ts`: bind `127.0.0.1`; single SSE error emission with correct status.
   - `src/tools/chat.ts`: relax `CHAT_MODEL_RE`; fix example id; correct `testMode` description.
   - README: replace "testMode = no credits" with the accurate credit-gate behavior.

2. **Zero-cost free-usage path**
   - `src/constants.ts`: add `FREE_CHAT_MODELS = ['glm-4.7-flash', 'glm-4.5-flash', 'glm-4.6v-flash', 'autoglm-phone-multilingual']` and `CHAT_FALLBACK_MODEL = 'glm-4.7-flash'`.
   - `src/puter/client.ts`: add `chatWithFreeFallback(messages, options)` — on `PuterApiError` code `insufficient_funds`/status 402, retry once with `CHAT_FALLBACK_MODEL` (works for stream and non-stream; the 402 arrives before any stream body).
   - `src/bridge/server.ts` + `src/tools/chat.ts`: route chat through the fallback wrapper; mark free models in `ChatModelInfo` (from the `costs` field on `/puterai/chat/models/details`) and sort them first in `/v1/models` and `list_chat_models` (annotated `(free)`).
   - `~/.config/opencode/opencode.jsonc` (outside repo): add `glm-4.7-flash`, `glm-4.5-flash`, `glm-4.6v-flash` as "free" entries in the `puter` provider.
   - README: document the free models and the fallback behavior.

3. **Monthly-allowance path (docs)**
   - README: explain the User-Pays model — paid models consume the account's free monthly allowance; a fresh account or the monthly reset restores it; reference `puter.auth.getMonthlyUsage()`. Note the current token's account is at 0.

4. **Tests**
   - `tests/bridge.test.ts` (new): assert `createBridgeServer().address()` binds `127.0.0.1`; assert exactly one error event on stream failure; assert fallback retries on 402 with the free model.
   - `tests/client.test.ts`: add regex/fallback unit cases.

5. **Verify**
   - `npm run build && npm run lint && npm test`.
   - Live with the current 0-credit token: `chat(model:"glm-4.7-flash")` via MCP and `curl http://127.0.0.1:47831/v1/chat/completions` — expect success with zero credits.

## Constraints

- Do not waste credits probing paid models; verification of free usage uses only zero-cost models (`glm-4.7-flash`).
- Keep scope surgical — do not refactor existing image-gen code beyond shared constants/helpers.
