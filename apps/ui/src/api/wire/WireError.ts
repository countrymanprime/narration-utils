import type { StandardSchemaIssue } from './standardSchema';

/** What a narrator reads. Paths and types go to the host log and the "Copy details" text, never into the screen copy. */
export const USER_MESSAGE = 'The app received data it could not read.';

/** How many failing paths one error carries; a payload that is wrong everywhere is not more useful listed in full. */
const MAX_ISSUES = 10;

/** One failing place in a payload: where (a path such as `rows[3].kind`) and which rule, never the value that was found. */
export type WireIssue = { path: string; message: string };

function segmentKey(segment: PropertyKey | { readonly key: PropertyKey }): PropertyKey {
  return typeof segment === 'object' ? segment.key : segment;
}

/** `rows[3].kind`, or `(root)` when the payload itself is the wrong shape. */
function formatPath(path: StandardSchemaIssue['path']): string {
  if (!path || path.length === 0) return '(root)';
  return path.reduce<string>((text, segment) => {
    const key = segmentKey(segment);
    if (typeof key === 'number') return `${text}[${key}]`;
    const name = String(key);
    return text === '' ? name : `${text}.${name}`;
  }, '');
}

/**
 * A payload that crossed into the UI and did not match its schema (ADR 0069). It names the boundary and the payload and
 * lists the failing paths with the rule each broke. It carries no value from the payload: manuscript text can be in it.
 */
export class WireError extends Error {
  readonly boundary: string;
  readonly payload: string;
  readonly issues: readonly WireIssue[];
  /** How many further issues were left out of `issues`. */
  readonly omitted: number;
  readonly userMessage = USER_MESSAGE;

  constructor(boundary: string, payload: string, issues: readonly WireIssue[], omitted = 0) {
    super(WireError.describe(boundary, payload, issues, omitted));
    this.name = 'WireError';
    this.boundary = boundary;
    this.payload = payload;
    this.issues = issues;
    this.omitted = omitted;
  }

  static fromIssues(boundary: string, payload: string, found: ReadonlyArray<StandardSchemaIssue>): WireError {
    const issues = found.slice(0, MAX_ISSUES).map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
    return new WireError(boundary, payload, issues, Math.max(0, found.length - MAX_ISSUES));
  }

  private static describe(boundary: string, payload: string, issues: readonly WireIssue[], omitted: number): string {
    const listed = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    return `${boundary} ${payload} did not match its schema: ${listed}${omitted > 0 ? `; and ${omitted} more` : ''}`;
  }

  /** The text for "Copy details" and the host log: technical, complete and free of payload values. */
  details(): string {
    return this.message;
  }
}

export function isWireError(error: unknown): error is WireError {
  return error instanceof WireError;
}
