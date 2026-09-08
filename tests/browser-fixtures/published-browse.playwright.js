async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  const origin = 'https://wf-ecru.vercel.app';
  const live = await (await page.request.get(origin + '/api/canary/trading-floor?pageSize=100')).json();
  const research = await (await page.request.get(origin + '/api/canary/price-research?pageSize=100')).json();
  const rows = live.records;
  if (!Array.isArray(rows) || rows.length !== 100) throw new Error('Live fixture unavailable');
  const group = (items, field) => [...new Set(items.map(item => item[field] || 'Reference-only listings'))].map(value => {
    const members = items.filter(item => (item[field] || 'Reference-only listings') === value);
    return { [field]: value, listing_count: members.length, model_count: new Set(members.map(item => item.model)).size, reference_count: new Set(members.map(item => item.reference)).size, image_url: members.find(item => item.image_url)?.image_url };
  });
  const brands = group(rows, 'brand');
  const regions = [...new Set(rows.map(item => item.location_region).filter(Boolean))];
  const calls = [];
  let slowBrand = '';
  await page.route('**/api/**', async route => {
    const [pathname, query = ''] = route.request().url().replace(/^https?:\/\/[^/]+/, '').split('?');
    if (pathname === '/api/dictionaries/published-brand-aliases.json') return route.continue();
    const values = Object.fromEntries(query.split('&').filter(Boolean).map(pair => pair.split('=').map(part => decodeURIComponent(part.replace(/\+/g, ' ')))));
    const url = { pathname, search: '?' + query, searchParams: { get: key => values[key], has: key => key in values } };
    calls.push(url.pathname + url.search);
    let payload = {};
    if (url.pathname === '/api/canary/browse') {
      const brand = url.searchParams.get('brand');
      const model = url.searchParams.get('model');
      let members = brand ? rows.filter(item => item.brand === brand) : rows;
      const models = group(members, 'model');
      if (model) members = members.filter(item => (item.model || 'Reference-only listings') === model);
      payload = { success: true, snapshot_id: 'fixture-source-backed', brands, models, references: group(members, 'reference'), availableRegions: regions };
      if (brand === slowBrand) await page.waitForTimeout(600);
    } else if (url.pathname === '/api/canary/trading-floor') {
      const size = Number(url.searchParams.get('pageSize') || 50);
      let members = rows.filter(item => !url.searchParams.get('brand') || item.brand === url.searchParams.get('brand'));
      if (url.searchParams.get('model')) members = members.filter(item => (item.model || 'Reference-only listings') === url.searchParams.get('model'));
      if (url.searchParams.get('sort') === 'discovery') members = [...members].reverse();
      const offset = url.searchParams.has('cursor') ? size : 0;
      payload = { ...live, records: members.slice(offset, offset + size), total: members.length, hasMore: offset + size < members.length, nextCursor: offset + size < members.length ? 'fixture-page2' : null };
    } else if (url.pathname === '/api/canary/price-research') payload = research;
    else if (url.pathname === '/api/catalog-suggestions') payload = { success: true, suggestions: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5187/#/trading');
  await page.locator('article[data-listing-id]').nth(49).waitFor();
  const options = await page.locator('#brand-filter option').evaluateAll(items => items.map(item => item.value).filter(Boolean));
  if (JSON.stringify(options.slice().sort()) !== JSON.stringify(brands.map(item => item.brand).sort())) throw new Error('Population brands incomplete');
  const ids = () => page.locator('article[data-listing-id]').evaluateAll(items => items.map(item => item.dataset.listingId));
  const before = await ids();
  const visibleCardTexts = await page.locator('article[data-listing-id]').allInnerTexts();
  for (let index = 0; index < before.length; index++) {
    const row = rows.find(item => item.listing_id === before[index]);
    if (row.location_region && !visibleCardTexts[index].includes(row.location_region)) throw new Error('Source region lost from visible card');
  }
  await page.locator('#sort-filter').selectOption('discovery');
  await page.waitForFunction(id => document.querySelector('article[data-listing-id]')?.dataset.listingId === id, rows[99].listing_id);
  const after = await ids();
  if (after[0] !== rows[99].listing_id) throw new Error('Discovery server order not retained');
  await page.locator('#sort-filter').selectOption('newest');
  await page.waitForFunction(id => document.querySelector('article[data-listing-id]')?.dataset.listingId === id, before[0]);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForFunction(id => document.querySelector('article[data-listing-id]')?.dataset.listingId === id, rows[50].listing_id);
  if ((await ids()).some(id => before.includes(id))) throw new Error('Page overlap');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await page.waitForFunction(id => document.querySelector('article[data-listing-id]')?.dataset.listingId === id, before[0]);
  if (regions.length > 1) {
    const selected = regions.slice(0, 2);
    await page.getByRole('checkbox', { name: selected[0], exact: true }).click();
    await page.getByRole('checkbox', { name: selected[1], exact: true }).click();
    await page.waitForFunction(expected => JSON.stringify(JSON.parse(new URLSearchParams(location.hash.split('?')[1]).get('location'))) === JSON.stringify(expected), selected);
    await page.waitForTimeout(250);
    const regionCalls = calls.filter(path => path.startsWith('/api/canary/trading-floor?') && path.includes('regions='));
    if (!regionCalls.some(path => decodeURIComponent(path.replace(/\+/g, ' ')).includes(JSON.stringify(selected)))) throw new Error('Region array serialization');
    await page.getByRole('checkbox', { name: 'All locations', exact: true }).click();
  }
  const aliasRow = rows.find(item => item.brand === 'Rolex');
  const aliasModel = aliasRow.model || 'Reference-only listings';
  await page.goto('http://127.0.0.1:5187/#/trading?brand=Datejust&model=' + encodeURIComponent(aliasModel));
  await page.waitForFunction(expected => document.querySelector('#brand-filter')?.value === 'Rolex' && document.querySelector('#model-filter')?.value === expected, aliasModel);
  await page.waitForFunction(expected => document.querySelectorAll('article[data-listing-id]').length === expected, Math.min(50, rows.filter(item => item.brand === 'Rolex' && (item.model || 'Reference-only listings') === aliasModel).length));
  await page.goto('http://127.0.0.1:5187/#/price-research?brand=Datejust&ref=' + encodeURIComponent(aliasRow.reference));
  await page.waitForFunction(expected => document.querySelector('select[aria-label="Watch brand"]')?.value === 'Rolex' && document.querySelector('#price-reference-input')?.value === expected, aliasRow.reference);
  await page.waitForTimeout(250);
  if (!calls.some(path => path.startsWith('/api/canary/price-research?') && path.includes('brand=Rolex') && path.includes('reference=' + encodeURIComponent(aliasRow.reference)))) throw new Error('Alias reference scope changed');
  await page.goto('http://127.0.0.1:5187/#/price-research');
  await page.getByRole('button', { name: /Rolex/ }).first().waitFor();
  const select = page.locator('select').filter({ has: page.locator('option[value="Rolex"]') }).first();
  await select.selectOption('');
  slowBrand = 'Rolex';
  await select.selectOption('Rolex');
  await select.selectOption('Patek Philippe');
  await page.getByRole('button', { name: /Other exact references/ }).first().waitFor();
  await page.waitForTimeout(800);
  if (await select.inputValue() !== 'Patek Philippe') throw new Error('Brand selection race');
  const modelText = await page.locator('body').textContent();
  const expectedModels = group(rows.filter(item => item.brand === 'Patek Philippe'), 'model');
  for (const item of expectedModels) if (!modelText.includes(item.model === 'Reference-only listings' ? 'Other exact references' : item.model)) throw new Error('Final models mismatch');
  await page.getByRole('button', { name: /Other exact references/ }).first().click();
  await page.getByPlaceholder(/Search all .* exact references/).waitFor();
  const exactReference = rows.find(item => item.brand === 'Patek Philippe' && !item.model)?.reference;
  if (exactReference) {
    await page.getByPlaceholder(/Search all .* exact references/).fill(exactReference);
    if (!(await page.locator('body').textContent()).includes(exactReference)) throw new Error('Reference-only search unavailable');
  }
  if (calls.some(path => /^\/api\/(?:catalog-models|catalog-references|model-stats|reviewed-market-inventory|price-research-batch-summary)/.test(path))) throw new Error('Legacy browse called in V2');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5187/#/trading');
  await page.locator('article[data-listing-id]').nth(23).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (overflow) throw new Error('Mobile overflow');
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Filter inventory' });
  // Draft brand selection must load its models before applying the sheet. A
  // delayed previous brand must never replace the currently selected options.
  slowBrand = 'Rolex';
  await sheet.getByRole('button', { name: 'Rolex', exact: true }).click();
  await sheet.getByRole('button', { name: 'Patek Philippe', exact: true }).click();
  const mobileModels = page.locator('#mobile-model-filter');
  await page.waitForFunction(expected => JSON.stringify(Array.from(document.querySelectorAll('#mobile-model-filter option'), option => option.value).filter(Boolean).sort()) === JSON.stringify(expected), expectedModels.map(item => item.model).sort());
  await page.waitForTimeout(800);
  const finalMobileModels = await mobileModels.locator('option').evaluateAll(items => items.map(item => item.value).filter(Boolean).sort());
  if (JSON.stringify(finalMobileModels) !== JSON.stringify(expectedModels.map(item => item.model).sort())) throw new Error('Stale mobile draft models');
  const selectedModel = expectedModels[0].model;
  await mobileModels.selectOption(selectedModel);
  await sheet.getByRole('button', { name: 'View results', exact: true }).click();
  await page.waitForFunction(expected => {
    const params = new URLSearchParams(location.hash.split('?')[1]);
    return params.get('brand') === 'Patek Philippe' && params.get('model') === expected;
  }, selectedModel);
  await page.waitForFunction(expected => document.querySelectorAll('article[data-listing-id]').length === expected, Math.min(24, rows.filter(item => item.brand === 'Patek Philippe' && (item.model || 'Reference-only listings') === selectedModel).length));
  await page.getByRole('button', { name: /^Filter/ }).click();
  await sheet.getByRole('button', { name: 'Clear all', exact: true }).click();
  if (await mobileModels.inputValue() !== '') throw new Error('Clear all retained mobile model');
  await sheet.getByRole('button', { name: 'View results', exact: true }).click();
  await page.waitForFunction(() => !new URLSearchParams(location.hash.split('?')[1]).has('model'));
  const result = { status: 'PASS', kind: 'LOCAL_SOURCE_BACKED_BROWSER_FIXTURE', live_fixture_snapshot: live.snapshot_id, fixture_rows: rows.length, population_brands: brands.map(item => item.brand), menu_population_exact: true, server_discovery_order_preserved: true, pagination_next_previous: true, picker_stale_response_ignored: true, reference_only_search: !!exactReference, legacy_browse_requests: 0, desktop_cards: 50, mobile_cards: 24, horizontal_overflow: false, production_mutations: 0, source_regions: regions, region_multiselect: regions.length > 1 };
  return { ...result, source_regions_visible_on_cards: true, mobile_draft_brand_model: true, mobile_stale_models_ignored: true, mobile_clear_all_model: true, exact_alias_deep_link_brand_model_reference: true };
}






