/**
 * Pure eligibility, security boundary, and comment formatting helpers for
 * Portalverse's open PR auto-merge workflow (`.github/workflows/pr-automerge.yml`).
 *
 * Lives under `.github/` so untrusted PRs cannot modify these rules and bypass
 * the workflow/secrets protection boundary.
 */

export const TARGET_BASE_BRANCH = 'main';
export const LIVE_SITE_URL = 'https://portalverse-server-production.up.railway.app';
export const STICKY_COMMENT_MARKER = '<!-- portalverse-automerge -->';
export const HOLD_LABELS = Object.freeze(['do-not-merge', 'hold', 'manual-merge', 'wip']);
export const PREFERRED_MERGE_METHODS = Object.freeze(['merge', 'squash', 'rebase']);

/**
 * Normalize a repository-relative path and check whether it touches `.github`
 * (GitHub Actions workflows, scripts, templates, or CODEOWNERS).
 *
 * Blocking `.github/` from auto-merge guarantees:
 *   1. Untrusted PRs cannot modify CI workflows or steal Actions secrets (`RAILWAY_TOKEN`).
 *   2. Untrusted PRs cannot weaken this policy file itself.
 *   3. `GITHUB_TOKEN` merges never fail cryptically due to GitHub's `workflows` scope block.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isProtectedPath(filePath) {
  if (typeof filePath !== 'string') return false;
  const normalized = filePath
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '');
  return /^\.github(?:\/|$)/i.test(normalized);
}

/**
 * Return a sorted, deduplicated list of protected paths touched by a PR's file list.
 * Checks both `filename` and `previous_filename` (for renames out of `.github/`).
 *
 * @param {Array<string | { filename?: string, previous_filename?: string }>} files
 * @returns {string[]}
 */
export function findProtectedFiles(files) {
  const hits = new Set();
  for (const entry of files ?? []) {
    if (typeof entry === 'string') {
      if (isProtectedPath(entry)) hits.add(entry);
      continue;
    }
    if (entry?.filename && isProtectedPath(entry.filename)) {
      hits.add(entry.filename);
    }
    if (entry?.previous_filename && isProtectedPath(entry.previous_filename)) {
      hits.add(entry.previous_filename);
    }
  }
  return [...hits].sort();
}

/**
 * Return any hold labels currently attached to the PR (matched case-insensitively).
 *
 * @param {Array<string | { name?: string }>} labels
 * @returns {string[]}
 */
export function findHoldLabels(labels) {
  const holdSet = new Set(HOLD_LABELS.map(label => label.toLowerCase()));
  const matched = [];
  for (const entry of labels ?? []) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (typeof name === 'string' && holdSet.has(name.trim().toLowerCase())) {
      matched.push(name);
    }
  }
  return matched;
}

/**
 * Wrap a PR status comment body with the sticky HTML marker so repeated runs
 * update a single bot comment instead of spamming the PR conversation.
 *
 * @param {string} body
 * @returns {string}
 */
export function formatStickyComment(body) {
  return `${STICKY_COMMENT_MARKER}\n${body.trim()}`;
}

/**
 * @param {string[]} protectedFiles
 * @returns {string}
 */
export function buildProtectedPathsComment(protectedFiles) {
  const list = protectedFiles.map(file => `- \`${file}\``).join('\n');
  return formatStickyComment(
    [
      '### Auto-merge skipped: `.github/` files modified',
      '',
      'This PR modifies repository automation files under `.github/`, which require manual maintainer review and merge:',
      list,
      '',
      'All other rooms and code changes across the repo auto-merge and deploy once `pnpm run build` and `pnpm test` pass.',
    ].join('\n'),
  );
}

/**
 * @returns {string}
 */
export function buildConflictComment() {
  return formatStickyComment(
    [
      '### Auto-merge paused: merge conflict with `main`',
      '',
      'Another change landed on `main` that conflicts with this PR. Sync with `main`, resolve conflicts, and push again (or re-run `pnpm submit`):',
      '',
      '```bash',
      'git fetch upstream main',
      'git rebase upstream/main',
      'pnpm run build && pnpm test',
      'pnpm submit',
      '```',
      '',
      'As soon as the updated commit is pushed and checks pass, this PR will auto-merge and deploy live automatically.',
    ].join('\n'),
  );
}

/**
 * @param {{ changedFiles: number, inspectedFiles: number }} info
 * @returns {string}
 */
export function buildTooManyFilesComment({ changedFiles, inspectedFiles }) {
  return formatStickyComment(
    [
      '### Auto-merge skipped: PR exceeds automatic file inspection limit',
      '',
      `This PR reports **${changedFiles}** changed files, which exceeds the **${inspectedFiles}** files returned by the GitHub PR files API. Please split the PR or ask a maintainer to merge it manually.`,
    ].join('\n'),
  );
}

/**
 * @param {{ runUrl: string, headSha: string }} info
 * @returns {string}
 */
export function buildFailureComment({ runUrl, headSha }) {
  const shortSha = (headSha || '').slice(0, 7) || 'latest';
  return formatStickyComment(
    [
      `### Validation failed on \`${shortSha}\``,
      '',
      `Auto-merge is waiting until \`pnpm run build\` (\`check:rooms\` + \`tsc --noEmit\` + \`vite build\`) and \`pnpm test\` pass.`,
      '',
      `- Inspect logs: [GitHub Actions run](${runUrl})`,
      '- Push a fix (or re-run `pnpm submit`) and this PR will automatically re-validate, merge into `main`, and deploy live!',
    ].join('\n'),
  );
}

/**
 * @param {{ mergeSha: string, liveUrl?: string }} info
 * @returns {string}
 */
export function buildMergedComment({ mergeSha, liveUrl = LIVE_SITE_URL }) {
  const shortSha = (mergeSha || '').slice(0, 7) || 'main';
  return formatStickyComment(
    [
      `### Validated & auto-merged into \`main\` (\`${shortSha}\`)`,
      '',
      `All room checks, typechecks, build, and tests passed! Deploying live to [${liveUrl.replace(/^https?:\/\//, '')}](${liveUrl}) now (~1–2 min).`,
    ].join('\n'),
  );
}

/**
 * Evaluate whether a pull request is eligible for open validation + auto-merge.
 *
 * @param {{
 *   pr: {
 *     state?: string,
 *     draft?: boolean,
 *     mergeable?: boolean | null,
 *     changed_files?: number,
 *     base?: { ref?: string },
 *     head?: { sha?: string },
 *     labels?: Array<string | { name?: string }>,
 *   },
 *   files: Array<string | { filename?: string, previous_filename?: string }>,
 *   expectedHeadSha?: string,
 * }} input
 */
export function evaluatePullRequest({ pr, files, expectedHeadSha }) {
  if (!pr || pr.state !== 'open') {
    return { eligible: false, reason: 'not-open', comment: null };
  }
  if (pr.base?.ref !== TARGET_BASE_BRANCH) {
    return { eligible: false, reason: 'non-main-base', comment: null };
  }
  if (pr.draft) {
    return { eligible: false, reason: 'draft', comment: null };
  }
  if (expectedHeadSha && pr.head?.sha !== expectedHeadSha) {
    return { eligible: false, reason: 'head-moved', comment: null };
  }

  const holdLabels = findHoldLabels(pr.labels ?? []);
  if (holdLabels.length > 0) {
    return { eligible: false, reason: 'hold-label', holdLabels, comment: null };
  }

  const inspectedFiles = Array.isArray(files) ? files.length : 0;
  if (typeof pr.changed_files === 'number' && pr.changed_files > inspectedFiles) {
    return {
      eligible: false,
      reason: 'too-many-files',
      comment: buildTooManyFilesComment({ changedFiles: pr.changed_files, inspectedFiles }),
    };
  }

  const protectedFiles = findProtectedFiles(files ?? []);
  if (protectedFiles.length > 0) {
    return {
      eligible: false,
      reason: 'protected-paths',
      protectedFiles,
      comment: buildProtectedPathsComment(protectedFiles),
    };
  }

  if (pr.mergeable === false) {
    return {
      eligible: false,
      reason: 'merge-conflict',
      comment: buildConflictComment(),
    };
  }

  return { eligible: true, reason: 'ok', comment: null };
}
