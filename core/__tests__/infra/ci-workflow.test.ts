import * as fs from 'fs';
import * as path from 'path';

describe('GitHub Actions CI Configuration', () => {
  const rootDir = path.resolve(__dirname, '../../../');
  const ciWorkflowPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');

  it('validates ci.yml exists', () => {
    expect(fs.existsSync(ciWorkflowPath)).toBe(true);
  });

  it('validates ci.yml contains quality, test, and docker jobs', () => {
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    // Trigger branches
    expect(content).toContain('main');
    expect(content).toContain("'person-*/**'");

    // Jobs
    expect(content).toContain('quality:');
    expect(content).toContain('test:');
    expect(content).toContain('docker-build:');

    // Quality job steps
    expect(content).toContain('npm run lint');
    expect(content).toContain('npm run format');
    expect(content).toContain('npm run build'); // typecheck step builds core → server → workers

    // Services in test job
    expect(content).toContain('postgres:16-alpine');
    expect(content).toContain('redis:7-alpine');

    // Migration and test steps
    expect(content).toContain('npm run db:migrate');
    expect(content).toContain('npm test');

    // Docker verification
    expect(content).toContain('infra/docker/Dockerfile.server');
    expect(content).toContain('infra/docker/Dockerfile.worker');
  });
});
