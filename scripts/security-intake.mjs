import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCES = [
  { id: 'node-blog', url: 'https://nodejs.org/en/feed/blog.xml', kind: 'feed' },
  { id: 'node-releases', url: 'https://nodejs.org/dist/index.json', kind: 'releases' },
  { id: 'cloudflare-blog', url: 'https://blog.cloudflare.com/rss/', kind: 'feed' },
  { id: 'cloudflare-changelog', url: 'https://developers.cloudflare.com/changelog/rss/index.xml', kind: 'feed' },
];

// ElementTree validates XML rather than guessing at RSS/Atom with regular expressions.
// No network or external entities are allowed while parsing a downloaded feed.
const feedParser = `
import json, sys, xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlparse
xml = sys.stdin.read()
if '<!DOCTYPE' in xml.upper() or '<!ENTITY' in xml.upper():
    raise ValueError('XML declarations are unsupported')
root = ET.fromstring(xml)
local = lambda tag: tag.rsplit('}', 1)[-1]
if local(root.tag) not in ('rss', 'feed'):
    raise ValueError('Expected RSS or Atom')
entries = []
for item in root.iter():
    if local(item.tag) not in ('item', 'entry'):
        continue
    fields = {}
    for child in item:
        name = local(child.tag)
        if name == 'link' and child.attrib.get('rel', 'alternate') == 'alternate':
            fields['link'] = child.attrib.get('href') or child.text
        elif name in ('title', 'pubDate', 'published', 'updated'):
            fields[name] = ''.join(child.itertext())
    title = fields.get('title', '').strip()
    link = urljoin(sys.argv[1], (fields.get('link') or '').strip())
    url = urlparse(link)
    published = fields.get('pubDate') or fields.get('published') or fields.get('updated')
    if not title or not fields.get('link') or not published:
        raise ValueError('Incomplete feed entry')
    if url.scheme != 'https' or url.hostname != urlparse(sys.argv[1]).hostname or url.username or url.password:
        raise ValueError('Unexpected article origin')
    entries.append(dict(title=title, url=link, published_at=published))
if not entries:
    raise ValueError('Empty feed is not evidence of no advisories')
print(json.dumps(entries))
`;

export function parseFeed(xml, origin) {
  if (Buffer.byteLength(xml) > 16 * 1024 * 1024) throw new Error('Feed exceeds size limit');
  const entries = JSON.parse(execFileSync('python3', ['-c', feedParser, origin], {
    input: xml, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }));
  return entries.map(entry => {
    const date = new Date(entry.published_at);
    if (Number.isNaN(date.valueOf())) throw new Error('Invalid feed timestamp');
    return { ...entry, published_at: date.toISOString(),
      key: createHash('sha256').update(entry.url).digest('hex').slice(0, 16) };
  });
}

export function securityReleases(raw) {
  const releases = JSON.parse(raw);
  if (!Array.isArray(releases) || releases.length === 0) throw new Error('Missing Node release data');
  const latest = new Map();
  for (const release of releases) {
    // The official index also lists prereleases; security flags still decide relevance.
    if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(release.version) ||
        Number.isNaN(Date.parse(release.date)) || typeof release.security !== 'boolean') {
      throw new Error('Unsupported Node release data');
    }
    if (!release.security) continue;
    const major = release.version.split('.')[0];
    const previous = latest.get(major);
    if (!previous || Date.parse(previous.date) < Date.parse(release.date)) {
      latest.set(major, { version: release.version, date: release.date, lts: release.lts });
    }
  }
  if (latest.size === 0) throw new Error('No Node security release metadata');
  return [...latest.values()];
}

export function actionInventory(workflows) {
  return [...new Set(workflows.flatMap(text => [...text.matchAll(
    /^\s*(?:-\s*)?uses:\s*["']?([\w.-]+\/[\w.-]+)(?:\/[\w./-]+)?@([^\s"'#]+)/gm,
  )].map(match => `${match[1]}@${match[2]}`)))].sort();
}

export function relevantActionAdvisories(pages, actions) {
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(Array.isArray)) {
    throw new Error('Unsupported paginated GitHub advisory response');
  }
  const names = new Set(actions.map(action => action.split('@')[0].toLowerCase()));
  return pages.flat().filter(advisory => {
    if (!advisory.ghsa_id || !Array.isArray(advisory.vulnerabilities)) {
      throw new Error('Incomplete GitHub advisory');
    }
    return !advisory.withdrawn_at && advisory.vulnerabilities.some(vulnerability =>
      vulnerability.package?.ecosystem === 'actions' &&
      names.has(vulnerability.package.name?.toLowerCase()));
  });
}

function fetchText(url) {
  // curl preserves inherited HTTPS proxy/CA trust. Refuse redirects, errors and oversize bodies.
  const output = execFileSync('curl', ['--silent', '--show-error', '--fail',
    '--max-time', '40', '--max-filesize', '16777216', '--proto', '=https',
    '--write-out', '\n%{http_code}', url],
  { encoding: 'utf8', timeout: 45000, maxBuffer: 17 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
  if (!output.endsWith('\n200')) throw new Error('Expected HTTP 200 without redirects');
  return output.slice(0, -4);
}

function command(binary, args, options = {}) {
  return execFileSync(binary, args, { encoding: 'utf8', timeout: 120000,
    maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

export async function collectSources({ fetch = fetchText, actions, github = command }) {
  const records = [];
  for (const source of SOURCES) {
    try {
      const raw = await fetch(source.url);
      records.push({ id: source.id, url: source.url, state: 'complete',
        sha256: createHash('sha256').update(raw).digest('hex'),
        entries: source.kind === 'feed' ? parseFeed(raw, source.url) : securityReleases(raw) });
    } catch {
      records.push({ id: source.id, url: source.url, state: 'incomplete',
        error: 'Fetch or validation failed. Check access and the official source; do not infer no findings.' });
    }
  }
  try {
    // JSON Lines works on older gh versions that lack --slurp. --paginate
    // still retrieves every page; gh applies the query to each response.
    const lines = github('gh', ['api', '--paginate',
      '/advisories?ecosystem=actions&per_page=100', '--jq', '.[] | @json']).trim();
    const pages = [lines ? lines.split('\n').map(line => JSON.parse(line)) : []];
    records.push({ id: 'github-actions-advisories', state: 'complete',
      entries: relevantActionAdvisories(pages, actions) });
  } catch {
    records.push({ id: 'github-actions-advisories', state: 'incomplete',
      error: 'GitHub advisory API could not be read or validated.' });
  }
  return records;
}

async function collect(root) {
  const { readdir } = await import('node:fs/promises');
  const paths = ['package.json', 'cli/package.json'];
  const manifests = await Promise.all(paths.map(async path =>
    ({ path, manifest: JSON.parse(await readFile(join(root, path), 'utf8')) })));
  const workflows = (await readdir(join(root, '.github/workflows')))
    .filter(name => /\.ya?ml$/.test(name));
  const actions = actionInventory(await Promise.all(workflows.map(name =>
    readFile(join(root, '.github/workflows', name), 'utf8'))));
  const lockfile = await readFile(join(root, 'pnpm-lock.yaml'));
  const report = {
    schema_version: 1, generated_at: new Date().toISOString(),
    repository: 'A-1ro/hiyori', revision: command('git', ['rev-parse', 'HEAD'], { cwd: root }).trim(),
    lockfile_sha256: createHash('sha256').update(lockfile).digest('hex'),
    inventory: { node: process.version, manifests, actions },
    coverage: 'npm audits every locked importer, including dev/optional; Actions advisories are filtered by action identity. Official feeds contain only entries supplied by upstream, not a complete historical archive. Article relevance and fixed versions require agent review.',
    sources: [],
  };
  const temporary = await mkdtemp(join(tmpdir(), 'hiyori-security-'));
  try {
    const auditPath = join(temporary, 'audit.json');
    try {
      let exitCode = 0;
      const auditEnv = { ...process.env, AUDIT_REPORT_PATH: auditPath,
        AUDIT_REGISTRY: 'https://registry.npmjs.org' };
      delete auditEnv.GITHUB_STEP_SUMMARY;
      try {
        command('ruby', ['.github/scripts/audit-workspaces.rb'], {
          cwd: root, env: auditEnv,
        });
      } catch (error) { exitCode = error.status; }
      const audit = JSON.parse(await readFile(auditPath, 'utf8'));
      if (![0, 1].includes(exitCode) || audit.schema_version !== 1 ||
          !audit.complete || !Array.isArray(audit.workspaces) || audit.workspaces.length === 0) {
        throw new Error('Incomplete workspace audit');
      }
      report.sources.push({ id: 'npm-audit', state: 'complete', ...audit });
    } catch {
      report.sources.push({ id: 'npm-audit', state: 'incomplete',
        error: 'Workspace audit unavailable or incomplete. Requires Ruby and pinned pnpm.' });
    }
    report.sources.push(...await collectSources({ actions }));
    report.complete = report.sources.every(source => source.state === 'complete');
    return report;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') {
    throw new Error('Usage: node scripts/security-intake.mjs --output /tmp/new-report.json');
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const report = await collect(root);
  await writeFile(resolve(args[1]), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ complete: report.complete,
    sources: report.sources.map(({ id, state }) => ({ id, state })) }, null, 2));
  process.exitCode = report.complete ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Security intake failed. Use a new output path; check prerequisites and source access.');
    process.exitCode = 2;
  });
}
