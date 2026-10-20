// Pinned sensitive-path samples for autobuilder-unit.js (1 = sensitive, 0 = not, -1 = reported only: an accepted
// over-match). Library: runClassifierSamples(scriptPath) -> { total, bad, lines }. CLI: node classifier-samples.mjs [script]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadScript, DEFAULT_SCRIPT } from './lib.mjs'
export const CLASSIFIER_SAMPLES = { 'src/login.ts': 1, 'src/log-in.tsx': 1, 'src/LoginForm.tsx': 1, 'src/signin.ts': 1, 'src/SignUpPage.tsx': 1, 'src/signupFlow.ts': 1, 'lib/password.ts': 1, 'lib/passwords/reset.ts': 1, 'lib/passwd.ts': 1, 'lib/credential.ts': 1, 'lib/credentialsStore.ts': 1, 'lib/token.ts': 1, 'lib/refreshTokens.ts': 1, 'lib/jwtVerify.ts': 1, 'lib/oidc.ts': 1, 'lib/samlProvider.ts': 1, 'lib/SSOCallback.ts': 1, 'lib/cookie.ts': 1, 'lib/cookies.ts': 1, 'mw/csrf.ts': 1, 'mw/xsrfGuard.ts': 1, 'mw/cors.ts': 1, 'app/admin/page.tsx': 1, 'lib/role.ts': 1, 'lib/userRoles.ts': 1, 'lib/privileges.ts': 1, 'lib/key.ts': 1, 'lib/apiKeys.ts': 1, 'tls/cert.pem': 1, 'lib/certs.ts': 1, 'lib/tlsConfig.ts': 1, 'lib/SSLContext.ts': 1, 'src/ACLs.ts': 1, 'src/RBACs.ts': 1, 'src/userACLs.ts': 1, 'src/HTTPAuthHandler.ts': 1, 'src/APIPermissions.ts': 1, 'src/OAuth2Client.ts': 1, 'src/XMLPaymentParser.ts': 1, 'src/userSession.ts': 1, 'src/author.ts': 0, 'docs/author.md': 0, 'src/authors/x.ts': 0, 'src/coauthor.tsx': 0, 'src/AuthorCard.tsx': 0, 'src/HTMLParser.ts': 0, 'src/oracle.ts': 0, 'src/console.ts': 0, 'src/userSignIn.ts': 1, 'src/userSignUp.ts': 1, 'src/userLogIn.ts': 1, 'src/logging.ts': -1, 'src/keyboard.ts': -1, 'src/tokenizer.ts': -1 }
export function runClassifierSamples(scriptPath = DEFAULT_SCRIPT) {
  const { src: s } = loadScript(scriptPath)
  const RE = eval(s.match(/const SENSITIVE_TOKEN_RE = (\/.*\/)\n/)[1])
  const camelSplit = eval(s.match(/const camelSplit = (f => .*)\n/)[1]) // eslint-disable-line no-unused-vars
  const lowerSplit = eval(s.match(/const lowerSplit = (f => .*)\n/)[1]) // eslint-disable-line no-unused-vars
  const tokenForms = eval(s.match(/const tokenForms = (f => .*)\n/)[1])
  const lines = []
  let bad = 0
  for (const [f, e] of Object.entries(CLASSIFIER_SAMPLES)) {
    const g = tokenForms(f).some(x => RE.test(x)) ? 1 : 0
    const ok = e < 0 || g === e
    if (!ok) bad++
    lines.push(`${ok ? 'PASS' : 'FAIL'} ${g ? 'SENS' : '    '} ${f}${e < 0 ? ' (reported only)' : ''}`)
  }
  return { total: Object.keys(CLASSIFIER_SAMPLES).length, bad, lines }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = runClassifierSamples(process.argv[2] || DEFAULT_SCRIPT)
  for (const l of r.lines) console.log(l)
  console.log(`${r.total - r.bad}/${r.total} as expected`)
  process.exitCode = r.bad ? 1 : 0
}
