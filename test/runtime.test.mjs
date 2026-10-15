import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, providerConfig } from '../runtime.mjs';

test('validates and deduplicates exact model IDs', () => {
  assert.deepEqual(loadSettings({ KIRO_ACP_MODELS: 'model-a,model-b,model-a' }).models, ['model-a', 'model-b']);
  for (const value of ['', ',', 'model with spaces', '../model']) {
    assert.throws(() => loadSettings({ KIRO_ACP_MODELS: value }), /model IDs/);
  }
});
test('rejects invalid ports and timer values', () => {
  for (const value of ['NaN', '-1', '65536', '1.5']) assert.throws(() => loadSettings({ KIRO_ACP_PORT: value }), /PORT/);
  for (const value of ['0', '-1', 'NaN', '1.5', '2147483648']) assert.throws(() => loadSettings({ KIRO_ACP_TIMEOUT: value }), /TIMEOUT/);
});
test('generates a V2 provider snippet using a file reference, not a key value', () => {
  const config = providerConfig({ models: ['model-a', 'model-b'], port: 11437, keyFile: '/example/private/api-key' });
  const provider = config.providers['kiro-acp'];
  assert.equal(provider.package, '@opencode/ai/providers/openai-compatible');
  assert.equal(provider.settings.apiKey, '{file:/example/private/api-key}');
  assert.deepEqual(Object.keys(provider.models), ['model-a', 'model-b']);
  assert.deepEqual(provider.models['model-a'].variants, []);
  assert.equal(config.model, undefined);
});
test('does not generate a client endpoint for an automatically assigned port', () => {
  assert.throws(() => providerConfig({ models: ['model-a'], port: 0, keyFile: '/example/api-key' }), /fixed port/);
});
