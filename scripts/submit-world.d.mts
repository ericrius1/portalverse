export declare const UPSTREAM_OWNER: string;
export declare const UPSTREAM_REPO: string;
export declare const UPSTREAM_SLUG: string;
export declare const UPSTREAM_BASE: string;
export declare const LIVE_SITE_URL: string;

export interface SubmitOptions {
  branch: string;
  title: string;
  body: string;
  draft: boolean;
  dryRun: boolean;
  wait: boolean;
  help: boolean;
}

export interface PrWaitStatus {
  done: boolean;
  ok: boolean;
  message: string;
}

export declare function parseArgs(argv: string[]): SubmitOptions;
export declare function isUpstreamRemote(url: string): boolean;
export declare function detectTouchedRooms(changedFiles: string[]): string[];
export declare function sanitizeBranchSegment(value: string): string;
export declare function chooseBranchName(input: {
  currentBranch: string;
  login: string;
  touchedRooms: string[];
  shortSha: string;
  explicitBranch: string;
}): string;
export declare function buildForkUrl(login: string, protocol?: 'https' | 'ssh'): string;
export declare function buildPushArgs(input: {
  pushRemote: string;
  targetBranch: string;
  isFork: boolean;
}): string[];
export declare function parseMergeTreeConflicts(output: string): string[];
export declare function classifyPrWaitStatus(pr: {
  state?: string;
  mergedAt?: string | null;
  mergeCommit?: { oid?: string } | null;
  mergeable?: string;
  statusCheckRollup?: Array<{
    name?: string;
    context?: string;
    conclusion?: string;
    detailsUrl?: string;
    targetUrl?: string;
  }>;
}): PrWaitStatus;
export declare function main(argv?: string[]): void;
