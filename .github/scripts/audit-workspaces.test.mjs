import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const scanner = join(dirname(fileURLToPath(import.meta.url)), 'audit-workspaces.rb');

function fixture(realDependency) {
  const real = realDependency ? '\n      cli: 0.1.0' : '';
  return `lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
importers:
  .:
    dependencies:
      runtime-helper: {specifier: 1.0.0, version: 1.0.0}
  cli:
    devDependencies:
      build-helper: {specifier: 1.0.0, version: 1.0.0}
    optionalDependencies:
      optional-helper: {specifier: 1.0.0, version: 1.0.0}
packages:
  runtime-helper@1.0.0: {resolution: {integrity: sha512-Zg==}}
  build-helper@1.0.0: {resolution: {integrity: sha512-Zg==}}
  optional-helper@1.0.0: {resolution: {integrity: sha512-Zg==}}
${realDependency ? '  cli@0.1.0: {resolution: {integrity: sha512-Zg==}}\n' : ''}snapshots:
  runtime-helper@1.0.0: {}
  build-helper@1.0.0:
    dependencies:
      optional-helper: 1.0.0${real}
  optional-helper@1.0.0: {}
${realDependency ? '  cli@0.1.0: {}\n' : ''}`;
}

function containsCli(node) {
  return Object.entries(node.dependencies ?? {}).some(([name, dependency]) =>
    (name === 'cli' && dependency.version === '0.1.0') || containsCli(dependency));
}

function command(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('ruby', args, { env, timeout: 20000 });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => { resolve({ code, output }); });
  });
}

async function check(realDependency, malformed = false) {
  const directory = await mkdtemp(join(tmpdir(), 'audit-regression-'));
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(payload);
    const vulnerable = containsCli(payload);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(malformed ? { error: 'mock registry error' } : {
      actions: [],
      advisories: vulnerable ? {
        95: { id: 95, module_name: 'cli', severity: 'low', title: 'cli regression fixture',
          url: 'https://github.com/advisories/GHSA-6cpc-mj5c-m9rq',
          findings: [{ version: '0.1.0', paths: ['.>build-helper>cli'] }] },
      } : {},
      metadata: { vulnerabilities: { info: 0, low: vulnerable ? 1 : 0,
        moderate: 0, high: 0, critical: 0 } },
    }));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const original = fixture(realDependency);
    await writeFile(join(directory, 'pnpm-lock.yaml'), original);
    await writeFile(join(directory, 'empty.npmrc'), '');
    const result = await command([scanner, directory], {
      ...process.env,
      RUNNER_TEMP: directory,
      GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
      AUDIT_REGISTRY: `http://127.0.0.1:${server.address().port}`,
      npm_config_userconfig: join(directory, 'empty.npmrc'),
      npm_config_globalconfig: join(directory, 'empty.npmrc'),
    });
    assert.equal(await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8'), original);
    assert.equal(requests.length, 2, result.output);
    for (const request of requests) {
      assert.deepEqual(Object.keys(request.dependencies), ['.']);
      assert.equal(request.dependencies['.'].version, '0.0.0');
    }
    // Each importer is still audited, including runtime, dev and optional edges.
    assert.ok(requests[0].dependencies['.'].dependencies['runtime-helper']);
    assert.ok(requests[1].dependencies['.'].dependencies['build-helper']);
    assert.ok(requests[1].dependencies['.'].dependencies['optional-helper']);
    return { ...result, requests };
  } finally {
    await new Promise(resolve => { server.close(resolve); });
    await rm(directory, { recursive: true, force: true });
  }
}

test('synthetic cli workspace is not sent as a cli registry dependency', async () => {
  const result = await check(false);
  assert.equal(result.code, 0, result.output);
  assert.ok(result.requests.every(request => !containsCli(request)));
});

test('an actual transitive cli@0.1.0 remains audited and fails on the same advisory', async () => {
  const result = await check(true);
  assert.equal(result.code, 1, result.output);
  assert.ok(containsCli(result.requests[1]));
  assert.match(result.output, /Dependency vulnerabilities detected/);
  assert.match(result.output, /GHSA-6cpc-mj5c-m9rq/);
});

test('registry error reports fail closed while still auditing both importers', async () => {
  const result = await check(false, true);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Dependency audit could not complete/);
});

test('ambiguous YAML keys fail closed instead of dropping a dependency name', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'audit-yaml-regression-'));
  try {
    await writeFile(join(directory, 'pnpm-lock.yaml'), fixture(false).replaceAll('runtime-helper:', 'on:'));
    const result = await command([scanner, directory], process.env);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Dependency audit could not complete/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
