import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AuthManager } from '../src/puter/auth.js';

// Mock fs, path, os
vi.mock('node:fs');
vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
  resolve: vi.fn((...args: string[]) => args.join('/')),
  dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
}));
vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock/home'),
}));

describe('AuthManager', () => {
  const mockHomeDir = '/mock/home';
  const mockConfigDir = '/mock/home/.puter-mcp';
  const mockConfigFile = '/mock/home/.puter-mcp/config.json';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load token from environment variable', async () => {
    process.env.PUTER_AUTH_TOKEN = 'env-token';
    const authManager = new AuthManager();
    const token = await authManager.getToken();
    expect(token).toBe('env-token');
    delete process.env.PUTER_AUTH_TOKEN;
  });

  it('should load token from config file if env var is missing', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({ authToken: 'file-token' }));

    const authManager = new AuthManager();
    const token = await authManager.getToken();
    expect(token).toBe('file-token');
  });

  it('should return undefined if no token found', async () => {
    (fs.existsSync as any).mockReturnValue(false);
    const authManager = new AuthManager();
    const token = await authManager.getToken();
    expect(token).toBeUndefined();
  });

  it('should save token to config file', () => {
    const authManager = new AuthManager();
    (fs.existsSync as any).mockReturnValue(false); // Dir doesn't exist

    authManager.setToken('new-token');

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.puter-mcp'), { recursive: true, mode: 0o700 });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('config.json'),
      JSON.stringify({ authToken: 'new-token' }, null, 2),
      { mode: 0o600 }
    );
  });
});
