export function validateRequest(body, models) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object');
  if (!models.includes(body.model)) throw new Error('Model is not enabled; no automatic fallback');
  if (!Array.isArray(body.messages) || !body.messages.length) throw new Error('messages must be nonempty');
  if (body.stream !== undefined && typeof body.stream !== 'boolean') throw new Error('stream must be boolean');
  if (body.n !== undefined && body.n !== 1) throw new Error('Only n=1 is supported');
  if (body.response_format && body.response_format.type !== 'text') throw new Error('Structured output is not supported');
  for (const message of body.messages) {
    if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role)) throw new Error('Unsupported message role');
    if (message.content !== null && message.content !== undefined && typeof message.content !== 'string') {
      if (!Array.isArray(message.content) || message.content.some(part => part.type !== 'text' || typeof part.text !== 'string')) {
        throw new Error('Only text input is supported');
      }
    }
    if (message.role === 'tool' && typeof message.tool_call_id !== 'string') throw new Error('Tool results require tool_call_id');
    if (message.tool_calls !== undefined) {
      if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) throw new Error('Invalid tool call history');
      for (const call of message.tool_calls) {
        if (call.type !== 'function' || typeof call.id !== 'string' || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string') {
          throw new Error('Invalid tool call history');
        }
        JSON.parse(call.function.arguments);
      }
    }
  }
  const tools = body.tools ?? [];
  if (!Array.isArray(tools)) throw new Error('tools must be an array');
  const names = new Set();
  for (const tool of tools) {
    if (tool.type !== 'function' || !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.function?.name ?? '')) throw new Error('Invalid function tool');
    if (names.has(tool.function.name)) throw new Error('Duplicate function tool');
    names.add(tool.function.name);
    if (tool.function.parameters?.type !== 'object') throw new Error('Tool parameters must be an object schema');
  }
  if (body.tool_choice !== undefined && !['auto', 'none'].includes(body.tool_choice)) throw new Error('Only auto/none tool_choice is supported');
  return body.tool_choice === 'none' ? [] : tools.map(tool => ({
    name: tool.function.name, description: tool.function.description ?? '', inputSchema: tool.function.parameters,
  }));
}

function text(content) {
  return Array.isArray(content) ? content.map(part => part.text).join('\n') : content ?? '';
}

export function buildPrompt(messages) {
  const system = messages.filter(message => ['system', 'developer'].includes(message.role)).map(message => text(message.content)).join('\n\n');
  const transcript = messages.filter(message => !['system', 'developer'].includes(message.role)).map(message => ({
    role: message.role, content: text(message.content),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
  }));
  return {
    system: `${system}\n\nYou are OpenCode's inference component. Continue the supplied conversation, answering the latest user or using an available opencode MCP tool. Tool results in the conversation were already executed by OpenCode; do not repeat those calls. Do not use native Kiro tools. Tool execution belongs exclusively to OpenCode.`,
    prompt: `Continue this conversation. Roles and tool call IDs are preserved in this JSON transcript:\n${JSON.stringify(transcript)}`,
  };
}

export function completion(model, content, toolCall, stopReason = 'end_turn') {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: {
      role: 'assistant', content: content || null,
      ...(toolCall ? { tool_calls: [toolCall] } : {}),
    }, finish_reason: toolCall ? 'tool_calls' : stopReason === 'max_tokens' ? 'length' : stopReason === 'refusal' ? 'content_filter' : 'stop' }],
  };
}
