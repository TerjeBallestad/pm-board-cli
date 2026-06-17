import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve('bin/pm');

function setupProject() {
  const dir = mkdtempSync(join(tmpdir(), 'pm-cli-'));
  writeFileSync(join(dir, 'pm.config.json'), JSON.stringify({ name: 'CLI Test', port: 0, dataDir: 'data' }));
  mkdirSync(join(dir, 'data', 'items'), { recursive: true });
  mkdirSync(join(dir, 'data', 'plans'), { recursive: true });
  mkdirSync(join(dir, 'data', 'designs'), { recursive: true });
  mkdirSync(join(dir, 'data', 'sprints'), { recursive: true });
  return {
    dir,
    cleanup() { rmSync(dir, { recursive: true, force: true }); }
  };
}

function runPm(dir, args, env = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: dir,
      env: { ...process.env, ...env }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolveRun({ status: null, stdout, stderr: stderr + '\nTimed out' });
    }, 5000);
    child.on('error', rejectRun);
    child.on('close', code => {
      clearTimeout(timer);
      resolveRun({ status: code, stdout, stderr });
    });
  });
}

function withJsonServer(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, body });
      const response = handler(req, body);
      const encoded = Buffer.from(JSON.stringify(response.body));
      res.writeHead(response.status || 200, {
        'Content-Type': 'application/json',
        'Connection': 'close',
        'Content-Length': encoded.length
      });
      res.end(encoded);
    });
  });
  return new Promise((resolveServer, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveServer({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise(resolveClose => {
          server.closeAllConnections();
          server.close(resolveClose);
        })
      });
    });
    server.on('error', reject);
  });
}

test('boolean flags do not consume following positionals', async (t) => {
  const { dir, cleanup } = setupProject();
  t.after(cleanup);
  writeFileSync(join(dir, 'data', 'plans', 'PLAN-001.json'), JSON.stringify({
    id: 'PLAN-001',
    title: 'One plan',
    stage: 'planned',
    tasks: []
  }));

  const res = await runPm(dir, ['list', '--json', 'plan']);
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'PLAN-001');
});

test('--server URL targets that URL, not the local config port', async (t) => {
  const { dir, cleanup } = setupProject();
  t.after(cleanup);
  const server = await withJsonServer(() => ({ body: { id: 'SB-001', title: 'remote item' } }));
  t.after(() => server.close());

  const res = await runPm(dir, ['get', 'SB-001', '--server', server.url]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].method, 'GET');
  assert.equal(server.requests[0].url, '/api/items/SB-001');
  assert.equal(JSON.parse(res.stdout).title, 'remote item');
});

test('--server <host:port> without scheme targets the remote, not local', async (t) => {
  const { dir, cleanup } = setupProject();
  t.after(cleanup);
  const server = await withJsonServer(() => ({ body: { id: 'SB-001', title: 'remote item' } }));
  t.after(() => server.close());
  // Local config points at a different (dead) port — if the scheme-less host
  // were ignored we'd hit local and fail, not reach this server.
  writeFileSync(join(dir, 'pm.config.json'), JSON.stringify({ name: 'CLI Test', port: 1, dataDir: 'data' }));
  const hostPort = server.url.replace('http://', ''); // e.g. 127.0.0.1:54321

  const res = await runPm(dir, ['get', 'SB-001', '--server', hostPort]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].url, '/api/items/SB-001');
  assert.equal(JSON.parse(res.stdout).title, 'remote item');
});

test('transport flags are not forwarded into patch bodies', async (t) => {
  const { dir, cleanup } = setupProject();
  t.after(cleanup);
  const server = await withJsonServer(() => ({ body: { ok: true } }));
  t.after(() => server.close());
  writeFileSync(join(dir, 'pm.config.json'), JSON.stringify({ name: 'CLI Test', port: Number(server.url.split(':').pop()), dataDir: 'data' }));

  const res = await runPm(dir, ['patch', 'SB-001', '--stage', 'done', '--server']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(server.requests.length, 1);
  assert.deepEqual(server.requests[0].body, { stage: 'done' });
});
