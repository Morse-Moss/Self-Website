import type { PoolClient } from 'pg';

export const DEFAULT_ALERT_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;

export interface EnqueueAlertOptions {
  dedupeKey: string;
  category: string;
  payload: Readonly<Record<string, unknown>>;
  now?: Date;
  expiresAt?: Date;
}

export async function enqueueAlert(
  client: PoolClient,
  options: EnqueueAlertOptions,
): Promise<boolean> {
  const now = options.now ?? new Date();
  const expiresAt = options.expiresAt
    ?? new Date(now.getTime() + DEFAULT_ALERT_RETENTION_MS);
  const result = await client.query(
    `INSERT INTO alert_outbox
      (dedupe_key, category, payload, available_at, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $4, $4)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      options.dedupeKey,
      options.category,
      JSON.stringify(options.payload),
      now,
      expiresAt,
    ],
  );
  return result.rowCount === 1;
}
