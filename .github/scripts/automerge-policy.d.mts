export declare const TARGET_BASE_BRANCH: string;
export declare const LIVE_SITE_URL: string;
export declare const STICKY_COMMENT_MARKER: string;
export declare const HOLD_LABELS: readonly string[];
export declare const PREFERRED_MERGE_METHODS: readonly ('merge' | 'squash' | 'rebase')[];

export interface PullRequestFileLike {
  filename?: string;
  previous_filename?: string;
}

export interface PullRequestLike {
  state?: string;
  draft?: boolean;
  mergeable?: boolean | null;
  changed_files?: number;
  base?: { ref?: string };
  head?: { sha?: string };
  labels?: Array<string | { name?: string }>;
}

export interface PullRequestEvaluation {
  eligible: boolean;
  reason:
    | 'ok'
    | 'not-open'
    | 'non-main-base'
    | 'draft'
    | 'head-moved'
    | 'hold-label'
    | 'too-many-files'
    | 'protected-paths'
    | 'merge-conflict';
  holdLabels?: string[];
  protectedFiles?: string[];
  comment: string | null;
}

export declare function isProtectedPath(filePath: string): boolean;
export declare function findProtectedFiles(files: Array<string | PullRequestFileLike>): string[];
export declare function findHoldLabels(labels: Array<string | { name?: string }>): string[];
export declare function formatStickyComment(body: string): string;
export declare function buildProtectedPathsComment(protectedFiles: string[]): string;
export declare function buildConflictComment(): string;
export declare function buildTooManyFilesComment(info: { changedFiles: number; inspectedFiles: number }): string;
export declare function buildFailureComment(info: { runUrl: string; headSha: string }): string;
export declare function buildMergedComment(info: { mergeSha: string; liveUrl?: string }): string;
export declare function evaluatePullRequest(input: {
  pr: PullRequestLike;
  files: Array<string | PullRequestFileLike>;
  expectedHeadSha?: string;
}): PullRequestEvaluation;
