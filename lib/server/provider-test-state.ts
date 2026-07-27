import type pg from 'pg';

import type { AiProviderTestState } from './ai-config.ts';

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

interface TestStateRow {
  config_digest: string;
  eligibility: AiProviderTestState['eligibility'];
  latest_latency_ms: number | null;
  latest_result_code: string | null;
  latest_status: 'succeeded' | 'failed' | null;
  latest_tested_at: Date | null;
  success_expires_at: Date | null;
}

export async function readProviderTestStates(
  queryable: Queryable,
  digests: string[],
): Promise<Map<string, AiProviderTestState>> {
  const uniqueDigests = [...new Set(digests)];
  if (uniqueDigests.length === 0) return new Map();
  const result = await queryable.query<TestStateRow>(
    `WITH requested AS (
       SELECT unnest($1::text[]) AS config_digest
     ), database_clock AS MATERIALIZED (
       SELECT clock_timestamp() AS current_time
     )
     SELECT requested.config_digest,
            CASE
              WHEN success.created_at IS NULL THEN 'untested'
              WHEN success.created_at + interval '30 minutes' >= database_clock.current_time
                THEN 'eligible'
              ELSE 'expired'
            END AS eligibility,
            latest.latency_ms AS latest_latency_ms,
            latest.result_code AS latest_result_code,
            latest.status AS latest_status,
            latest.created_at AS latest_tested_at,
            success.created_at + interval '30 minutes' AS success_expires_at
       FROM requested
       CROSS JOIN database_clock
       LEFT JOIN LATERAL (
         SELECT event.latency_ms, event.result_code, event.status, event.created_at
           FROM ai_config_events event
          WHERE event.config_digest = requested.config_digest
            AND event.event_type IN ('provider_test', 'environment_test')
            AND event.status IN ('succeeded', 'failed')
          ORDER BY event.created_at DESC, event.id DESC
          LIMIT 1
       ) latest ON true
       LEFT JOIN LATERAL (
         SELECT event.created_at
           FROM ai_config_events event
          WHERE event.config_digest = requested.config_digest
            AND event.event_type IN ('provider_test', 'environment_test')
            AND event.status = 'succeeded'
          ORDER BY event.created_at DESC, event.id DESC
          LIMIT 1
       ) success ON true`,
    [uniqueDigests],
  );
  return new Map(result.rows.map((row) => [row.config_digest, {
    eligibility: row.eligibility,
    latestTest: row.latest_status && row.latest_result_code && row.latest_tested_at
      ? {
          latencyMs: row.latest_latency_ms,
          resultCode: row.latest_result_code,
          status: row.latest_status,
          testedAt: row.latest_tested_at.toISOString(),
        }
      : null,
    successExpiresAt: row.success_expires_at?.toISOString() ?? null,
  }]));
}
