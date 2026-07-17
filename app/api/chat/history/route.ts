import { NextRequest } from 'next/server';

import { getChatHistoryResponse } from '@/lib/server/chat-history-route';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return getChatHistoryResponse(request);
}
