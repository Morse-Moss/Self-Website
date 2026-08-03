import type { Pool, PoolClient } from 'pg';

import type { ChatSource, TokenUsage } from '../contracts/chat.ts';
import type { ProviderAttempt, ProviderWinner } from './ai-provider.ts';
import type { ChatBehavior } from './chat-behavior.ts';
import { estimateCostUsd, type TokenRates } from './budget.ts';
import type { ContextTerminalState } from './chat-context-turn-preparation.ts';
import { persistContextTerminalManifest } from './conversation-context-state.ts';
import {
  loadInteractionForUpdate,
  replaceProviderAttempts,
  terminateInteraction,
  type InteractionTurn,
} from './interaction-log.ts';
import { summarizeProviderAttempts } from './provider-attempt-log.ts';

export type TerminalStatus = 'stopped' | 'failed';

export interface CompensableTurn {
  conversationId: string;
  userMessageId: string | null;
  turnId: string;
  createdConversation: boolean;
  behavior: ChatBehavior;
}

export interface CompensationInput {
  client: PoolClient;
  pool: Pool;
  accessSessionId: string;
  turn: CompensableTurn;
  status: TerminalStatus;
  errorCode: string;
  answer: string | null;
  sources: ChatSource[];
  attempts: ProviderAttempt[];
  winner: ProviderWinner | null;
  config: {
    dynamicProviderContextEnabled?: boolean;
    tokenRates: TokenRates | null;
  };
  startedAt: Date;
  completedAt: Date;
  contextTerminal?: ContextTerminalState | null;
}

type CompensationResult = 'completed' | 'expected_terminal' | 'other_terminal';

function usageCost(usage: TokenUsage | null, rates: TokenRates | null): number | null {
  return usage && rates ? estimateCostUsd(usage, rates) : null;
}

function elapsedMilliseconds(startedAt: Date, completedAt: Date): number {
  return Math.max(0, Math.trunc(completedAt.getTime() - startedAt.getTime()));
}

function isExpectedTerminal(
  interaction: InteractionTurn,
  input: CompensationInput,
): boolean {
  return interaction.status === input.status
    && interaction.errorCode === input.errorCode
    && interaction.answer === input.answer;
}

async function compensateTurnOnce(input: CompensationInput): Promise<CompensationResult> {
  try {
    await input.client.query('BEGIN');
    const interaction = await loadInteractionForUpdate(input.client, input.turn.turnId);
    if (interaction?.status === 'completed') {
      await input.client.query('COMMIT');
      return 'completed';
    }
    if (interaction?.status === 'stopped' || interaction?.status === 'failed') {
      const result = isExpectedTerminal(interaction, input)
        ? 'expected_terminal'
        : 'other_terminal';
      await input.client.query('COMMIT');
      return result;
    }
    if (!interaction) throw new Error('Reserved interaction turn is missing.');

    if (input.turn.userMessageId !== null) {
      const deleted = await input.client.query(
        `DELETE FROM conversation_messages
          WHERE id = $1
            AND conversation_id = $2
            AND role = 'user'`,
        [input.turn.userMessageId, input.turn.conversationId],
      );
      if (deleted.rowCount === 1) {
        await input.client.query(
          `UPDATE access_sessions
              SET message_count = GREATEST(message_count - 1, 0)
            WHERE id = $1`,
          [input.accessSessionId],
        );
      }
    }

    const aggregate = aggregateProviderAttempts(input.attempts);
    if (input.attempts.length > 0) {
      await replaceProviderAttempts(input.client, input.turn.turnId, input.attempts, {
        dynamicProviderContextEnabled: input.config.dynamicProviderContextEnabled === true,
      });
    }
    if (input.attempts.length > 0 && input.turn.behavior !== 'v2') {
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
    }
    const attemptSummary = input.turn.behavior === 'v2'
      ? await summarizeProviderAttempts(input.client, input.turn.turnId)
      : null;
    const summarizedV2 = attemptSummary !== null && attemptSummary.attemptCount > 0;
    const usage = summarizedV2 ? attemptSummary.usage : aggregate.usage;
    const knownCostUsd = summarizedV2
      ? attemptSummary.estimatedCostUsd ?? usageCost(usage, input.config.tokenRates)
      : aggregate.knownCostUsd;
    const usageComplete = summarizedV2
      ? attemptSummary.usageComplete
      : aggregate.usageComplete;
    const costComplete = summarizedV2
      ? attemptSummary.costComplete
      : aggregate.costComplete;
    await terminateInteraction({
      client: input.client,
      turnId: input.turn.turnId,
      status: input.status,
      answer: input.answer,
      errorCode: input.errorCode,
      sources: input.sources,
      usage,
      estimatedCostUsd: costComplete ? knownCostUsd : null,
      knownCostUsd,
      usageComplete,
      costComplete,
      winner: input.winner,
      latencyMs: elapsedMilliseconds(input.startedAt, input.completedAt),
      completedAt: input.completedAt,
    });
    if (input.contextTerminal) {
      await persistContextTerminalManifest(input.client, {
        interactionTurnId: input.turn.turnId,
        conversationId: input.turn.conversationId,
        contextScopeId: input.contextTerminal.contextScopeId,
        resolved: input.contextTerminal.resolved,
        manifest: input.contextTerminal.manifest,
      });
    }

    if (input.turn.createdConversation && !input.contextTerminal) {
      await input.client.query(
        `DELETE FROM conversations AS conversation
          WHERE conversation.id = $1
            AND NOT EXISTS (
              SELECT 1 FROM conversation_messages AS message
               WHERE message.conversation_id = conversation.id
            )`,
        [input.turn.conversationId],
      );
    }
    await input.client.query('COMMIT');
    return 'expected_terminal';
  } catch (error) {
    await input.client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export function aggregateProviderAttempts(attempts: ProviderAttempt[]): {
  usage: TokenUsage | null;
  knownCostUsd: number | null;
  usageComplete: boolean;
  costComplete: boolean;
} {
  let hasUsage = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let knownCostUsd: number | null = null;
  for (const attempt of attempts) {
    if (attempt.usage) {
      hasUsage = true;
      inputTokens += attempt.usage.inputTokens;
      outputTokens += attempt.usage.outputTokens;
    }
    if (attempt.knownCostUsd !== null) {
      knownCostUsd = (knownCostUsd ?? 0) + attempt.knownCostUsd;
    }
  }
  return {
    usage: hasUsage ? { inputTokens, outputTokens } : null,
    knownCostUsd,
    usageComplete: attempts.length > 0 && attempts.every((attempt) => attempt.usageComplete),
    costComplete: attempts.length > 0 && attempts.every((attempt) => attempt.costComplete),
  };
}

export async function compensateTurn(input: CompensationInput): Promise<boolean> {
  try {
    const result = await compensateTurnOnce(input);
    return result !== 'other_terminal';
  } catch {
    const recoveryClient = await input.pool.connect().catch(() => null);
    if (!recoveryClient) return false;
    let destroyRecoveryClient = false;
    try {
      const result = await compensateTurnOnce({ ...input, client: recoveryClient });
      return result !== 'other_terminal';
    } catch {
      destroyRecoveryClient = true;
      return false;
    } finally {
      recoveryClient.release(destroyRecoveryClient);
    }
  }
}
