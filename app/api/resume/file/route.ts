import { NextRequest, NextResponse } from 'next/server.js';

import {
  ResumeAccessError,
  authenticateResumeSession,
  recordResumeFileReturned,
} from '../../../../lib/server/resume-access.ts';
import { loadResumeConfig } from '../../../../lib/server/resume-config.ts';
import { getPool } from '../../../../lib/server/db.ts';
import {
  RESUME_NO_STORE_HEADERS,
  resumeNotAvailable,
  resumeRequestContext,
  resumeUnauthorized,
  resumeUnavailable,
} from '../../../../lib/server/resume-http.ts';
import {
  getCurrentResumeDocument,
  readResumePdf,
} from '../../../../lib/server/resume-storage.ts';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const config = loadResumeConfig();
    if (!config.enabled) return resumeNotAvailable();
    const token = request.cookies.get(config.cookieName)?.value ?? '';
    const pool = getPool(config.databaseUrl);
    const session = await authenticateResumeSession(pool, token);
    if (!session) return resumeUnauthorized();
    const document = await getCurrentResumeDocument(pool);
    if (!document) return resumeNotAvailable();
    const pdf = await readResumePdf({
      document,
      storageDir: config.storageDir,
      key: config.encryptionKey,
      expectedKeyVersion: config.keyVersion,
    });
    try {
      await recordResumeFileReturned(pool, session, resumeRequestContext(request, config));
    } catch (error) {
      if (error instanceof ResumeAccessError) return resumeUnauthorized();
      throw error;
    }
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        ...RESUME_NO_STORE_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': 'inline; filename="Morse-Resume.pdf"',
      },
    });
  } catch {
    return resumeUnavailable();
  }
}
