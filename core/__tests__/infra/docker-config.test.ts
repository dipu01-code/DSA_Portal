import * as fs from 'fs';
import * as path from 'path';

describe('Production Docker & Infrastructure Configuration', () => {
  const rootDir = path.resolve(__dirname, '../../../');
  const infraDir = path.join(rootDir, 'infra');

  it('validates dev docker-compose.yml exists and contains expected services', () => {
    const composePath = path.join(infraDir, 'docker-compose.yml');
    expect(fs.existsSync(composePath)).toBe(true);
    const content = fs.readFileSync(composePath, 'utf8');
    expect(content).toContain('dsa_portal_postgres');
    expect(content).toContain('dsa_portal_redis');
  });

  it('validates production docker-compose.prod.yml structure and services', () => {
    const prodComposePath = path.join(infraDir, 'docker-compose.prod.yml');
    expect(fs.existsSync(prodComposePath)).toBe(true);
    const content = fs.readFileSync(prodComposePath, 'utf8');

    // Services check
    expect(content).toContain('postgres:');
    expect(content).toContain('redis:');
    expect(content).toContain('server:');
    expect(content).toContain('workers:');
    expect(content).toContain('nginx:');

    // Healthchecks check
    expect(content).toContain('healthcheck:');
    expect(content).toContain('pg_isready');
    expect(content).toContain('redis-cli');

    // Network isolation check
    expect(content).toContain('dsa_internal:');
    expect(content).toContain('dsa_public:');
    expect(content).toContain('internal: true');
  });

  it('validates nginx reverse proxy configuration', () => {
    const nginxPath = path.join(infraDir, 'nginx', 'nginx.conf');
    expect(fs.existsSync(nginxPath)).toBe(true);
    const content = fs.readFileSync(nginxPath, 'utf8');

    expect(content).toContain('upstream api_backend');
    expect(content).toContain('limit_req_zone');
    expect(content).toContain('/socket.io/');
    expect(content).toContain('/health');
    expect(content).toContain('/api/');
  });

  it('validates multi-stage Dockerfiles exist', () => {
    const serverDockerfile = path.join(infraDir, 'docker', 'Dockerfile.server');
    const workerDockerfile = path.join(infraDir, 'docker', 'Dockerfile.worker');

    expect(fs.existsSync(serverDockerfile)).toBe(true);
    expect(fs.existsSync(workerDockerfile)).toBe(true);

    const serverContent = fs.readFileSync(serverDockerfile, 'utf8');
    expect(serverContent).toContain('FROM node:20-alpine AS base');
    expect(serverContent).toContain('FROM base AS builder');
    expect(serverContent).toContain('FROM base AS runner');
    expect(serverContent).toContain('USER node');
  });
});
