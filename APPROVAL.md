# Usage and approval guidance

Policy sources reviewed: **2026-10-16**. Policies and enterprise agreements can change.
This document is project guidance, not legal advice or approval from Kiro, AWS, or an
employer. No vendor approval for this bridge has been established by this review.

## What Kiro explicitly says

The [Kiro FAQ](https://kiro.dev/faq/), under “With which tools can I use my Kiro
subscription?”, states:

> Kiro subscriptions can be used with Kiro IDE, Kiro CLI, Kiro Web, Kiro Crew, ACP
> compatible IDEs, and automation in software development (ex: reviews during CI/CD).
> Use through third-party automation harnesses (such as OpenClaw) that route requests
> outside of Kiro's native interfaces is not permitted.

The [ACP architecture documentation](https://kiro.dev/docs/acp.md) also describes
connecting an “editor, application, or custom integration to the Kiro agent” and lists
purpose-built ACP clients. The [editor setup guide](https://kiro.dev/docs/cli/acp.md)
documents using Kiro CLI through ACP-compatible editors.

These sources support ACP integrations, but do not explicitly classify this bridge's
Chat Completions adapter and OpenCode-owned agent loop. They do not establish that
every ACP-based integration is permitted, nor that this bridge is necessarily prohibited.

The [Kiro license](https://kiro.dev/license/) references the AWS Customer Agreement or
another governing written agreement, together with the AWS Intellectual Property License.
The bridge's MIT license does not grant rights to Kiro services or subscription access.

## Why this implementation needs clarification

The inspected implementation uses the official CLI ACP interface rather than extracting
Kiro credentials or calling private inference endpoints. However, it also:

- Exposes Kiro as a Chat Completions provider to OpenCode (`server.mjs`).
- Creates a fresh Kiro session for each inference step and reconstructs OpenCode history.
- Tells Kiro it is “OpenCode's inference component” (`protocol.mjs`).
- Hands off the first tool call and cancels the Kiro turn; OpenCode owns approval,
  execution, and the next inference request (`server.mjs` and `mcp.mjs`).

**Interpretation:** This differs from simply presenting a Kiro agent session in an
editor. It could be classified as a third-party harness, while its use of documented
ACP and custom-agent capabilities supports a competing interpretation. The published
wording does not settle that boundary. Neither the localhost binding, permission
handoff, successful authentication, nor a passing test proves subscription compliance.

## Before live use

For company-provided subscriptions or company/client work, this project's onboarding
guidance requires the following before starting the bridge or a live probe:

- [ ] Obtain written approval from your **project/account sponsor** for this specific
  integration and intended use, not just general permission to use Kiro.
- [ ] Obtain approval from the organization's Kiro administrator and complete required
  security, software/tooling, and client reviews.
- [ ] Have the subscription owner or administrator obtain written clarification from
  Kiro/AWS that this exact provider-style ACP flow is allowed under the applicable plan
  and agreement. Sponsor approval alone cannot override vendor restrictions.
- [ ] Confirm that the data sent through OpenCode, the bridge, Kiro, and any configured
  tools is permitted, including source code, prompts, tool outputs, and retained sessions.
- [ ] Use your own authorized login and locally generated adapter key. Do not share a
  subscription, credentials, or the endpoint as a team service.
- [ ] After approval, validate your CLI/model combination using non-sensitive sample
  data and the restricted smoke test in the README.

If vendor classification or organizational approval is unresolved, do not use this bridge
with that subscription or company/client data. Use an explicitly approved Kiro workflow
instead. Personal subscribers still need to resolve vendor permission for this flow;
a company sponsor is not applicable to purely personal use.

For Accenture-managed accounts, Accenture and client rules or negotiated agreements may
be stricter than public Kiro guidance. This project has not reviewed those internal rules
and does not claim a specific Accenture policy mandates or permits this integration.
The sponsor checklist above is project safety guidance, not a quotation of company policy.

Keep approval records in the appropriate internal system. Do not publish contracts,
internal correspondence, credentials, or client details in this repository or its issues.

## Suggested clarification request

> May users of our Kiro subscription run Kiro CLI ACP behind a localhost Chat Completions
> adapter where OpenCode owns conversation orchestration, tool approval/execution, and
> repeated inference calls? The bridge starts a fresh Kiro session per inference step,
> hands tool requests back to OpenCode, and cancels the Kiro turn before OpenCode executes
> the tool. Does this qualify as permitted ACP custom integration/software-development
> automation, or as restricted third-party harness use? Please confirm for our subscription
> and agreement, including any usage or data-handling conditions.
