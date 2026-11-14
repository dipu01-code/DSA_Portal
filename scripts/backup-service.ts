import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface BackupManifest {
  id: string;
  timestamp: string;
  database: string;
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
  retentionDays: number;
  schemaVersion: string;
  tableCounts: Record<string, number>;
}

export class BackupService {
  private backupDir: string;
  private retentionDays: number;

  constructor(backupDir: string = './backups', retentionDays: number = 7) {
    this.backupDir = path.resolve(backupDir);
    this.retentionDays = retentionDays;
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  getBackupDir(): string {
    return this.backupDir;
  }

  computeChecksum(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  verifyChecksum(filePath: string, expectedChecksum: string): boolean {
    const actualChecksum = this.computeChecksum(filePath);
    return actualChecksum.toLowerCase() === expectedChecksum.toLowerCase();
  }

  createManifest(params: {
    fileName: string;
    filePath: string;
    database: string;
    schemaVersion: string;
    tableCounts: Record<string, number>;
    timestamp?: string;
  }): BackupManifest {
    const stats = fs.statSync(params.filePath);
    const checksum = this.computeChecksum(params.filePath);
    const id = `backup_${Date.now()}`;

    const manifest: BackupManifest = {
      id,
      timestamp: params.timestamp || new Date().toISOString(),
      database: params.database,
      fileName: params.fileName,
      fileSizeBytes: stats.size,
      sha256: checksum,
      retentionDays: this.retentionDays,
      schemaVersion: params.schemaVersion,
      tableCounts: params.tableCounts,
    };

    const manifestPath = path.join(this.backupDir, `${params.fileName}.manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  }

  listBackups(): BackupManifest[] {
    const files = fs.readdirSync(this.backupDir);
    const manifests: BackupManifest[] = [];

    for (const file of files) {
      if (file.endsWith('.manifest.json')) {
        try {
          const content = fs.readFileSync(path.join(this.backupDir, file), 'utf8');
          manifests.push(JSON.parse(content));
        } catch {
          // ignore corrupted manifest files
        }
      }
    }

    return manifests.sort((a, b) => {
      const diff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      return diff !== 0 ? diff : b.fileName.localeCompare(a.fileName);
    });
  }

  pruneOldBackups(): string[] {
    const now = Date.now();
    const maxAgeMs = this.retentionDays * 24 * 60 * 60 * 1000;
    const manifests = this.listBackups();
    const pruned: string[] = [];

    for (const manifest of manifests) {
      const backupTime = new Date(manifest.timestamp).getTime();
      if (now - backupTime > maxAgeMs) {
        const backupPath = path.join(this.backupDir, manifest.fileName);
        const manifestPath = path.join(this.backupDir, `${manifest.fileName}.manifest.json`);

        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);

        pruned.push(manifest.fileName);
      }
    }

    return pruned;
  }
}
