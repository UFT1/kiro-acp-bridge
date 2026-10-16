import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const site = new URL('../site/', import.meta.url);
const html = await readFile(new URL('index.html', site), 'utf8');
const script = await readFile(new URL('script.js', site), 'utf8');

function page(hostname, pathname, clipboard) {
  const links = ['', '#quick-start', 'blob/master/APPROVAL.md'].map(path => ({ dataset: { repoPath: path } }));
  const commands = {};
  const status = {};
  const button = {
    hidden: true,
    addEventListener(event, callback) { this.click = callback; },
    closest() { return { querySelector: () => commands }; },
  };
  runInNewContext(script, {
    location: { hostname, pathname },
    navigator: { clipboard },
    setTimeout() {},
    document: {
      querySelectorAll: selector => selector === '[data-repo-path]' ? links : [button],
      querySelector: selector => selector === '#clone-commands' ? commands : status,
    },
  });
  return { links, commands, status, button };
}

test('landing page local assets and section links resolve', async () => {
  for (const match of html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)) {
    assert.ok((await stat(new URL(match[1], site))).isFile());
  }
  for (const match of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(html.includes(`id="${match[1]}"`), `Missing section ${match[1]}`);
  }
  assert.match(html, /sponsor.*approval/i);
  assert.match(html, /permission.*unresolved/i);
});

test('project Pages links and clone commands follow a transferred owner', () => {
  const { links, commands } = page('uft1.github.io', '/kiro-acp-bridge/');
  assert.equal(links[0].href, 'https://github.com/uft1/kiro-acp-bridge');
  assert.equal(links[1].href, 'https://github.com/uft1/kiro-acp-bridge#quick-start');
  assert.equal(links[2].href, 'https://github.com/uft1/kiro-acp-bridge/blob/master/APPROVAL.md');
  assert.match(commands.textContent, /git clone https:\/\/github.com\/uft1\/kiro-acp-bridge.git/);
});

test('local preview retains the fallback repository without clipboard controls', () => {
  const { links, button } = page('localhost', '/');
  assert.equal(links[0].href, 'https://github.com/UFT1/kiro-acp-bridge');
  assert.equal(button.hidden, true);
});

test('copy control copies commands and announces success', async () => {
  let copied;
  const { commands, button, status } = page('uft1.github.io', '/kiro-acp-bridge/', {
    async writeText(value) { copied = value; },
  });
  assert.equal(button.hidden, false);
  await button.click();
  assert.equal(copied, commands.textContent);
  assert.equal(button.textContent, 'Copied!');
  assert.match(status.textContent, /copied/);
});

test('copy control handles denied clipboard access', async () => {
  const { button, status } = page('localhost', '/', {
    async writeText() { throw new Error('Permission denied'); },
  });
  await button.click();
  assert.equal(button.textContent, 'Select text');
  assert.match(status.textContent, /manually/);
});
