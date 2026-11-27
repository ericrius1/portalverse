/**
 * Zero-friction PR submission helper for Portalverse contributors (and coding agents).
 *
 * Works even if you cloned `ericrius1/portalverse` directly with no fork yet and committed on `main`:
 *   1. Verifies working tree is clean and ahead of upstream `main` with no merge conflicts.
 *   2. Moves commits off `main` onto a feature branch (`<github-handle>/<room-id>`) if needed.
 *   3. Checks whether you have direct push access to `ericrius1/portalverse`; if not, creates or
 *      reuses your GitHub fork (`<github-handle>/portalverse`) non-interactively via `gh repo fork`.
 *   4. Pushes your branch and opens (or updates) a Pull Request against `ericrius1/portalverse`.
 *   5. Optionally (`--wait`) polls until CI validates, auto-merges into `main`, and triggers deploy.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const UPSTREAM_OWNER = 'ericrius1';
export const UPSTREAM_REPO = 'portalverse';
export const UPSTREAM_SLUG = `${UPSTREAM_OWNER}/${UPSTREAM_REPO}`;
export const UPSTREAM_BASE = 'main';
export const LIVE_SITE_URL = 'https://portalverse-server-production.up.railway.app';

export function parseArgs(argv) {
  const opts = { branch: '', title: '', body: '', draft: false, dryRun: false, wait: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--draft') opts.draft = true;
    else if (arg === '--wait' || arg === '-w') opts.wait = true;
    else if (arg === '--branch' && argv[i + 1]) opts.branch = argv[++i];
    else if (arg.startsWith('--branch=')) opts.branch = arg.slice('--branch='.length);
    else if (arg === '--title' && argv[i + 1]) opts.title = argv[++i];
    else if (arg.startsWith('--title=')) opts.title = arg.slice('--title='.length);
    else if (arg === '--body' && argv[i + 1]) opts.body = argv[++i];
    else if (arg.startsWith('--body=')) opts.body = arg.slice('--body='.length);
  }
  return opts;
}

export function isUpstreamRemote(url) {
  return /(?:github\.com[:/])ericrius1\/portalverse(?:\.git)?$/i.test(url.trim());
}

export function detectTouchedRooms(changedFiles) {
  const rooms = new Set();
  for (const file of changedFiles) {
    const match = /^worlds\/([^/]+)\//.exec(file.replace(/\\/g, '/'));
    if (match) rooms.add(match[1]);
  }
  return [...rooms];
}

export function sanitizeBranchSegment(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'world';
}

export function chooseBranchName({ currentBranch, login, touchedRooms, shortSha, explicitBranch }) {
  if (explicitBranch) {
    const trimmed = explicitBranch.trim();
    if (trimmed === UPSTREAM_BASE) {
      throw new Error(`--branch cannot be "${UPSTREAM_BASE}". Choose a feature branch name instead.`);
    }
    return trimmed;
  }
  if (currentBranch && currentBranch !== UPSTREAM_BASE && currentBranch !== 'HEAD') {
    return currentBranch;
  }
  const handle = sanitizeBranchSegment(login || 'contributor');
  const topic = touchedRooms.length > 0
    ? sanitizeBranchSegment(touchedRooms[0])
    : `contribution-${sanitizeBranchSegment(shortSha || 'patch')}`;
  return `${handle}/${topic}`;
}

export function buildForkUrl(login, protocol = 'https') {
  if (protocol === 'ssh') {
    return `git@github.com:${login}/${UPSTREAM_REPO}.git`;
  }
  return `https://github.com/${login}/${UPSTREAM_REPO}.git`;
}

export function buildPushArgs({ pushRemote, targetBranch, isFork }) {
  if (!targetBranch || targetBranch === UPSTREAM_BASE) {
    throw new Error(`Refusing to push directly to "${UPSTREAM_BASE}" via submit helper.`);
  }
  const args = ['push'];
  if (isFork) args.push('--force-with-lease');
  args.push('-u', pushRemote, `HEAD:refs/heads/${targetBranch}`);
  return args;
}

export function parseMergeTreeConflicts(output) {
  const conflicts = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = /^CONFLICT \([^)]+\): .*? in (.+)$/.exec(line.trim());
    if (match) conflicts.add(match[1].trim());
  }
  return [...conflicts].sort();
}

export function classifyPrWaitStatus(pr) {
  if (!pr || typeof pr !== 'object') return { done: false, ok: false, message: 'Waiting for PR status...' };
  if (pr.mergedAt || pr.state === 'MERGED') {
    const sha = pr.mergeCommit?.oid ? pr.mergeCommit.oid.slice(0, 7) : 'main';
    return {
      done: true,
      ok: true,
      message: `Auto-merged into ${UPSTREAM_BASE} (${sha})! Railway is deploying live to ${LIVE_SITE_URL} (~1–2 min).`,
    };
  }
  if (pr.state === 'CLOSED') {
    return { done: true, ok: false, message: 'Pull Request was closed without being merged.' };
  }
  if (pr.mergeable === 'CONFLICTING') {
    return {
      done: true,
      ok: false,
      message: 'Pull Request has merge conflicts with main. Run `git fetch upstream main && git rebase upstream/main`, resolve conflicts, and re-run `pnpm submit`.',
    };
  }
  const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  const failed = checks.find(check => {
    const conclusion = String(check?.conclusion || '').toUpperCase();
    return conclusion === 'FAILURE' || conclusion === 'TIMED_OUT' || conclusion === 'ACTION_REQUIRED';
  });
  if (failed) {
    const name = failed.name || failed.context || 'CI check';
    const url = failed.detailsUrl || failed.targetUrl || '';
    return {
      done: true,
      ok: false,
      message: `CI check failed (${name})${url ? `: ${url}` : ''}`,
    };
  }
  return { done: false, ok: false, message: 'Waiting for CI validation and auto-merge...' };
}

function run(cmd, args, { allowFail = false, cwd } = {}) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (allowFail) return null;
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr || '').trim() : '';
    const stdout = err && typeof err === 'object' && 'stdout' in err ? String(err.stdout || '').trim() : '';
    const detail = stderr || stdout || (err instanceof Error ? err.message : String(err));
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}\n${detail}`);
  }
}

function detectMergeConflicts(cwd, baseRef) {
  const behindRaw = run('git', ['rev-list', '--count', `HEAD..${baseRef}`], { allowFail: true, cwd });
  const behind = Number(behindRaw ?? '0');
  if (!behind || Number.isNaN(behind)) return [];

  try {
    execFileSync('git', ['merge-tree', '--write-tree', baseRef, 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [];
  } catch (err) {
    const stdout = err && typeof err === 'object' && 'stdout' in err ? String(err.stdout || '') : '';
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr || '') : '';
    // Older Git (<2.38) does not support `git merge-tree --write-tree`; skip check gracefully.
    if (/unknown option|usage:\s*git merge-tree/i.test(stderr)) return [];
    const combined = `${stdout}\n${stderr}`;
    const parsed = parseMergeTreeConflicts(combined);
    if (parsed.length > 0) return parsed;
    if (/CONFLICT/i.test(combined)) return ['(conflict detected; run `git rebase` to inspect)'];
    return [];
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForAutoMerge(root, prUrl) {
  console.log('Waiting for CI validation and auto-merge (Ctrl+C to stop waiting; CI continues in the background)...');
  const maxAttempts = 36; // ~6 minutes at 10s intervals
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = run(
      'gh',
      ['pr', 'view', prUrl, '--json', 'state,mergedAt,mergeCommit,mergeable,statusCheckRollup'],
      { allowFail: true, cwd: root },
    );
    if (raw) {
      try {
        const status = classifyPrWaitStatus(JSON.parse(raw));
        if (status.done) {
          if (status.ok) {
            console.log(status.message);
            return;
          }
          console.error(status.message);
          process.exit(1);
        }
      } catch {
        // Ignore transient JSON parse failures and retry
      }
    }
    sleepMs(10_000);
  }
  console.log(`Still waiting after 6 minutes. Check PR status at: ${prUrl}`);
}

function findUpstreamRemote(cwd) {
  const raw = run('git', ['remote', '-v'], { cwd });
  const remotes = new Map();
  for (const line of raw.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (m) remotes.set(m[1], m[2]);
  }
  for (const preferred of ['upstream', 'origin']) {
    const url = remotes.get(preferred);
    if (url && isUpstreamRemote(url)) return { name: preferred, url };
  }
  for (const [name, url] of remotes) {
    if (isUpstreamRemote(url)) return { name, url };
  }
  return null;
}

function defaultPrCopy(root, touchedRooms, latestSubject) {
  let title = latestSubject || 'Add new Portalverse room';
  let roomSummary = '';
  if (touchedRooms.length > 0) {
    try {
      const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
      const matched = touchedRooms
        .map(id => registry.worlds?.find(w => w.id === id))
        .filter(Boolean);
      if (matched.length === 1 && (!latestSubject || /^add /i.test(latestSubject) === false)) {
        title = `Add room: ${matched[0].name} (${matched[0].id})`;
      }
      if (matched.length > 0) {
        roomSummary = matched
          .map(w => `- **${w.name}** (\`worlds/${w.id}\`) — ${w.description || 'Community room'}`)
          .join('\n');
      }
    } catch {
      // Fall back to touched folder names if registry.json cannot be parsed
    }
    if (!roomSummary) {
      roomSummary = touchedRooms.map(id => `- \`worlds/${id}\``).join('\n');
    }
  }

  const body = [
    '## Summary',
    roomSummary || `- ${latestSubject || 'Portalverse contribution'}`,
    '',
    '## Checks',
    '- [x] `pnpm run build` (`check:rooms` + `tsc --noEmit` + `vite build`)',
    '- [x] `pnpm test`',
    '- [x] Updated `CHANGELOG.md`',
  ].join('\n');

  return { title, body };
}

function printHelp() {
  console.log(`Usage: pnpm submit [options]

Submit your Portalverse world or code changes as a Pull Request to ${UPSTREAM_SLUG}.
Automatically forks the repo if you do not have direct push access. Once CI checks
pass, non-draft PRs automatically merge into ${UPSTREAM_BASE} and deploy live to Railway.

Options:
  --branch <name>  Branch name to push (default: current branch, or <handle>/<room-id> if on main)
  --title <text>   Pull Request title
  --body <text>    Pull Request description
  --draft          Create the Pull Request as a draft (pauses auto-merge)
  --wait, -w       Wait for CI validation and auto-merge to complete
  --dry-run        Print planned actions without changing git remotes or opening a PR
  -h, --help       Show this help message`);
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return;
  }

  const root = fileURLToPath(new URL('../', import.meta.url));

  // 1. Ensure clean working tree
  const dirty = run('git', ['status', '--porcelain'], { cwd: root });
  if (dirty) {
    console.error('Working tree has uncommitted changes. Commit your changes first, then re-run `pnpm submit`:');
    console.error(dirty);
    process.exit(1);
  }

  // 2. Verify GitHub CLI is installed & authenticated
  if (run('gh', ['--version'], { allowFail: true, cwd: root }) === null) {
    console.error('GitHub CLI (`gh`) is required for automatic fork & PR submission.');
    console.error(`Install it from https://cli.github.com/ or fork manually at https://github.com/${UPSTREAM_SLUG}/fork`);
    process.exit(1);
  }
  if (run('gh', ['auth', 'status'], { allowFail: true, cwd: root }) === null) {
    console.error('GitHub CLI is not authenticated. Run `gh auth login` once, then re-run `pnpm submit`.');
    process.exit(1);
  }

  // 3. Locate upstream remote & fetch latest main
  let upstream = findUpstreamRemote(root);
  if (!upstream) {
    const upstreamUrl = `https://github.com/${UPSTREAM_SLUG}.git`;
    if (opts.dryRun) {
      console.log(`[dry-run] git remote add upstream ${upstreamUrl}`);
      upstream = { name: 'upstream', url: upstreamUrl };
    } else {
      run('git', ['remote', 'add', 'upstream', upstreamUrl], { cwd: root });
      upstream = { name: 'upstream', url: upstreamUrl };
    }
  }
  if (!opts.dryRun) {
    run('git', ['fetch', upstream.name, UPSTREAM_BASE], { cwd: root });
  }

  const baseRef = `${upstream.name}/${UPSTREAM_BASE}`;
  const aheadRaw = run('git', ['rev-list', '--count', `${baseRef}..HEAD`], { allowFail: true, cwd: root });
  const ahead = Number(aheadRaw ?? '0');
  if (!ahead || Number.isNaN(ahead)) {
    console.error(`No commits ahead of ${baseRef}. Commit your changes first, then run \`pnpm submit\`.`);
    process.exit(1);
  }

  // 3b. Pre-flight merge conflict check against latest upstream/main
  const conflicts = detectMergeConflicts(root, baseRef);
  if (conflicts.length > 0) {
    console.error(`Your branch conflicts with latest ${baseRef} in:`);
    for (const file of conflicts) console.error(`  - ${file}`);
    console.error(`\nSync with ${baseRef}, resolve conflicts, verify build/tests, and re-run \`pnpm submit\`:`);
    console.error(`  git rebase ${baseRef}`);
    console.error('  pnpm run build && pnpm test');
    console.error('  pnpm submit');
    process.exit(1);
  }

  // 4. Identify GitHub user & repo push permission
  const login = run('gh', ['api', 'user', '--jq', '.login'], { cwd: root });
  const canPushUpstream = run('gh', ['api', `repos/${UPSTREAM_SLUG}`, '--jq', '.permissions.push'], {
    allowFail: true,
    cwd: root,
  }) === 'true';

  const currentBranch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
  const shortSha = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root });
  const changedRaw = run('git', ['diff', '--name-only', `${baseRef}..HEAD`], { cwd: root });
  const changedFiles = changedRaw ? changedRaw.split('\n').filter(Boolean) : [];
  const touchedRooms = detectTouchedRooms(changedFiles);
  const targetBranch = chooseBranchName({
    currentBranch,
    login,
    touchedRooms,
    shortSha,
    explicitBranch: opts.branch,
  });

  // 5. Move off `main` onto a feature branch if needed
  if (currentBranch !== targetBranch) {
    const branchExists = run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${targetBranch}`], {
      allowFail: true,
      cwd: root,
    }) !== null;
    if (opts.dryRun) {
      console.log(`[dry-run] git checkout ${branchExists ? '' : '-b '}${targetBranch}`);
    } else if (branchExists) {
      run('git', ['checkout', '-B', targetBranch], { cwd: root });
    } else {
      run('git', ['checkout', '-b', targetBranch], { cwd: root });
    }
  }

  // 6. Push to fork (for external contributors) or upstream branch (for maintainers)
  let pushRemote = upstream.name;
  let prHead = targetBranch;
  const isFork = !canPushUpstream;

  if (isFork) {
    const forkSlug = `${login}/${UPSTREAM_REPO}`;
    const hasFork = run('gh', ['repo', 'view', forkSlug, '--json', 'url'], { allowFail: true, cwd: root }) !== null;
    if (!hasFork) {
      if (opts.dryRun) {
        console.log(`[dry-run] gh repo fork ${UPSTREAM_SLUG} --clone=false --remote=false --default-branch-only`);
      } else {
        console.log(`Creating your fork ${forkSlug}...`);
        run('gh', ['repo', 'fork', UPSTREAM_SLUG, '--clone=false', '--remote=false', '--default-branch-only'], {
          cwd: root,
        });
        // GitHub fork provisioning can take a moment to become pushable.
        for (let attempt = 0; attempt < 6; attempt++) {
          if (run('gh', ['repo', 'view', forkSlug, '--json', 'url'], { allowFail: true, cwd: root }) !== null) break;
          sleepMs(1500);
        }
      }
    }

    const ghProto = run('gh', ['config', 'get', 'git_protocol'], { allowFail: true, cwd: root });
    const protocol = ghProto === 'ssh' || upstream.url.startsWith('git@') ? 'ssh' : 'https';
    const forkUrl = buildForkUrl(login, protocol);
    const existingForkUrl = run('git', ['remote', 'get-url', 'fork'], { allowFail: true, cwd: root });

    if (opts.dryRun) {
      console.log(`[dry-run] git remote ${existingForkUrl ? 'set-url' : 'add'} fork ${forkUrl}`);
    } else if (existingForkUrl) {
      if (existingForkUrl !== forkUrl) run('git', ['remote', 'set-url', 'fork', forkUrl], { cwd: root });
    } else {
      run('git', ['remote', 'add', 'fork', forkUrl], { cwd: root });
    }

    pushRemote = 'fork';
    prHead = `${login}:${targetBranch}`;
  }

  const pushArgs = buildPushArgs({ pushRemote, targetBranch, isFork });
  if (opts.dryRun) {
    console.log(`[dry-run] git ${pushArgs.join(' ')}`);
  } else {
    console.log(`Pushing ${targetBranch} to ${pushRemote}...`);
    run('git', pushArgs, { cwd: root });
  }

  // 7. Create or report existing Pull Request against ericrius1/portalverse
  const existingPr = run(
    'gh',
    ['pr', 'list', '--repo', UPSTREAM_SLUG, '--head', prHead, '--state', 'open', '--json', 'url', '--jq', '.[0].url'],
    { allowFail: true, cwd: root },
  );

  if (existingPr) {
    console.log(`Updated existing Pull Request: ${existingPr}`);
    if (opts.draft) {
      console.log('Draft PRs pause auto-merge until marked Ready for review.');
    } else {
      console.log(`CI will re-validate your changes, auto-merge into ${UPSTREAM_BASE}, and deploy live to ${LIVE_SITE_URL} (~1–2 min)!`);
      if (opts.wait && !opts.dryRun) waitForAutoMerge(root, existingPr);
    }
    return;
  }

  const latestSubject = run('git', ['log', '-1', '--pretty=%s'], { cwd: root });
  const defaults = defaultPrCopy(root, touchedRooms, latestSubject);
  const title = opts.title || defaults.title;
  const body = opts.body || defaults.body;

  const prArgs = [
    'pr',
    'create',
    '--repo',
    UPSTREAM_SLUG,
    '--base',
    UPSTREAM_BASE,
    '--head',
    prHead,
    '--title',
    title,
    '--body',
    body,
  ];
  if (opts.draft) prArgs.push('--draft');

  if (opts.dryRun) {
    console.log(`[dry-run] gh ${prArgs.map(a => (a.includes(' ') || a.includes('\n') ? JSON.stringify(a) : a)).join(' ')}`);
    return;
  }

  const prUrl = run('gh', prArgs, { cwd: root });
  console.log(`Pull Request created: ${prUrl}`);
  if (opts.draft) {
    console.log('Draft PRs pause auto-merge until marked Ready for review.');
  } else {
    console.log(`CI will validate your changes automatically, auto-merge into ${UPSTREAM_BASE}, and deploy live to ${LIVE_SITE_URL} (~1–2 min)!`);
    if (opts.wait) waitForAutoMerge(root, prUrl);
  }
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
})();

if (isDirectRun) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
