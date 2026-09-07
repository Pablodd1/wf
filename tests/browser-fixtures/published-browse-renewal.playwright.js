async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('http://127.0.0.1:5187/');
  let mode = 'once';
  const calls = [];
  await page.route('**/api/canary/browse?**', async route => {
    const url = route.request().url();
    calls.push(url);
    const expired = mode === 'always' || url.includes('snapshot=');
    const invalid = mode === 'invalid';
    const body = expired || invalid ? { success: false, error: invalid ? 'Invalid browse surface' : 'Cursor snapshot expired or unknown. Restart pagination without a cursor to open a fresh snapshot.' } : { success: true, snapshot_id: 'renewed', brands: [], models: [], references: [] };
    await route.fulfill({ status: expired || invalid ? 400 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const invoke = () => page.evaluate(async () => {
    const { loadPublishedBrowse } = await import('/src/utils/publishedBrowse.ts');
    try { return await loadPublishedBrowse('trading_floor', 'Rolex', '', new AbortController().signal, 'expired'); }
    catch (error) { return { error: error.message }; }
  });
  const renewed = await invoke();
  if (renewed.snapshot_id !== 'renewed' || calls.length !== 2 || calls[1].includes('snapshot=')) throw new Error('Expired browse did not renew exactly once');
  mode = 'always'; calls.length = 0;
  if (!(await invoke()).error || calls.length !== 2) throw new Error('Repeated expiry must stop after one renewal');
  mode = 'invalid'; calls.length = 0;
  if (!(await invoke()).error || calls.length !== 1) throw new Error('Unrelated 400 must not renew');
  return { status: 'PASS', expired_browse_renewals: 1, persistent_error_requests: 2, unrelated_error_requests: 1, listing_or_evidence_cursor_changes: 0, production_mutations: 0 };
}
