import { loadAccessConfig } from '@/lib/server/config';
import { getPool } from '@/lib/server/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const config = loadAccessConfig();
    const result = await getPool(config.databaseUrl).query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM knowledge_chunks',
    );
    return Response.json({
      ok: true,
      database: 'ready',
      indexedChunks: Number(result.rows[0]?.count ?? 0),
      provider: {
        configured: Boolean(
          process.env.OPENAI_API_KEY
          && process.env.OPENAI_CHAT_MODEL
          && process.env.OPENAI_EMBEDDING_MODEL
          && process.env.MORSE_INPUT_USD_PER_MILLION
          && process.env.MORSE_OUTPUT_USD_PER_MILLION
        ),
      },
    });
  } catch {
    return Response.json({ ok: false, database: 'unavailable', indexedChunks: 0 }, { status: 503 });
  }
}
