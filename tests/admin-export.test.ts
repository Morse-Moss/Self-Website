import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  ADMIN_EXPORT_COLUMNS,
  collectAdminExport,
  streamAdminExport,
  type AdminExportInput,
} from '../lib/server/admin-export.ts';

const decoder = new TextDecoder();

async function readChunks(
  chunks: AsyncIterable<Uint8Array>,
): Promise<{ chunks: Uint8Array[]; text: string }> {
  const collected: Uint8Array[] = [];
  let text = '';
  for await (const chunk of chunks) {
    assert.ok(chunk instanceof Uint8Array);
    collected.push(chunk);
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return { chunks: collected, text };
}

interface ParsedCsvCell {
  quoted: boolean;
  value: string;
}

function parseCsvRecords(input: string): ParsedCsvCell[][] {
  const records: ParsedCsvCell[][] = [];
  let record: ParsedCsvCell[] = [];
  let value = '';
  let quoted = false;
  let inQuotes = false;

  const finishCell = () => {
    record.push({ quoted, value });
    value = '';
    quoted = false;
  };
  const finishRecord = () => {
    finishCell();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inQuotes) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"' && value.length === 0) {
      quoted = true;
      inQuotes = true;
    } else if (character === ',') {
      finishCell();
    } else if (character === '\r' && input[index + 1] === '\n') {
      finishRecord();
      index += 1;
    } else {
      value += character;
    }
  }
  if (record.length > 0 || value.length > 0 || quoted) finishRecord();
  return records;
}

function sampleRecord(overrides: AdminExportInput = {}): AdminExportInput {
  return {
    id: 'turn-001',
    createdAt: new Date('2026-07-16T08:00:00.000Z'),
    completedAt: null,
    deleteAfter: new Date('2026-07-26T08:00:00.000Z'),
    workflow: 'diagnosis',
    audienceIntent: 'collaboration',
    question: '中文问题，包含 "引号"\r\n以及换行',
    answer: '',
    status: 'completed',
    errorCode: null,
    usedSearch: false,
    searchQuery: null,
    sources: [{ id: 'local-1', title: '公开证据', href: '/works/example' }],
    inputTokens: null,
    outputTokens: 21,
    estimatedCostUsd: null,
    provider: 'openai',
    model: 'configured-model',
    latencyMs: 125,
    badcase: false,
    adminNote: null,
    diagnosis: {
      problem: '信息不完整',
      goal: '形成方案',
    },
    ...overrides,
  };
}

test('JSON export projects a stable whitelist and preserves Unicode, structured values, and nulls', async () => {
  const secretRecord = {
    ...sampleRecord(),
    sources: [{
      id: 'local-1',
      title: '公开证据',
      href: '/works/example',
      providerRawPayload: 'nested-provider-secret-must-not-export',
    }],
    diagnosis: {
      problem: '信息不完整',
      goal: '形成方案',
      token: 'nested-token-secret-must-not-export',
    },
    cookie: 'cookie-secret-must-not-export',
    token: 'token-secret-must-not-export',
    apiKey: 'api-key-secret-must-not-export',
    providerRawPayload: { raw: 'provider-secret-must-not-export' },
  };

  const encoded = await collectAdminExport('json', [secretRecord]);
  const text = new TextDecoder().decode(encoded);
  const parsed = JSON.parse(text) as Array<Record<string, unknown>>;

  assert.equal(parsed.length, 1);
  assert.deepEqual(Object.keys(parsed[0]), ADMIN_EXPORT_COLUMNS);
  assert.equal(parsed[0].createdAt, '2026-07-16T08:00:00.000Z');
  assert.equal(parsed[0].completedAt, null);
  assert.equal(parsed[0].answer, '');
  assert.equal(parsed[0].question, '中文问题，包含 "引号"\r\n以及换行');
  assert.deepEqual(parsed[0].sources, [
    { id: 'local-1', title: '公开证据', href: '/works/example' },
  ]);
  assert.deepEqual(parsed[0].diagnosis, {
    problem: '信息不完整',
    goal: '形成方案',
  });
  assert.doesNotMatch(
    text,
    /cookie-secret|token-secret|api-key-secret|provider-secret|providerRawPayload|apiKey/,
  );
});

test('CSV export emits one UTF-8 BOM, stable columns, and RFC 4180 quoting with CRLF', async () => {
  const encoded = await collectAdminExport('csv', [sampleRecord()]);
  assert.deepEqual([...encoded.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder().decode(encoded.slice(3));

  assert.ok(text.startsWith(`${ADMIN_EXPORT_COLUMNS.join(',')}\r\n`));
  assert.equal((text.match(/\uFEFF/gu) ?? []).length, 0);
  assert.match(text, /"中文问题，包含 ""引号""\r\n以及换行"/u);
  assert.ok(text.endsWith('\r\n'));

  const records = parseCsvRecords(text);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].map((cell) => cell.value), ADMIN_EXPORT_COLUMNS);
  assert.equal(records[1].length, ADMIN_EXPORT_COLUMNS.length);
  assert.equal(records[1][ADMIN_EXPORT_COLUMNS.indexOf('question')].value, sampleRecord().question);
  assert.equal(records[1][ADMIN_EXPORT_COLUMNS.indexOf('completedAt')].value, '');
  assert.equal(records[1][ADMIN_EXPORT_COLUMNS.indexOf('completedAt')].quoted, false);
  assert.equal(records[1][ADMIN_EXPORT_COLUMNS.indexOf('answer')].value, '');
  assert.equal(records[1][ADMIN_EXPORT_COLUMNS.indexOf('answer')].quoted, true);
});

test('CSV export prefixes a single quote when the first non-empty character can start a formula', async () => {
  const encoded = await collectAdminExport('csv', [sampleRecord({
    question: '=SUM(1,2)',
    answer: '  +cmd|calc',
    errorCode: '-1+1',
    adminNote: '\t@IMPORTXML("https://example.com")',
  })]);
  assert.deepEqual([...encoded.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const records = parseCsvRecords(new TextDecoder().decode(encoded.slice(3)));
  const row = records[1];

  assert.equal(row[ADMIN_EXPORT_COLUMNS.indexOf('question')].value, "'=SUM(1,2)");
  assert.equal(row[ADMIN_EXPORT_COLUMNS.indexOf('answer')].value, "'  +cmd|calc");
  assert.equal(row[ADMIN_EXPORT_COLUMNS.indexOf('errorCode')].value, "'-1+1");
  assert.equal(
    row[ADMIN_EXPORT_COLUMNS.indexOf('adminNote')].value,
    "'\t@IMPORTXML(\"https://example.com\")",
  );
});

test('streamAdminExport consumes async records incrementally and keeps large output chunked', async () => {
  const total = 2_000;
  let produced = 0;
  async function* records(): AsyncIterable<AdminExportInput> {
    for (let index = 0; index < total; index += 1) {
      produced += 1;
      yield sampleRecord({ id: `turn-${index}`, question: `问题-${index}` });
    }
  }

  const iterator = streamAdminExport('json', records())[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.ok(produced <= 1, 'the stream must not buffer the entire record source');

  async function* remaining(): AsyncIterable<Uint8Array> {
    if (!first.done) yield first.value;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  const output = await readChunks(remaining());
  assert.ok(output.chunks.length > 100, 'large exports must be emitted in multiple chunks');
  const parsed = JSON.parse(output.text) as Array<Record<string, unknown>>;
  assert.equal(parsed.length, total);
  assert.equal(parsed[0].id, 'turn-0');
  assert.equal(parsed.at(-1)?.id, `turn-${total - 1}`);
});

test('admin export implementation has no filesystem or temporary-file dependency', async () => {
  const source = await readFile(
    new URL('../lib/server/admin-export.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /node:fs|mkdtemp|tmpdir|writeFile|createWriteStream/u);
});
