import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const tools = JSON.parse(await readFile(process.env.KIRO_BRIDGE_TOOLS, 'utf8'));
const lines = createInterface({ input: process.stdin });
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

lines.on('line', line => {
  void (async () => {
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (request.id === undefined) return;
    try {
      let result;
      switch (request.method) {
        case 'initialize':
          result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'opencode-handoff', version: '0.1.0' } };
          break;
        case 'ping': result = {}; break;
        case 'tools/list': result = { tools }; break;
        case 'tools/call': {
          if (!tools.some(tool => tool.name === request.params.name)) throw new Error('Unknown tool');
          const response = await fetch(process.env.KIRO_BRIDGE_CALLBACK, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.KIRO_BRIDGE_SECRET}` },
            body: JSON.stringify(request.params),
          });
          if (!response.ok) throw new Error('Tool handoff rejected');
          // Stay pending until the bridge cancels Kiro. Returning a fake result would let Kiro continue independently.
          return;
        }
        default:
          send({ id: request.id, error: { code: -32601, message: 'Unsupported MCP method' } });
          return;
      }
      send({ id: request.id, result });
    } catch {
      send({ id: request.id, error: { code: -32603, message: 'Tool handoff failed' } });
    }
  })();
});
