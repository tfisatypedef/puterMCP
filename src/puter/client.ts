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

const DATA_URI_PATTERN = /^data:image\/([a-zA-Z0-9.+-]+);base64,([\s\S]+)$/;

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
