export declare const UPSTREAM_OWNER: string;
export declare const UPSTREAM_REPO: string;
export declare const UPSTREAM_SLUG: string;
export declare const UPSTREAM_BASE: string;

export interface SubmitOptions {
  branch: string;
  title: string;
  body: string;
  draft: boolean;
  dryRun: boolean;
  help: boolean;
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
export declare function main(argv?: string[]): void;
