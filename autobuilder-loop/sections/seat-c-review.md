<!-- AUTO-GENERATED from seat-c-review.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->
# Seat C: engineering and code review methods

This is a findings-only reference generated from the canonical review sources below.
Read this entire file AND `~/.claude/skills/gstack/review/checklist.md` before reviewing.
If either is missing or unreadable, return REVIEW_INCOMPLETE, never clean.
Review the parent-specified immutable range and every acceptance clause. Remain read-only.
Apply all four engineering dimensions, failure modes, CRITICAL then INFORMATIONAL checklist
passes, suppressions and confidence rules. Follow the parent's P1/P2 and completion-marker format.

The extracted methodology mentions interactive planning outputs. In this gate, evaluate them
against the implemented code and briefs; report gaps as findings. Never write plan/test artifacts,
ask the user, start other reviewers, apply fixes or persist logs. For a choice, recommend an option
and record genuine taste calls in notes. These are the existing Seat C skip rules, not new waivers.

<!-- Canonical source: plan-eng-review/SKILL.md.tmpl | ## My engineering preferences -->
## My engineering preferences (use these to guide your recommendations):
* **Shared code:** require common behavior and improved reliability or net savings; similar-looking code alone is insufficient.
* **Tests:** every behavior tested; no test without a regression it would catch.
* **Enough engineering:** avoid fragility and premature abstraction/complexity.
* **Edge cases:** thorough handling over speed.
* **Explicit over clever.**
* **Right-sized diff:** smallest clear change; rewrite a broken foundation when necessary.

## Cognitive Patterns — How Great Eng Managers Think

Apply throughout, not as extra checks:

1. **State diagnosis:** Match falling behind, treading water, repaying debt or innovating (Larson).
2. **Blast radius:** Trace worst-case harm to systems and people.
3. **Boring by default:** Three innovation tokens; otherwise proven technology (McKinley).
4. **Incremental change:** Strangler migrations and canaries over big bangs (Fowler).
5. **Systems over heroes:** Design for tired humans at 3am.
6. **Reversibility:** Flags and incremental rollouts make mistakes cheap to undo.
7. **Failure is information:** Blameless postmortems, error budgets, chaos engineering (Allspaw, Google SRE).
8. **Conway's Law:** Design team/system boundaries together (Skelton/Pais).
9. **DX signals quality:** Slow CI, local dev and deploys predict quality and retention trouble.
10. **Essential vs accidental complexity:** Real problem or self-created? (Brooks).
11. **Two-week smell:** A small feature taking two weeks suggests onboarding trouble.
12. **Glue work:** Value coordination without trapping people in it (Reilly).
13. **Make change easy first:** Refactor before behavior changes; keep them separate (Beck).
14. **Own production:** Dev and ops share responsibility (Majors).
15. **Error budgets:** Spend a 99.9% SLO's 0.1% downtime budget; avoid uptime at any cost (Google SRE).

## Documentation and diagrams:
* Use ASCII diagrams for flows, states, dependencies, pipelines and decisions in plans/docs; propose inline code diagrams for complex Models, Controllers, Concerns, Services and Tests.
* Update nearby diagrams with code in the same commit. Flag stale diagrams even outside scope.

<!-- Canonical source: plan-eng-review/sections/review-sections.md.tmpl | ## Review Sections (after scope is agreed) -->
## Review Sections (after scope is agreed)

Evaluate Architecture → Code Quality → Tests → Performance,
at most 8 top issues each. Never condense, abbreviate or skip a section, including
strategy/spec/infra plans. With zero findings, report "No issues found" and continue.

After each of Sections 1–4, resolve new or reopened choices through Decision
procedure, report findings and dispositions, then continue.

### 1. Architecture review
Evaluate:
* System/component boundaries, dependencies and coupling.
* Data flow, bottlenecks, scaling and single points of failure.
* Security: auth, data access and API boundaries.
* Key flows needing ASCII diagrams in plans/code.
* One realistic production failure per new path/integration; does the plan handle it?
* **Distribution architecture:** New artifacts' build, publish and update paths; included or deferred CI/CD.

### 2. Code quality review
Evaluate:
* Organization and module structure.
* Shared-code opportunities in the target and related callers, using the rubric below. No standalone history/PR sweep or quotas. Check proposed caller assumptions against existing interfaces.
* Explicitly flag error handling gaps and missing edge cases.
* Technical debt, fragility and needless complexity per engineering preferences.
* Accuracy of touched files' ASCII diagrams.

### Shared-code evaluation rubric

- **Prove the callers.** Require at least two verified, first-party authored source
  locations, with functions and lines. Actual added or uncommitted source qualifies.
  Only an engineering-plan review may use proposed callers; label those assumptions
  and distinguish them from existing source. Similar names or formatting alone do
  not establish equivalent behavior. Generated and third-party copies cannot qualify
  as callers or contribute savings. Follow generated copies back to authored
  templates/resolvers. Existing dependencies remain valid reuse targets.
- **Reuse before extracting.** Inspect existing libraries and helpers first. Compare
  behavior, inputs, outputs, error handling, side effects, security requirements,
  dependencies, and deployment/runtime boundaries. Preserve differences callers need;
  do not bridge languages or isolated deployments without a practical shared contract.
- **Keep the helper small.** Name its destination and contract, the callers to migrate,
  and the smallest adoption sequence. Avoid option-heavy helpers and coupling unrelated
  components. Point to existing tests or established use, specify shared-contract and
  caller-integration coverage, and describe the blast radius of a shared failure.
- **Account for the whole change.** Name removed blocks and their replacements. Show
  estimated implementation lines removed, added, and saved separately from total lines
  removed, added, and saved including tests and integration. Savings = removed - added.
  Count moved code on both sides, exclude generated/vendor lines, use ranges when
  uncertain, and do not count overlapping removals twice across opportunities. State
  when tests or integration may make the total change grow.
- **Rank useful changes.** Favor reliability gains and total net savings, then low
  adoption and testing risk. Prefer proven code used by several callers. Use recent
  activity to break ties between comparable benefits, not as evidence by itself.
  Explain choices centered on older code. Reject similarities with incompatible
  contracts and opportunities whose benefits do not justify the abstraction.

Use Decision procedure for new/reopened extraction choices; scope approval does not approve extraction.

### 3. Test review

For shared-code changes, audit existing/missing shared-contract tests (behavior,
errors, side effects, boundaries) and each migrated caller's integration/differences.
Rejected extractions still need coverage for real duplicated-code defects.

Coverage goal: every changed behavior is protected by a test that would catch a real regression. Test count is not a goal. Identify the tests each planned codepath needs. Add required proof for an exact approved behavior without asking again; take new policies or optional verification depth through the decision gate before treating their tests as accepted work. Review the requirements here; do not build the proposed tests.

#### Test Framework Detection

Before analyzing coverage, detect the project's test framework:

1. **Read CLAUDE.md** — look for a `## Testing` section with test command and framework name. If found, use that as the authoritative source.
2. **If CLAUDE.md has no testing section, auto-detect:**

```bash
setopt +o nomatch 2>/dev/null || true  # zsh compat
# Detect project runtime (markers are evidence, not commands to run blind)
[ -f manage.py ] && echo "RUNTIME:python FRAMEWORK:django"
{ [ -f pyproject.toml ] || [ -f pytest.ini ] || [ -f tox.ini ] || [ -f setup.cfg ] || [ -f requirements.txt ]; } && echo "RUNTIME:python"
{ [ -f Gemfile ] || [ -f Rakefile ] || [ -f .rspec ]; } && echo "RUNTIME:ruby"
[ -f package.json ] && echo "RUNTIME:node"
[ -f go.mod ] && echo "RUNTIME:go"
[ -f Cargo.toml ] && echo "RUNTIME:rust"
[ -f pom.xml ] && echo "RUNTIME:jvm BUILD:maven"
{ [ -f build.gradle ] || [ -f build.gradle.kts ]; } && echo "RUNTIME:jvm BUILD:gradle"
# Check for existing test infrastructure — config files, scripts, AND test files
ls jest.config.* vitest.config.* playwright.config.* cypress.config.* .rspec pytest.ini tox.ini phpunit.xml 2>/dev/null
[ -f package.json ] && grep -q '"test"[[:space:]]*:' package.json && echo "SCRIPT:package.json test"
[ -f Makefile ] && grep -qE '^(test|check):' Makefile && echo "TARGET:make test"
git ls-files | grep -cE '(^|/)(tests?|spec|__tests__)/|(^|/)tests?\.py$|(^|/)test_[^/]+\.py$|_test\.(go|py|rb|ts|js|exs)$|\.(test|spec)\.[jt]sx?$|_spec\.rb$|Test\.(java|kt)$' | sed 's/^/TESTFILES:/'
```

3. **If no framework detected:** State that the framework is unknown; continue the diagram and planned assertions. If proposing a new framework, settle that choice through Decision procedure in Test step 5. Reuse an exact prior approval; with no selection proposed, ask no framework question. Do not install a framework or write the proposed tests during this review.

Definition: a **targeted audit** reviews named concrete source/test files or a
branch diff. A **prototype** is existing runnable code referenced by the plan,
not a proposed future component.

For every target, run these five Test steps inside Section 3, after Scope
Challenge and the Architecture/Code Quality reviews. Do not restart them.
Within Test step 1, read concrete source/tests before tracing or diagramming;
Test step 2 adds user flows. Future paths remain proposals, not runnable code.

**Step 1. Trace every codepath in the plan:**

Read the plan document. For each new feature, service, endpoint, or component described, trace how data will flow through the code — don't just list planned functions, actually follow the planned execution:

1. **Read the plan.** For each planned component, understand what it does and how it connects to existing code. When grounded in concrete source and test files, read them in a dedicated tool call before drawing the diagram. Do not mix diff, grep, package/config, git, or commentary into that read; use separate calls for context. Base the diagram on that read.
2. **Trace data flow.** Starting from each entry point (route handler, exported function, event listener, component render), follow the data through every branch:
   - Where does input come from? (request params, props, database, API call)
   - What transforms it? (validation, mapping, computation)
   - Where does it go? (database write, API response, rendered output, side effect)
   - What can go wrong at each step? (null/undefined, invalid input, network failure, empty collection)
3. **Diagram the execution.** For each existing or proposed component in the selected target, draw an ASCII diagram showing:
   - Every existing or proposed function/method in scope
   - Every conditional branch (if/else, switch, ternary, guard clause, early return)
   - Every error path (try/catch, rescue, error boundary, fallback)
   - Every call to another function (trace into it — does IT have untested branches?)
   - Every edge: what happens with null input? Empty array? Invalid type?

This is the critical step — you're building a map of every line of code that can execute differently based on input. Every branch in this diagram needs a test.

**Step 2. Map user flows, interactions, and error states:**

Code coverage isn't enough — you need to cover how real users interact with the selected target. For each existing or proposed feature, think through:

- **User flows:** What sequence of actions does a user take that touches this code? Map the full journey (e.g., "user clicks 'Pay' → form validates → API call → success/failure screen"). Each step in the journey needs a test.
- **Interaction edge cases:** What happens when the user does something unexpected?
  - Double-click/rapid resubmit
  - Navigate away mid-operation (back button, close tab, click another link)
  - Submit with stale data (page sat open for 30 minutes, session expired)
  - Slow connection (API takes 10 seconds — what does the user see?)
  - Concurrent actions (two tabs, same form)
- **Error states the user can see:** For every error the code handles, what does the user actually experience?
  - Is there a clear error message or a silent failure?
  - Can the user recover (retry, go back, fix input) or are they stuck?
  - What happens with no network? With a 500 from the API? With invalid data from the server?
- **Empty/zero/boundary states:** What does the UI show with zero results? With 10,000 results? With a single character input? With maximum-length input?

Add these to your diagram alongside the code branches. A user flow with no test is just as much a gap as an untested if/else.

**Step 3. Check each branch against existing tests:**

Go through your diagram branch by branch — both code paths AND user flows. For each one, search for a test that exercises it:
- Function `processPayment()` → look for `billing.test.ts`, `billing.spec.ts`, `test/billing_test.rb`
- An if/else → look for tests covering BOTH the true AND false path
- An error handler → look for a test that triggers that specific error condition
- A call to `helperFn()` that has its own branches → those branches need tests too
- A user flow → look for an integration or E2E test that walks through the journey
- An interaction edge case → look for a test that simulates the unexpected action

Quality scoring rubric:
- ★★★  Tests behavior with edge cases AND error paths
- ★★   Tests correct behavior, happy path only
- ★    Smoke test / existence check / trivial assertion (e.g., "it renders", "it doesn't throw"); weak, never counts as coverage

**Test value bar.** Propose or write a test only with all four answers; otherwise extend an existing test or drop it:

1. What observable behavior, invariant or independent contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not already catch that? Prefer adding a row to an existing table-driven test or shared fixture over a near-duplicate.
4. Does it need a production seam (export, flag, wrapper, injection hook) that no production caller needs? If yes, test at the real boundary instead.

A test that breaks under a behavior-preserving refactor asserts implementation: rewrite it at the owning boundary, unless exact output is the declared contract (goldens, prompt bytes, wire formats).

Value card: `Value: protects=<...>; fails_when=<...>; why_new=<...>; seam=none` (seam: `none` or its name); each field at most 160 UTF-8 bytes here (clamp to 157 plus `...`; JSON keeps full values). One card per Critical Path and Edge Case in the Test Plan Artifact. A missing upstream card never blocks: derive it; ignore unknown fields.

Example: Value: protects=refundPayment rejects an empty reason; fails_when=the reason guard is removed or inverted; why_new=billing.test.ts covers processPayment only; seam=none
Rejected (covered_elsewhere): "checkout renders"; checkout.e2e.ts:15 covers it, so extend that test.

Weak tests (★ smoke/existence/trivial, gate-failing or unrated) never count as coverage. X = paths with a ★★/★★★ test / total paths (value-weighted; the gate uses X); Y = paths with any test / total paths. /ship computes them; here every proposed test needs a card.

Retention bar: keep a test that independently enforces a public API, protocol, config, migration, storage, security, platform, default, prompt-byte, generated-output (golden), package, release or architecture contract; static or slow is no reason to delete.

#### E2E Test Decision Matrix

When checking each branch, also determine whether a unit test or E2E/integration test is the right tool:

**RECOMMEND E2E (mark as [→E2E] in the diagram):**
- Common user flow spanning 3+ components/services (e.g., signup → verify email → first login)
- Integration point where mocking hides real failures (e.g., API → queue → worker → DB)
- Auth/payment/data-destruction flows — too important to trust unit tests alone

**RECOMMEND EVAL (mark as [→EVAL] in the diagram):**
- Critical LLM call that needs a quality eval (e.g., prompt change → test output still meets quality bar)
- Changes to prompt templates, system instructions, or tool definitions

**STICK WITH UNIT TESTS:**
- Pure function with clear inputs/outputs
- Internal helper with no side effects
- Edge case of a single function (null input, empty array)
- Obscure/rare flow that isn't customer-facing

#### REGRESSION RULE (mandatory)

**IRON RULE:** When a planned change puts existing behavior at risk without regression coverage, that coverage is a critical requirement. Carry forward an exact approved regression contract; otherwise use one dedicated AskUserQuestion to settle it — behavior to preserve, intentional changes, and acceptance assertions — before adding the approved contract to the plan. Ask how to cover it, not whether to skip it. Do not silently include it under a different test-depth question.

A proposed rewrite is a regression risk, not proof that running code already broke. Name the existing callers and behavior at risk; preserve unchanged behavior and explicitly identify intended differences. No skipping regression coverage.

**Step 4. Output ASCII coverage diagram:**

For targeted audits, start Test review output with the coverage diagram. In full
plan reviews, put it inside the normal Test review section. Required outputs
keep the final terminal report order.

Include BOTH code paths and user flows in the same diagram. Mark E2E-worthy and eval-worthy paths:

```
CODE PATHS                                            USER FLOWS
[+] src/services/billing.ts                           [+] Payment checkout
  ├── processPayment()                                  ├── [★★★ TESTED] Complete purchase — checkout.e2e.ts:15
  │   ├── [★★★ TESTED] happy + declined + timeout      ├── [GAP] [→E2E] Double-click submit
  │   ├── [GAP]         Network timeout                 └── [GAP]        Navigate away mid-payment
  │   └── [GAP]         Invalid currency
  └── refundPayment()                                 [+] Error states
      ├── [★★  TESTED] Full refund — :89                ├── [★★  TESTED] Card declined message
      └── [★   TESTED] Partial (non-throw only) — :101  └── [GAP]        Network timeout UX

LLM integration: [GAP] [→EVAL] Prompt template change — needs eval test

COVERAGE: 5/13 paths tested (38%)  |  Code paths: 3/5 (60%)  |  User flows: 2/8 (25%)
QUALITY: ★★★:2 ★★:2 ★:1  |  GAPS: 8 (2 E2E, 1 eval)
```

Legend: ★★★ behavior + edge + error  |  ★★ happy path  |  ★ smoke check
[→E2E] = needs integration test  |  [→EVAL] = needs LLM eval

Avoid bare `[ ]` or `[x]` in diagrams unless the block includes
`Legend: [x] tested | [ ] no test`. Prefer `[GAP]`, `[★★ TESTED]`,
`[→E2E]`, `[→EVAL]`; keep user-flow markers off code-path rows.

**Fast path:** All paths covered → "Test review: All new code paths have test coverage ✓" Still check LLM/eval scope and produce the Test Plan Artifact below.

#### LLM/eval scope

For LLM/prompt changes: check the "Prompt/LLM changes" file patterns listed in CLAUDE.md. If this plan touches ANY of those patterns, state which eval suites must be run, which cases should be added, and what baselines to compare against. Include unapproved eval scope among the choices resolved in Step 5.

**Step 5. Add missing tests to the plan:**

Collect the requirements for each GAP and the LLM/eval scope above. Carry forward required proof of approved behavior. Mark new contracts and optional depth choices pending until the decision gate below resolves them. For every proposed test, specify:
- What test file to create (match existing naming conventions)
- What the test should assert (specific inputs → expected outputs/behavior)
- Whether it's a unit test, E2E test, or eval (use the decision matrix)
- Its value card (test value bar above)
- For regression risks: flag as **CRITICAL** and name the behavior to protect

A proposal that fails the value bar becomes "extend <existing test>" or is dropped with a one-line reason. Also list **Tests made obsolete by this plan** (proposal only; retiring one still needs a complete retirement card at implementation time, see /test-audit).

Run the decision gate for this section's new or reopened choices. **STOP for each pending decision.** Wait for its answer before applying that remedy, moving to the next section or calling ExitPlanMode.

When these test and eval choices are resolved, write the Test Plan Artifact below. Its approved requirements should be specific enough to implement alongside the feature code.

#### Test Plan Artifact

After resolving the Test review decisions, record the approved test requirements in an artifact for `/qa` and `/qa-only`. List any unresolved choices separately as pending, not required implementation. Update this artifact if later approved decisions change the tests. Use the Review record and write policy above.

```bash
eval "$(~/.claude/skills/gstack/bin/gstack-slug 2>/dev/null)" && mkdir -p ~/.gstack/projects/$SLUG  # sets SLUG and BRANCH
TEST_PLAN_USER=$(whoami)
DATETIME=$(date +%Y%m%d-%H%M%S)
```

Use `SLUG` and the sanitized `BRANCH` from gstack-slug, `TEST_PLAN_USER` for {user}, and `DATETIME` for {datetime}. Set {date} to today. Read the local origin URL with `git remote get-url origin` and use its owner/repo; without an origin, write `local-only`. No network request is needed.

Write to `~/.gstack/projects/{slug}/{user}-{branch}-eng-review-test-plan-{datetime}.md`:

```markdown
# Test Plan
Generated by /plan-eng-review on {date}
Branch: {branch}
Repo: {owner/repo}

## Affected Pages/Routes
- {URL path} — {what to test and why}

## Key Interactions to Verify
- {interaction description} on {page}

## Edge Cases
- {edge case} on {page}

## Critical Paths
- {end-to-end flow that must work}
  Value: protects={...}; fails_when={...}; why_new={...}; seam=none

## Tests to Retire
- {existing test made obsolete by this plan and why, or none}

## Pending Decisions
- {unapproved test requirement and its ledger row, or none}
```

Give each Edge Case and Critical Path entry its value card line. `/test-audit` reads `## Tests to Retire` from the newest artifact for the branch as seed candidates.

This file is consumed by `/qa` and `/qa-only` as primary test input. Include only the information that helps a QA tester know **what to test and where** — not implementation details.

After **Add missing tests to the plan** resolves test/eval decisions and the Test Plan Artifact is saved or presented, report the Test review findings and their dispositions and continue to Performance review.

### 4. Performance review
Evaluate:
* N+1 queries and database access patterns.
* Memory usage.
* Caching opportunities.
* Slow or complex paths.

<!-- Canonical source: plan-eng-review/sections/review-sections.md.tmpl | ### Failure modes -->
### Failure modes
For each new diagrammed path, name a realistic production failure, its test/error
handling coverage, and whether users see a clear error or a silent failure.

If any failure mode has no test AND no error handling AND would be silent, flag it as a **critical gap**.

<!-- Canonical source: review/SKILL.md.tmpl | ## Step 2: Read the checklist -->
## Step 2: Read the checklist

Read `~/.claude/skills/gstack/review/checklist.md`.

**If the file cannot be read, STOP and report the error.** Do not proceed without the checklist.

---

<!-- Canonical source: review/SKILL.md.tmpl | Apply both checklist passes in order: -->
Apply both checklist passes in order: CRITICAL, then INFORMATIONAL. Respect its suppressions.

**Enum & Value Completeness requires reading code OUTSIDE the diff.** When the diff introduces a new enum value, status, tier, or type constant, use Grep to find all files that reference sibling values, then Read those files to check if the new value is handled. Shared-code analysis also requires reading related callers outside the diff; keep findings anchored to changed code.

**Search-before-recommending:** Research proposed fixes through Aside, especially
concurrency, caching, auth and framework behavior:
- Check current best practice for the installed framework version.
- Look for a newer built-in before proposing a workaround.
- Verify API signatures against current docs.

```bash
_EG="$HOME/.claude/skills/gstack/bin/gstack-egress-lib.sh"; [ -r "$_EG" ] && . "$_EG"; _aside_exec() { if command -v _gstack_egress_run >/dev/null 2>&1; then _gstack_egress_run open aside-agent aside.com aside-exec "user invoked this skill" --no-payload aside exec "$@"; else aside exec "$@"; fi; }
_aside_exec "Search the web for {framework} {version} {pattern} current best practice and whether a built-in replaces it. Read-only: do not sign in, submit, or change anything. Reply with up to 5 bullets, each with its source URL, then stop."
```

Without Aside `READY`, use WebSearch if available; with neither, disclose the gap
and use existing knowledge.

### Shared-code opportunities (core pass)

Run this check on every diff, including fewer than 50 changed lines and hosts without Review Army:
1. Read the changed code and related unchanged callers using the rubric below. Do not run the standalone history/PR sweep or impose candidate quotas.
2. Require at least one verified authored location changed in this diff and at least two actual authored source locations needing the shared behavior. Added or uncommitted source qualifies; invented future callers do not.
3. Trace generated copies to authored templates/resolvers. Exclude generated and third-party copies from evidence and savings.

### Shared-code evaluation rubric

- **Prove the callers.** Require at least two verified, first-party authored source
  locations, with functions and lines. Actual added or uncommitted source qualifies.
  Only an engineering-plan review may use proposed callers; label those assumptions
  and distinguish them from existing source. Similar names or formatting alone do
  not establish equivalent behavior. Generated and third-party copies cannot qualify
  as callers or contribute savings. Follow generated copies back to authored
  templates/resolvers. Existing dependencies remain valid reuse targets.
- **Reuse before extracting.** Inspect existing libraries and helpers first. Compare
  behavior, inputs, outputs, error handling, side effects, security requirements,
  dependencies, and deployment/runtime boundaries. Preserve differences callers need;
  do not bridge languages or isolated deployments without a practical shared contract.
- **Keep the helper small.** Name its destination and contract, the callers to migrate,
  and the smallest adoption sequence. Avoid option-heavy helpers and coupling unrelated
  components. Point to existing tests or established use, specify shared-contract and
  caller-integration coverage, and describe the blast radius of a shared failure.
- **Account for the whole change.** Name removed blocks and their replacements. Show
  estimated implementation lines removed, added, and saved separately from total lines
  removed, added, and saved including tests and integration. Savings = removed - added.
  Count moved code on both sides, exclude generated/vendor lines, use ranges when
  uncertain, and do not count overlapping removals twice across opportunities. State
  when tests or integration may make the total change grow.
- **Rank useful changes.** Favor reliability gains and total net savings, then low
  adoption and testing risk. Prefer proven code used by several callers. Use recent
  activity to break ties between comparable benefits, not as evidence by itself.
  Explain choices centered on older code. Reject similarities with incompatible
  contracts and opportunities whose benefits do not justify the abstraction.

The core pass owns optional extraction advice. Zero proposals is valid; prefer a compatible existing helper.
- Show the changed anchor, verified callers, smallest helper/destination, preserved differences, compatibility tests and shared-failure risk.
- Estimate implementation and total removed/added/saved lines from named blocks; deduplicate equivalent proposals and overlapping savings.
- Use `"category":"shared-libs","severity":"INFORMATIONAL","advisory":true`, `evidence_paths` (all authored supporting paths) and `helper_target:{"path":"...","symbol":"..."}`.
- Include an existing helper's authored path in `evidence_paths` so its contract and raw bytes participate in revalidation. A not-yet-created helper belongs only in `helper_target`.

**Identity before merge or suppression:** Use installed `sharedLibsFingerprint`, never model-generated hashes. Send literal JSON on stdin (actual paths/symbol; keep the quoted delimiter), not interpolated shell code:

```bash
GSTACK_SHARED_LIB=~/.claude/skills/gstack/lib/review-evidence.ts
bun -e 'const { sharedLibsFingerprint } = await import(process.argv[1]); const value = sharedLibsFingerprint(JSON.parse(await Bun.stdin.text())); if (!value) process.exit(1); console.log(value);' "$GSTACK_SHARED_LIB" <<'GSTACK_SHARED_LIBS_JSON'
{"evidence_paths":["src/caller-a.ts","src/caller-b.ts"],"helper_target":{"path":"src/shared.ts","symbol":"sharedHelper"}}
GSTACK_SHARED_LIBS_JSON
```

Use the returned fingerprint; malformed/missing metadata requires revalidation. Real defects follow Fix-First independently: advice or a prior Skip cannot suppress, downgrade or replace them, even with a shared supplied fingerprint.

Core findings use the confidence gates below; Step 4.6 applies its specialist gates.
Use CRITICAL/INFORMATIONAL labels in the finding format.
Step 5.8 combines these finding lines with the checklist's action groups.

## Confidence Calibration

Verify evidence first, then score every finding (1-10) and apply its display rule.

### Pre-emit verification gate

1. **Quote the specific code line:** file:line and verbatim text. For a missing field,
   quote its class definition; for a nullable value, its initialization; for a race, both sides.
2. For framework-generated symbols, read and quote their generating metaclass,
   descriptor, ORM Meta block, migration, decorator or schema. Missing literal
   names in the class body or grep results do not prove absence.
3. **If you cannot quote the motivating line(s), the finding is unverified.**
   Force its confidence to 4-5: use 4 for appendix-only reporting, or 5 only when
   the finding belongs in the main report with the medium-confidence caveat below.
   Never invent speculative confidence 7+.

| Score | Meaning | Display rule |
|-------|---------|-------------|
| 9-10 | Specific code verifies a concrete bug or exploit. | Show normally |
| 7-8 | High-confidence pattern match; very likely correct. | Show normally |
| 5-6 | Moderate; could be a false positive. | Show with caveat: "Medium confidence, verify this is actually an issue" |
| 3-4 | Suspicious but may be fine. | Suppress from main report. Include in appendix only. |
| 1-2 | Speculation. | Only report a suspected release-blocking catastrophe (widespread data loss, total outage or system-wide compromise); label it CRITICAL and explicitly speculative. |

**Finding format:**

`[CRITICAL|INFORMATIONAL] (confidence: N/10) file:line — description`

Example:
`[CRITICAL] (confidence: 9/10) user.rb:42 — SQL injection via string interpolation`

**Calibration learning:** If the user confirms a reported finding scored < 7 is
real, log the corrected pattern as a learning.

### TODOS cross-reference

If root `TODOS.md` exists, report closed items as "This PR addresses TODO: <title>".
Flag new TODOs as informational and cite related items. Otherwise skip silently.

### Documentation staleness check

Read root `.md` files. When changed code affects a documented feature or workflow
but its doc was not updated, flag an INFORMATIONAL finding naming the file and
affected behavior. Propose `/document-release` for the parent's decision, never a
critical finding or another writer during collection. Skip silently if no docs exist.

---
