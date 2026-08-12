
export interface ModelInfo {
  id: string;
  displayName?: string;
  category: 'openai' | 'google' | 'flux' | 'stable-diffusion' | 'other';
  quality?: string[];  // Supported quality levels
  notes?: string;
}

/**
 * Static snapshot of Puter's image-generation model catalog.
 *
 * This is only a fallback: the `list_models` tool prefers the live catalog
 * from `GET https://api.puter.com/puterai/image/models/details`. Keep this
 * list in sync with Puter's `src/backend/drivers/ai-image/providers/{openai,gemini,together}/models.ts`.
 */
export const SUPPORTED_MODELS: ModelInfo[] = [
  // OpenAI Models
  { id: 'gpt-image-2',          displayName: 'GPT Image 2',          category: 'openai', quality: ['low', 'medium', 'high', 'auto'] },
  { id: 'gpt-image-1.5',        displayName: 'GPT Image 1.5',        category: 'openai', quality: ['low', 'medium', 'high'] },
  { id: 'gpt-image-1',          displayName: 'GPT Image 1',          category: 'openai', quality: ['low', 'medium', 'high'] },
  { id: 'gpt-image-1-mini',     displayName: 'GPT Image 1 Mini',     category: 'openai', quality: ['low', 'medium', 'high'] },

  // Google / Gemini Models
  { id: 'gemini-3.1-flash-image-preview', displayName: 'Nano Banana 2 (Gemini 3.1 Flash)', category: 'google', quality: ['512', '1K', '2K', '4K'], notes: 'Fast, pro-level quality' },
  { id: 'gemini-3-pro-image-preview',     displayName: 'Nano Banana Pro (Gemini 3 Pro)',    category: 'google', quality: ['1K', '2K', '4K'],    notes: 'Best text rendering' },
  { id: 'gemini-2.5-flash-image-preview', displayName: 'Nano Banana (Gemini 2.5 Flash)',    category: 'google', notes: 'Supports img2img' },
  { id: 'google/flash-image-2.5',         displayName: 'Google Flash Image 2.5',            category: 'google', quality: ['1K'] },
  { id: 'google/flash-image-3.1',         displayName: 'Google Flash Image 3.1',            category: 'google', quality: ['0.5K', '1K', '2K', '4K'] },
  { id: 'google/imagen-4.0-fast',         displayName: 'Google Imagen 4.0 Fast',            category: 'google' },
  { id: 'google/imagen-4.0',              displayName: 'Google Imagen 4.0',                 category: 'google', quality: ['1K', '2K'] },
  { id: 'google/imagen-4.0-ultra',        displayName: 'Google Imagen 4.0 Ultra',           category: 'google', quality: ['1K', '2K'] },

  // Flux Models
  { id: 'black-forest-labs/FLUX.1-schnell',      displayName: 'Flux.1 Schnell',      category: 'flux', notes: 'Fast generation' },
  { id: 'black-forest-labs/FLUX.1.1-pro',        displayName: 'Flux 1.1 Pro',        category: 'flux' },
  { id: 'black-forest-labs/FLUX.1-kontext-max',  displayName: 'Flux.1 Kontext Max',  category: 'flux' },
  { id: 'black-forest-labs/FLUX.1-kontext-pro',  displayName: 'Flux.1 Kontext Pro',  category: 'flux' },
  { id: 'black-forest-labs/FLUX.1-krea-dev',     displayName: 'Flux.1 Krea Dev',     category: 'flux' },
  { id: 'black-forest-labs/FLUX.2-dev',          displayName: 'Flux.2 Dev',          category: 'flux' },
  { id: 'black-forest-labs/FLUX.2-flex',         displayName: 'Flux.2 Flex',         category: 'flux' },
  { id: 'black-forest-labs/FLUX.2-max',          displayName: 'Flux.2 Max',          category: 'flux' },
  { id: 'black-forest-labs/FLUX.2-pro',          displayName: 'Flux.2 Pro',          category: 'flux' },

  // Stable Diffusion Models
  { id: 'stabilityai/stable-diffusion-3-medium',       displayName: 'Stable Diffusion 3 Medium',  category: 'stable-diffusion' },
  { id: 'stabilityai/stable-diffusion-xl-base-1.0',    displayName: 'Stable Diffusion XL Base',   category: 'stable-diffusion' },

  // Other Models
  { id: 'ByteDance-Seed/Seedream-3.0',           displayName: 'ByteDance Seedream 3.0',   category: 'other' },
  { id: 'ByteDance-Seed/Seedream-4.0',           displayName: 'ByteDance Seedream 4.0',   category: 'other' },
  { id: 'HiDream-ai/HiDream-I1-Dev',             displayName: 'HiDream I1 Dev',           category: 'other' },
  { id: 'HiDream-ai/HiDream-I1-Fast',            displayName: 'HiDream I1 Fast',          category: 'other' },
  { id: 'HiDream-ai/HiDream-I1-Full',            displayName: 'HiDream I1 Full',          category: 'other' },
  { id: 'Lykon/DreamShaper',                      displayName: 'Lykon DreamShaper',        category: 'other' },
  { id: 'Qwen/Qwen-Image',                       displayName: 'Qwen Image',               category: 'other' },
  { id: 'Qwen/Qwen-Image-2.0',                   displayName: 'Qwen Image 2.0',           category: 'other' },
  { id: 'Qwen/Qwen-Image-2.0-Pro',               displayName: 'Qwen Image 2.0 Pro',       category: 'other' },
  { id: 'RunDiffusion/Juggernaut-pro-flux',       displayName: 'Juggernaut Pro Flux',      category: 'other' },
  { id: 'Rundiffusion/Juggernaut-Lightning-Flux', displayName: 'Juggernaut Lightning',     category: 'other' },
  { id: 'Wan-AI/Wan2.6-image',                   displayName: 'Wan 2.6 Image',            category: 'other' },
  { id: 'ideogram/ideogram-3.0',                  displayName: 'Ideogram 3.0',            category: 'other' },
  { id: 'ideogram/ideogram-4.0',                  displayName: 'Ideogram 4.0',            category: 'other' },
];

export const DEFAULT_MODEL = 'gpt-image-1-mini';
export const PUTER_API_BASE = 'https://api.puter.com';

/**
 * Chat models that cost $0 (verified live: `costs.prompt_tokens` and
 * `costs.completion_tokens` are both 0 in `/puterai/chat/models/details`).
 * These work even when the account's monthly allowance is exhausted, because
 * Puter's credit gate (`hasEnoughCredits(actor, 0)`) always passes for $0.
 */
export const FREE_CHAT_MODELS = [
  'glm-4.7-flash',
  'glm-4.5-flash',
  'glm-4.6v-flash',
  'autoglm-phone-multilingual',
];

/**
 * Default free model used when a paid chat call fails with `insufficient_funds`
 * (402), so chat keeps working once the account's free monthly allowance runs out.
 */
export const CHAT_FALLBACK_MODEL = 'glm-4.7-flash';
export const MODEL_FALLBACK_CHAIN = [
  'gpt-image-1-mini',
  'gpt-image-2',
  'gpt-image-1.5',
  'black-forest-labs/FLUX.1-schnell',
];
export const FALLBACK_ERROR_PATTERNS = [
  'insufficient',
  'forbidden',
  'rate limit',
  'unavailable',
  'quota',
  'billing',
  'credit',
  'payment',
];
