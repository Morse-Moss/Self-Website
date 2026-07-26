export function scanExtractedRoot(
  root: string,
  options?: { secretCanaries?: string[] },
): Promise<{ filesScanned: number }>;
