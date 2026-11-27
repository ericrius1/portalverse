import { describe, expect, it } from 'vitest';
import {
  buildForkUrl,
  chooseBranchName,
  detectTouchedRooms,
  isUpstreamRemote,
  parseArgs,
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

  it('preserves an existing feature branch or explicit --branch override', () => {
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
  });

  it('builds HTTPS and SSH fork URLs cleanly', () => {
    expect(buildForkUrl('douglascalhoun', 'https')).toBe('https://github.com/douglascalhoun/portalverse.git');
    expect(buildForkUrl('douglascalhoun', 'ssh')).toBe('git@github.com:douglascalhoun/portalverse.git');
  });

  it('parses CLI flags', () => {
    expect(parseArgs(['--dry-run', '--draft', '--branch', 'doug/clover', '--title=Add Clover Hollow'])).toEqual({
      branch: 'doug/clover',
      title: 'Add Clover Hollow',
      body: '',
      draft: true,
      dryRun: true,
      help: false,
    });
  });
});
