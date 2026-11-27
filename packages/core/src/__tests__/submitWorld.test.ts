import { describe, expect, it } from 'vitest';
import {
  buildForkUrl,
  buildPushArgs,
  chooseBranchName,
  classifyPrWaitStatus,
  detectTouchedRooms,
  isUpstreamRemote,
  parseArgs,
  parseMergeTreeConflicts,
} from '../../../../scripts/submit-world.mjs';

describe('submit-world helper', () => {
  it('recognizes HTTPS and SSH upstream portalverse remotes', () => {
    expect(isUpstreamRemote('https://github.com/ericrius1/portalverse.git')).toBe(true);
    expect(isUpstreamRemote('https://github.com/ericrius1/portalverse')).toBe(true);
    expect(isUpstreamRemote('git@github.com:ericrius1/portalverse.git')).toBe(true);
    expect(isUpstreamRemote('https://github.com/douglascalhoun/portalverse.git')).toBe(false);
    expect(isUpstreamRemote('git@github.com:douglascalhoun/portalverse.git')).toBe(false);
  });

  it('extracts unique touched room folders from changed file paths', () => {
    expect(
      detectTouchedRooms([
        'registry.json',
        'CHANGELOG.md',
        'worlds/doug-clover-hollow/index.ts',
        'worlds/doug-clover-hollow/meadow.ts',
      ]),
    ).toEqual(['doug-clover-hollow']);
  });

  it('moves commits made on main onto a contributor feature branch', () => {
    expect(
      chooseBranchName({
        currentBranch: 'main',
        login: 'douglascalhoun',
        touchedRooms: ['doug-clover-hollow'],
        shortSha: 'abc1234',
        explicitBranch: '',
      }),
    ).toBe('douglascalhoun/doug-clover-hollow');
  });

  it('preserves an existing feature branch or explicit --branch override and rejects main', () => {
    expect(
      chooseBranchName({
        currentBranch: 'doug/clover-hollow',
        login: 'douglascalhoun',
        touchedRooms: ['doug-clover-hollow'],
        shortSha: 'abc1234',
        explicitBranch: '',
      }),
    ).toBe('doug/clover-hollow');

    expect(
      chooseBranchName({
        currentBranch: 'main',
        login: 'douglascalhoun',
        touchedRooms: ['doug-clover-hollow'],
        shortSha: 'abc1234',
        explicitBranch: 'custom/branch',
      }),
    ).toBe('custom/branch');

    expect(() =>
      chooseBranchName({
        currentBranch: 'main',
        login: 'douglascalhoun',
        touchedRooms: [],
        shortSha: 'abc1234',
        explicitBranch: 'main',
      }),
    ).toThrow(/--branch cannot be "main"/);
  });

  it('builds HTTPS and SSH fork URLs cleanly', () => {
    expect(buildForkUrl('douglascalhoun', 'https')).toBe('https://github.com/douglascalhoun/portalverse.git');
    expect(buildForkUrl('douglascalhoun', 'ssh')).toBe('git@github.com:douglascalhoun/portalverse.git');
  });

  it('uses --force-with-lease for personal fork branches and never pushes directly to main', () => {
    expect(buildPushArgs({ pushRemote: 'fork', targetBranch: 'alice/moon-room', isFork: true })).toEqual([
      'push',
      '--force-with-lease',
      '-u',
      'fork',
      'HEAD:refs/heads/alice/moon-room',
    ]);
    expect(buildPushArgs({ pushRemote: 'origin', targetBranch: 'eric/fix', isFork: false })).toEqual([
      'push',
      '-u',
      'origin',
      'HEAD:refs/heads/eric/fix',
    ]);
    expect(() => buildPushArgs({ pushRemote: 'origin', targetBranch: 'main', isFork: false })).toThrow(/Refusing/);
  });

  it('parses conflicting file paths from git merge-tree output', () => {
    const sample = [
      'deadbeef1234567890',
      '100644 aaa 1\tregistry.json',
      '',
      'Auto-merging CHANGELOG.md',
      'CONFLICT (content): Merge conflict in CHANGELOG.md',
      'Auto-merging registry.json',
      'CONFLICT (content): Merge conflict in registry.json',
      'CONFLICT (add/add): Merge conflict in worlds/demo/index.ts',
    ].join('\n');
    expect(parseMergeTreeConflicts(sample)).toEqual([
      'CHANGELOG.md',
      'registry.json',
      'worlds/demo/index.ts',
    ]);
  });

  it('classifies PR wait states cleanly for --wait polling', () => {
    expect(
      classifyPrWaitStatus({ state: 'MERGED', mergedAt: '2026-11-27T18:00:00Z', mergeCommit: { oid: '1234567890' } }),
    ).toMatchObject({ done: true, ok: true });
    expect(classifyPrWaitStatus({ state: 'CLOSED', mergedAt: null })).toMatchObject({ done: true, ok: false });
    expect(classifyPrWaitStatus({ state: 'OPEN', mergeable: 'CONFLICTING' })).toMatchObject({ done: true, ok: false });
    expect(
      classifyPrWaitStatus({
        state: 'OPEN',
        mergeable: 'MERGEABLE',
        statusCheckRollup: [{ name: 'validate', conclusion: 'FAILURE', detailsUrl: 'https://example.com/run' }],
      }),
    ).toMatchObject({ done: true, ok: false });
    expect(
      classifyPrWaitStatus({
        state: 'OPEN',
        mergeable: 'MERGEABLE',
        statusCheckRollup: [{ name: 'validate', conclusion: '' }],
      }),
    ).toMatchObject({ done: false, ok: false });
  });

  it('parses CLI flags including --wait', () => {
    expect(
      parseArgs(['--dry-run', '--draft', '--wait', '--branch', 'doug/clover', '--title=Add Clover Hollow']),
    ).toEqual({
      branch: 'doug/clover',
      title: 'Add Clover Hollow',
      body: '',
      draft: true,
      dryRun: true,
      wait: true,
      help: false,
    });
  });
});
