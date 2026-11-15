import type {z} from 'zod';

/**
 * Formats a zod error as one line per issue: the failing field path, then
 * the message. Used by both components so failures read the same way.
 */
export function formatIssues(error: z.ZodError): readonly string[] {
  return error.issues.map(issue => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

/** Error raised when a data file fails its schema. */
export class ContractError extends Error {
  readonly file: string;
  readonly issues: readonly string[];

  constructor(file: string, issues: readonly string[]) {
    super(`${file} failed validation:\n  ${issues.join('\n  ')}`);
    this.name = 'ContractError';
    this.file = file;
    this.issues = issues;
  }
}

/**
 * Parses unknown data with a schema, raising a ContractError that names the
 * file and every failing field.
 */
export function parseContract<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
  file: string,
): z.infer<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ContractError(file, formatIssues(result.error));
  }
  return result.data;
}

/** Schema versions this build of the contracts understands. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1];

/**
 * Checks the schemaVersion of raw data before full validation, so an
 * unsupported version gives a clear message instead of a field error.
 */
export function assertSupportedSchemaVersion(
  data: unknown,
  file: string,
): void {
  const version: unknown =
    typeof data === 'object' && data !== null && 'schemaVersion' in data
      ? data.schemaVersion
      : undefined;
  if (
    typeof version !== 'number' ||
    !SUPPORTED_SCHEMA_VERSIONS.includes(version)
  ) {
    throw new ContractError(file, [
      `schemaVersion: unsupported version ${JSON.stringify(version)}; supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
    ]);
  }
}
