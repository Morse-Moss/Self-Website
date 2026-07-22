import type { Pool } from 'pg';

import {
  CHAT_WORKFLOWS,
  type ChatAudienceIntent,
  type ChatSource,
  type ChatWorkflow,
} from '../contracts/chat.ts';
import { sanitizeTurnSources } from './turn-codec.ts';

const WORKFLOWS = CHAT_WORKFLOWS;
const STATUSES = ['running', 'completed', 'stopped', 'failed'] as const;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_ADMIN_NOTE_LENGTH = 2_000;

type Workflow = ChatWorkflow;
type TurnStatus = (typeof STATUSES)[number];
type BooleanFilter = boolean | string | null | undefined;
type DateFilter = Date | string | null | undefined;
type NumberFilter = number | string | null | undefined;

export interface AdminTurnFilterInput {
  workflow?: string | null;
  status?: string | null;
  usedSearch?: BooleanFilter;
  badcase?: BooleanFilter;
  from?: DateFilter;
  to?: DateFilter;
  page?: NumberFilter;
  limit?: NumberFilter;
}

export interface NormalizedAdminTurnFilters {
  workflow: Workflow | null;
  status: TurnStatus | null;
  usedSearch: boolean | null;
  badcase: boolean | null;
  from: Date | null;
  to: Date | null;
  page: number;
  limit: number;
}

export interface AdminTurn {
  id: string;
  accessSessionId: string;
  inviteLabel: string | null;
  conversationId: string | null;
  workflow: Workflow;
  audienceIntent: ChatAudienceIntent;
  question: string;
  answer: string | null;
  status: TurnStatus;
  errorCode: string | null;
  knowledgeSources: ChatSource[];
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  usedSearch: boolean;
  badcase: boolean;
  adminNote: string | null;
  createdAt: Date;
  completedAt: Date | null;
  deleteAfter: Date;
}

export interface AdminSearchDetail {
  id: string;
  query: string;
  routeReason: string;
  status: 'pending' | 'completed' | 'failed';
  results: unknown;
  errorCode: string | null;
  createdAt: Date;
  deleteAfter: Date;
}

export interface AdminDiagnosisDetail {
  id: string;
  fields: Record<string, unknown>;
  summary: string;
  status: 'collecting' | 'complete' | 'handoff_pending' | 'notified';
  notificationStatus: 'pending' | 'sent' | 'failed' | 'not_required';
  createdAt: Date;
  completedAt: Date | null;
  deleteAfter: Date;
}

export interface AdminTurnDetail extends AdminTurn {
  search: AdminSearchDetail | null;
  diagnosis: AdminDiagnosisDetail | null;
}

interface AdminTurnRow {
  id: string;
  access_session_id: string;
  invite_label: string | null;
  conversation_id: string | null;
  workflow: Workflow;
  audience_intent: ChatAudienceIntent;
  question: string;
  answer: string | null;
  status: TurnStatus;
  error_code: string | null;
  knowledge_sources: unknown;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: string | number | null;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  used_search: boolean;
  badcase: boolean;
  admin_note: string | null;
  created_at: Date;
  completed_at: Date | null;
  delete_after: Date;
}

interface AdminTurnDetailRow extends AdminTurnRow {
  search_id: string | null;
  search_query: string | null;
  search_route_reason: string | null;
  search_status: AdminSearchDetail['status'] | null;
  search_results: unknown;
  search_error_code: string | null;
  search_created_at: Date | null;
  search_delete_after: Date | null;
  diagnosis_id: string | null;
  diagnosis_fields: Record<string, unknown> | null;
  diagnosis_summary: string | null;
  diagnosis_status: AdminDiagnosisDetail['status'] | null;
  diagnosis_notification_status: AdminDiagnosisDetail['notificationStatus'] | null;
  diagnosis_created_at: Date | null;
  diagnosis_completed_at: Date | null;
  diagnosis_delete_after: Date | null;
}

const turnColumns = `turn.id::text,
  turn.access_session_id::text,
  turn.invite_label,
  turn.conversation_id::text,
  turn.workflow,
  turn.audience_intent,
  turn.question,
  turn.answer,
  turn.status,
  turn.error_code,
  turn.knowledge_sources,
  turn.input_tokens,
  turn.output_tokens,
  turn.estimated_cost_usd,
  turn.provider,
  turn.model,
  turn.latency_ms,
  turn.used_search,
  turn.badcase,
  turn.admin_note,
  turn.created_at,
  turn.completed_at,
  turn.delete_after`;

function parseEnum<T extends string>(
  value: string | null | undefined,
  values: readonly T[],
  field: string,
): T | null {
  if (value === undefined || value === null || value === '') return null;
  if (!values.includes(value as T)) throw new Error(`Invalid ${field}.`);
  return value as T;
}

function parseBoolean(value: BooleanFilter, field: string): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`Invalid ${field}.`);
}

function parseDate(value: DateFilter, field: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}.`);
  return parsed;
}

function parseInteger(
  value: NumberFilter,
  field: string,
  fallback: number,
  maximum?: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum !== undefined && parsed > maximum)) {
    throw new Error(`Invalid ${field}.`);
  }
  return parsed;
}

export function normalizeAdminTurnFilters(
  input: AdminTurnFilterInput,
): NormalizedAdminTurnFilters {
  const from = parseDate(input.from, 'from');
  const to = parseDate(input.to, 'to');
  if (from && to && from.getTime() > to.getTime()) {
    throw new Error('Invalid from and to range.');
  }
  return {
    workflow: parseEnum(input.workflow, WORKFLOWS, 'workflow'),
    status: parseEnum(input.status, STATUSES, 'status'),
    usedSearch: parseBoolean(input.usedSearch, 'usedSearch'),
    badcase: parseBoolean(input.badcase, 'badcase'),
    from,
    to,
    page: parseInteger(input.page, 'page', DEFAULT_PAGE),
    limit: parseInteger(input.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT),
  };
}

function toAdminTurn(row: AdminTurnRow): AdminTurn {
  return {
    id: row.id,
    accessSessionId: row.access_session_id,
    inviteLabel: row.invite_label,
    conversationId: row.conversation_id,
    workflow: row.workflow,
    audienceIntent: row.audience_intent,
    question: row.question,
    answer: row.answer,
    status: row.status,
    errorCode: row.error_code,
    knowledgeSources: sanitizeTurnSources(row.knowledge_sources) ?? [],
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostUsd: row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd),
    provider: row.provider,
    model: row.model,
    latencyMs: row.latency_ms,
    usedSearch: row.used_search,
    badcase: row.badcase,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    deleteAfter: row.delete_after,
  };
}

function addValue(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
}

function buildLiveTurnWhere(
  filters: NormalizedAdminTurnFilters,
  now: Date,
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const nowParameter = addValue(values, now);
  const clauses = [
    `turn.created_at <= ${nowParameter}`,
    `turn.created_at >= ${nowParameter} - INTERVAL '10 days'`,
    `turn.delete_after > ${nowParameter}`,
  ];
  if (filters.workflow) clauses.push(`turn.workflow = ${addValue(values, filters.workflow)}`);
  if (filters.status) clauses.push(`turn.status = ${addValue(values, filters.status)}`);
  if (filters.usedSearch !== null) {
    clauses.push(`turn.used_search = ${addValue(values, filters.usedSearch)}`);
  }
  if (filters.badcase !== null) clauses.push(`turn.badcase = ${addValue(values, filters.badcase)}`);
  if (filters.from) clauses.push(`turn.created_at >= ${addValue(values, filters.from)}`);
  if (filters.to) clauses.push(`turn.created_at <= ${addValue(values, filters.to)}`);
  return { sql: clauses.join('\n        AND '), values };
}

export async function listAdminTurns(
  pool: Pool,
  input: AdminTurnFilterInput & { now?: Date } = {},
): Promise<{ items: AdminTurn[]; total: number; page: number; limit: number }> {
  const filters = normalizeAdminTurnFilters(input);
  const now = input.now ?? new Date();
  const where = buildLiveTurnWhere(filters, now);
  const count = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM interaction_turns AS turn
      WHERE ${where.sql}`,
    where.values,
  );
  const values = [...where.values];
  const limitParameter = addValue(values, filters.limit);
  const offsetParameter = addValue(values, (filters.page - 1) * filters.limit);
  const rows = await pool.query<AdminTurnRow>(
    `SELECT ${turnColumns}
       FROM interaction_turns AS turn
      WHERE ${where.sql}
      ORDER BY turn.created_at DESC, turn.id DESC
      LIMIT ${limitParameter}
     OFFSET ${offsetParameter}`,
    values,
  );
  return {
    items: rows.rows.map(toAdminTurn),
    total: Number(count.rows[0]?.total ?? 0),
    page: filters.page,
    limit: filters.limit,
  };
}

export async function getAdminTurn(
  pool: Pool,
  turnId: string,
  now = new Date(),
): Promise<AdminTurnDetail | null> {
  const rows = await pool.query<AdminTurnDetailRow>(
    `SELECT ${turnColumns},
            search.id::text AS search_id,
            search.query AS search_query,
            search.route_reason AS search_route_reason,
            search.status AS search_status,
            search.results AS search_results,
            search.error_code AS search_error_code,
            search.created_at AS search_created_at,
            search.delete_after AS search_delete_after,
            diagnosis.id::text AS diagnosis_id,
            diagnosis.fields AS diagnosis_fields,
            diagnosis.summary AS diagnosis_summary,
            diagnosis.status AS diagnosis_status,
            diagnosis.notification_status AS diagnosis_notification_status,
            diagnosis.created_at AS diagnosis_created_at,
            diagnosis.completed_at AS diagnosis_completed_at,
            diagnosis.delete_after AS diagnosis_delete_after
       FROM interaction_turns AS turn
       LEFT JOIN interaction_searches AS search
         ON search.interaction_turn_id = turn.id
        AND search.created_at <= $2
        AND search.delete_after > $2
       LEFT JOIN diagnoses AS diagnosis
         ON diagnosis.interaction_turn_id = turn.id
        AND diagnosis.created_at <= $2
        AND diagnosis.delete_after > $2
      WHERE turn.id = $1
        AND turn.created_at <= $2
        AND turn.created_at >= $2 - INTERVAL '10 days'
        AND turn.delete_after > $2`,
    [turnId, now],
  );
  const row = rows.rows[0];
  if (!row) return null;
  return {
    ...toAdminTurn(row),
    search: row.search_id && row.search_query !== null && row.search_route_reason !== null
      && row.search_status && row.search_created_at && row.search_delete_after
      ? {
          id: row.search_id,
          query: row.search_query,
          routeReason: row.search_route_reason,
          status: row.search_status,
          results: row.search_results,
          errorCode: row.search_error_code,
          createdAt: row.search_created_at,
          deleteAfter: row.search_delete_after,
        }
      : null,
    diagnosis: row.diagnosis_id && row.diagnosis_fields && row.diagnosis_summary !== null
      && row.diagnosis_status && row.diagnosis_notification_status
      && row.diagnosis_created_at && row.diagnosis_delete_after
      ? {
          id: row.diagnosis_id,
          fields: row.diagnosis_fields,
          summary: row.diagnosis_summary,
          status: row.diagnosis_status,
          notificationStatus: row.diagnosis_notification_status,
          createdAt: row.diagnosis_created_at,
          completedAt: row.diagnosis_completed_at,
          deleteAfter: row.diagnosis_delete_after,
        }
      : null,
  };
}

export function updateAdminBadcase(input: {
  pool: Pool;
  turnId: string;
  badcase: boolean;
  note: string | null;
  now?: Date;
}): Promise<AdminTurn | null> {
  if (typeof input.badcase !== 'boolean') throw new Error('Invalid badcase.');
  if (input.note !== null && typeof input.note !== 'string') throw new Error('Invalid admin note.');
  const note = input.note?.trim() || null;
  if (note && note.length > MAX_ADMIN_NOTE_LENGTH) {
    throw new Error('Admin note cannot exceed 2,000 characters.');
  }
  const now = input.now ?? new Date();
  return input.pool.query<AdminTurnRow>(
    `UPDATE interaction_turns AS turn
        SET badcase = $2,
            admin_note = $3
      WHERE turn.id = $1
        AND turn.created_at <= $4
        AND turn.created_at >= $4 - INTERVAL '10 days'
        AND turn.delete_after > $4
      RETURNING ${turnColumns}`,
    [input.turnId, input.badcase, note, now],
  ).then((updated) => (updated.rows[0] ? toAdminTurn(updated.rows[0]) : null));
}
