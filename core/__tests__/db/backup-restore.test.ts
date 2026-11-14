import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BackupService } from '../../../scripts/backup-service';

describe('Database Backup & Restore Verification Service', () => {
  let tempDir: string;
  let backupService: BackupService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsa_backup_test_'));
    backupService = new BackupService(tempDir, 7);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('computes and verifies file checksums correctly', () => {
    const testFile = path.join(tempDir, 'test_backup.sql');
    fs.writeFileSync(testFile, 'SELECT 1; INSERT INTO users VALUES (1);', 'utf8');

    const checksum = backupService.computeChecksum(testFile);
    expect(checksum).toBeDefined();
    expect(checksum.length).toBe(64); // SHA-256 hex length

    expect(backupService.verifyChecksum(testFile, checksum)).toBe(true);
    expect(backupService.verifyChecksum(testFile, 'invalid_checksum')).toBe(false);
  });

  it('detects tampering when archive content changes', () => {
    const testFile = path.join(tempDir, 'tamper_backup.sql');
    fs.writeFileSync(testFile, 'ORIGINAL CONTENT', 'utf8');

    const originalChecksum = backupService.computeChecksum(testFile);

    // Tamper with file
    fs.writeFileSync(testFile, 'MODIFIED / TAMPERED CONTENT', 'utf8');

    expect(backupService.verifyChecksum(testFile, originalChecksum)).toBe(false);
  });

  it('creates and lists backup manifests in chronological order', () => {
    const file1 = path.join(tempDir, 'backup_1.sql');
    const file2 = path.join(tempDir, 'backup_2.sql');
    fs.writeFileSync(file1, 'DATA 1', 'utf8');
    fs.writeFileSync(file2, 'DATA 2', 'utf8');

    const manifest1 = backupService.createManifest({
      fileName: 'backup_1.sql',
      filePath: file1,
      database: 'dsa_portal',
      schemaVersion: '001',
      tableCounts: { users: 10 },
      timestamp: new Date(Date.now() - 5000).toISOString(),
    });

    const manifest2 = backupService.createManifest({
      fileName: 'backup_2.sql',
      filePath: file2,
      database: 'dsa_portal',
      schemaVersion: '002',
      tableCounts: { users: 20 },
      timestamp: new Date().toISOString(),
    });

    expect(manifest1.fileSizeBytes).toBe(6);
    expect(manifest2.fileSizeBytes).toBe(6);

    const list = backupService.listBackups();
    expect(list.length).toBe(2);
    expect(list[0].fileName).toBe('backup_2.sql');
    expect(list[1].fileName).toBe('backup_1.sql');
  });

  it('prunes expired backups exceeding retention days', () => {
    const oldFile = path.join(tempDir, 'old_backup.sql');
    fs.writeFileSync(oldFile, 'OLD DATA', 'utf8');

    const oldManifest = backupService.createManifest({
      fileName: 'old_backup.sql',
      filePath: oldFile,
      database: 'dsa_portal',
      schemaVersion: '001',
      tableCounts: {},
    });

    // Manually backdate the manifest timestamp to 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    oldManifest.timestamp = tenDaysAgo;
    fs.writeFileSync(
      path.join(tempDir, 'old_backup.sql.manifest.json'),
      JSON.stringify(oldManifest, null, 2),
      'utf8'
    );

    const freshFile = path.join(tempDir, 'fresh_backup.sql');
    fs.writeFileSync(freshFile, 'FRESH DATA', 'utf8');
    backupService.createManifest({
      fileName: 'fresh_backup.sql',
      filePath: freshFile,
      database: 'dsa_portal',
      schemaVersion: '003',
      tableCounts: {},
    });

    const pruned = backupService.pruneOldBackups();
    expect(pruned).toContain('old_backup.sql');
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);

    const remaining = backupService.listBackups();
    expect(remaining.length).toBe(1);
    expect(remaining[0].fileName).toBe('fresh_backup.sql');
  });
});
