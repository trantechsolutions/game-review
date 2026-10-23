// Types for r2.mjs, so the TypeScript tools (tools/manager/manager.ts) can import it under tsc.
export interface R2Object { size: number; etag: string }

export interface ClipsR2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  clipsBucket: string;
  [key: string]: unknown;
}

export function loadR2(file: string): Record<string, unknown> | null;
export function r2Client(c: Record<string, unknown>): {
  list(): Promise<Map<string, R2Object>>;
  put(name: string, buf: Uint8Array, existing: Map<string, R2Object>): Promise<boolean>;
  prune(keep: Set<string>, existing: Map<string, R2Object>): Promise<number>;
  url(name: string): string;
};

export function loadClipsR2(file: string): ClipsR2Config | null;
export function clipsClient(c: ClipsR2Config): {
  /** key → { size, etag } for every object under prefix. */
  list(prefix: string): Promise<Map<string, R2Object>>;
  /** Uploads unless an identical object (same MD5) is already there. Returns true if uploaded. */
  put(key: string, buf: Uint8Array, existing: Map<string, R2Object>): Promise<boolean>;
  remove(keys: string[]): Promise<number>;
};
