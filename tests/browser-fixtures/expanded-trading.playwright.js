async page => {
  // Real compiled local UI; only API responses are intercepted. The one image
  // single retains its complete existing public source record and image URL.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  const response = await page.request.get('https://wf-ecru.vercel.app/api/canary/trading-floor?pageSize=1');
  const seedPayload = await response.json();
  const seed = seedPayload.records?.[0];
  if (!seed?.image_url || !seed?.source_hash) throw new Error('Existing source-image fixture unavailable');
  const baselineImage = seed.image_url;
  const make = (id, fields) => ({ ...seed, id, listing_id: id, source_id: id, source_hash: 'a'.repeat(64),
    brand: 'Synthetic Fixture Brand', model: null, reference: id, title: id,
    raw_message_text: '[SYNTHETIC FIXTURE] One supported watch ' + id, raw_message_scope: 'original_post',
    raw_message_available: true, description: null, image_key: null, image_url: null, thumbnail_url: null,
    imageUrl: null, primary_image_url: null, image_urls: [], images: [], image_status: 'NO_IMAGE',
    image_evidence_type: 'NO_IMAGE', parent_listing_id: null, child_index: null, is_bundle: false,
    is_unbundled_child: false, bundle_status: 'SINGLE_LISTING', dealer_profile_path: null,
    seller_rating: null, seller_review_count: null, seller_rating_evidence_status: 'UNKNOWN',
    listing_type: 'WTB', intent: 'WTB', original_price_role: null, price_usd: null,
    source_price_amount: null, original_price_amount: null, source_currency: null, original_price_currency: null,
    source_price_text: null, price_raw: null, currency: null, price_display_verified: false, price_research_eligible: false,
    dial_color: null, condition: null, year: null, source_listing_status: null, source_deleted: null,
    location_country: null, location_region: null, ...fields });
  const plain = make('SYNTHETIC-SINGLE', { location_country: 'CH', location_region: 'Geneva', source_listing_status: 'ended',
    source_created_at: null, source_created_at_text: '2026-09-01 17:30:00', listing_date: null,
    original_price_role: 'WTB_BUDGET', source_price_amount: 5000, original_price_amount: 5000,
    source_currency: 'USD', original_price_currency: 'USD', source_price_text: 'USD 5,000', price_raw: 5000, currency: 'USD' });
  const child = make('SYNTHETIC-CHILD', { parent_listing_id: 'SYNTHETIC-PARENT', child_index: 1,
    is_bundle: true, is_unbundled_child: true, bundle_status: 'BUNDLE_CHILD', raw_message_text: null,
    source_context_text: '[SYNTHETIC CHILD] Exact watch line, green dial, no assigned image.',
    dial_color: 'Green', source_listing_status: 'open', location_country: 'US', location_region: 'New York, NY',
    // Deliberate stale URL fields prove the UI also rejects inherited images.
    image_url: baselineImage, imageUrl: baselineImage, thumbnail_url: baselineImage,
    image_urls: [baselineImage], images: [baselineImage], image_status: 'SOURCE_IMAGE_PRESENT' });
  const rows = [{ ...seed, location_country: 'US', location_region: 'New York, NY' }, plain, child];
  const parentText = '[SYNTHETIC PARENT] Original two-watch message\n' + child.source_context_text + '\nSecond watch remains separate.';
  const countries = ['CH', 'US'], regions = ['Geneva', 'New York, NY'];
  const calls = []; const imageLoads = []; let failBrowse = true; let failParent = true;
  const capturePrefix = 'output/playwright/expanded-' + Date.now();
  const parse = request => {
    const url = request.url();
    const [path, query = ''] = url.replace(/^https?:\/\/[^/]+/, '').split('?');
    const values = Object.fromEntries(query.split('&').filter(Boolean).map(pair => pair.split('=').map(value => decodeURIComponent(value.replace(/\+/g, ' ')))));
    return { path, values, url };
  };
  await page.route('**/api/**', async route => {
    const call = parse(route.request()); calls.push(call); let status = 200, payload = {};
    if (call.path === '/api/canary/browse') {
      if (failBrowse) { status = 503; payload = { success: false }; }
      else payload = { success: true, snapshot_id: 'abcdef12-abcd-4abc-8def-123456abcdef',
        brands: [...new Set(rows.map(row => row.brand))].map(brand => ({ brand, listing_count: rows.filter(row => row.brand === brand).length })),
        models: [{ model: 'Reference-only listings', listing_count: 2 }], references: [], availableCountries: countries, availableRegions: regions };
    } else if (call.path === '/api/canary/trading-floor') {
      let selected = rows;
      if (call.values.countries) selected = selected.filter(row => JSON.parse(call.values.countries).includes(row.location_country));
      if (call.values.regions) selected = selected.filter(row => JSON.parse(call.values.regions).includes(row.location_region));
      if (call.values.brand) selected = selected.filter(row => row.brand === call.values.brand);
      if (call.values.intent) selected = selected.filter(row => row.intent === call.values.intent);
      payload = { ...seedPayload, records: selected, total: selected.length, hasMore: false, nextCursor: null, sort: call.values.sort };
    } else if (call.path === '/api/canary/source-evidence') {
      if (call.values.listing_id !== child.id || call.values.source_hash !== child.source_hash) throw new Error('Unbound parent source request');
      if (failParent) { status = 503; payload = { success: false }; }
      else payload = { success: true, listing_id: child.id, source_hash: child.source_hash, raw_message_text: parentText, source_context_text: child.source_context_text };
    } else if (call.path === '/api/catalog-suggestions') payload = { success: true, suggestions: [] };
    else if (call.path.includes('price-research')) payload = { success: true, count: 0, stats: null, analytics_ready: false, records: [], results: [] };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  const card = id => page.locator('article[data-listing-id="' + id + '"]');
  const ids = () => page.locator('article[data-listing-id]').evaluateAll(items => items.map(item => item.dataset.listingId));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const waitCards = async expected => page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('article[data-listing-id]')].map(item => item.dataset.listingId)) === JSON.stringify(expected), expected);
  const parentCalls = () => calls.filter(call => call.path === '/api/canary/source-evidence');
  const assertCard = async viewport => {
    await waitCards(rows.map(row => row.id));
    check(await card(child.id).locator('img').count() === 0, viewport + ' child must have no image element');
    check(!/NO[ _]IMAGE/.test(await card(child.id).innerText()), viewport + ' child must have no empty image container');
    check((await card(child.id).innerText()).includes(child.source_context_text), viewport + ' exact child quote immediately visible');
    check((await card(child.id).innerText()).includes('Dial: Green'), viewport + ' supported dial visible');
    check(/NO[ _]IMAGE/.test(await card(plain.id).innerText()), viewport + ' original imageless single area preserved');
    check((await card(plain.id).innerText()).includes('HISTORICAL · SOURCE ENDED'), viewport + ' historical status visible');
    check((await card(plain.id).innerText()).includes('Budget: USD 5,000'), viewport + ' WTB amount explicitly labelled budget');
    check(!(await card(child.id).innerText()).includes('Posted Posting date'), viewport + ' missing date has no duplicated prefix');
    check((await card(plain.id).innerText()).includes('2026-09-01 17:30:00 (source time; timezone not stated)'), viewport + ' unzoned source time never parsed as UTC');
    check(await card(seed.id).locator('img').first().getAttribute('src') === baselineImage, viewport + ' original single image URL unchanged');
    await card(seed.id).scrollIntoViewIfNeeded();
    await page.waitForFunction(id => {
      const img = document.querySelector('article[data-listing-id="' + id + '"] img');
      return img && img.complete && img.naturalWidth > 0;
    }, seed.id, { timeout: 15000 });
    imageLoads.push({ viewport, original_url: baselineImage, loaded: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), viewport + ' horizontal overflow');
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5191/#/trading');
  await page.getByTestId('preview-fixture-banner').waitFor();
  await page.getByRole('alert').filter({ hasText: "Watch filters couldn't load." }).waitFor();
  await waitCards(rows.map(row => row.id));
  const initialCalls = calls.filter(call => call.path === '/api/canary/trading-floor' && call.values.pageSize === '50');
  check(initialCalls.length > 0, 'Main inventory request observed');
  check(initialCalls.every(call => call.values.sort === 'source_images' && call.values.category === 'watches' && !call.values.brand && !call.values.intent), 'Default all watches/brands/intents with server source-images order');
  check(parentCalls().length === 0, 'No eager parent download');
  failBrowse = false;
  await page.getByRole('button', { name: 'Retry watch filters', exact: true }).click();
  await page.getByRole('group', { name: 'Countries', exact: true }).getByRole('checkbox', { name: 'CH', exact: true }).waitFor();
  await assertCard('desktop');
  await card(child.id).getByText('Original parent message', { exact: true }).click();
  await card(child.id).getByRole('button', { name: 'Retry original source' }).waitFor();
  failParent = false;
  await card(child.id).getByRole('button', { name: 'Retry original source' }).click();
  await card(child.id).getByText(parentText, { exact: true }).waitFor();
  await card(child.id).getByText('Original parent message', { exact: true }).click();
  await card(child.id).getByText(parentText, { exact: true }).waitFor({ state: 'detached' });
  const countriesGroup = page.getByRole('group', { name: 'Countries', exact: true });
  await countriesGroup.getByRole('checkbox', { name: 'CH', exact: true }).click();await waitCards([plain.id]);
  check(await countriesGroup.getByRole('checkbox', { name: 'CH', exact: true }).getAttribute('aria-checked') === 'true', 'Country selection settles checked');
  await countriesGroup.getByRole('checkbox', { name: 'US', exact: true }).click();await waitCards(rows.map(row => row.id));
  await page.getByRole('checkbox', { name: 'New York, NY', exact: true }).click();await waitCards([seed.id,child.id]);
  const scoped = calls.filter(call => call.path === '/api/canary/trading-floor').at(-1);
  check(JSON.stringify(JSON.parse(scoped.values.countries).sort()) === JSON.stringify(countries) && JSON.parse(scoped.values.regions)[0] === 'New York, NY', 'Country OR and region AND scopes preserve exact labels');
  await page.getByRole('complementary', { name: 'Marketplace filters' }).getByRole('button', { name: 'Clear', exact: true }).first().click();await waitCards(rows.map(row => row.id));
  await card(child.id).getByRole('button', { name: /SYNTHETIC-CHILD/ }).click();
  const detail = page.getByRole('region', { name: 'Selected listing' });await detail.waitFor();
  check(await detail.locator('img').count() === 0, 'Child detail gallery absent');
  check(!/NO[ _]IMAGE/.test(await detail.innerText()), 'Child detail empty image container absent');
  check((await detail.innerText()).includes(child.source_context_text), 'Child detail exact source visible');
  await detail.getByRole('button', { name: 'Close', exact: true }).click();await waitCards(rows.map(row => row.id));
  await card(seed.id).scrollIntoViewIfNeeded();
  await page.screenshot({ path: capturePrefix + '-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });await page.evaluate(() => window.scrollTo(0,0));
  await assertCard('mobile');
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  const sheet = page.getByRole('dialog');await sheet.waitFor();
  await sheet.getByRole('group', { name: 'Countries', exact: true }).getByRole('checkbox', { name: 'CH', exact: true }).click();
  await sheet.getByRole('checkbox', { name: 'Geneva', exact: true }).click();
  await sheet.getByRole('button', { name: 'View results', exact: true }).click();await waitCards([plain.id]);
  await page.getByRole('button', { name: /^Filter/ }).click();
  await sheet.getByRole('button', { name: 'Clear all', exact: true }).click();
  await sheet.getByRole('button', { name: 'View results', exact: true }).click();await waitCards(rows.map(row => row.id));
  const reset = calls.filter(call => call.path === '/api/canary/trading-floor').at(-1);
  check(!reset.values.countries && !reset.values.regions && !reset.values.brand && !reset.values.intent && reset.values.sort === 'source_images' && reset.values.category === 'watches', 'Mobile reset restores exact expanded default');
  await card(seed.id).scrollIntoViewIfNeeded();
  await page.waitForFunction(id => { const img = document.querySelector('article[data-listing-id="' + id + '"] img'); return img && img.complete && img.naturalWidth > 0; }, seed.id);
  await page.screenshot({ path: capturePrefix + '-mobile-child.png', fullPage: true });
  await card(child.id).getByRole('button', { name: /SYNTHETIC-CHILD/ }).click();await detail.waitFor();
  check(await detail.locator('img').count() === 0 && !/NO[ _]IMAGE/.test(await detail.innerText()), 'Mobile child detail image-free');
  await detail.getByText('Original parent message', { exact: true }).click();await detail.getByText(parentText, { exact: true }).waitFor();
  await page.screenshot({ path: capturePrefix + '-mobile-detail.png', fullPage: true });
  return { status: 'PASS', synthetic_preview: true, desktop_mobile_cards: true, source_single_image_preserved: baselineImage,
    child_no_image_containers_grid_detail: true, exact_child_quote_immediate: true, parent_source_on_demand_retry_and_clear: true,
    default_all_watches_brands_intents: true, country_region_multiselect_and_reset: true, historical_label_and_unzoned_time: true,
    wtb_budget_label: true, browse_retry: true, no_horizontal_overflow: true, api_calls: calls.length, image_loads: imageLoads,
    screenshots: [capturePrefix + '-desktop.png',capturePrefix + '-mobile-child.png',capturePrefix + '-mobile-detail.png'] };
}
