import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
let child;
let address;
let headers;
let directory;
before(async () => {
  const tempRoot = join(tmpdir(), 'opencode');
  await mkdir(tempRoot, { recursive: true });
  directory = await mkdtemp(join(tempRoot, 'kiro-acp-tests-'));
  const key = randomBytes(32).toString('hex');
  await writeFile(join(directory, 'api-key'), key, { mode: 0o600 });
  await chmod(`${root}/test/mock-kiro.mjs`, 0o700);
  headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: {
    ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, KIRO_ACP_KEY_FILE: join(directory, 'api-key'),
    KIRO_CLI: `${root}/test/mock-kiro.mjs`, KIRO_ACP_PORT: '0', KIRO_ACP_TIMEOUT: '5000',
    KIRO_ACP_MODELS: 'claude-sonnet-5',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Mock provider startup timed out')), 5000);
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Mock provider exited before listening')));
    child.stdout.once('data', data => {
      clearTimeout(timer);
      resolve(data.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0]);
    });
  });
});
after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

const input = content => ({ model: 'claude-sonnet-5', messages: [{ role: 'user', content }] });
const post = body => fetch(`${address}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
const tool = { type: 'function', function: { name: 'echo', description: 'Echo', parameters: { type: 'object', properties: { text: { type: 'string' } } } } };

test('requires the local key and rejects browser origins', async () => {
  assert.equal((await fetch(`${address}/health`)).status, 401);
  assert.equal((await fetch(`${address}/health`, { headers: { ...headers, origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(`${address}/health`, { headers })).status, 200);
});
test('rejects unsupported input before starting a Kiro turn', async () => {
  assert.equal((await post({ ...input('hello'), model: 'unlisted-model' })).status, 400);
  assert.equal((await fetch(`${address}/health`, { headers }).then(response => response.json())).activeTurns, 0);
});
test('text completion uses the selected model', async () => {
  const response = await post(input('hello'));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.model, 'claude-sonnet-5');
  assert.equal(result.choices[0].message.content, 'MOCK:hello');
});
test('stream terminates with a finish reason and DONE', async () => {
  const response = await post({ ...input('hello'), stream: true });
  const text = await response.text();
  assert.match(text, /text\/event-stream|MOCK:hello/);
  assert.match(text, /"finish_reason":"stop"/);
  assert.match(text, /data: \[DONE\]/);
});
test('returns a tool call without fabricating its result', async () => {
  const result = await post({ ...input('tool'), tools: [tool] }).then(response => response.json());
  const choice = result.choices[0];
  assert.equal(choice.finish_reason, 'tool_calls');
  assert.equal(choice.message.content, null);
  assert.equal(choice.message.tool_calls[0].function.name, 'echo');
  assert.deepEqual(JSON.parse(choice.message.tool_calls[0].function.arguments), { text: 'MOCK_TOOL_OK' });
  const continued = await post({ model: 'claude-sonnet-5', messages: [
    ...input('tool').messages, choice.message,
    { role: 'tool', tool_call_id: choice.message.tool_calls[0].id, content: 'MOCK_TOOL_OK' },
  ] }).then(response => response.json());
  assert.equal(continued.choices[0].message.content, 'RESULT:MOCK_TOOL_OK');
});
test('streamed tool calls retain the tool index and finish reason', async () => {
  const text = await post({ ...input('tool'), tools: [tool], stream: true }).then(response => response.text());
  assert.match(text, /"tool_calls":\[\{"index":0/);
  assert.match(text, /"finish_reason":"tool_calls"/);
});
test('native filesystem requests and permission requests are denied', async () => {
  const native = await post(input('native')).then(response => response.json());
  assert.equal(native.choices[0].message.content, 'NATIVE_DENIED');
  const permission = await post(input('permission')).then(response => response.json());
  assert.equal(permission.choices[0].message.content, 'PERMISSION_DENIED');
});
test('client disconnect cancels the ACP turn and releases its slot', async () => {
  const response = await post({ ...input('hold'), stream: true });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await delay(100);
  const health = await fetch(`${address}/health`, { headers }).then(response => response.json());
  assert.equal(health.activeTurns, 0);
});
test('concurrency is bounded and aborted turns release both slots', async () => {
  const first = await post({ ...input('hold'), stream: true });
  const second = await post({ ...input('hold'), stream: true });
  assert.equal((await post(input('hello'))).status, 429);
  await first.body.cancel();
  await second.body.cancel();
  await delay(100);
  assert.equal((await fetch(`${address}/health`, { headers }).then(response => response.json())).activeTurns, 0);
});
