import * as fs from 'fs';
import * as path from 'path';
import { validateProblem, type Problem } from '@dsa-portal/core';
import { PostgresProblemRepository } from './repositories/problem.repository';
import { closePool } from './pool';

const CANDIDATE_DIRS = [
  path.resolve(__dirname, '../../../core/problems'),
  path.resolve(__dirname, '../../../cli/problems'),
];

export async function importLegacyProblems(): Promise<{ imported: string[]; skipped: string[] }> {
  console.log('[Legacy Importer] Scanning for original CLI problem definitions...');
  const problemRepo = new PostgresProblemRepository();

  const imported: string[] = [];
  const skipped: string[] = [];
  const seenIds = new Set<string>();

  for (const dir of CANDIDATE_DIRS) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    console.log(`[Legacy Importer] Inspecting directory: ${dir}`);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const validated: Problem = validateProblem(parsed);

        if (seenIds.has(validated.id)) {
          skipped.push(validated.id);
          continue;
        }

        console.log(
          `[Legacy Importer] Ingesting legacy problem: ${validated.title} (${validated.id})`
        );
        await problemRepo.save(validated);
        seenIds.add(validated.id);
        imported.push(validated.id);
      } catch (err) {
        console.warn(`[Legacy Importer] Skipping invalid JSON problem in ${file}:`, err);
        skipped.push(file);
      }
    }
  }

  console.log(
    `[Legacy Importer] Import complete. Imported: ${imported.length}, Skipped: ${skipped.length}`
  );
  return { imported, skipped };
}

if (require.main === module) {
  importLegacyProblems()
    .then((result) => {
      console.log('Legacy import summary:', result);
      return closePool().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error('Legacy import failed:', err);
      return closePool().then(() => process.exit(1));
    });
}
