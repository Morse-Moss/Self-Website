import type { Pool, PoolClient } from 'pg';

import type {
  ChatServiceErrorCode,
  ChatSource,
  TokenUsage,
} from '../contracts/chat.ts';
import type { ContextPacketManifest } from '../contracts/chat-context.ts';
import type { AnswerValidationResult } from '../contracts/chat-turn-plan.ts';
import { enqueueAlert } from './alert-service.ts';
import type { ProviderAttempt, ProviderWinner } from './ai-provider.ts';
import { estimateCostUsd, type TokenRates } from './budget.ts';
import type { NormalizedChatRequest } from './chat-core.ts';
import {
  projectAnswerValidationManifest,
} from './chat-context-packet.ts';
import type { PreparedContextTurn } from './chat-context-turn-preparation.ts';
import type { ChatRouteDecision } from './chat-route-policy.ts';
import { aggregateProviderAttempts } from './chat-turn-compensation.ts';
import type { TurnContext } from './chat-turn-reservation.ts';
import {
  applyTaskState,
  deriveTaskStateTransition,
  loadTaskState,
  taskStateAppliedByTurn,
  taskStateRequiresWrite,
} from './conversation-task-state.ts';
import {
  lockContextPipelineAfterLegacySuccess,
  persistContextSuccessState,
  type UpsertContextTaskFrameInput,
} from './conversation-context-state.ts';
import {
  completeInteraction,
  loadCompletedInteraction,
  providerAttemptsMatch,
  replaceProviderAttempts,
} from './interaction-log.ts';
import { summarizeProviderAttempts } from './provider-attempt-log.ts';
import { runPoolTransaction } from './transaction-runner.ts';
import { encodeTurnMessage } from './turn-codec.ts';
import {
  buildDiagnosisSummary,
  transitionDiagnosisStatus,
} from './workflows/diagnosis.ts';

type PublicChatSource = ChatSource;

interface TurnCompletionConfig {
  tokenRates: TokenRates | null;
  dynamicProviderContextEnabled?: boolean;
  providerName?: string;
  model?: string;
}

interface CompletionErrorFactory {
  createError(code: ChatServiceErrorCode): Error;
}

function requestWorkflow(request: NormalizedChatRequest) {
  return request.workflow ?? 'chat';
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function elapsedMilliseconds(startedAt: Date, completedAt: Date): number {
  return Math.max(0, Math.trunc(completedAt.getTime() - startedAt.getTime()));
}

function addTokenUsage(left: TokenUsage | null, right: TokenUsage | null): TokenUsage | null {
  if (!left) return right;
  if (!right) return left;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}

function usageCost(usage: TokenUsage | null, rates: TokenRates | null): number | null {
  return usage && rates ? estimateCostUsd(usage, rates) : null;
}

function addUsageCosts(
  leftUsage: TokenUsage | null,
  leftCost: number | null,
  rightUsage: TokenUsage | null,
  rightCost: number | null,
): number | null {
  if (leftUsage && leftCost === null) return null;
  if (rightUsage && rightCost === null) return null;
  if (!leftUsage && !rightUsage) return null;
  return (leftCost ?? 0) + (rightCost ?? 0);
}

export function contextSuccessManifest(
  prepared: PreparedContextTurn,
  validation: AnswerValidationResult | null = null,
): ContextPacketManifest {
  return {
    ...prepared.manifest,
    ...(prepared.manifest.answer_validation ? {
      answer_validation: projectAnswerValidationManifest(validation),
    } : {}),
    legacy_bridge_status: prepared.legacyBridgeResolution
      ?? prepared.manifest.legacy_bridge_status,
  };
}

async function persistDiagnosis(input: {
  client: PoolClient;
  accessSessionId: string;
  request: NormalizedChatRequest;
  turn: TurnContext;
  completedAt: Date;
} & CompletionErrorFactory): Promise<void> {
  if (requestWorkflow(input.request) !== 'diagnosis') return;
  const diagnosis = input.turn.diagnosis;
  if (!diagnosis) throw input.createError('CONVERSATION_INVALID');

  const fields = diagnosis.fields;
  const summary = buildDiagnosisSummary(fields);
  let status = diagnosis.status;
  const retention = await input.client.query<{ delete_after: Date }>(
    'SELECT delete_after FROM interaction_turns WHERE id = $1',
    [input.turn.turnId],
  );
  const deleteAfter = retention.rows[0]?.delete_after;
  if (!deleteAfter) throw input.createError('CONVERSATION_INVALID');

  if (diagnosis.existing) {
    const updated = await input.client.query(
      `UPDATE diagnoses
          SET interaction_turn_id = $2,
              fields = $3::jsonb,
              summary = $4,
              status = $5,
              notification_status = CASE
                WHEN $5 = 'complete' THEN 'pending'
                ELSE notification_status
              END,
              completed_at = CASE
                WHEN $5 = 'collecting' THEN completed_at
                ELSE COALESCE(completed_at, $6)
              END,
              delete_after = $7
        WHERE id = $1`,
      [
        diagnosis.id,
        input.turn.turnId,
        JSON.stringify(fields),
        summary,
        status,
        input.completedAt,
        deleteAfter,
      ],
    );
    if (updated.rowCount !== 1) throw input.createError('CONVERSATION_INVALID');
  } else {
    await input.client.query(
      `INSERT INTO diagnoses
        (id, interaction_turn_id, access_session_id, conversation_id,
         fields, summary, status, notification_status,
         created_at, completed_at, delete_after)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
      [
        diagnosis.id,
        input.turn.turnId,
        input.accessSessionId,
        input.turn.conversationId,
        JSON.stringify(fields),
        summary,
        status,
        status === 'collecting' ? 'not_required' : 'pending',
        input.completedAt,
        status === 'collecting' ? null : input.completedAt,
        deleteAfter,
      ],
    );
  }

  if (status !== 'complete') return;
  await enqueueAlert(input.client, {
    dedupeKey: `diagnosis-complete:${diagnosis.id}`,
    category: 'diagnosis_complete',
    payload: {
      diagnosisId: diagnosis.id,
      occurredAt: input.completedAt.toISOString(),
    },
    now: input.completedAt,
    expiresAt: deleteAfter,
  });
  status = transitionDiagnosisStatus(status, {
    fields,
    outboxEnqueued: true,
  });
  await input.client.query(
    `UPDATE diagnoses
        SET status = $2,
            notification_status = 'pending'
      WHERE id = $1`,
    [diagnosis.id, status],
  );
}

export async function completeTurn(input: {
  pool: Pool;
  client: PoolClient;
  accessSessionId: string;
  request: NormalizedChatRequest;
  turn: TurnContext;
  answer: string;
  sources: PublicChatSource[];
  usage: TokenUsage | null;
  attempts: ProviderAttempt[];
  winner: ProviderWinner | null;
  usageComplete: boolean;
  costComplete: boolean;
  knownCostUsd: number | null;
  config: TurnCompletionConfig;
  startedAt: Date;
  completedAt: Date;
  route?: ChatRouteDecision | null;
  context?: PreparedContextTurn | null;
  validation?: AnswerValidationResult | null;
  signal?: AbortSignal;
} & CompletionErrorFactory): Promise<TokenUsage | null> {
  const provider = input.config.providerName ?? 'openai';
  const model = input.config.model ?? 'configured-model';
  const routed = input.attempts.length > 0;
  let taskStateWriteRequired = false;
  let contextStateWriteRequired = false;
  let usage = input.usage;

  throwIfAborted(input.signal);
  return runPoolTransaction<TokenUsage | null>({
    client: input.client,
    work: async () => {
      const attemptSummary = await summarizeProviderAttempts(input.client, input.turn.turnId);
      let estimatedCostUsd: number | null;
      let knownCostUsd = input.knownCostUsd;
      let usageComplete = input.usageComplete;
      let costComplete = input.costComplete;
      const summarizedV2 = input.turn.behavior === 'v2'
        && routed
        && attemptSummary.attemptCount > 0;
      if (summarizedV2) {
        usage = attemptSummary.usage;
        usageComplete = attemptSummary.usageComplete;
        costComplete = attemptSummary.costComplete;
        knownCostUsd = attemptSummary.estimatedCostUsd
          ?? usageCost(usage, input.config.tokenRates);
        estimatedCostUsd = costComplete ? knownCostUsd : null;
      } else if (routed) {
        const aggregate = aggregateProviderAttempts(input.attempts);
        usage = aggregate.usage;
        estimatedCostUsd = input.costComplete ? input.knownCostUsd : null;
      } else {
        const historicalUsage = attemptSummary.usage;
        const historicalCost = attemptSummary.estimatedCostUsd
          ?? usageCost(historicalUsage, input.config.tokenRates);
        const currentCost = usageCost(input.usage, input.config.tokenRates);
        usage = addTokenUsage(historicalUsage, input.usage);
        estimatedCostUsd = addUsageCosts(
          historicalUsage,
          historicalCost,
          input.usage,
          currentCost,
        );
      }

      const assistantMessage = await input.client.query<{ id: string }>(
        `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
         VALUES ($1, 'assistant', $2, $3)
         RETURNING id::text AS id`,
        [
          input.turn.conversationId,
          encodeTurnMessage(input.turn.turnId, input.answer, input.sources),
          input.completedAt,
        ],
      );
      const assistantMessageId = assistantMessage.rows[0].id;
      if (routed) {
        await replaceProviderAttempts(input.client, input.turn.turnId, input.attempts, {
          dynamicProviderContextEnabled: input.config.dynamicProviderContextEnabled === true,
        });
      }
      if (routed && !summarizedV2) {
        for (const attempt of input.attempts) {
          if (!attempt.usage) continue;
          await input.client.query(
            `INSERT INTO usage_events
              (access_session_id, conversation_id, provider, model,
               input_tokens, output_tokens, estimated_cost_usd, created_at,
               interaction_turn_id, provider_attempt_index, cost_complete)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              input.accessSessionId,
              input.turn.conversationId,
              attempt.connectionDisplayName,
              attempt.modelId,
              attempt.usage.inputTokens,
              attempt.usage.outputTokens,
              attempt.knownCostUsd,
              attempt.completedAt,
              input.turn.turnId,
              attempt.attemptIndex,
              attempt.costComplete,
            ],
          );
        }
      } else if (usage && estimatedCostUsd !== null) {
        await input.client.query(
          `INSERT INTO usage_events
            (access_session_id, conversation_id, provider, model,
             input_tokens, output_tokens, estimated_cost_usd, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            input.accessSessionId,
            input.turn.conversationId,
            provider,
            model,
            usage.inputTokens,
            usage.outputTokens,
            estimatedCostUsd,
            input.completedAt,
          ],
        );
      }
      await completeInteraction({
        client: input.client,
        turnId: input.turn.turnId,
        answer: input.answer,
        sources: input.sources,
        usage,
        estimatedCostUsd,
        knownCostUsd: routed || summarizedV2 ? knownCostUsd : estimatedCostUsd,
        usageComplete: routed || summarizedV2 ? usageComplete : input.usage !== null,
        costComplete: routed || summarizedV2 ? costComplete : estimatedCostUsd !== null,
        winner: input.winner,
        provider,
        model,
        latencyMs: elapsedMilliseconds(input.startedAt, input.completedAt),
        completedAt: input.completedAt,
      });
      await persistDiagnosis({
        client: input.client,
        accessSessionId: input.accessSessionId,
        request: input.request,
        turn: input.turn,
        completedAt: input.completedAt,
        createError: input.createError,
      });
      if (input.context) {
        if (input.turn.userMessageId === null) throw new Error('CONTEXT_USER_MESSAGE_MISSING');
        contextStateWriteRequired = true;
        const candidate = input.context.candidateFrame;
        const frame: UpsertContextTaskFrameInput | null = candidate ? {
          ...candidate,
          lastSuccessfulMessageId: assistantMessageId,
          updatedByMessageId: input.turn.userMessageId,
          now: input.completedAt,
        } : null;
        await persistContextSuccessState(input.client, {
          interactionTurnId: input.turn.turnId,
          conversationId: input.turn.conversationId,
          contextScopeId: input.context.contextScopeId,
          userMessageId: input.turn.userMessageId,
          assistantMessageId,
          resolved: input.context.resolution.resolved,
          frame,
          manifest: contextSuccessManifest(input.context, input.validation ?? null),
          completedAt: input.completedAt,
          bridgeResolution: input.context.legacyBridgeResolution,
        });
      } else if (input.turn.behavior === 'v2' && input.route) {
        const currentTaskState = await loadTaskState(input.client, input.turn.conversationId, {
          forUpdate: true,
        });
        const transition = deriveTaskStateTransition(input.route, currentTaskState);
        if (taskStateRequiresWrite(currentTaskState, transition)) {
          taskStateWriteRequired = true;
          const rowCount = await applyTaskState(
            input.client,
            input.turn.conversationId,
            input.turn.turnId,
            transition,
            currentTaskState?.version ?? 0,
            input.completedAt,
          );
          if (rowCount !== 1) throw input.createError('CONVERSATION_INVALID');
        }
      }
      if (!input.context
        && input.turn.contextAssignment === 'context_packet_v22'
        && input.turn.userMessageId !== null) {
        await lockContextPipelineAfterLegacySuccess(input.client, {
          conversationId: input.turn.conversationId,
          userMessageId: input.turn.userMessageId,
          interactionTurnId: input.turn.turnId,
          completedAt: input.completedAt,
        });
      }
      await input.client.query(
        'UPDATE conversations SET updated_at = $2 WHERE id = $1',
        [input.turn.conversationId, input.completedAt],
      );
      throwIfAborted(input.signal);
      return usage;
    },
    recoverAfterCommit: async () => {
      const completed = await loadCompletedInteraction(input.pool, input.turn.turnId)
        .catch(() => null);
      const attemptsMatch = completed?.answer === input.answer
        ? await providerAttemptsMatch(input.pool, input.turn.turnId, input.attempts, {
            dynamicProviderContextEnabled: input.config.dynamicProviderContextEnabled === true,
          }).catch(() => false)
        : false;
      const taskStateOk = !taskStateWriteRequired
        || await taskStateAppliedByTurn(input.pool, input.turn.conversationId, input.turn.turnId)
          .catch(() => false);
      const contextStateOk = !contextStateWriteRequired
        || (await input.pool.query<{ applied: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM conversation_context_completed_turns
              WHERE conversation_id = $1 AND turn_id = $2
           ) AND EXISTS (
             SELECT 1 FROM interaction_turns
              WHERE id = $2 AND context_manifest IS NOT NULL
           ) AS applied`,
          [input.turn.conversationId, input.turn.turnId],
        ).catch(() => ({ rows: [{ applied: false }] }))).rows[0]?.applied === true;
      if (attemptsMatch && taskStateOk && contextStateOk) {
        return { recovered: true, result: usage };
      }
      return { recovered: false };
    },
  });
}

export async function completeSafetyBoundaryTurn(input: {
  pool: Pool;
  client: PoolClient;
  accessSessionId: string;
  turn: TurnContext;
  answer: string;
  startedAt: Date;
  completedAt: Date;
  route?: ChatRouteDecision | null;
  context?: PreparedContextTurn | null;
  signal?: AbortSignal;
} & CompletionErrorFactory): Promise<void> {
  let taskStateWriteRequired = false;
  let contextStateWriteRequired = false;
  throwIfAborted(input.signal);
  return runPoolTransaction<void>({
    client: input.client,
    work: async () => {
      const assistantMessage = await input.client.query<{ id: string }>(
        `INSERT INTO conversation_messages (conversation_id, role, content, created_at)
         VALUES ($1, 'assistant', $2, $3)
         RETURNING id::text AS id`,
        [
          input.turn.conversationId,
          encodeTurnMessage(input.turn.turnId, input.answer, []),
          input.completedAt,
        ],
      );
      const assistantMessageId = assistantMessage.rows[0].id;
      await completeInteraction({
        client: input.client,
        turnId: input.turn.turnId,
        answer: input.answer,
        sources: [],
        usage: null,
        estimatedCostUsd: null,
        knownCostUsd: null,
        usageComplete: false,
        costComplete: false,
        winner: null,
        provider: 'deterministic',
        model: 'policy',
        latencyMs: elapsedMilliseconds(input.startedAt, input.completedAt),
        completedAt: input.completedAt,
      });
      await input.client.query(
        `UPDATE access_sessions
            SET message_count = GREATEST(message_count - 1, 0)
          WHERE id = $1`,
        [input.accessSessionId],
      );
      if (input.context) {
        if (input.turn.userMessageId === null) throw new Error('CONTEXT_USER_MESSAGE_MISSING');
        contextStateWriteRequired = true;
        const candidate = input.context.candidateFrame;
        const frame: UpsertContextTaskFrameInput | null = candidate ? {
          ...candidate,
          lastSuccessfulMessageId: assistantMessageId,
          updatedByMessageId: input.turn.userMessageId,
          now: input.completedAt,
        } : null;
        await persistContextSuccessState(input.client, {
          interactionTurnId: input.turn.turnId,
          conversationId: input.turn.conversationId,
          contextScopeId: input.context.contextScopeId,
          userMessageId: input.turn.userMessageId,
          assistantMessageId,
          resolved: input.context.resolution.resolved,
          frame,
          manifest: contextSuccessManifest(input.context),
          completedAt: input.completedAt,
          bridgeResolution: input.context.legacyBridgeResolution,
        });
      } else if (input.turn.behavior === 'v2' && input.route) {
        const currentTaskState = await loadTaskState(input.client, input.turn.conversationId, {
          forUpdate: true,
        });
        const transition = deriveTaskStateTransition(input.route, currentTaskState);
        if (taskStateRequiresWrite(currentTaskState, transition)) {
          taskStateWriteRequired = true;
          const rowCount = await applyTaskState(
            input.client,
            input.turn.conversationId,
            input.turn.turnId,
            transition,
            currentTaskState?.version ?? 0,
            input.completedAt,
          );
          if (rowCount !== 1) throw input.createError('CONVERSATION_INVALID');
        }
      }
      if (!input.context
        && input.turn.contextAssignment === 'context_packet_v22'
        && input.turn.userMessageId !== null) {
        await lockContextPipelineAfterLegacySuccess(input.client, {
          conversationId: input.turn.conversationId,
          userMessageId: input.turn.userMessageId,
          interactionTurnId: input.turn.turnId,
          completedAt: input.completedAt,
        });
      }
      await input.client.query(
        'UPDATE conversations SET updated_at = $2 WHERE id = $1',
        [input.turn.conversationId, input.completedAt],
      );
      throwIfAborted(input.signal);
    },
    recoverAfterCommit: async () => {
      const completed = await loadCompletedInteraction(input.pool, input.turn.turnId)
        .catch(() => null);
      const taskStateOk = !taskStateWriteRequired
        || await taskStateAppliedByTurn(input.pool, input.turn.conversationId, input.turn.turnId)
          .catch(() => false);
      const contextStateOk = !contextStateWriteRequired
        || (await input.pool.query<{ applied: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM conversation_context_completed_turns
              WHERE conversation_id = $1 AND turn_id = $2
           ) AS applied`,
          [input.turn.conversationId, input.turn.turnId],
        ).catch(() => ({ rows: [{ applied: false }] }))).rows[0]?.applied === true;
      if (completed?.answer === input.answer && taskStateOk && contextStateOk) {
        return { recovered: true, result: undefined };
      }
      return { recovered: false };
    },
  });
}
