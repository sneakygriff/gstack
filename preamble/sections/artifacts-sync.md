<!-- AUTO-GENERATED from artifacts-sync.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->
## Artifacts Sync — restore offer & privacy stop-gate (shared preamble section)

You loaded this because the skill-start artifacts status asked for it.

If the status output included `artifacts repo detected: <url>`: tell the user a
cross-machine artifacts repo exists and offer `gstack-brain-restore` to pull it
(or `gstack-config set artifacts_sync_mode off` to dismiss forever). Do NOT
auto-run the restore.

If the output included `ARTIFACTS_SYNC_PROMPT: needed` (sync off, never
prompted, gbrain available), ask once:

> gstack can publish your artifacts (CEO plans, designs, reports) to a private GitHub repo that GBrain indexes across machines. How much should sync?

Options:
- A) Everything allowlisted (recommended)
- B) Only artifacts
- C) Decline, keep everything local

After answer:

```bash
# Chosen mode: full | artifacts-only | off
~/.claude/skills/gstack/bin/gstack-config set artifacts_sync_mode <choice>
~/.claude/skills/gstack/bin/gstack-config set artifacts_sync_mode_prompted true
```

If A/B and `~/.gstack/.git` is missing, ask whether to run
`gstack-artifacts-init`. Do not block the skill.
