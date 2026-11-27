import { describe, expect, it } from 'vitest';
import {
  STICKY_COMMENT_MARKER,
  buildConflictComment,
  buildFailureComment,
  buildMergedComment,
  evaluatePullRequest,
  findHoldLabels,
  findProtectedFiles,
  isProtectedPath,
} from '../../../../.github/scripts/automerge-policy.mjs';

function makeOpenPr(overrides: Record<string, unknown> = {}) {
  return {
    state: 'open',
    draft: false,
    mergeable: true,
    changed_files: 3,
    base: { ref: 'main' },
    head: { sha: 'abc1234567890' },
    labels: [],
    ...overrides,
  };
}

describe('open PR auto-merge policy', () => {
  it('allows room additions and general repo code changes across worlds, core, server, and app', () => {
    const decision = evaluatePullRequest({
      pr: makeOpenPr({ changed_files: 5 }),
      files: [
        { filename: 'worlds/new-room/index.ts' },
        { filename: 'registry.json' },
        { filename: 'packages/core/src/engine/WorldEngine.ts' },
        { filename: 'packages/server/src/roomManager.ts' },
        { filename: 'app/main.ts' },
      ],
      expectedHeadSha: 'abc1234567890',
    });
    expect(decision).toEqual({ eligible: true, reason: 'ok', comment: null });
  });

  it('detects protected .github paths including uppercase, backslashes, leading ./, and renames', () => {
    expect(isProtectedPath('.github/workflows/rooms.yml')).toBe(true);
    expect(isProtectedPath('.github/scripts/automerge-policy.mjs')).toBe(true);
    expect(isProtectedPath('.GITHUB/workflows/evil.yml')).toBe(true);
    expect(isProtectedPath('./.github/workflows/pr-automerge.yml')).toBe(true);
    expect(isProtectedPath('.github\\workflows\\deploy.yml')).toBe(true);
    expect(isProtectedPath('.github')).toBe(true);
    expect(isProtectedPath('worlds/my-room/index.ts')).toBe(false);
    expect(isProtectedPath('docs/.github-notes.md')).toBe(false);

    expect(
      findProtectedFiles([
        { filename: 'worlds/room/index.ts' },
        { filename: 'scripts/moved.mjs', previous_filename: '.github/scripts/automerge-policy.mjs' },
        { filename: '.github/workflows/deploy.yml' },
      ]),
    ).toEqual(['.github/scripts/automerge-policy.mjs', '.github/workflows/deploy.yml']);
  });

  it('blocks auto-merge with a sticky explanation comment when .github files are modified', () => {
    const decision = evaluatePullRequest({
      pr: makeOpenPr({ changed_files: 2 }),
      files: [
        { filename: 'worlds/cool-room/index.ts' },
        { filename: '.github/workflows/rooms.yml' },
      ],
      expectedHeadSha: 'abc1234567890',
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('protected-paths');
    expect(decision.protectedFiles).toEqual(['.github/workflows/rooms.yml']);
    expect(decision.comment).toContain(STICKY_COMMENT_MARKER);
    expect(decision.comment).toContain('.github/workflows/rooms.yml');
  });

  it('skips drafts, non-main bases, closed PRs, moved heads, and hold labels quietly', () => {
    const files = [{ filename: 'worlds/my-room/index.ts' }];

    expect(
      evaluatePullRequest({ pr: makeOpenPr({ draft: true, changed_files: 1 }), files }).reason,
    ).toBe('draft');
    expect(
      evaluatePullRequest({ pr: makeOpenPr({ state: 'closed', changed_files: 1 }), files }).reason,
    ).toBe('not-open');
    expect(
      evaluatePullRequest({ pr: makeOpenPr({ base: { ref: 'feature' }, changed_files: 1 }), files }).reason,
    ).toBe('non-main-base');
    expect(
      evaluatePullRequest({
        pr: makeOpenPr({ head: { sha: 'newsha' }, changed_files: 1 }),
        files,
        expectedHeadSha: 'oldsha',
      }).reason,
    ).toBe('head-moved');

    const held = evaluatePullRequest({
      pr: makeOpenPr({ labels: [{ name: 'enhancement' }, { name: 'Do-Not-Merge' }], changed_files: 1 }),
      files,
    });
    expect(held.eligible).toBe(false);
    expect(held.reason).toBe('hold-label');
    expect(held.holdLabels).toEqual(['Do-Not-Merge']);
    expect(findHoldLabels(['HOLD', 'bug', 'wip'])).toEqual(['HOLD', 'wip']);
  });

  it('blocks PRs whose file count exceeds the inspected list (3000-file pagination cap)', () => {
    const decision = evaluatePullRequest({
      pr: makeOpenPr({ changed_files: 3050 }),
      files: [{ filename: 'worlds/huge/index.ts' }],
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('too-many-files');
    expect(decision.comment).toContain(STICKY_COMMENT_MARKER);
    expect(decision.comment).toContain('3050');
  });

  it('flags merge conflicts with sync instructions while allowing null (still computing)', () => {
    const files = [{ filename: 'registry.json' }];

    const conflict = evaluatePullRequest({
      pr: makeOpenPr({ mergeable: false, changed_files: 1 }),
      files,
    });
    expect(conflict.eligible).toBe(false);
    expect(conflict.reason).toBe('merge-conflict');
    expect(conflict.comment).toContain('git rebase upstream/main');
    expect(conflict.comment).toContain(STICKY_COMMENT_MARKER);

    const pendingMergeable = evaluatePullRequest({
      pr: makeOpenPr({ mergeable: null, changed_files: 1 }),
      files,
    });
    expect(pendingMergeable.eligible).toBe(true);
  });

  it('formats sticky failure, conflict, and merged comments consistently', () => {
    expect(buildConflictComment()).toContain(STICKY_COMMENT_MARKER);
    expect(
      buildFailureComment({
        runUrl: 'https://github.com/ericrius1/portalverse/actions/runs/123',
        headSha: 'deadbeef123456',
      }),
    ).toContain('deadbee');
    expect(buildMergedComment({ mergeSha: 'cafebabe987654' })).toContain('cafebab');
  });
});
