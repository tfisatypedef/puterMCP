# puterMCP

A TypeScript/Node.js [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that runs locally via `npx` and acts as a bridge between any MCP-compatible LLM environment (Claude Desktop, Kilo Code, Trae, Cursor, Windsurf, opencode, etc.) and [Puter](https://puter.com)'s free AI APIs.

puterMCP ships two capabilities:

1. **Image generation** across 30+ models (GPT Image, DALL-E, Gemini Nano Banana, Flux, Stable Diffusion, and more).
2. **Generative text (LLM chat)** across 500+ models (GPT, Claude, Gemini, Grok, and more) — including an OpenAI-compatible HTTP bridge so that opencode (and any OpenAI-compatible client) can run its chat on Puter's free models.

All without API keys or per-request costs (Puter bills usage against your account's free credits).

## Features

- **Zero Friction**: Install and run with a single `npx` command.
- **Free Image Generation**: Access 30+ models including DALL-E 3, Flux.1, and Stable Diffusion via Puter's free tier.
- **Free LLM Chat**: Access 500+ text models; supports streaming, tool/function calling, temperature, and max tokens.
- **OpenAI-Compatible Bridge**: Run Puter models in opencode's `/models` picker via a local `/v1/chat/completions` endpoint.
- **Secure Authentication**: Uses your personal Puter account token, stored locally and securely.
- **Universal Compatibility**: Works with Claude Desktop, Cursor, Trae, opencode, and any other MCP client.
- **Inline Image Generation**: Images are returned directly in the chat interface, ready for preview and download.
- **Smart Fallback**: Automatically tries free models (like Flux) if premium models (like DALL-E 3) fail due to quota limits.
- **testMode**: Use Puter's free test API for chat to avoid spending credits.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- A free account on [Puter.com](https://puter.com)

## Installation & Setup

### 1. Authenticate with Puter

You need to provide your Puter authentication token to the MCP server. This is a one-time setup.

1. Log in to [puter.com](https://puter.com).
2. Open the browser Developer Tools (**F12** or **Cmd+Option+I**) -> **Console**.
3. Type `puter.authToken` and press Enter.
4. Copy the string (without quotes).
5. Run the following command in your terminal:

```bash
npx puter-mcp --token <your-token-here>
```

Your token will be securely stored in `~/.puter-mcp/config.json`. You can also set the `PUTER_AUTH_TOKEN` environment variable instead.

### 2. Configure Your MCP Client

#### Claude Desktop

Add the following to your `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "puter": {
      "command": "npx",
      "args": ["-y", "puter-mcp"]
    }
  }
}
```

#### Trae / Cursor / Kilo Code

Add the configuration to your project's MCP settings (e.g., `.kilo/mcp.json` or via the IDE settings UI):

```json
{
  "mcpServers": {
    "puter": {
      "command": "npx",
      "args": ["-y", "puter-mcp"]
    }
  }
}
```

### 3. Run opencode's chat on Puter (optional)

Start the OpenAI-compatible bridge (default port `47831`):

```bash
npx puter-mcp --bridge
```

Then add a `puter` provider to your opencode config (`~/.config/opencode/opencode.json` or `opencode.jsonc`):

```jsonc
{
  "provider": {
    "puter": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Puter (free)",
      "options": { "baseURL": "http://127.0.0.1:47831/v1" },
      "models": {
        "gpt-5-nano":           { "name": "GPT-5 Nano (Puter)" },
        "gpt-4o-mini":          { "name": "GPT-4o mini (Puter)" },
        "claude-sonnet-4-6":    { "name": "Claude Sonnet 4.6 (Puter)" },
        "gemini-2.5-flash":     { "name": "Gemini 2.5 Flash (Puter)" },
        "grok-4":               { "name": "Grok 4 (Puter)" },
        "deepseek-v4-flash":    { "name": "DeepSeek V4 Flash (Puter)" }
      }
    }
  }
}
```

The bridge routes OpenAI `chat.completions` requests to Puter's chat interface. The model ids listed here must match what `GET /v1/models` returns (run `curl http://127.0.0.1:47831/v1/models` to see the live list). No API key is needed for the bridge — it uses your stored Puter token. Set `PUTER_TEST_MODE=true` (or send `X-Puter-Test-Mode: true`) to use Puter's free test API.

## Usage

Once configured, restart your LLM environment. You can now ask it to generate images or chat:

- "Generate a cyberpunk city at night using DALL-E 3"
- "Create a logo for a coffee shop using Flux.1 Schnell"
- "Show me what models are available"
- "Summarize the attached file in two sentences" (chat)
- "What free models can I use for text?" (`list_chat_models`)

### Available Tools

- **`generate_image`**: Generate an image from a text prompt.
  - `prompt`: Description of the image.
  - `model`: (Optional) Model ID (default: `dall-e-3`).
  - `quality`: (Optional) Quality setting (e.g., `hd`, `standard`).

- **`list_models`**: List all available image generation models.
  - `category`: (Optional) Filter by category (`all`, `openai`, `google`, `flux`, `stable-diffusion`, `other`).

- **`chat`**: Chat with Puter's free LLM models.
  - `messages`: Conversation history (`[{ role, content }]`).
  - `model`: (Optional) Puter model id (e.g., `openai/gpt-4o-mini`).
  - `temperature`: (Optional) Sampling temperature (0–2).
  - `maxTokens`: (Optional) Max response tokens.
  - `testMode`: (Optional) Use the free test API (default `false`).

- **`list_chat_models`**: List available LLM models.
  - `provider`: (Optional) Filter by provider (e.g., `openai-completion`, `anthropic`, `google`).

## Development

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/puter-mcp.git
   cd puter-mcp
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the project:

   ```bash
   npm run build
   ```

4. Run locally:

   ```bash
   node bin/puter-mcp.mjs
   ```

5. Run tests:

   ```bash
   npm test
   ```

Live tests (image + chat) require a Puter token and are skipped otherwise.

## License

MIT
