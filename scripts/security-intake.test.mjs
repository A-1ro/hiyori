import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SOURCES, actionInventory, collectSources, parseFeed,
  relevantActionAdvisories, securityReleases } from './security-intake.mjs';

function feed(origin, extra = '') {
  return `<?xml version="1.0"?><rss><channel><item>
    <title><![CDATA[Security & runtime update]]></title>
    <link>${origin}/security</link><pubDate>Wed, 21 Oct 2026 22:00:00 GMT</pubDate>
    ${extra}</item></channel></rss>`;
}

test('RSS and Atom are parsed as data, with stable keys and UTC timestamps', () => {
  const rss = parseFeed(feed('https://nodejs.org'), 'https://nodejs.org/en/feed/blog.xml');
  assert.equal(rss[0].title, 'Security & runtime update');
  assert.equal(rss[0].published_at, '2026-10-21T22:00:00.000Z');
  const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <title>Security &amp; runtime update</title><link href="/security"/>
    <updated>2026-10-21T22:00:00Z</updated></entry></feed>`, 'https://nodejs.org/feed');
  assert.deepEqual(atom, rss);
});

test('invalid, empty, entity-bearing, redirected-origin and incomplete feeds fail closed', () => {
  for (const xml of ['<rss>', '<html>denied</html>', '<rss><channel/></rss>',
    '<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///etc/passwd">]><rss/>',
    feed('http://nodejs.org'), feed('https://untrusted.example'),
    feed('https://nodejs.org').replace('<pubDate>', '<missing>').replace('</pubDate>', '</missing>'),
    feed('https://nodejs.org').replace('Wed, 21 Oct 2026 22:00:00 GMT', 'not-a-date')]) {
    assert.throws(() => parseFeed(xml, 'https://nodejs.org/feed'));
  }
});

test('latest security release per major is selected by date, not input order', () => {
  const releases = [
    { version: 'v24.22.0', date: '2026-10-14', security: false, lts: 'Krypton' },
    { version: 'v22.23.3', date: '2026-09-23', security: true, lts: 'Jod' },
    { version: 'v24.22.1', date: '2026-10-21', security: true, lts: 'Krypton' },
    { version: 'v22.23.4', date: '2026-10-21', security: true, lts: 'Jod' },
  ];
  assert.deepEqual(securityReleases(JSON.stringify(releases)).map(item => item.version),
    ['v22.23.4', 'v24.22.1']);
  for (const raw of ['{}', '[]', '[{"version":"v24.0.0"}]',
    JSON.stringify([{ ...releases[0], security: 'true' }])]) {
    assert.throws(() => securityReleases(raw));
  }
});

test('official prereleases do not prevent collection of stable security releases', () => {
  const releases = [
    { version: 'v27.0.0-alpha.0.0.0', date: '2026-10-29', security: false, lts: false },
    { version: 'v26.13.0', date: '2026-10-28', security: false, lts: 'Lithium' },
    { version: 'v24.22.1', date: '2026-10-21', security: true, lts: 'Krypton' },
    { version: 'v26.12.1', date: '2026-10-21', security: true, lts: false },
  ];
  assert.deepEqual(securityReleases(JSON.stringify(releases)), [
    { version: 'v24.22.1', date: '2026-10-21', lts: 'Krypton' },
    { version: 'v26.12.1', date: '2026-10-21', lts: false },
  ]);
});

test('malformed prereleases and invalid prerelease metadata still fail closed', () => {
  const stable = { version: 'v24.22.1', date: '2026-10-21', security: true, lts: 'Krypton' };
  const alpha = { version: 'v27.0.0-alpha.0.0.0', date: '2026-10-29', security: false, lts: false };
  for (const version of ['v27.0.0-', 'v27.0.0-alpha..0', 'v27.0.0-alpha/0', 'v27.0.0-alpha_0']) {
    assert.throws(() => securityReleases(JSON.stringify([stable, { ...alpha, version }])));
  }
  for (const entry of [{ ...alpha, security: 'false' }, { ...alpha, date: 'not-a-date' }]) {
    assert.throws(() => securityReleases(JSON.stringify([stable, entry])));
  }
  assert.throws(() => securityReleases(JSON.stringify([alpha])));
});

test('a prerelease marked as a security release is retained', () => {
  const release = { version: 'v27.0.0-rc.1', date: '2026-10-29', security: true, lts: false };
  assert.deepEqual(securityReleases(JSON.stringify([release])), [
    { version: release.version, date: release.date, lts: false },
  ]);
});

test('Action subpaths map to repository identities; all API pages and only matching advisories are used', () => {
  const actions = actionInventory([`steps:
  - uses: actions/checkout@abc123
  - uses: "github/codeql-action/init@def456"
  - uses: github/codeql-action/analyze@def456
  - uses: ./local-action
  - uses: docker://alpine:3`]);
  assert.deepEqual(actions, ['actions/checkout@abc123', 'github/codeql-action@def456']);
  const advisory = (name, withdrawn = null) => ({ ghsa_id: name,
    withdrawn_at: withdrawn, vulnerabilities: [{ package: { ecosystem: 'actions', name } }] });
  const pages = [[advisory('unrelated/tool')], [advisory('actions/checkout'),
    advisory('github/codeql-action'), advisory('actions/checkout', '2026-10-20')]];
  assert.deepEqual(relevantActionAdvisories(pages, actions).map(item => item.ghsa_id),
    ['actions/checkout', 'github/codeql-action']);
  assert.throws(() => relevantActionAdvisories({}, actions));
  assert.throws(() => relevantActionAdvisories([[{}]], actions));
});

test('one denied source does not suppress other results and never becomes a clean scan', async () => {
  const fetched = [];
  const records = await collectSources({ actions: [],
    fetch: url => {
      fetched.push(url);
      if (new URL(url).hostname === 'blog.cloudflare.com') throw new Error('denied');
      if (url.endsWith('index.json')) return JSON.stringify([
        { version: 'v24.22.1', date: '2026-10-21', security: true, lts: 'Krypton' },
      ]);
      return feed(new URL(url).origin);
    },
    github: () => { throw new Error('API access denied'); },
  });
  assert.deepEqual(fetched, SOURCES.map(source => source.url));
  assert.deepEqual(records.map(record => record.state),
    ['complete', 'complete', 'incomplete', 'complete', 'incomplete']);
  assert.ok(records.every(record => !JSON.stringify(record).includes('API access denied')));
});

test('GitHub JSON Lines are collected through paginated gh without requiring --slurp', async () => {
  const advisory = { ghsa_id: 'GHSA-test-1234-5678', withdrawn_at: null,
    vulnerabilities: [{ package: { ecosystem: 'actions', name: 'actions/checkout' } }] };
  const records = await collectSources({ actions: ['actions/checkout@abcdef'],
    fetch: url => url.endsWith('index.json') ? JSON.stringify([
      { version: 'v24.22.1', date: '2026-10-21', security: true, lts: 'Krypton' },
    ]) : feed(new URL(url).origin),
    github: (binary, args) => {
      assert.equal(binary, 'gh');
      assert.ok(args.includes('--paginate'));
      assert.ok(!args.includes('--slurp'));
      return `${JSON.stringify(advisory)}\n`;
    },
  });
  assert.ok(records.every(record => record.state === 'complete'));
  assert.equal(records.at(-1).entries[0].ghsa_id, advisory.ghsa_id);
});
