import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface MigrationManifestEntry {
  checksum: string;
  version: string;
}

export async function readMigrationManifest(
  directory = path.resolve(process.cwd(), 'db', 'migrations'),
): Promise<MigrationManifestEntry[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const migrations = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map(async (entry) => {
      const match = /^(\d+)[_-].+\.sql$/iu.exec(entry.name);
      if (!match) throw new Error('MIGRATION_MANIFEST_INVALID');
      const bytes = await fs.readFile(path.join(directory, entry.name));
      return {
        checksum: createHash('sha256').update(bytes).digest('hex'),
        version: match[1],
      };
    }));
  migrations.sort((left, right) => {
    const leftVersion = BigInt(left.version);
    const rightVersion = BigInt(right.version);
    return leftVersion < rightVersion ? -1 : leftVersion > rightVersion ? 1 : 0;
  });
  if (migrations.length === 0 || new Set(migrations.map(({ version }) => version)).size !== migrations.length) {
    throw new Error('MIGRATION_MANIFEST_INVALID');
  }
  return migrations;
}
