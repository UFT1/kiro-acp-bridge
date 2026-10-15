# Kiro ACP Bridge

**Keep coding in OpenCode. Add Kiro as another model provider.**

An experimental, dependency-free Node.js bridge that uses your authenticated Kiro CLI
through ACP. OpenCode remains responsible for its tools and permission decisions.
Use it alongside your other configured OpenCode providers without changing your default.

```text
OpenCode -> local Chat Completions endpoint -> Kiro CLI ACP -> Kiro
    ^                                           |
    +---- tool request, not tool execution ------+
```

This is an unofficial project, not affiliated with or endorsed by Kiro, AWS, or OpenCode.
It does not bundle Kiro CLI, extract Kiro credentials, call private inference endpoints,
or bypass subscription limits. If your company provides Kiro, confirm that your
organization permits this integration and the data you send through it.

## Why this exists

OpenCode can be your consistent coding environment while model access comes from
different subscriptions or organizations. This project adds an experimental Kiro route
without moving your file edits, shell commands, MCP tools, or approval decisions into
a second coding agent.

The key feature is **OpenCode-owned tool execution**. Client tool schemas become
MCP handoff tools inside the dedicated Kiro agent. The bridge captures the first call,
returns it to OpenCode, and stops the inner Kiro turn. OpenCode executes or denies it,
then sends the result on its next inference request.

## Requirements

- Node.js 22 or newer; no runtime npm dependencies and no `npm install` required.
- Kiro CLI installed and authenticated with access to your chosen model.
- OpenCode **V2** for the supplied configuration.
- macOS or Linux. Windows process-tree cleanup is not qualified.

Live-tested with Kiro CLI **2.31.0**, its explicit **v2 ACP engine**, and OpenCode **2.0.25**.
Other versions and models need validation. CLI version and engine generation are different.

## Quick start

```sh
git clone https://github.com/jovylle/kiro-acp-bridge.git
cd kiro-acp-bridge
npm test
```

If you are already logged in to Kiro, keep that login. Otherwise authenticate through
the official CLI with `kiro-cli login`. Never put your Kiro credentials in this repository.

Check the exact model IDs available to your account:

```sh
kiro-cli chat --list-models --format json
```

The default enabled model is `claude-sonnet-5`. If that model is unavailable, set
`KIRO_ACP_MODELS` to an exact ID from your list. Use the **same environment values**
when starting the server and generating its configuration. For example:

```sh
export KIRO_ACP_MODELS="YOUR_EXACT_MODEL_ID"
```

Remove that example export if you want the default. Do not use the placeholder literally.

Start the bridge and leave the terminal open:

```sh
npm start
```

The server listens on `http://127.0.0.1:11437` and creates a private local adapter key.
This is **not** a Kiro credential. Stop with Ctrl+C. No automatic startup is installed.

### Configure OpenCode

In another terminal, from this clone and with the same model/port environment:

```sh
node configure.mjs
```

This prints an OpenCode V2 JSON configuration fragment with your installation's key-file
path, **not the key itself**. It does not edit your OpenCode settings or contact Kiro.

Merge its `providers.kiro-acp` entry into `~/.config/opencode/opencode.jsonc` (or your
project configuration). **Do not replace existing providers, permissions, or settings.**
The generated fragment does not change your default model.

Open `/models` and select `kiro-acp/<your-model-id>`. With the default:

```sh
opencode run --model kiro-acp/claude-sonnet-5 'Explain this project'
```

Keep the clone at the same path, or regenerate the key-file reference after moving it.
If port 11437 is already occupied, set `KIRO_ACP_PORT` and regenerate the configuration.

## Architecture

Every inference request creates a fresh temporary workspace, restricted custom Kiro
agent, ACP process, and session. System/developer instructions become the custom agent
prompt; the remaining conversation is carried as a role-labelled JSON transcript in
one ACP user prompt. The adapter checks the selected agent and exact model before
inference; a mismatch fails instead of silently becoming Auto. This checks ACP metadata,
not independently attested backend identity.

For tool requests:

1. OpenCode supplies its function definitions.
2. A minimal MCP server exposes those schemas to Kiro without implementing the actions.
3. The first MCP call is captured and returned as an OpenAI `tool_call`.
4. The bridge cancels Kiro and terminates its process group.
5. OpenCode applies its own permissions, executes or denies the tool, and supplies the result.

The bridge does not scrape tool calls out of model-authored JSON, execute shell commands
for the model, or reconnect Kiro directly to your other MCP servers.

## Security and data handling

- Binds to `127.0.0.1` only; checks Host, rejects browser Origin headers, and requires
  a generated 256-bit local API key stored with mode `0600`. No permissive CORS.
- The dedicated agent exposes only handoff MCP tools, excludes global/workspace MCP
  configuration, and disables inherited default resources. Unexpected native ACP
  filesystem/terminal requests are unsupported; permission requests are denied.
- Tool arguments are returned to OpenCode for validation and permission checks.
  MCP callback secrets are random and scoped to one turn.
- Two concurrent turns maximum, a 2 MiB body limit, and a 180-second turn timeout.
  Disconnect/timeout cancels ACP and terminates the process group, including MCP children.
- Temporary workspaces are removed after each turn. A hard crash can leave one behind.
  **Kiro may persist ACP sessions separately**; deleting a workspace does not delete that history.
- Prompts, source context, and tool results reach Kiro just as they would another provider.
  Your organization's data rules still apply. The adapter does not log raw requests,
  Kiro stderr, credentials, or OAuth URLs; Kiro's own logging is separate.
- Profile restrictions are **not an OS sandbox**. Kiro CLI still runs as your user.
  Local clients with the adapter key can consume your Kiro credits.

Never expose this experimental server publicly or commit `api-key`, `.env`, generated
configuration, prompt captures, or credential files.

## Known limitations

This is a small working prototype, **not a faithful raw-model API or production-ready gateway**.

- Fresh session and full transcript reconstruction per inference step: startup/context
  overhead, growing Kiro history, and imperfect native role/history/cache semantics.
- One tool call is handed off per request. Parallel tool calls are not preserved;
  OpenCode can continue serially.
- Text/function tools only. Images and structured-output modes are rejected.
- Only `auto` and `none` tool choice; forced/required selection is rejected.
- No token usage, credit-cost, cache, or reasoning/signature reporting. **Zero cost/tokens
  shown by OpenCode means unknown, not free. Kiro credits are still consumed.**
- Sampling, output-budget, and reasoning-effort controls are not forwarded. The generated
  32K context / 4K output settings are conservative OpenCode-side policy, not verified
  backend limits or a hard output cap. Effort variants are intentionally absent.
- CLI refresh/re-login, large contexts, other models, reconnect/replay, prolonged coding
  workloads, and immediate upstream cancellation/billing remain unverified.
- Errors are currently generic; richer rate-limit and retry classification is future work.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `KIRO_CLI` | `~/.local/bin/kiro-cli`, otherwise `kiro-cli` on PATH | CLI executable |
| `KIRO_ACP_MODELS` | `claude-sonnet-5` | Comma-separated exact enabled model IDs |
| `KIRO_ACP_PORT` | `11437` | Loopback port |
| `KIRO_ACP_TIMEOUT` | `180000` | Turn/request timeout in milliseconds |
| `KIRO_ACP_TEMP_DIR` | OS temporary directory + `/opencode` | Parent for owned temporary workspaces |
| `KIRO_ACP_KEY_FILE` | `api-key` next to `server.mjs` | Local adapter key file, not Kiro credentials |

When enabling more models, regenerate the OpenCode fragment with the same environment
and merge its model entries. Unknown IDs fail; no aliases or silent fallbacks are provided.
Do not switch to the v3 engine without implementing its different session/configuration protocol.

## Testing

```sh
npm test
```

Offline tests cover validation, configuration generation, auth/origin guards, text/SSE,
tool handoff/history, native-operation denial, cancellation, and bounded concurrency.
They use a mock CLI and do not require a Kiro account or consume credits.
CI is configured for Node 22/24 on macOS/Linux.

Optional live capability probe (creates a Kiro session, but sends no inference prompt):

```sh
npm run probe
```

Optional live OpenCode read-tool check, with the bridge running:

```sh
node configure.mjs --verification > verification/opencode.jsonc
cd verification
opencode run --standalone --agent kiro-smoke --model kiro-acp/claude-sonnet-5 \
  'Read sentinel.txt using the read tool, then reply with exactly its contents.'
```

Replace the model in that command if you configured another one. Expected response:
`OPENCODE_KIRO_TOOL_OK`. The test agent permits only that read; live tests consume credits.
Text streaming, an echo handoff, an OpenCode read roundtrip, and preservation of an
OpenCode permission denial were verified during development.

## Related projects

[Kiro Gateway](https://github.com/ankitcharolia/kiro-gateway) is a broader Python-based
ACP gateway with OpenAI, Responses, Anthropic, and ACP interfaces. Its documented design
lets Kiro execute native and forwarded MCP tools. This project's narrower focus is
**handing unexecuted client tool requests back to OpenCode**, so OpenCode retains execution
and permission ownership. Consult each project's current documentation before choosing.

This is an independent implementation, not a fork; no Kiro Gateway source is included.

## License and terms

[MIT](LICENSE). The license covers this bridge only. Kiro CLI and your subscription are
governed by their own terms; using an official protocol is not a blanket compliance guarantee.

References: [OpenCode V2 providers](https://opencode.ai/v2/docs/providers),
[Kiro ACP](https://kiro.dev/docs/cli/acp.md),
[custom agents](https://kiro.dev/docs/custom-agents/configuration-reference.md).
