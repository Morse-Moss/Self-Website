import { readinessResponse } from '@/lib/server/readiness';

export const runtime = 'nodejs';

export async function GET() {
  return readinessResponse();
}
