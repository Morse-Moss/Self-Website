export function syntheticResumePdf(
  label = 'SYNTHETIC RESUME - NO PERSONAL DATA',
): Buffer {
  const safeLabel = label.replace(/[()\\]/gu, '');
  const stream = `BT /F1 12 Tf 72 720 Td (${safeLabel}) Tj ET`;
  return Buffer.from(
    '%PDF-1.4\n'
      + '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n'
      + '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n'
      + '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + '/Contents 4 0 R >> endobj\n'
      + `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n`
      + `${stream}\nendstream endobj\n%%EOF\n`,
    'ascii',
  );
}
