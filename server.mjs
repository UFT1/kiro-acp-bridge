import http from 'node:http';
import { timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AcpClient } from './acp.mjs';
import { validateRequest, buildPrompt, completion } from './protocol.mjs';
import { loadSettings, root } from './runtime.mjs';

const { keyFile, models, port, cli, timeout, tempRoot } = loadSettings();
const turns = new Map();
let activeTurns = 0;
let shuttingDown = false;

async function loadKey() {
  try {
    const key = (await readFile(keyFile, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid local API key file');
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const key = randomBytes(32).toString('hex');
    await writeFile(keyFile, key, { mode: 0o600, flag: 'wx' });
    return key;
  }
}
const apiKey = await loadKey();

function authorized(request, key) {
  const supplied = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${key}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function json(response, status, data) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Request exceeds 2 MiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function runTurn(input, tools, response, address) {
  const id = randomUUID();
  const secret = randomBytes(32).toString('hex');
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(tempRoot, 'kiro-acp-turn-'));
  let client;
  let sessionId;
  let content = '';
  let handedOff = false;
  let aborted = false;
  let resolveHandoff;
  const handoff = new Promise(resolve => { resolveHandoff = resolve; });
  const result = completion(input.model, '');
  const chunk = delta => {
    if (!input.stream || response.destroyed) return;
    response.write(`data: ${JSON.stringify({ id: result.id, object: 'chat.completion.chunk', created: result.created, model: input.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  };
  const cancel = () => {
    aborted = true;
    if (sessionId) client?.notify('session/cancel', { sessionId });
    client?.close();
  };
  response.on('close', cancel);
  const deadline = setTimeout(cancel, timeout);
  turns.set(id, {
    secret, cancel,
    accept(call) {
      call.arguments ??= {};
      if (handedOff || aborted || !tools.some(tool => tool.name === call.name) || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) return false;
      handedOff = true;
      resolveHandoff({ id: `call_${randomUUID().replaceAll('-', '')}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } });
      return true;
    },
  });
  try {
    const prompt = buildPrompt(input.messages);
    await mkdir(join(directory, '.kiro/agents'), { recursive: true });
    await mkdir(join(directory, '.kiro/settings'), { recursive: true });
    const mcpServer = {
      name: 'opencode', command: process.execPath, args: [join(root, 'mcp.mjs')],
      env: [
        { name: 'KIRO_BRIDGE_TOOLS', value: join(directory, 'tools.json') },
        { name: 'KIRO_BRIDGE_CALLBACK', value: `${address}/internal/handoff/${id}` },
        { name: 'KIRO_BRIDGE_SECRET', value: secret },
      ],
    };
    await writeFile(join(directory, 'tools.json'), JSON.stringify(tools), { mode: 0o600 });
    await writeFile(join(directory, '.kiro/settings/cli.json'), JSON.stringify({ 'chat.disableInheritingDefaultResources': true }), { mode: 0o600 });
    await writeFile(join(directory, '.kiro/agents/opencode-provider.json'), JSON.stringify({
      name: 'opencode-provider', prompt: prompt.system, model: input.model,
      tools: ['@opencode'], allowedTools: ['@opencode'], mcpServers: {},
      resources: [], hooks: {}, includeMcpJson: false,
    }), { mode: 0o600 });
    if (aborted || response.destroyed) throw new Error('Turn cancelled');
    client = new AcpClient(cli, ['acp', '--agent-engine=v2', '--agent', 'opencode-provider', '--model', input.model], {
      cwd: directory, timeout,
      onNotification(method, params) {
        if (method !== 'session/update' || params.sessionId !== sessionId || handedOff) return;
        const update = params.update;
        if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          content += update.content.text;
          chunk({ content: update.content.text });
        }
      },
      async onRequest(method, params) {
        if (method === 'session/request_permission') {
          const option = params.options?.find(option => option.kind === 'reject_once');
          return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } };
        }
        throw new Error('Native client operation disabled');
      },
    });
    await client.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'kiro-acp-bridge', version: '0.1.0' } });
    const session = await client.request('session/new', { cwd: directory, mcpServers: tools.length ? [mcpServer] : [] });
    sessionId = session.sessionId;
    if (!sessionId || session.modes?.currentModeId !== 'opencode-provider') throw new Error('Dedicated agent was not selected');
    if (session.models?.currentModelId !== input.model) throw new Error('Requested model was not selected; fallback rejected');
    if (input.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      chunk({ role: 'assistant' });
    }
    const outcome = await Promise.race([
      client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt.prompt }] }).then(value => ({ stopReason: value.stopReason })),
      handoff.then(toolCall => ({ toolCall })),
    ]);
    if (aborted) throw new Error('Turn cancelled or timed out');
    if (outcome.toolCall) {
      client.notify('session/cancel', { sessionId });
      client.close();
    } else if (!['end_turn', 'max_tokens', 'refusal'].includes(outcome.stopReason)) {
      throw new Error('Unexpected ACP stop reason');
    }
    const completed = completion(input.model, content, outcome.toolCall, outcome.stopReason);
    completed.id = result.id;
    if (input.stream) {
      if (outcome.toolCall) chunk({ tool_calls: [{ index: 0, ...outcome.toolCall }] });
      response.write(`data: ${JSON.stringify({ id: result.id, object: 'chat.completion.chunk', created: result.created, model: input.model, choices: [{ index: 0, delta: {}, finish_reason: completed.choices[0].finish_reason }] })}\n\ndata: [DONE]\n\n`);
      response.end();
    } else json(response, 200, completed);
  } catch {
    if (response.headersSent) {
      if (!response.destroyed) response.end(`data: ${JSON.stringify({ error: { message: 'Kiro ACP turn failed or timed out', type: 'provider_error' } })}\n\n`);
    } else json(response, 502, { error: { message: 'Kiro ACP turn failed: check CLI login, model access, and agent/MCP setup', type: 'provider_error' } });
  } finally {
    clearTimeout(deadline);
    response.off('close', cancel);
    client?.close();
    turns.delete(id);
    // This directory was created exclusively by this turn; never remove a caller-supplied workspace.
    await rm(directory, { recursive: true, force: true });
  }
}

export const server = http.createServer(async (request, response) => {
  try {
    const host = request.headers.host;
    const actualPort = server.address().port;
    if (host !== `127.0.0.1:${actualPort}` || request.headers.origin || shuttingDown) return json(response, 403, { error: { message: 'Local non-browser clients only' } });
    const url = new URL(request.url, `http://${host}`);
    if (url.pathname.startsWith('/internal/handoff/') && request.method === 'POST') {
      const turn = turns.get(url.pathname.slice('/internal/handoff/'.length));
      if (!turn || !authorized(request, turn.secret)) return json(response, 401, { error: { message: 'Unauthorized' } });
      return json(response, turn.accept(await body(request)) ? 200 : 400, {});
    }
    if (!authorized(request, apiKey)) return json(response, 401, { error: { message: 'Unauthorized' } });
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { status: 'ok', transport: 'kiro-acp-v2', models, activeTurns });
    if (request.method === 'GET' && url.pathname === '/v1/models') return json(response, 200, { object: 'list', data: models.map(id => ({ id, object: 'model', owned_by: 'kiro-acp' })) });
    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') return json(response, 404, { error: { message: 'Not found' } });
    const input = await body(request);
    const tools = validateRequest(input, models);
    if (activeTurns >= 2) return json(response, 429, { error: { message: 'Two Kiro turns are already active; retry later' } });
    activeTurns++;
    try { await runTurn(input, tools, response, `http://127.0.0.1:${actualPort}`); }
    finally { activeTurns--; }
  } catch {
    json(response, 400, { error: { message: 'Invalid or unsupported request; only enabled models and text/function tools are accepted', type: 'invalid_request_error' } });
  }
});
server.requestTimeout = timeout + 10_000;
server.headersTimeout = 10_000;
server.listen(port, '127.0.0.1', () => console.log(`Kiro ACP provider listening on http://127.0.0.1:${server.address().port} (${models.join(', ')})`));
server.on('error', error => { console.error(`Provider listener error: ${error.code}`); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  shuttingDown = true;
  for (const turn of turns.values()) turn.cancel();
  server.close();
  server.closeAllConnections();
});
