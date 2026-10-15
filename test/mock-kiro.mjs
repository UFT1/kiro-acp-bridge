#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';

const lines = createInterface({ input: process.stdin });
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
let session;
let promptId;
let callback;
let callbackSecret;
const sessionId = 'mock-session';
const emit = text => send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
const finish = text => {
  emit(text);
  send({ id: promptId, result: { stopReason: 'end_turn' } });
};

lines.on('line', line => {
  void (async () => {
    const message = JSON.parse(line);
    if (!message.method) {
      if (message.id === 'native-request') finish(message.error?.code === -32601 ? 'NATIVE_DENIED' : 'UNSAFE');
      if (message.id === 'permission-request') finish(message.result?.outcome?.optionId === 'deny' ? 'PERMISSION_DENIED' : 'UNSAFE');
      return;
    }
    switch (message.method) {
      case 'initialize': send({ id: message.id, result: { protocolVersion: 1, agentInfo: { name: 'mock' }, agentCapabilities: {} } }); break;
      case 'session/new': {
        const profile = JSON.parse(await readFile(`${message.params.cwd}/.kiro/agents/opencode-provider.json`, 'utf8'));
        const settings = JSON.parse(await readFile(`${message.params.cwd}/.kiro/settings/cli.json`, 'utf8'));
        if (profile.tools.join(',') !== '@opencode' || profile.includeMcpJson || !settings['chat.disableInheritingDefaultResources']) throw new Error('Unsafe profile');
        session = message.params;
        const env = Object.fromEntries((session.mcpServers[0]?.env ?? []).map(item => [item.name, item.value]));
        callback = env.KIRO_BRIDGE_CALLBACK;
        callbackSecret = env.KIRO_BRIDGE_SECRET;
        send({ id: message.id, result: { sessionId, modes: { currentModeId: 'opencode-provider' }, models: { currentModelId: profile.model } } });
        break;
      }
      case 'session/prompt': {
        promptId = message.id;
        const transcript = JSON.parse(message.params.prompt[0].text.split('\n').slice(1).join('\n'));
        const latest = transcript.at(-1).content;
        if (latest === 'hold') { emit('WAITING'); break; }
        if (latest === 'native') {
          send({ id: 'native-request', method: 'fs/read_text_file', params: { sessionId, path: '/must-not-read' } });
          break;
        }
        if (latest === 'permission') {
          send({ id: 'permission-request', method: 'session/request_permission', params: { sessionId, options: [{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }] } });
          break;
        }
        if (latest === 'tool') {
          const response = await fetch(callback, {
            method: 'POST', headers: { authorization: `Bearer ${callbackSecret}`, 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'echo', arguments: { text: 'MOCK_TOOL_OK' } }),
          });
          if (!response.ok) throw new Error('Handoff rejected');
          break;
        }
        finish(transcript.at(-1).role === 'tool' ? `RESULT:${latest}` : `MOCK:${latest}`);
        break;
      }
      case 'session/cancel': if (promptId !== undefined) send({ id: promptId, result: { stopReason: 'cancelled' } }); break;
      default: send({ id: message.id, error: { code: -32601, message: 'Unsupported method' } });
    }
  })().catch(() => process.exit(1));
});
