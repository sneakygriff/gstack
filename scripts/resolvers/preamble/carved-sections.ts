/**
 * Carved preamble sections — the Claude-host lazy-load split (#48).
 *
 * The preamble used to inline ~44 KB of identical prose into every generated
 * SKILL.md (54+ copies of the same text; ~77% of a typical skill invocation
 * was duplicated preamble). This module carves the runtime-CONDITIONAL mass
 * into shared files under `preamble/sections/` — one copy for the whole
 * suite — referenced from each skill by a compact index + in-place pointers,
 * exactly like the per-skill `sections/` carve (v2 plan T9), but shared.
 *
 * What carves (relevant only sometimes, skill-agnostic):
 *   - onboarding.md          one-time onboarding chain (lake intro, telemetry
 *                            prompt, proactive prompt, first-run guidance,
 *                            routing injection, vendoring deprecation) —
 *                            gated by preamble-echo flags; steady-state users
 *                            never load it
 *   - ask-user-questions.md  the FULL AskUserQuestion spec; a compact contract
 *                            with every mandatory marker stays inline (the
 *                            auq-format-always-loaded guarantee holds — see
 *                            test/auq-format-always-loaded.test.ts)
 *   - artifacts-sync.md      restore offer + privacy stop-gate (rare paths);
 *                            the always-run bash moved to
 *                            bin/gstack-artifacts-preamble (code, not prose)
 *
 * What stays inline: the preamble bash (defines every env var), plan-mode
 * info (must precede all other instructions), upgrade/spawned-session checks,
 * ambient style guidance (Voice, Writing Style, Completeness, ...), and the
 * Completion Status / Telemetry run-last pairing.
 *
 * HOST SPLIT: Claude only. Every other host keeps the full inlined preamble
 * (mirrors the per-skill section carve, which also inlines via {{SECTION:id}}
 * on non-Claude hosts). generatePreamble branches on ctx.host === 'claude'.
 */
import type { TemplateContext } from '../types';
import { generateAskUserFormat, AUQ_FORMAT_BLOCK } from './generate-ask-user-format';
import { generateLakeIntro } from './generate-lake-intro';
import { generateTelemetryPrompt } from './generate-telemetry-prompt';
import { generateProactivePrompt } from './generate-proactive-prompt';
import { generateFirstRunGuidance } from './generate-first-run-guidance';
import { generateRoutingInjection } from './generate-routing-injection';
import { generateVendoringDeprecation } from './generate-vendoring-deprecation';

/** Absolute base the generated pointers use. For Claude this renders as
 * `~/.claude/skills/gstack/preamble/sections` — resolvable through the repo
 * clone from any install (flat symlink dirs, PTY smoke, cherry-picked
 * installs), and rewritten by --out-dir's rewriteSectionBase (the path
 * matches its `<something>/sections/` regex). */
export function carvedSectionBase(ctx: TemplateContext): string {
  return `${ctx.paths.skillRoot}/preamble/sections`;
}

/** Compact index table injected near the top of every Claude skill. Rows are
 * tier-gated the same way the sections they replace were. */
export function generatePreambleSectionIndex(ctx: TemplateContext): string {
  const tier = ctx.preambleTier ?? 4;
  const base = carvedSectionBase(ctx);
  const rows: string[] = [
    `| the preamble echo shows a pending onboarding flag — \`LAKE_INTRO: no\`, \`TEL_PROMPTED: no\`, \`PROACTIVE_PROMPTED: no\`, \`ACTIVATED: no\`, \`FIRST_LOOP_SHOWN: no\`, \`HAS_ROUTING: no\` (unless \`ROUTING_DECLINED: true\`), or \`VENDORED_GSTACK: yes\`. Skip entirely when \`SPAWNED_SESSION: true\`. | \`${base}/onboarding.md\` |`,
  ];
  if (tier >= 2) {
    rows.push(
      `| before composing your FIRST AskUserQuestion or prose decision brief this run | \`${base}/ask-user-questions.md\` |`,
    );
  }
  rows.push(
    `| the Artifacts Sync output shows \`artifacts repo detected\` or \`ARTIFACTS_SYNC_PROMPT: needed\` | \`${base}/artifacts-sync.md\` |`,
  );
  return `## Preamble Section Index — shared sections, read on demand

Heavy preamble guidance is carved into shared files under \`${base}/\` (one copy
for the whole skill suite). Read a file IN FULL the moment its trigger applies —
never act on its topic from memory. If that base doesn't exist on this machine
(vendored or non-standard install), resolve the same filename relative to this
skill file's own installed location instead — \`../../preamble/sections/\` from
a skill dir, or the gstack repo root's \`preamble/sections/\`.

| When | Read |
|------|------|
${rows.join('\n')}`;
}

/**
 * Always-loaded AskUserQuestion contract (Claude host). The FULL spec lives in
 * the shared ask-user-questions.md section; this floor keeps every mandatory
 * format marker in the skeleton so a question firing before the Read still
 * renders a compliant brief (the always-loaded guarantee —
 * test/auq-format-always-loaded.test.ts documents the policy).
 *
 * The pointer must NOT use the `> **STOP.**` blockquote: carve-guard
 * checkOrdering treats the first STOP marker in a skeleton as section-routing
 * and would flag mustPrecedeStop anchors (e.g. cso's "## Arguments") as
 * stranded behind a preamble STOP.
 */
export function generateAskUserFormatCompact(ctx: TemplateContext): string {
  const base = carvedSectionBase(ctx);
  return `## AskUserQuestion Format

Every AskUserQuestion is a decision brief sent as tool_use, not prose (exceptions below).

**Read-first rule:** before composing your FIRST AskUserQuestion or prose decision
brief this run, Read \`${base}/ask-user-questions.md\` in full — tool resolution
(Conductor/MCP variants), prose-fallback layout, split rules for 5+ options, and
CJK handling live there. The contract below is the always-loaded floor, not the
full spec.

${AUQ_FORMAT_BLOCK}

D-numbering starts at \`D1\` per skill invocation; increment yourself. ELI10 and
Recommendation are ALWAYS present — ELI10 in plain English, not function names;
keep the \`(recommended)\` label — AUTO_DECIDE depends on it. Minimum 2 ✅ and 1 ❌ per option, ≥40 chars each (hard-stop escape
for one-way/destructive confirmations: \`✅ No cons — this is a hard-stop choice\`).
If \`CONDUCTOR_SESSION: true\` was echoed by the preamble, never call the tool —
render the brief as prose (full rules in the shared section). AskUserQuestion caps
every call at 4 options — with 5+ real options, split or batch per the shared
section; NEVER drop, merge, or silently defer one to fit.

### When AskUserQuestion is unavailable or a call fails

A \`[plan-tune auto-decide] <id> → <option>\` result is the preference hook working
as designed, NOT a failure — proceed with that option; do not retry or fall back to
prose. On a genuine failure (no variant in your tool list, or the call errors —
retry once only if no answer could have surfaced), branch on \`SESSION_KIND\` from
the preamble echo (empty/absent ⇒ \`interactive\`): \`spawned\` → auto-choose the
recommended option; \`headless\` → \`BLOCKED — AskUserQuestion unavailable\`, stop
and wait; \`interactive\` → prose fallback: a \`D<N>\`-titled markdown brief carrying
the issue ELI10, per-choice \`Completeness: X/10\`, a \`Recommendation:\` line plus
the \`(recommended)\` marker, and a "reply with a letter" instruction — then STOP
and wait. Read the shared section (pointer above) before rendering it.

### Self-check before emitting

D<N> header · ELI10 + stakes line · Recommendation with concrete reason ·
Completeness scored (or kind-note) · ≥2 ✅ / ≥1 ❌ per option, ≥40 chars ·
\`(recommended)\` on exactly one option · Net line · tool_use not prose (unless
Conductor or the documented failure fallback) · 5+ options split, never dropped.`;
}

/** Inline Artifacts Sync (Claude host): the deterministic checks live in
 * bin/gstack-artifacts-preamble (code costs nothing to read); only the status
 * interpretation + run-last sync pairing stay in prose. */
export function generateArtifactsSyncInline(ctx: TemplateContext): string {
  const base = carvedSectionBase(ctx);
  return `## Artifacts Sync (skill start)

\`\`\`bash
${ctx.paths.binDir}/gstack-artifacts-preamble 2>/dev/null || echo "ARTIFACTS_SYNC: off"
\`\`\`

If the output includes \`artifacts repo detected\` or \`ARTIFACTS_SYNC_PROMPT: needed\`,
Read \`${base}/artifacts-sync.md\` and follow it before continuing. Otherwise continue.

At skill END before telemetry:

\`\`\`bash
${ctx.paths.binDir}/gstack-brain-sync --discover-new 2>/dev/null || true
${ctx.paths.binDir}/gstack-brain-sync --once 2>/dev/null || true
\`\`\`
`;
}

/** Shared onboarding file body: the one-time prompt chain, verbatim from the
 * per-generator sources, prefaced with its loading contract. Order matches the
 * old inline composition (lake → telemetry → proactive → first-run → routing
 * → vendoring) so the one-prompt-per-session cascade
 * (LAKE_INTRO → TEL_PROMPTED → PROACTIVE_PROMPTED → HAS_ROUTING) is preserved
 * as a unit. */
function generateOnboardingSectionBody(ctx: TemplateContext): string {
  return [
    `## Onboarding & One-Time Prompts (shared preamble section)

You loaded this because the preamble echo showed a pending onboarding flag.
Process ONLY the blocks whose flag matches the echo you saw; skip the rest.
At most ONE onboarding AskUserQuestion per session. If \`SPAWNED_SESSION\` is
\`true\`, skip this entire file.`,
    generateLakeIntro(),
    generateTelemetryPrompt(ctx),
    generateProactivePrompt(ctx),
    generateFirstRunGuidance(ctx),
    generateRoutingInjection(ctx),
    generateVendoringDeprecation(ctx),
  ].join('\n\n');
}

/** Shared artifacts-sync file body: the rare-path prose (restore offer +
 * privacy stop-gate) keyed off status lines emitted by
 * bin/gstack-artifacts-preamble. */
function generateArtifactsSyncLazyBody(ctx: TemplateContext): string {
  return `## Artifacts Sync — restore offer & privacy stop-gate (shared preamble section)

You loaded this because the skill-start artifacts status asked for it.

If the status output included \`artifacts repo detected: <url>\`: tell the user a
cross-machine artifacts repo exists and offer \`gstack-brain-restore\` to pull it
(or \`gstack-config set artifacts_sync_mode off\` to dismiss forever). Do NOT
auto-run the restore.

If the output included \`ARTIFACTS_SYNC_PROMPT: needed\` (sync off, never
prompted, gbrain available), ask once:

> gstack can publish your artifacts (CEO plans, designs, reports) to a private GitHub repo that GBrain indexes across machines. How much should sync?

Options:
- A) Everything allowlisted (recommended)
- B) Only artifacts
- C) Decline, keep everything local

After answer:

\`\`\`bash
# Chosen mode: full | artifacts-only | off
${ctx.paths.binDir}/gstack-config set artifacts_sync_mode <choice>
${ctx.paths.binDir}/gstack-config set artifacts_sync_mode_prompted true
\`\`\`

If A/B and \`~/.gstack/.git\` is missing, ask whether to run
\`gstack-artifacts-init\`. Do not block the skill.`;
}

/** Shared full-AUQ file body: the complete spec, unchanged, with a loading
 * contract preface. Reuses generateAskUserFormat verbatim so the spec text has
 * exactly one source of truth. */
function generateAskUserQuestionsBody(ctx: TemplateContext): string {
  return `<!-- Shared preamble section: the FULL AskUserQuestion spec. A compact
always-loaded contract lives in every tier-2+ SKILL.md; this file is read once
per run, before the first question fires. -->

${generateAskUserFormat(ctx)}`;
}

/** Dispatcher for the {{PREAMBLE_SECTION:id}} resolver used by
 * preamble/sections/*.md.tmpl. */
export function generatePreambleSection(ctx: TemplateContext, id: string): string {
  switch (id) {
    case 'onboarding':
      return generateOnboardingSectionBody(ctx);
    case 'ask-user-questions':
      return generateAskUserQuestionsBody(ctx);
    case 'artifacts-sync':
      return generateArtifactsSyncLazyBody(ctx);
    default:
      throw new Error(`Unknown preamble section id: ${id}`);
  }
}
