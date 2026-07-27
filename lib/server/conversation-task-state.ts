import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { ChatTopicKind } from '../contracts/chat.ts';
import type { ChatRouteDecision } from '../contracts/chat-runtime.ts';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
type TaskTopicKind = Exclude<ChatTopicKind, 'none'>;

export type ConversationTaskKind =
  | 'project_discussion'
  | 'capability_verification'
  | 'jd_match'
  | 'external_research';

export interface ConversationTaskState {
  conversationId: string | null;
  taskId: string;
  taskKind: ConversationTaskKind;
  topicKind: TaskTopicKind;
  topicRef: string;
  status: 'active' | 'waiting_input' | 'completed';
  waitingFor: string[];
  taskStartedTurnId: string | null;
  lastSuccessfulTurnId: string | null;
  version: number;
  updatedByTurnId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  // Removed with the V2.1 LLM route judge in Task 2.
  activeTopicKind: TaskTopicKind;
  activeTopicRef: string;
}

export type TaskStateAction = 'continue' | 'switch' | 'waiting_input' | 'complete';

export interface TaskStateTransition {
  action: TaskStateAction;
  next: ConversationTaskState | null;
  writeRequired: boolean;
}

function taskKindForTopic(topicKind: TaskTopicKind): ConversationTaskKind {
  switch (topicKind) {
    case 'project': return 'project_discussion';
    case 'capability': return 'capability_verification';
    case 'jd': return 'jd_match';
    case 'external': return 'external_research';
  }
}

function createTaskState(
  topicKind: TaskTopicKind,
  topicRef: string,
  status: ConversationTaskState['status'] = 'active',
): ConversationTaskState {
  return {
    conversationId: null,
    taskId: randomUUID(),
    taskKind: taskKindForTopic(topicKind),
    topicKind,
    topicRef,
    status,
    waitingFor: status === 'waiting_input' ? ['job_description'] : [],
    taskStartedTurnId: null,
    lastSuccessfulTurnId: null,
    version: 0,
    updatedByTurnId: null,
    createdAt: null,
    updatedAt: null,
    activeTopicKind: topicKind,
    activeTopicRef: topicRef,
  };
}

function sameTopic(
  current: ConversationTaskState | null,
  topicKind: TaskTopicKind,
  topicRef: string,
): boolean {
  return current !== null
    && current.topicKind === topicKind
    && current.topicRef === topicRef;
}

export function deriveTaskStateTransition(
  route: ChatRouteDecision,
  current: ConversationTaskState | null,
): TaskStateTransition {
  if (route.routeKind === 'jd_intake') {
    const next = sameTopic(current, 'jd', 'jd')
      ? {
          ...current!,
          status: 'waiting_input' as const,
          waitingFor: ['job_description'],
        }
      : createTaskState('jd', 'jd', 'waiting_input');
    return { action: 'waiting_input', next, writeRequired: true };
  }

  if (route.topicKind === 'none' || !route.topicRef) {
    return { action: 'continue', next: current, writeRequired: false };
  }

  if (!sameTopic(current, route.topicKind, route.topicRef)) {
    return {
      action: 'switch',
      next: createTaskState(route.topicKind, route.topicRef),
      writeRequired: true,
    };
  }

  const continued = current as ConversationTaskState;
  const resumed = continued.status === 'waiting_input' && route.topicKind === 'jd'
    ? { ...continued, status: 'active' as const, waitingFor: [] }
    : continued;
  return { action: 'continue', next: resumed, writeRequired: true };
}

export function taskStateRequiresWrite(
  _current: ConversationTaskState | null,
  transition: TaskStateTransition,
): boolean {
  return transition.writeRequired;
}

interface TaskStateRow {
  conversation_id: string;
  task_id: string;
  task_kind: ConversationTaskKind;
  topic_kind: TaskTopicKind;
  topic_ref: string;
  status: ConversationTaskState['status'];
  waiting_for: string[];
  task_started_turn_id: string | null;
  last_successful_turn_id: string | null;
  version: number;
  updated_by_turn_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function toTaskState(row: TaskStateRow): ConversationTaskState {
  return {
    conversationId: row.conversation_id,
    taskId: row.task_id,
    taskKind: row.task_kind,
    topicKind: row.topic_kind,
    topicRef: row.topic_ref,
    status: row.status,
    waitingFor: row.waiting_for,
    taskStartedTurnId: row.task_started_turn_id,
    lastSuccessfulTurnId: row.last_successful_turn_id,
    version: row.version,
    updatedByTurnId: row.updated_by_turn_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activeTopicKind: row.topic_kind,
    activeTopicRef: row.topic_ref,
  };
}

export async function loadTaskState(
  client: Queryable,
  conversationId: string,
  options: { forUpdate?: boolean } = {},
): Promise<ConversationTaskState | null> {
  const result = await client.query<TaskStateRow>(
    `SELECT conversation_id::text, task_id::text, task_kind, topic_kind, topic_ref,
            status, waiting_for, task_started_turn_id::text,
            last_successful_turn_id::text, version, updated_by_turn_id::text,
            created_at, updated_at
       FROM conversation_task_state
      WHERE conversation_id = $1
      ${options.forUpdate ? 'FOR UPDATE' : ''}`,
    [conversationId],
  );
  const row = result.rows[0];
  return row ? toTaskState(row) : null;
}

export async function applyTaskState(
  client: Queryable,
  conversationId: string,
  turnId: string,
  transition: TaskStateTransition,
  expectedVersion: number,
  now: Date,
): Promise<number> {
  const next = transition.next;
  if (!next || !transition.writeRequired) {
    throw new TypeError('applyTaskState requires a writable next Task Frame.');
  }
  const result = await client.query(
    `INSERT INTO conversation_task_state
      (conversation_id, task_id, task_kind, topic_kind, topic_ref, status,
       waiting_for, task_started_turn_id, last_successful_turn_id, version,
       updated_by_turn_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9 + 1, $8, $10, $10)
     ON CONFLICT (conversation_id) DO UPDATE
        SET task_id = EXCLUDED.task_id,
            task_kind = EXCLUDED.task_kind,
            topic_kind = EXCLUDED.topic_kind,
            topic_ref = EXCLUDED.topic_ref,
            status = EXCLUDED.status,
            waiting_for = EXCLUDED.waiting_for,
            task_started_turn_id = CASE
              WHEN conversation_task_state.task_id = EXCLUDED.task_id
                THEN conversation_task_state.task_started_turn_id
              ELSE EXCLUDED.task_started_turn_id
            END,
            last_successful_turn_id = EXCLUDED.last_successful_turn_id,
            version = conversation_task_state.version + 1,
            updated_by_turn_id = EXCLUDED.updated_by_turn_id,
            created_at = CASE
              WHEN conversation_task_state.task_id = EXCLUDED.task_id
                THEN conversation_task_state.created_at
              ELSE EXCLUDED.created_at
            END,
            updated_at = EXCLUDED.updated_at
      WHERE conversation_task_state.version = $9`,
    [
      conversationId,
      next.taskId,
      next.taskKind,
      next.topicKind,
      next.topicRef,
      next.status,
      next.waitingFor,
      turnId,
      expectedVersion,
      now,
    ],
  );
  if ((result.rowCount ?? 0) === 1) {
    const turn = await client.query(
      'UPDATE interaction_turns SET task_id = $2 WHERE id = $1',
      [turnId, next.taskId],
    );
    if (turn.rowCount !== 1) {
      throw new Error('The completed interaction turn cannot receive task_id.');
    }
  }
  return result.rowCount ?? 0;
}

export async function taskStateAppliedByTurn(
  pool: Pool,
  conversationId: string,
  turnId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM conversation_task_state AS task
       JOIN interaction_turns AS turn
         ON turn.id = task.updated_by_turn_id
        AND turn.task_id = task.task_id
      WHERE task.conversation_id = $1
        AND task.updated_by_turn_id = $2`,
    [conversationId, turnId],
  );
  return (result.rowCount ?? 0) > 0;
}
