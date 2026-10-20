// Pinned remote-URL samples for autobuilder-unit.js: each URL is configured as the origin of scratch repositories and
// the script's REAL in-shell validator (ID_SH) runs on them. Expected: the parsed host/owner/repo, or null (rejected),
// and the validator's output (stdout + stderr) never contains the URL (lib.mjs realIdentity throws on a leak).
// Library: runRemoteSamples(scriptPath) -> { total, bad, lines }. CLI: node remote-samples.mjs [script]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadScript, shellBlock, realIdentity, DEFAULT_SCRIPT, fake } from './lib.mjs'
export const REMOTE_SAMPLES = {
  'https://github.com/acme/app.git': 'github.com/acme/app', 'https://github.com/acme/app': 'github.com/acme/app', 'https://github.com/acme/app/': 'github.com/acme/app',
  'git@github.com:acme/app.git': 'github.com/acme/app', 'ssh://git@github.com/acme/app.git': 'github.com/acme/app', 'ssh://git@github.com:22/acme/app.git': 'github.com/acme/app',
  'git://github.com/acme/app': 'github.com/acme/app', 'git@ghe.corp.example:acme/app.git': 'ghe.corp.example/acme/app', 'https://GHE.Corp.Example/acme/app.git': 'GHE.Corp.Example/acme/app', // printed as-is (never rewritten); compared case-insensitively by the script
  'https://$(printf injected)/owner/repo.git': null, 'git@$(id):acme/app.git': null, 'https://`id`/acme/app.git': null, "https://github.com/acme/app';id;'.git": null,
  [fake.auth('https', 'user', fake.ghp('secret'), 'github.com/acme/app.git')]: null, 'https://x-token@github.com/acme/app.git': null, 'https://github.com:8443/acme/app.git': null,
  [fake.auth('https', 'u', 'p', 'ss@w0rd@github.com/acme/app.git')]: null, 'git@evil.host:acme/app.git': 'evil.host/acme/app', '/srv/mirror/app': null, 'file:///srv/app.git': null,
  'https://github.com/acme': null, 'https://github.com/a/b/c': null, 'https://github.com/../app.git': null, 'https://-bad.host/acme/app': null,
  'https://github.com/acme/app.git\textra': null, [fake.auth('ssh', 'us', 'er', 'github.com/acme/app.git')]: null,
  'ssh://-f@github.com/acme/app.git': null, '-f@github.com:acme/app.git': null, '--force@github.com:acme/app.git': null, 'git@-oProxyCommand=x:acme/app.git': null,
}
export function runRemoteSamples(scriptPath = DEFAULT_SCRIPT) {
  const idsh = shellBlock(loadScript(scriptPath).src, 'ID_SH')
  const lines = []
  let bad = 0
  for (const [u, e] of Object.entries(REMOTE_SAMPLES)) {
    let got, err = ''
    try {
      const out = realIdentity(idsh, { repo_url: u, lane_url: u })
      const m = (out.find(l => l.startsWith('ID lane ')) || '').match(/^ID lane ok (\S+) /)
      got = m ? m[1] : null
    } catch (x) { err = x.message; got = 'ERROR' }
    const ok = got === e && !err
    if (!ok) bad++
    lines.push(`${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(u)} -> ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(e)})${err ? ' ' + err : ''}`}`)
  }
  return { total: Object.keys(REMOTE_SAMPLES).length, bad, lines }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = runRemoteSamples(process.argv[2] || DEFAULT_SCRIPT)
  for (const l of r.lines) console.log(l)
  console.log(`${r.total - r.bad}/${r.total} as expected`)
  process.exitCode = r.bad ? 1 : 0
}
