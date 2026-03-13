// -- ChangedSource ADT --

export type ChangedSource =
  | { readonly type: 'untracked' }
  | { readonly type: 'unstaged' }
  | { readonly type: 'staged' }
  | { readonly type: 'branch'; readonly name: string }
  | { readonly type: 'sha'; readonly sha: string };

// -- Config --

export type CheckEntry = {
  readonly name: string;
  readonly match: string;
  readonly exclude?: string;
  readonly group: string;
  readonly command: string;
  readonly changedFiles?: {
    readonly separator?: string;
    readonly path?: 'relative' | 'absolute';
  };
};

export type ReviewEntry = {
  readonly name: string;
  readonly match: string;
  readonly exclude?: string;
  readonly vars?: Readonly<Record<string, string>>;
  readonly prompt?: string;
  readonly command: string;
  readonly fallbacks?: readonly string[];
};

export type GatecheckConfig = {
  readonly defaults?: {
    readonly changed?: string;
    readonly target?: string;
  };
  readonly checks?: readonly CheckEntry[];
  readonly reviews?: readonly ReviewEntry[];
};

// -- Check Result ADT --

export type CheckResult =
  | { readonly status: 'skip'; readonly name: string }
  | {
      readonly status: 'passed';
      readonly name: string;
      readonly command: string;
    }
  | {
      readonly status: 'failed';
      readonly name: string;
      readonly command: string;
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    };

// -- Review Result ADT --

export type ReviewResult =
  | { readonly status: 'skip'; readonly name: string }
  | {
      readonly status: 'completed';
      readonly name: string;
      readonly command: string;
      readonly stdout: string;
    }
  | {
      readonly status: 'failed';
      readonly name: string;
      readonly command: string;
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    };
