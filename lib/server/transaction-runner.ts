interface TransactionClient {
  query(sql: string): Promise<unknown>;
}

interface RunPoolTransactionInput<T> {
  client: TransactionClient;
  work: () => Promise<T>;
  recoverAfterCommit?: () => Promise<
    | { recovered: true; result: T }
    | { recovered: false }
  >;
}

export async function runPoolTransaction<T>(
  input: RunPoolTransactionInput<T>,
): Promise<T> {
  let commitAttempted = false;
  try {
    await input.client.query('BEGIN');
    const result = await input.work();
    commitAttempted = true;
    await input.client.query('COMMIT');
    return result;
  } catch (error) {
    if (commitAttempted && input.recoverAfterCommit) {
      const recovered = await input.recoverAfterCommit();
      if (recovered.recovered) return recovered.result;
    }
    await input.client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
