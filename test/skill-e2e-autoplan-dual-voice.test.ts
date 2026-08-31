import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId, evalsEnabled,
  describeIfSelected, logCost, recordE2E,
  copyDirSync, createEvalCollector, finalizeEvalCollector,
} from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// E2E for /autoplan's outside-voices advisory panel (M2). Periodic tier:
// non-deterministic, costs ~$1/run, not a gate. The purpose is to catch
// regressions where the panel mechanism (bin/gstack-panel + bin/gstack-vote,
// the fable subagent, or the native Claude self-review pass) fails silently
// post-hardening.
//
// Pre-M2 this test pinned autoplan's old inline dual-voice blocks (a raw
// `codex exec` Bash call + a dispatched "Claude subagent"), keying success on
// a literal "CODEX SAYS (" marker. M2 deleted those blocks: autoplan now runs
// the shared Advisory Panel Procedure (autoplan/SKILL.md, "## Outside Voices —
// Advisory Panel Procedure") once per phase, which invokes `gstack-panel`
// (owns the codex/grok/gemini CLI voices + kill-switches/auth/consent/redaction),
// dispatches the `fable` subagent (Agent tool, model: fable), and has the
// current agent itself write a `claude.result.json` self-review verdict — then
// tabulates all of it with `gstack-vote` into one per-voice-row table. This
// test now targets THAT mechanism.
//
// File/tag/collector names are kept as "dual-voice" for continuity with
// test/skill-coverage-matrix.ts and test/helpers/touchfiles-data.ts, which key
// off this exact file path and the 'autoplan-dual-voice' tag — renaming either
// would require updating those out-of-scope registries too.

// ───────────────────────────────────────────────────────────────────────────
// Static invocation-mechanics pins (fix1 test-task, feat-outside-voices-
// panel-20260830-224457, gate-grok P1 #4). ALWAYS RUN — no EVALS, no API key,
// no `describeIfSelected` gate — so this file carries real signal on every
// plain `bun test`, not only on a periodic EVALS run.
//
// gate-grok found the EVALS-gated runtime test below (see "Autoplan
// dual-voice E2E") passed on a transcript where the model ONLY Read
// autoplan/SKILL.md and never invoked the panel: its regexes matched the
// literal EXAMPLE per-voice-row table baked into the procedure's Step 5 doc
// ("Outside Voices — advisory panel", "VOICE VENDOR STATUS VERDICT",
// "claude anthropic ready CONCERNS", "RECOMMENDATION: CONCERNS") and the
// mandatory phase-transition-summary TEMPLATE line ("**Phase 1 complete.**
// ... Outside-voices panel: [N ready / M voices]") — both of which land in
// the transcript the instant /autoplan Reads the skill file, regardless of
// whether it goes on to run anything.
//
// This block pins the OPPOSITE thing: the real, executable invocation
// MECHANICS the procedure actually wires up — the literal `gstack-panel`
// Bash invocation (with --untrusted-file/--datamark, the anti-injection nonce
// transport), the literal `gstack-vote` tabulation call, and the wiring
// sentence connecting them — pulled from Step 2/Step 4 of the rendered
// procedure, never from the Step 5 example output table. A future edit that
// strips the real invocation lines (while leaving the example table intact)
// fails HERE; it would NOT have failed the old runtime-only version of this
// file, because the old test only ran under EVALS=1 and even then couldn't
// tell a real run from a Read of these same example strings.
describe('Autoplan outside-voices panel — static invocation-mechanics pins (always-on, no API key)', () => {
  const AUTOPLAN_SKILL = fs.readFileSync(path.join(ROOT, 'autoplan', 'SKILL.md'), 'utf-8');

  test('fixture guard: the generated file loaded (not empty/truncated)', () => {
    expect(AUTOPLAN_SKILL.length).toBeGreaterThan(50_000);
  });

  test('Step 2 wires the real gstack-panel invocation: --surface, --prompt-file, --untrusted-file, --datamark, --out-dir, --wall-clock-s', () => {
    expect(AUTOPLAN_SKILL).toContain('### Step 2 — Run the external CLI voices (`bin/gstack-panel`)');
    expect(AUTOPLAN_SKILL).toContain(
      '~/.claude/skills/gstack/bin/gstack-panel --surface <surface> \\\n' +
        '  --prompt-file "<literal $PANEL_PROMPT_FILE>" \\\n' +
        '  --untrusted-file "<literal $PANEL_UNTRUSTED_FILE>" \\\n' +
        '  --datamark "<literal $PANEL_NONCE>" \\\n' +
        '  --out-dir "<literal $PANEL_OUT_DIR>" \\\n' +
        '  --wall-clock-s 560',
    );
  });

  test('the anti-injection nonce/datamark wiring sentence connects --untrusted-file + --datamark to per-voice verdict authentication', () => {
    expect(AUTOPLAN_SKILL).toContain(
      "`--untrusted-file` + `--datamark` are what wire the anti-injection nonce end-to-end: the panel\n" +
        "fences the untrusted target with your nonce and then REQUIRES that same nonce in each voice's\n" +
        "verdict (`parseVoiceResult` rejects a verdict whose `datamark` does not match).",
    );
  });

  test('Step 4 wires the real gstack-vote tabulation call: --dir, --surface, --nonce, --budget-usd (the ONLY tabulation path)', () => {
    expect(AUTOPLAN_SKILL).toContain('### Step 4 — Tabulate (`bin/gstack-vote`, the ONLY tabulation path)');
    expect(AUTOPLAN_SKILL).toContain(
      '~/.claude/skills/gstack/bin/gstack-vote --dir "<literal $PANEL_OUT_DIR>" --surface "<surface label>" \\\n' +
        '  --nonce "<literal $PANEL_NONCE>" \\\n' +
        '  --budget-usd "$(~/.claude/skills/gstack/bin/gstack-config has panel_budget_usd 2>/dev/null || echo 1.50)"',
    );
  });

  // M3 outside-voices panel integration (2026-08-31): Step 7 ("Persist the
  // aggregate record + cleanup") re-invokes `gstack-vote --dir` a SECOND time
  // — with `--json` and no `--surface`/`--budget-usd` — to get the raw
  // TallyResult it maps into the aggregate `outside-voices` review-log record,
  // re-reading the SAME `*.result.json` files Step 4 already tabulated
  // (BEFORE the cleanup step deletes them) rather than re-implementing the
  // tally. This is a second CALL to the same ONLY tabulation path, not a
  // second tabulation MECHANISM, so it doesn't contradict the Step 4 heading
  // above. Pinned separately so a future edit can't silently drop the
  // aggregate-record re-read without failing a test.
  test('Step 7 wires the aggregate-record JSON re-read of the same gstack-vote tally: --dir, --nonce, --json', () => {
    expect(AUTOPLAN_SKILL).toContain('### Step 7 — Persist the aggregate record + cleanup');
    expect(AUTOPLAN_SKILL).toContain(
      '~/.claude/skills/gstack/bin/gstack-vote --dir "<literal $PANEL_OUT_DIR>" --nonce "<literal $PANEL_NONCE>" --json',
    );
  });

  test('these invocation lines are distinct from the Step 5 EXAMPLE output table (the tautology vector) — the panel-invoke line exists once; the vote line exists exactly twice (Step 4 tabulate + Step 7 JSON re-read), never more', () => {
    // Sanity: the example table this pin deliberately does NOT rely on is
    // still there (Step 5 documents what the real output looks like) — this
    // just confirms the two things (real invocation vs. illustrative
    // output) are separate, non-overlapping pieces of the rendered skill.
    const exampleTable = 'claude  anthropic  ready    CONCERNS   P1 unbounded retry queue.ts#retry    (repro claimed)';
    expect(AUTOPLAN_SKILL).toContain(exampleTable);
    expect(AUTOPLAN_SKILL.split('~/.claude/skills/gstack/bin/gstack-panel --surface <surface>').length - 1).toBe(1);
    // Exactly the two known-good forms, once each — not a loose count, so a
    // stray THIRD gstack-vote call (a real regression) still fails this.
    const voteDirCount = AUTOPLAN_SKILL.split('~/.claude/skills/gstack/bin/gstack-vote --dir').length - 1;
    expect(voteDirCount).toBe(2);
    expect(
      AUTOPLAN_SKILL.split(
        '~/.claude/skills/gstack/bin/gstack-vote --dir "<literal $PANEL_OUT_DIR>" --surface "<surface label>"',
      ).length - 1,
    ).toBe(1);
    expect(
      AUTOPLAN_SKILL.split(
        '~/.claude/skills/gstack/bin/gstack-vote --dir "<literal $PANEL_OUT_DIR>" --nonce "<literal $PANEL_NONCE>" --json',
      ).length - 1,
    ).toBe(1);
  });
});

// ── Tamper-resistant evidence-bucket logic (gate-grok P1 #4 fix, hardened
// round 2 against the Bash-vector — gate2-codex [P2] / gate2-eng-review B-2 /
// fix2.md's deferred item) ───────────────────────────────────────────────
//
// autoplan/SKILL.md ships a literal EXAMPLE per-voice-row table ("Outside
// Voices — advisory panel", "VOICE VENDOR STATUS VERDICT", "claude anthropic
// ready CONCERNS", "RECOMMENDATION: CONCERNS" — Step 5 of the procedure) and
// each phase's mandatory phase-transition summary is a literal TEMPLATE line
// ("**Phase 1 complete.** ... Outside-voices panel: [N ready / M voices]").
// /autoplan Reads the whole skill file in Phase 0 REGARDLESS of whether it
// goes on to run anything — that Read's tool_result lands in the transcript
// as a `user` event carrying the full file text. The PRE-fix version of this
// test matched regexes against the WHOLE transcript (raw JSON-stringified
// `user`/`assistant` events, `result.output`), so a model that read the
// skill and stalled before Phase 1 — never invoking
// gstack-panel/gstack-vote/fable at all — still passed.
//
// Fix (round 1): only trust transcript content that is STRUCTURALLY tied to
// a real tool invocation:
//   - tool_use blocks (name + input) — these NEVER carry file/command
//     OUTPUT, only the parameters the model chose to call a tool with (a
//     Bash `command` string, an Agent `subagent_type`/`model`, a Read
//     `file_path`) — so they cannot be contaminated by SKILL.md's own prose
//     the way a Read's tool_result can.
//   - tool_results, but ONLY when the ORIGINATING tool_use was Bash (genuine
//     command stdout/stderr) or a Read of an actual `*.result.json` panel
//     artifact (a genuine per-voice verdict file — never SKILL.md or any
//     other `.md` doc). Every other tool_result — Read of SKILL.md chief
//     among them — is excluded entirely, closing the exact hole gate-grok
//     found.
//
// Round-1 residue (found in re-gate): the round-1 fix trusted EVERY Bash
// tool_result wholesale. A Bash `cat autoplan/SKILL.md` / `grep -A5
// gstack-panel autoplan/SKILL.md` re-opens a narrower version of the same
// tautology — the file's OWN Step 5 example table lands in
// `trustedResultContent` via a Bash tool_result instead of a Read one,
// satisfying `panelArtifact`/`anthropicVoiceRecorded` without a real panel
// run. Worse, the Bash command's own TEXT (`"command":"grep gstack-panel
// autoplan/SKILL.md"`) contains the search term "gstack-panel" as a
// substring, which alone satisfies `panelInvoked`'s regex against
// `toolUseContent` — the model never has to execute the binary, just
// mention its name while grepping for it.
//
// Fix (round 2): a Bash tool_use/tool_result pair is excluded from BOTH
// evidence buckets when its `command` is a plain FILE READ of a `*SKILL.md`
// path (`cat`/`grep`/`head`/`tail`/`less`/`sed`/`awk` over a SKILL.md path)
// — `isSkillFileReadCommand` below. A real panel run never shells out to one
// of those utilities against a SKILL.md file; it invokes
// `~/.claude/skills/gstack/bin/gstack-panel`/`gstack-vote` directly
// (Procedure Step 2/Step 4) and reads `*.result.json` artifacts (Step
// 3/Step 4). Excluding skill-file reads from `toolUseContent` closes the
// `panelInvoked` substring-match vector; excluding them from
// `trustedResultContent` closes the `panelArtifact`/`anthropicVoiceRecorded`
// re-injection vector. The test can no longer pass on a model that merely
// dumps the skill file via Bash instead of actually running
// `gstack-panel`/`gstack-vote`.
//
// `result.output` (the model's own final freeform summary) is deliberately
// NOT used as evidence either: a confused model could paraphrase/echo the
// skill's example text in its own words there, and there is no structural
// way to tell that apart from a genuine completion summary.
//
// Round-3 residue (gate-round-3 codex P2 / /review + gate3-eng-review):
// `panelInvoked` was still a SUBSTRING match — `/"command":"[^"]*gstack-
// panel/.test(toolUseContent)` — against the JSON-stringified Bash command.
// That regex is satisfied the instant the text "gstack-panel" appears
// ANYWHERE in a command's arguments (e.g. `echo "still need to run
// gstack-panel before merging"`, or `ls gstack-panel-notes.txt`), with no
// requirement that the command actually EXECUTE the binary. Separately, the
// round-2 skill-file-read denylist (cat/grep/head/tail/less/sed/awk) missed
// `rg`/`nl`/`more`/`bat`, so e.g. `rg 'CODEX SAYS' autoplan/SKILL.md` could
// still re-inject the file's own example table into trustedResultContent.
//
// Fix (round 3): `panelInvoked` is now a binary ALLOWLIST
// (commandInvokesPanelBinary below) — it parses each Bash command into the
// executable(s) it actually runs (first token per `;`/`&&`/`||`/`|`/newline-
// separated segment, skipping env-var prefixes) and only counts when that
// executable's basename IS `gstack-panel`/`gstack-vote` (bare, or via any
// path depth like `bin/gstack-panel`). The command's own argument text —
// including a bare mention of the binary's name — can no longer satisfy it.
// The skill-file-read denylist (SKILL_FILE_READ_COMMAND_RE) was widened to
// add `rg`/`nl`/`more`/`bat` alongside the existing cat/grep/head/tail/less/
// sed/awk.
//
// Extracted to a standalone, pure function (no network, no API key) so its
// LOGIC can be exercised directly against synthetic fixture transcripts even
// when the live EVALS-gated test below cannot run in this sandbox (nested
// `claude -p` auth is unavailable inside a Claude Code session — see the
// FOLLOW-UP note on the live test). See "Bash-vector detection logic" below
// for the offline fixture coverage.

/** A plain FILE READ of a `*SKILL.md` path via a read-only text utility —
 * never a real gstack-panel/gstack-vote invocation (which always runs the
 * binary directly, with flags like `--surface`/`--dir`, not
 * `cat`/`grep`/`rg`/`head`/`tail`/`nl`/`more`/`bat`/`less`/`sed`/`awk`).
 *
 * Round-3 widening (/review + gate3-eng-review, fix3): the round-2 list
 * (cat/grep/head/tail/less/sed/awk) missed `rg` (the fast-grep replacement
 * most agents reach for first), `nl`, `more`, and `bat` — each of those can
 * dump a SKILL.md's content (including its Step 5 example table / literal
 * invocation lines) into a Bash tool_result exactly like `cat` can, re-
 * opening the same tautology round 2 closed for cat/grep/head/tail. */
const SKILL_FILE_READ_COMMAND_RE = /\b(?:cat|grep|rg|head|tail|nl|more|bat|less|sed|awk)\b[^\n]*\bSKILL\.md\b/i;
function isSkillFileReadCommand(command: unknown): boolean {
  return typeof command === 'string' && SKILL_FILE_READ_COMMAND_RE.test(command);
}

/** Parses a Bash command string into the executables it actually runs — the
 * first token of each top-level segment (split on `;`, `&&`, `||`, `|`, and
 * newlines), skipping any leading `VAR=value` env-assignment prefixes. This
 * is a best-effort, non-shell-grammar parse — good enough to tell "the
 * command's executable IS gstack-panel/gstack-vote" apart from "the string
 * gstack-panel/gstack-vote merely appears somewhere in this command's
 * arguments" (round-3 codex P2, ~line 235-236 in the pre-fix version: a Bash
 * SUBSTRING match against the JSON-stringified command let e.g.
 * `echo "still need to run gstack-panel"` count as a real invocation,
 * because the regex just checked whether the text "gstack-panel" appeared
 * anywhere after `"command":"`, never who the command actually executes). */
function extractCommandExecutables(command: string): string[] {
  const segments = command.split(/&&|\|\||[;|\n]/);
  const executables: string[] = [];
  for (const rawSegment of segments) {
    const trimmed = rawSegment.trim().replace(/^[(){}]+/, '').trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
    if (i < tokens.length) executables.push(tokens[i].replace(/^["']|["']$/g, ''));
  }
  return executables;
}

/** True when `token` (an executable path from extractCommandExecutables) IS
 * `gstack-panel`/`gstack-vote`, at any path depth (bare `gstack-panel`,
 * `bin/gstack-panel`, `~/.claude/skills/gstack/bin/gstack-panel`) — matched
 * on the path's basename, never as a substring against unrelated text. */
function isPanelBinaryExecutable(token: string): boolean {
  const base = token.split('/').pop() ?? '';
  return base === 'gstack-panel' || base === 'gstack-vote';
}

/** Allowlist replacement for the old substring-matching `panelInvoked`
 * (round-3 codex P2 / eng-review "invert to a binary allowlist", fix3):
 * true ONLY when a Bash command's actual executable is
 * `gstack-panel`/`gstack-vote` — never when that name merely appears inside
 * the command's arguments, a file name, or echoed prose. */
function commandInvokesPanelBinary(command: unknown): boolean {
  return typeof command === 'string' && extractCommandExecutables(command).some(isPanelBinaryExecutable);
}

/** Computes the tamper-resistant evidence-bucket verdicts from a raw
 * session-runner transcript. Pure — no I/O, no network — so it is callable
 * both from the live EVALS test and from static fixture tests. */
function computeAutoplanPanelEvidence(transcript: any[]) {
  const toolUseById = new Map<string, { name: string; input: any }>();
  for (const entry of transcript) {
    if (entry?.type !== 'assistant') continue;
    for (const item of entry.message?.content ?? []) {
      if (item?.type === 'tool_use' && item.id) {
        toolUseById.set(item.id, { name: item.name, input: item.input });
      }
    }
  }

  // Every tool_use's name+input, JSON-stringified — parameters only, never
  // output/file content. Excludes Bash tool_use entries whose command is a
  // plain read of a SKILL.md file: such a command's own TEXT can contain the
  // search term "gstack-panel"/"gstack-vote" (e.g. `grep gstack-panel
  // autoplan/SKILL.md`) without the model ever having run the binary — see
  // isSkillFileReadCommand above.
  const toolUseContent = [...toolUseById.values()]
    .filter((t) => !(t.name === 'Bash' && isSkillFileReadCommand(t.input?.command)))
    .map((t) => JSON.stringify(t))
    .join('\n');

  // tool_results, restricted to Bash output (excluding plain SKILL.md reads
  // — see isSkillFileReadCommand above) or a `*.result.json` Read — real
  // command execution / real panel artifacts only.
  const trustedResultContent = transcript
    .filter((e: any) => e?.type === 'user')
    .flatMap((e: any) => e.message?.content ?? [])
    .filter((item: any) => item?.type === 'tool_result')
    .filter((item: any) => {
      const origin = toolUseById.get(item.tool_use_id);
      if (!origin) return false;
      if (origin.name === 'Bash') return !isSkillFileReadCommand(origin.input?.command);
      if (origin.name === 'Read' && /\.result\.json$/.test(String(origin.input?.file_path ?? ''))) return true;
      return false;
    })
    .map((item: any) => JSON.stringify(item.content ?? ''))
    .join('\n');

  // Panel mechanism: the model actually invoked gstack-panel/gstack-vote (a
  // Bash tool_use whose command's ACTUAL EXECUTABLE is the binary — an
  // allowlist match via commandInvokesPanelBinary, not a substring search;
  // see that function's doc comment for the round-3 codex P2 bug this
  // replaces), OR real Bash/artifact output shows the panel's actual
  // per-voice-row table, verdict schema, or a graceful ABSENT/consent
  // degrade (all scoped to trustedResultContent — never a Read, or a Bash
  // read, of SKILL.md).
  const panelInvoked = [...toolUseById.values()].some(
    (t) => t.name === 'Bash' && commandInvokesPanelBinary(t.input?.command),
  );
  const panelArtifact =
    /"schema":\s*"outside-voice\/v2"/.test(trustedResultContent) ||
    /RECOMMENDATION:\s*(PASS|CONCERNS|BLOCK|none)/.test(trustedResultContent) ||
    /VOICE\s+VENDOR\s+STATUS\s+VERDICT/.test(trustedResultContent);
  const panelDegraded =
    /:\s*ABSENT\s*—/.test(trustedResultContent) ||
    /NEEDS_CONSENT:/.test(trustedResultContent) ||
    /codex CLI not installed|auth preflight failed|codex_reviews=/i.test(trustedResultContent);
  const panelRan = panelInvoked || panelArtifact || panelDegraded;

  // Anthropic voices: fable is dispatched via the Agent tool_use (runtime
  // `subagent_type`/`model: fable`, `run_in_background: false` — Procedure
  // Step 3, structural, safe); the native Claude pass has no separate tool
  // call (the current agent reviews itself and writes claude.result.json),
  // so also accept a genuine `*.result.json` artifact record or real Bash
  // output recording either voice.
  const fableDispatched =
    /"subagent_type":"[^"]*fable[^"]*"/.test(toolUseContent) || /"model":"fable"/i.test(toolUseContent);
  const anthropicVoiceRecorded =
    /"voice":\s*"(fable|claude)"/.test(trustedResultContent) ||
    /claude\s+anthropic\s+(ready|absent)/i.test(trustedResultContent) ||
    /\b(fable|claude):\s*ABSENT/i.test(trustedResultContent);
  const anthropicVoiceFired = fableDispatched || anthropicVoiceRecorded;

  return {
    toolUseContent,
    trustedResultContent,
    panelInvoked,
    panelArtifact,
    panelDegraded,
    panelRan,
    fableDispatched,
    anthropicVoiceRecorded,
    anthropicVoiceFired,
  };
}

// Fixture builders for the offline logic test below — minimal
// session-runner-shaped transcript entries (assistant tool_use / user
// tool_result pairs), not a real Anthropic transcript.
function bashUse(id: string, command: string) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } };
}
function bashResult(id: string, output: string) {
  return { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: output }] } };
}
function readUse(id: string, file_path: string) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path } }] } };
}
function readResult(id: string, output: string) {
  return { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: output }] } };
}

// The exact Step 5 example table + Step 2/Step 4 invocation lines
// autoplan/SKILL.md actually ships (copied from the always-on static pins
// above) — realistic bait for the Bash-vector fixtures below.
const SKILL_MD_EXAMPLE_TABLE_AND_INVOCATION = [
  'Outside Voices — advisory panel (recommendation only; the user decides)',
  '  VOICE   VENDOR     STATUS   VERDICT    TOP FINDING (promoted)',
  '  claude  anthropic  ready    CONCERNS   P1 unbounded retry queue.ts#retry    (repro claimed)',
  '  RECOMMENDATION: CONCERNS   (vendor-median; anthropic collapsed to one ordinal)',
  '~/.claude/skills/gstack/bin/gstack-panel --surface <surface> \\',
  '  --prompt-file "<literal $PANEL_PROMPT_FILE>"',
  '~/.claude/skills/gstack/bin/gstack-vote --dir "<literal $PANEL_OUT_DIR>" --surface "<surface label>" \\',
].join('\n');

describe('Bash-vector detection logic (offline, no API key, no EVALS) — fix2/fix3 hardening against a Bash-mediated SKILL.md dump and the panelInvoked substring-match vector', () => {
  test('a model that ONLY Reads autoplan/SKILL.md (round-1 vector) still correctly fails — panelRan and anthropicVoiceFired are both false', () => {
    const transcript = [
      readUse('t1', 'autoplan/SKILL.md'),
      readResult('t1', SKILL_MD_EXAMPLE_TABLE_AND_INVOCATION),
    ];
    const evidence = computeAutoplanPanelEvidence(transcript);
    expect(evidence.panelRan).toBe(false);
    expect(evidence.anthropicVoiceFired).toBe(false);
  });

  test('a model that dumps autoplan/SKILL.md via Bash `cat` (round-2 vector) correctly fails — this is the exact bug the round-2 fix closes', () => {
    // Before the round-2 fix, `trustedResultContent` trusted EVERY Bash
    // tool_result wholesale — this fixture's `cat` output IS the file's own
    // Step 5 example table + invocation lines, which would have satisfied
    // panelArtifact/anthropicVoiceRecorded without any panel ever running.
    const transcript = [
      bashUse('t1', 'cat autoplan/SKILL.md'),
      bashResult('t1', SKILL_MD_EXAMPLE_TABLE_AND_INVOCATION),
    ];
    const evidence = computeAutoplanPanelEvidence(transcript);
    expect(evidence.panelRan).toBe(false);
    expect(evidence.anthropicVoiceFired).toBe(false);
  });

  test('a model that greps autoplan/SKILL.md for "gstack-panel" via Bash (round-2 vector) correctly fails panelInvoked — the search term in its own command no longer counts as invocation', () => {
    // Originally (round 2) this was excluded only because the command was a
    // SKILL.md read. Round 3 makes it fail for a STRONGER reason too: the
    // command's actual executable is `grep`, not `gstack-panel`/
    // `gstack-vote` — commandInvokesPanelBinary's allowlist rejects it
    // regardless of the SKILL.md-read denylist. ("command":"grep -n
    // gstack-panel autoplan/SKILL.md" contains the substring "gstack-panel",
    // which is exactly what the pre-round-3 regex wrongly matched against.)
    const transcript = [
      bashUse('t1', 'grep -n gstack-panel autoplan/SKILL.md'),
      bashResult('t1', '1389:- **`fable`:** dispatch via the Agent tool with runtime `model: fable`'),
    ];
    const evidence = computeAutoplanPanelEvidence(transcript);
    expect(evidence.panelInvoked).toBe(false);
    expect(evidence.panelRan).toBe(false);
  });

  test('a model that dumps autoplan/SKILL.md via Bash `rg` (round-3 vector: the round-2 denylist missed rg/nl/more/bat) correctly fails — no evidence is produced', () => {
    // /review + gate3-eng-review: the round-2 denylist covered
    // cat/grep/head/tail/less/sed/awk but missed `rg` — the fast-grep tool
    // most agents reach for first. Before the round-3 widening, this
    // fixture's `rg` output IS the file's own Step 5 example table +
    // invocation lines, which would have satisfied
    // panelArtifact/anthropicVoiceRecorded without any panel ever running —
    // the exact same tautology round 2 closed for `cat`.
    const transcript = [
      bashUse('t1', "rg 'CODEX SAYS' autoplan/SKILL.md"),
      bashResult('t1', SKILL_MD_EXAMPLE_TABLE_AND_INVOCATION),
    ];
    const evidence = computeAutoplanPanelEvidence(transcript);
    expect(evidence.panelRan).toBe(false);
    expect(evidence.anthropicVoiceFired).toBe(false);
  });

  test('a model that greps/rgs/heads/tails/nls/mores/bats/seds/awks a SKILL.md path is excluded regardless of which read-only utility it uses', () => {
    for (const cmd of [
      'grep -A5 "RECOMMENDATION" autoplan/SKILL.md',
      "rg -n 'CODEX SAYS' autoplan/SKILL.md",
      'head -c 2000 autoplan/SKILL.md',
      'tail -n 200 .agents/skills/gstack-autoplan/SKILL.md',
      'nl autoplan/SKILL.md',
      'more autoplan/SKILL.md',
      'bat autoplan/SKILL.md',
      'less autoplan/SKILL.md',
      "sed -n '1380,1400p' autoplan/SKILL.md",
      "awk '/RECOMMENDATION/' autoplan/SKILL.md",
    ]) {
      expect(isSkillFileReadCommand(cmd), `expected excluded: ${cmd}`).toBe(true);
    }
  });

  test('a bare substring of "gstack-panel"/"gstack-vote" inside an UNRELATED command\'s arguments does NOT count as panelInvoked (round-3 codex P2: the pre-fix regex substring-matched the JSON-stringified command text, not the actual executable)', () => {
    // This is the exact bug flagged at ~line 235-236 of the pre-fix version:
    // `/"command":"[^"]*gstack-panel/.test(toolUseContent)` is satisfied the
    // instant the text "gstack-panel" appears ANYWHERE in a command's
    // arguments — no execution of the binary required, and this command
    // isn't even a SKILL.md read, so the denylist alone can't catch it.
    const transcript = [
      bashUse('t1', 'echo "TODO: still need to run gstack-panel and gstack-vote before merging this PR"'),
      bashResult('t1', 'TODO: still need to run gstack-panel and gstack-vote before merging this PR'),
    ];
    const evidence = computeAutoplanPanelEvidence(transcript);
    expect(evidence.panelInvoked).toBe(false);
    expect(evidence.panelRan).toBe(false);
    expect(evidence.anthropicVoiceFired).toBe(false);
  });

  test('a genuine gstack-panel invocation via a RELATIVE path (bin/gstack-panel, not the full ~/.claude/... path) still sets panelInvoked, and a Read of its *.result.json artifact sets panelArtifact — the allowlist matches on executable basename, not a fixed literal path', () => {
    const transcript = [
      bashUse('t1', 'bin/gstack-panel --surface eng --out-dir /tmp/x --wall-clock-s 560'),
      bashResult('t1', 'wrote /tmp/x/codex.result.json'),
      readUse('t2', '/tmp/x/codex.result.json'),
      // A genuine gstack-vote-tabulated RECOMMENDATION line, exactly the
      // shape panelArtifact's `/RECOMMENDATION:\s*(PASS|CONCERNS|BLOCK|
      // none)/` pattern matches against real Bash/artifact output.
      readResult('t2', 'RECOMMENDATION: PASS'),
    ];
    const evidence = computeAutoplanPanelEvidence(transcript);
    expect(evidence.panelInvoked).toBe(true);
    expect(evidence.panelArtifact).toBe(true);
    expect(evidence.panelRan).toBe(true);
  });

  test('a chained command (cd ... && bin/gstack-vote ...) is still recognized — the allowlist parses each &&-separated segment\'s own executable, not just the first token of the whole string', () => {
    const transcript = [
      bashUse('t1', 'cd /tmp/x && bin/gstack-vote --dir /tmp/x --surface eng --nonce abc123 --budget-usd 1.50'),
      bashResult('t1', '  RECOMMENDATION: CONCERNS'),
    ];
    const evidence = computeAutoplanPanelEvidence(transcript);
    expect(evidence.panelInvoked).toBe(true);
  });

  test('a real gstack-panel + gstack-vote invocation (with genuine console output) correctly PASSES — the fix does not break real panel runs', () => {
    // Bait shaped like gstack-vote's ACTUAL printed per-voice-row table
    // (Procedure Step 5) — quote-free console text, the realistic shape of
    // a real Bash tool_result, not a hand-built JSON literal.
    const transcript = [
      bashUse(
        't1',
        '~/.claude/skills/gstack/bin/gstack-panel --surface ceo --prompt-file /tmp/x/prompt.txt --untrusted-file /tmp/x/untrusted.txt --datamark abc123 --out-dir /tmp/x --wall-clock-s 560',
      ),
      bashResult('t1', 'wrote /tmp/x/codex.result.json\nwrote /tmp/x/grok.result.json (absent)'),
      bashUse('t2', '~/.claude/skills/gstack/bin/gstack-vote --dir /tmp/x --surface ceo --nonce abc123 --budget-usd 1.50'),
      bashResult(
        't2',
        '  VOICE   VENDOR     STATUS   VERDICT\n' +
          '  codex   openai     ready    CONCERNS\n' +
          '  fable   anthropic  ready    PASS\n' +
          '  claude  anthropic  ready    CONCERNS\n' +
          '  RECOMMENDATION: CONCERNS',
      ),
    ];
    const evidence = computeAutoplanPanelEvidence(transcript);
    expect(evidence.panelInvoked).toBe(true);
    expect(evidence.panelRan).toBe(true);
    expect(evidence.anthropicVoiceRecorded).toBe(true);
    expect(evidence.anthropicVoiceFired).toBe(true);
  });

  test('a Bash command that merely MENTIONS a SKILL.md path without reading it (e.g. invoking the panel binary itself) is NOT excluded', () => {
    // isSkillFileReadCommand only matches cat/grep/rg/head/tail/nl/more/bat/
    // less/sed/awk OVER a SKILL.md path — a real binary invocation should
    // never be misclassified as a skill-file read just because "SKILL.md"
    // appears somewhere unrelated in the command line.
    expect(isSkillFileReadCommand('~/.claude/skills/gstack/bin/gstack-panel --surface ceo')).toBe(false);
    expect(isSkillFileReadCommand('~/.claude/skills/gstack/bin/gstack-vote --dir /tmp/x')).toBe(false);
  });
});

const evalCollector = createEvalCollector('e2e-autoplan-dual-voice');

describeIfSelected('Autoplan dual-voice E2E', ['autoplan-dual-voice'], () => {
  let workDir: string;
  let planPath: string;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-autoplan-dv-'));

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: workDir, stdio: 'pipe', timeout: 10000 });

    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(workDir, 'README.md'), '# test repo\n');
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);

    // Copy /autoplan + its review-skill dependencies (they're loaded from disk).
    copyDirSync(path.join(ROOT, 'autoplan'), path.join(workDir, 'autoplan'));
    copyDirSync(path.join(ROOT, 'plan-ceo-review'), path.join(workDir, 'plan-ceo-review'));
    copyDirSync(path.join(ROOT, 'plan-eng-review'), path.join(workDir, 'plan-eng-review'));
    copyDirSync(path.join(ROOT, 'plan-design-review'), path.join(workDir, 'plan-design-review'));
    copyDirSync(path.join(ROOT, 'plan-devex-review'), path.join(workDir, 'plan-devex-review'));

    // Register the skills as project-level slash commands. The root copies
    // above are NOT enough on their own: claude -p only discovers skills under
    // .claude/skills/, and an unregistered slash command short-circuits with
    // "Unknown command: /autoplan" (0 turns, ~1s) on claude >= 2.x — the model
    // never runs, so both voice assertions fail. Same install pattern as
    // installSkills() in skill-routing-e2e.test.ts.
    const skillsBase = path.join(workDir, '.claude', 'skills');
    for (const skill of ['autoplan', 'plan-ceo-review', 'plan-eng-review', 'plan-design-review', 'plan-devex-review']) {
      const dest = path.join(skillsBase, skill);
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(path.join(ROOT, skill, 'SKILL.md'), path.join(dest, 'SKILL.md'));
    }

    // Write a tiny plan file for /autoplan to review.
    planPath = path.join(workDir, 'TEST_PLAN.md');
    fs.writeFileSync(planPath, `# Test Plan: add /greet skill

## Context
Add a new /greet skill that prints a welcome message.

## Scope
- Create greet/SKILL.md with a simple "hello" flow
- Add to gen-skill-docs pipeline
- One unit test
`);
  });

  afterAll(() => {
    finalizeEvalCollector(evalCollector);
    if (workDir && fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  // Skip entirely unless evals enabled (periodic tier).
  //
  // SANDBOX LIMITATION (fix1 test-task follow-up): this test spawns `claude -p`
  // as a real subprocess (session-runner.ts) that needs a live Anthropic API
  // key from a plain, non-nested terminal. This session runs INSIDE a Claude
  // Code session, and nested `claude -p` auth is not available here (a
  // documented Tier-2 limitation — see reports/fix1-tests.md) — `EVALS=1 bun
  // test test/skill-e2e-autoplan-dual-voice.test.ts` was run as part of this
  // fix to confirm the failure mode is exactly that (auth/preflight), not a
  // bug in the detection logic below. The detection logic itself was
  // restructured (see the transcript-evidence section right below) so that
  // WHEN it does run with a real key, it can no longer pass on a Read alone —
  // that fix is verifiable by static inspection even though a live PASS
  // cannot be produced in this sandbox. FOLLOW-UP: re-run `EVALS=1 bun test
  // test/skill-e2e-autoplan-dual-voice.test.ts` from a plain terminal with
  // ANTHROPIC_API_KEY set to confirm an actual panel run now passes only on
  // genuine gstack-panel/gstack-vote invocation evidence.
  test.skipIf(!evalsEnabled)(
    'the outside-voices advisory panel produces output in Phase 1 (within timeout)',
    async () => {
      // Fire /autoplan with a 10-min hard timeout on the spawn itself.
      // The skill itself has 10-min phase timeouts + gstack-panel's own
      // wall-clock budget (--wall-clock-s 560), and the panel is advisory
      // (exit 0) even when every external voice ends up ABSENT — so a
      // missing codex auth on the test machine should still let the panel
      // (fable + native Claude) complete.
      // Budget note: 5 min / 30 turns was enough at v1.0-era skill sizes, but
      // the full-depth Phase 1 (registered skill + CEO review + the
      // outside-voices panel) now needs longer — at 300s the run was killed
      // mid-CEO-review with the panel already dispatched but no
      // Phase-1-complete marker yet.
      const result = await runSkillTest({
        testName: 'autoplan-dual-voice',
        workingDirectory: workDir,
        prompt: `/autoplan ${planPath}`,
        timeout: 600_000, // 10 min
        // /autoplan spawns subagents and calls codex via Bash; it needs the
        // full tool set to get past Phase 1. Bash+Read+Write alone wasn't
        // enough — the skill stalled trying to invoke Agent/Skill.
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Agent', 'Skill'],
        maxTurns: 40,
        runId,
      });

      // Tamper-resistant evidence buckets — see computeAutoplanPanelEvidence
      // above (defined once, module-level) for the full rationale + round-2
      // Bash-vector hardening. `result.output` (the model's own final
      // freeform summary) is deliberately NOT used as evidence: a confused
      // model could paraphrase/echo the skill's example text in its own
      // words there, with no structural way to tell that apart from a
      // genuine completion summary.
      const transcript = Array.isArray(result.transcript) ? result.transcript : [];
      const evidence = computeAutoplanPanelEvidence(transcript);
      const { panelInvoked, panelRan, anthropicVoiceFired } = evidence;

      expect(anthropicVoiceFired).toBe(true);
      expect(panelRan).toBe(true);

      // Hang protection: require STRUCTURAL evidence that Phase 1 review
      // dispatch actually happened — an Agent tool_use whose input carries
      // review instructions (execution artifact built by the skill, not an
      // echo of our prompt or of the skill's own phase-transition-summary
      // TEMPLATE line, which is why this no longer also matches a phrase
      // search over the raw transcript/output the way it used to).
      const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
      const reviewDispatched = toolCalls.some((tc: any) =>
        (tc?.tool === 'Agent' || tc?.tool === 'Task') &&
        /review|ceo|eng manager|strategy/i.test(JSON.stringify(tc?.input ?? {})));
      // Also accept a genuine Bash-executed gstack-panel/gstack-vote call
      // (panelInvoked) as proof Phase 1 progressed past a bare Read.
      expect(reviewDispatched || panelInvoked).toBe(true);

      logCost('autoplan-dual-voice', result);
      recordE2E(evalCollector, 'autoplan-dual-voice', 'Autoplan dual-voice E2E', result, {
        passed: anthropicVoiceFired && panelRan && (reviewDispatched || panelInvoked),
      });
    },
    630_000, // per-test timeout slightly > spawn timeout so cleanup can run
  );
});
