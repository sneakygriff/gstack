# Subscription execution lane readiness

Observed on 23 October 2026 (UTC timestamps in the adjacent JSON). This is a capability report, not an invoice, quota forecast, model benchmark or certification that every lane can implement work. The secret-free observation record is `provider-lanes.json`.

| Lane | Authentication and effective identity | Execution evidence | Capacity evidence | Readiness |
| --- | --- | --- | --- | --- |
| Codex desktop agent | CLI reports `Logged in using ChatGPT`; effective account identifier not exposed by this check | The current worker successfully read repository files using its host tools. A separate Codex CLI model/tool probe was not run | Desktop usage-limit tool unavailable to this subagent; remaining quota unknown | Host agent working; distinct CLI transport unverified |
| Claude default | Initial unqualified auth call: `claude.ai`, Max. Later explicit default-directory capture: logged out, auth `none`, subscription unknown | Earlier bounded read-only Haiku probe succeeded, with a public `Read` event; this does not override the later auth result | Remaining quota unknown; cost metadata uses list-price basis, not a verified charge | Earlier Read transport verified; final explicit default-profile readiness unresolved |
| Claude overflow | `claude.ai`, first-party, Max in both observations; initially matched default email AND organization | Auth status verified, separate model execution not run | One authenticated pool in final capture; final identity comparison unavailable because default is unauthenticated | Do not budget two independent subscriptions |
| Grok CLI | Initially unauthenticated; authorized OAuth refresh succeeded using the existing signed-in browser account. CLI now reports logged in with grok.com | Both safe sandbox attempts failed before model/tool execution | Subscription tier and quota unknown; a model catalog is not entitlement or usage evidence | Auth working; sandbox/tool transport blocked |

## Conflicting Claude observations

The initial unqualified default auth call and explicit overflow call both returned authenticated Max identities with matching email and organization. The later structured capture, at 04:19:55 UTC, explicitly set each profile directory: default returned `loggedIn: false`, `authMethod: none` and no subscription; overflow remained authenticated Max. Both observations are retained. No further provider calls were made to reconcile them. The difference could be temporal or invocation-environment related; its cause is unverified. A missing default identity cannot establish distinct accounts, so the final comparison is unknown, not false. The earlier successful Read probe remains valid historical transport evidence and does not certify the later explicit default-profile state.

## Harmless transport probe

Claude Code 2.1.308 ran with restricted settings, disabled hooks, an empty strict MCP configuration, `dontAsk`, and only the `Read` tool allowed. API-key/token environment overrides were removed. It read one line from the local validation spec, and returned the expected title. The public session transcript independently records that `Read` request and its result. The CLI reported model `claude-haiku-5-5`, two turns, success, no permission denials, and 2,709 ms elapsed. This verifies that bounded read path, not all implementation tools or Fable.

The result contains 4 input, 2,977 cache-creation input, 6,155 cache-read input and 161 output tokens. It labels the USD value as list-price cost basis. No invoice was inspected, and no saving comparison follows from this single probe. Existing Fable headless credit guards were not overridden. Prior interactive Fable evidence remains historical, not a fresh probe here.

Codex CLI 0.159.3 authentication was inspected without a paid model probe. Current host tool calls establish the desktop agent path; they do not establish that a separate CLI child has the same account, model or sandbox capability.

## Grok failure and attempted safe correction

Grok Build 1.0.67 initially reported `You are not authenticated`. The supported OAuth login flow then completed from the existing browser session without account switching. Its CLI confirmation and subsequent catalog query prove authentication, not an operational sandbox. No credentials or raw account identifiers are retained in this report.

A bounded two-turn, read-tool-only probe using the built-in `read-only` profile exited 1 before model execution:

> socket deny resolution failed: could not resolve runtime-socket deny path /var/run/docker.sock: endpoint is a symlink to a path outside the deny list

The local socket resolves to the OrbStack runtime socket. Official configuration supports a named custom profile inheriting `read-only` and adding deny paths. The disposable worker profile inherited that profile, kept network restriction enabled, added the resolved socket to `deny`, and added no writable paths. It still failed with the same runtime-socket resolution error. The full redacted diagnostic and exact profile fields are recorded in the JSON. The temporary project profile was removed; global configuration was not changed. [Sandbox documentation](https://docs.x.ai/build/features/sandbox), [profile configuration reference](https://docs.x.ai/build/settings/reference).

There was no switch to `off`, no unsandboxed retry, and no paid-credit override. Therefore no observed Grok execution model, tool result or usage is available. The `grok-4.7` catalog default is only a requested/default model identifier. Ticket 06 was not dispatched to Grok; any later non-Grok analysis must be attributed to its actual author.

The prerequisite for another Grok attempt is a supported sandbox configuration or vendor correction that safely handles this socket layout, followed by a successful bounded tool probe and positive sandbox-enforcement evidence. Authentication refresh alone does not satisfy that prerequisite. Changing the host socket or weakening protections is outside this report.

## Validation and limits

This ticket changes only evidence documents. The TDD skill was read; no product behavior or test seam was added, so no synthetic red/green suite was invented for the report. Public provider commands and the isolated Read probe are its acceptance checks. Missing facts remain null in the JSON. Two profile directories are not two verified pools. The installed skill, review gates, retry policy and billing guards were not modified.

Confidence is high in the individual recorded outputs and Grok startup refusal. Current default Claude readiness and the cause of its conflicting observations remain unresolved; identity equality was verified only in the initial observation. Confidence in available future quota or live implementation acceleration is unknown: these require new provider evidence and equivalent task runs.
