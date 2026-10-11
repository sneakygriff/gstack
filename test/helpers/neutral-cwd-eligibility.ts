/**
 * Independent host-eligibility oracle for bin/gstack-neutral-cwd's success path.
 *
 * The helper fails closed unless its TMPDIR's whole physical ancestry is private
 * (not group/other-writable, owned by you or root) and free of `.git` / agent
 * config. Tests used to decide "can this host host a neutral cwd?" by RUNNING THE
 * HELPER — circular: a regression that refuses every clean directory would make
 * that probe false and silently skip every success case. This module decides it
 * WITHOUT the helper (plain fs.statSync / fs.existsSync / readdir over the
 * ancestry), so an eligible host REQUIRES the helper to succeed.
 *
 * The deny list is deliberately a separate literal (not parsed out of the script
 * under test): a regression that adds a bogus name must turn the suite red here,
 * not shrink eligibility in lockstep.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const NEUTRAL_CWD_DENY = [
  '.git',
  '.grok',
  '.claude',
  '.cursor',
  '.mcp.json',
  '.cursorrules',
  '.envrc',
  '.grokrc',
  'AGENTS.md',
  'AGENTS.local.md',
  'CLAUDE.md',
  'CLAUDE.local.md',
] as const;

export interface Eligibility {
  eligible: boolean;
  /** Why not (empty when eligible). */
  reason: string;
}

/**
 * Would `dir` (an existing directory) pass bin/gstack-neutral-cwd's ancestry
 * walk as a TMPDIR? Mirrors its documented contract, computed independently.
 */
export function neutralCwdEligibility(dir: string): Eligibility {
  let d: string;
  try {
    d = fs.realpathSync(dir);
  } catch (e) {
    return { eligible: false, reason: `cannot resolve ${dir}: ${(e as Error).message}` };
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
  for (;;) {
    let st: fs.Stats;
    try {
      st = fs.statSync(d);
    } catch (e) {
      return { eligible: false, reason: `cannot stat ${d}: ${(e as Error).message}` };
    }
    if ((st.mode & 0o022) !== 0) return { eligible: false, reason: `${d} is group/other-writable` };
    if (st.uid !== uid && st.uid !== 0) return { eligible: false, reason: `${d} is owned by uid ${st.uid}` };
    for (const n of NEUTRAL_CWD_DENY) {
      const p = path.join(d, n);
      let present = fs.existsSync(p);
      if (!present) {
        try {
          fs.lstatSync(p); // a dangling symlink still counts
          present = true;
        } catch {
          /* absent */
        }
      }
      if (present) return { eligible: false, reason: `${d} contains ${n}` };
    }
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(d);
    } catch {
      /* unreadable listing: the fixed-name checks above still ran */
    }
    const rc = entries.find((e) => e.toLowerCase().startsWith('.grokrc'));
    if (rc) return { eligible: false, reason: `${d} contains ${rc}` };
    if (d === path.dirname(d)) break;
    d = path.dirname(d);
  }
  return { eligible: true, reason: '' };
}

/** Eligibility of the platform temp dir — the base every hermetic scenario builds under. */
export function platformTmpEligibility(): Eligibility {
  return neutralCwdEligibility(os.tmpdir());
}
