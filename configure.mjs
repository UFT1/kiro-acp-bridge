import { loadSettings, providerConfig } from './runtime.mjs';

if (process.argv.slice(2).some(arg => arg !== '--verification')) {
  throw new Error('Usage: node configure.mjs [--verification]');
}
const config = providerConfig(loadSettings());
if (process.argv.includes('--verification')) {
  config.agents = {
    'kiro-smoke': {
      description: 'Restricted Kiro provider integration test', mode: 'primary',
      system: 'Use only the read tool to read sentinel.txt when requested. No other actions are permitted.',
      permissions: [
        { action: '*', resource: '*', effect: 'deny' },
        { action: 'read', resource: 'sentinel.txt', effect: 'allow' },
      ],
    },
  };
}
console.log(JSON.stringify(config, null, 2));
