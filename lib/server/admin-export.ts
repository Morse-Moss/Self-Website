export const ADMIN_EXPORT_COLUMNS = [
  'id',
  'createdAt',
  'completedAt',
  'deleteAfter',
  'workflow',
  'audienceIntent',
  'question',
  'answer',
  'status',
  'errorCode',
  'usedSearch',
  'searchQuery',
  'sources',
  'inputTokens',
  'outputTokens',
  'estimatedCostUsd',
  'provider',
  'model',
  'latencyMs',
  'badcase',
  'adminNote',
  'diagnosis',
] as const;

export type AdminExportColumn = typeof ADMIN_EXPORT_COLUMNS[number];
export type AdminExportFormat = 'json' | 'csv';

export interface AdminExportInput {
  readonly [field: string]: unknown;
}

export type AdminExportRecords =
  | Iterable<AdminExportInput>
  | AsyncIterable<AdminExportInput>;

const encoder = new TextEncoder();
const csvFormulaPrefix = /^\s*[=+\-@]/u;
const sourceColumns = [
  'id',
  'title',
  'href',
  'kind',
  'domain',
  'score',
  'snippet',
] as const;
const diagnosisColumns = [
  'id',
  'problem',
  'goal',
  'currentState',
  'constraints',
  'expectedTimeline',
  'summary',
  'status',
  'notificationStatus',
  'completedAt',
] as const;

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, normalizeValue(nested)]),
    );
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return null;
}

function projectNestedRecord(
  value: unknown,
  columns: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const column of columns) {
    if (Object.hasOwn(input, column)) projected[column] = normalizeValue(input[column]);
  }
  return projected;
}

function normalizeColumnValue(column: AdminExportColumn, value: unknown): unknown {
  if (column === 'sources') {
    if (value === null || value === undefined) return null;
    if (!Array.isArray(value)) return null;
    return value
      .map((source) => projectNestedRecord(source, sourceColumns))
      .filter((source) => source !== null);
  }
  if (column === 'diagnosis') {
    if (value === null || value === undefined) return null;
    return projectNestedRecord(value, diagnosisColumns);
  }
  return normalizeValue(value);
}

function projectRecord(input: AdminExportInput): Record<AdminExportColumn, unknown> {
  const projected = {} as Record<AdminExportColumn, unknown>;
  for (const column of ADMIN_EXPORT_COLUMNS) {
    projected[column] = normalizeColumnValue(column, input[column]);
  }
  return projected;
}

function csvCell(value: unknown): string {
  if (value === null) return '';
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const safe = csvFormulaPrefix.test(serialized) ? `'${serialized}` : serialized;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvRow(record: Record<AdminExportColumn, unknown>): string {
  return ADMIN_EXPORT_COLUMNS.map((column) => csvCell(record[column])).join(',');
}

export async function* streamAdminExport(
  format: AdminExportFormat,
  records: AdminExportRecords,
): AsyncIterable<Uint8Array> {
  if (format === 'json') {
    yield encoder.encode('[');
    let first = true;
    for await (const record of records) {
      const separator = first ? '' : ',';
      first = false;
      yield encoder.encode(`${separator}${JSON.stringify(projectRecord(record))}`);
    }
    yield encoder.encode(']');
    return;
  }
  if (format !== 'csv') throw new TypeError('Unsupported admin export format.');

  yield encoder.encode(`\uFEFF${ADMIN_EXPORT_COLUMNS.join(',')}\r\n`);
  for await (const record of records) {
    yield encoder.encode(`${csvRow(projectRecord(record))}\r\n`);
  }
}

export async function collectAdminExport(
  format: AdminExportFormat,
  records: AdminExportRecords,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of streamAdminExport(format, records)) {
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  }

  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
