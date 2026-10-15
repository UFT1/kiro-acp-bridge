import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, buildPrompt, completion } from '../protocol.mjs';

const models = ['claude-sonnet-5'];
const base = () => ({ model: models[0], messages: [{ role: 'user', content: 'Hello' }] });
const echo = { type: 'function', function: { name: 'echo', description: 'Echo text', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } };

test('accepts text and converts function definitions into MCP schemas', () => {
  assert.deepEqual(validateRequest({ ...base(), tools: [echo] }, models), [{ name: 'echo', description: 'Echo text', inputSchema: echo.function.parameters }]);
});
test('does not expose tools for tool_choice none', () => {
  assert.deepEqual(validateRequest({ ...base(), tools: [echo], tool_choice: 'none' }, models), []);
});
test('rejects unknown models instead of falling back', () => {
  assert.throws(() => validateRequest({ ...base(), model: 'auto' }, models), /fallback/);
});
test('rejects images instead of silently dropping them', () => {
  assert.throws(() => validateRequest({ ...base(), messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] }] }, models), /text input/);
});
test('rejects duplicate tools and forced tool choices', () => {
  assert.throws(() => validateRequest({ ...base(), tools: [echo, echo] }, models), /Duplicate/);
  assert.throws(() => validateRequest({ ...base(), tool_choice: 'required' }, models), /tool_choice/);
});
test('rejects unsupported structured output and multiple completions', () => {
  assert.throws(() => validateRequest({ ...base(), response_format: { type: 'json_object' } }, models), /Structured/);
  assert.throws(() => validateRequest({ ...base(), n: 2 }, models), /n=1/);
});
test('preserves system instructions, roles, tool IDs, arguments and results', () => {
  const call = { id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{"text":"hello"}' } };
  const messages = [{ role: 'system', content: 'Be precise' }, ...base().messages,
    { role: 'assistant', content: null, tool_calls: [call] }, { role: 'tool', tool_call_id: 'call_1', content: 'hello' }];
  validateRequest({ ...base(), messages }, models);
  const prompt = buildPrompt(messages);
  assert.match(prompt.system, /Be precise/);
  const transcript = JSON.parse(prompt.prompt.split('\n').slice(1).join('\n'));
  assert.deepEqual(transcript[1].tool_calls, [call]);
  assert.equal(transcript[2].tool_call_id, 'call_1');
  assert.equal(transcript[2].content, 'hello');
});
test('text parts remain ordered', () => {
  const result = buildPrompt([{ role: 'user', content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] }]);
  assert.match(result.prompt, /first\\nsecond/);
});
test('tool completions use tool_calls finish reason and original name', () => {
  const call = { id: 'call_1', type: 'function', function: { name: 'echo', arguments: '{}' } };
  const result = completion(models[0], '', call);
  assert.equal(result.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(result.choices[0].message.tool_calls, [call]);
  assert.equal(result.choices[0].message.content, null);
});
test('refusals and token exhaustion are not normal completion', () => {
  assert.equal(completion(models[0], 'No', undefined, 'refusal').choices[0].finish_reason, 'content_filter');
  assert.equal(completion(models[0], 'Partial', undefined, 'max_tokens').choices[0].finish_reason, 'length');
});
