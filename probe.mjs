import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AcpClient } from './acp.mjs';
import { loadSettings } from './runtime.mjs';

const { cli, models, tempRoot } = loadSettings();
await mkdir(tempRoot, { recursive: true, mode: 0o700 });
const cwd = await mkdtemp(join(tempRoot, 'kiro-acp-probe-'));
let client;
try {
  await mkdir(join(cwd, '.kiro/agents'), { recursive: true });
  await mkdir(join(cwd, '.kiro/settings'), { recursive: true });
  await writeFile(join(cwd, '.kiro/settings/cli.json'), JSON.stringify({ 'chat.disableInheritingDefaultResources': true }), { mode: 0o600 });
  await writeFile(join(cwd, '.kiro/agents/opencode-provider.json'), JSON.stringify({
    name: 'opencode-provider', prompt: 'Read-only ACP capability probe.', model: models[0],
    tools: [], resources: [], hooks: {}, mcpServers: {}, includeMcpJson: false,
  }), { mode: 0o600 });
  client = new AcpClient(cli, ['acp', '--agent-engine=v2', '--agent', 'opencode-provider', '--model', models[0]], { cwd, timeout: 30_000 });
  const initialized = await client.request('initialize', {
    protocolVersion: 1, clientCapabilities: {},
    clientInfo: { name: 'kiro-acp-bridge', version: '0.1.0' },
  });
  const session = await client.request('session/new', {
    cwd, mcpServers: [],
  });
  if (session.modes?.currentModeId !== 'opencode-provider' || session.models?.currentModelId !== models[0]) {
    throw new Error('Probe did not select the dedicated agent and requested model');
  }
  console.log(JSON.stringify({
    agent: initialized.agentInfo,
    capabilities: initialized.agentCapabilities,
    selectedAgent: session.modes.currentModeId,
    selectedModel: session.models.currentModelId,
    availableModels: session.models.availableModels?.map(model => model.modelId),
  }, null, 2));
} finally {
  client?.close();
  await rm(cwd, { recursive: true, force: true });
}
