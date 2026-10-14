// The harness checkpoint (AGENTS.md sequencing, e2e/README.md): every route boots, the auth
// token actually reached the pages that carry one, the pitch settles at a legal eleven, and
// /api/state genuinely comes from the frozen capture rather than a live fetch. If this file is
// red, nothing built on top of it can be trusted, so it runs first and alone before any other
// spec is written.
const { readFileSync } = require('fs');
const { gunzipSync } = require('zlib');
const path = require('path');
const { test, expect } = require('../fixtures');
const { LIVE_CAPTURE } = require('../scripts/live-capture.js');

const ROUTES = ['/', '/app', '/armband-team', '/wildcard'];

// Only "/" and "/app" (both routeLanding — see cmd/armband/webroutes.go's routeFor) serve
// app.html, the one embedded document that carries the armband-token placeholder at all.
// /armband-team and /wildcard are the spectator pages, deliberately ungated — their own doc
// comments in webroutes.go say so — and team.html/wildcard.html carry no such tag to fill.
// VERIFIED against the actual assets: `grep -c armband-token` on all four page templates
// finds it only in app.html. The design this suite implements assumed all four carried one;
// they do not, and this is that correction.
const TOKEN_ROUTES = new Set(['/', '/app']);

for (const route of ROUTES) {
  test(`${route} boots`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response.status(), `${route} responded`).toBe(200);

    if (!TOKEN_ROUTES.has(route)) return;
    // The positive control for the auth-cookie fixture (§5.3 of the design this suite
    // implements): an empty token means the page rendered the unauthenticated shell, and
    // every write action in every other spec would then be silently refused. See
    // cmd/armband/webroutes.go's withToken/tokenMeta.
    const token = await page.locator('meta[name="armband-token"]').getAttribute('content');
    expect(token, `${route}'s armband-token meta tag must be non-empty, or this run is ` +
      'driving the unauthenticated shell and every write test downstream is meaningless')
      .toBeTruthy();
  });
}

test('the pitch settles at a legal eleven and the bench at four', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#pitch .card')).toHaveCount(11);
  await expect(page.locator('#benchrow .card')).toHaveCount(4);

  const formation = await page.locator('#formation').textContent();
  expect(formation.trim()).toMatch(/^\d-\d-\d$/);
});

test('GET /api/state genuinely comes from the frozen capture (determinism control)', async ({
  page,
  request,
}) => {
  // Two things prove this response came from the committed capture rather than a live
  // fetch. First, which clubs exist: decoded directly from the same bootstrap-static.json.gz
  // this suite primed the cache from. Second, the clock: serve-fixture.mjs pins the server
  // to the manifest's captured_at, so the open planning horizon starts at the manifest's own
  // event. Without that pin the server judges deadlines by the wall clock, and once every
  // gameweek in the horizon has passed its deadline the page boots with no gameweek at all —
  // this assertion names that failure instead of leaving it to surface as a page error.
  await page.goto('/');
  const res = await request.get('/api/state');
  expect(res.status()).toBe(200);
  const state = await res.json();

  const captureDir = path.resolve(__dirname, '..', '..', 'data', 'captures', LIVE_CAPTURE);
  const gz = readFileSync(path.join(captureDir, 'bootstrap-static.json.gz'));
  const boot = JSON.parse(gunzipSync(gz).toString('utf8'));
  const expectedClubs = boot.teams.map((t) => t.short_name).sort();

  expect(Array.isArray(state.clubs), 'state.clubs must be an array of club codes').toBe(true);
  expect([...state.clubs].sort()).toEqual(expectedClubs);

  const manifest = JSON.parse(readFileSync(path.join(captureDir, 'manifest.json'), 'utf8'));
  expect(state.now, 'the server clock is pinned to the capture moment')
    .toBe(manifest.captured_at);
  const current = (state.gameweeks || []).find((g) => g.current);
  expect(current && current.gw, 'the current gameweek is the capture\'s own event')
    .toBe(manifest.event);
});

test('the import card is hidden at GW1', async ({ page }) => {
  // The GW1 capture's import window is closed by construction — importWindow
  // (cmd/armband/importwindow.go) requires next.ID >= 2, and this capture's IsNext is
  // event 1. See e2e/README.md for the full list of what is unreachable under this fixture.
  await page.goto('/');
  await expect(page.locator('#importCard')).toBeHidden();
});

test('phone viewport is the real 390px, not the --dump-dom 500px floor', async ({ page }) => {
  // The positive control for browsertest's own documented trap: --dump-dom silently widens
  // a narrow window to 500px while --screenshot (and Playwright's device-metrics-driven
  // viewport) honours the exact request. Without this, a "phone" run at 500px would still
  // look mobile — every max-width:720px rule stays active — and nothing would say the
  // viewport was wrong. See internal/browsertest/browsertest.go's minDumpDOMWidth comment.
  test.skip(test.info().project.name !== 'phone', 'phone-only control');
  await page.goto('/');
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
  expect(await page.evaluate(() => matchMedia('(max-width: 720px)').matches)).toBe(true);
  expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
});
