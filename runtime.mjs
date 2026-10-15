import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = dirname(fileURLToPath(import.meta.url));

export function loadSettings(env = process.env) {
  const models = [...new Set((env.KIRO_ACP_MODELS ?? 'claude-sonnet-5').split(',').map(value => value.trim()).filter(Boolean))];
  if (!models.length || models.some(model => !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model))) {
    throw new Error('KIRO_ACP_MODELS must contain comma-separated exact Kiro model IDs');
  }
  const port = Number(env.KIRO_ACP_PORT ?? 11437);
  const timeout = Number(env.KIRO_ACP_TIMEOUT ?? 180_000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('KIRO_ACP_PORT must be an integer from 0 to 65535');
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new Error('KIRO_ACP_TIMEOUT must be a positive timer-safe integer');
  const installedCli = join(homedir(), '.local/bin/kiro-cli');
  return {
    models, port, timeout,
    cli: env.KIRO_CLI || (existsSync(installedCli) ? installedCli : 'kiro-cli'),
    keyFile: resolve(env.KIRO_ACP_KEY_FILE || join(root, 'api-key')),
    tempRoot: resolve(env.KIRO_ACP_TEMP_DIR || join(tmpdir(), 'opencode')),
  };
}

export function providerConfig(settings) {
  if (settings.port === 0) throw new Error('Choose a fixed port before generating OpenCode configuration');
  return {
    $schema: 'https://opencode.ai/config.json',
    providers: {
      'kiro-acp': {
        name: 'Kiro ACP (experimental)',
        package: '@opencode/ai/providers/openai-compatible',
        settings: { baseURL: `http://127.0.0.1:${settings.port}/v1`, apiKey: `{file:${settings.keyFile}}` },
        models: Object.fromEntries(settings.models.map(id => [id, {
          name: `${id} via Kiro ACP`, variants: [],
          capabilities: { tools: true, input: ['text'], output: ['text'] },
          limit: { context: 32768, output: 4096 },
        }])),
      },
    },
  };
}
