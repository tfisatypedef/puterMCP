import { describe, it, expect } from 'vitest';
import { PuterClient } from '../src/puter/client.js';
import { AuthManager } from '../src/puter/auth.js';

// Load token from environment or config
const token = process.env.TEST_PUTER_TOKEN || process.env.PUTER_AUTH_TOKEN;

// Only run these tests if a token is available
const runIfToken = token ? describe : describe.skip;

runIfToken('Live Integration Tests', () => {
  const authManager = new AuthManager();

  // Force the auth manager to use our test token
  if (token) {
    authManager.getToken = async () => token;
  }

  const client = new PuterClient(authManager);

  it('should generate an image using OpenAI (GPT Image)', async () => {
    const result = await client.generateImage('A minimal red square', {
      model: 'gpt-image-1-mini',
      quality: 'low'
    });

    expect(result.mimeType).toMatch(/^image\//);
    expect(result.base64).toBeDefined();
    expect(result.base64!.length).toBeGreaterThan(100);
  }, 60000); // 60s timeout

  it('should generate an image using Google (Gemini Nano)', async () => {
    const result = await client.generateImage('A minimal blue circle', {
      model: 'gemini-3.1-flash-image-preview'
    });

    expect(result.mimeType).toMatch(/^image\//);
    expect(result.base64).toBeDefined();
  }, 60000);

  it('should generate an image using Together (Flux)', async () => {
    const result = await client.generateImage('A minimal green triangle', {
      model: 'black-forest-labs/FLUX.1-schnell'
    });

    expect(result.base64 || result.url).toBeDefined();
    if (result.base64) {
      expect(result.mimeType).toMatch(/^image\//);
    }
  }, 60000);
});
