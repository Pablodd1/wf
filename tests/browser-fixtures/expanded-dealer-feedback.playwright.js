async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });await page.goto('about:blank');
  const rows = [
    { id: 'synthetic-feedback', display_name: 'Synthetic feedback source poster', rating: null, review_count: 7,
      whatsapp_group_count: null, source_system: 'WATCHFACTS_SOURCE_POSTERS', stats: { total_posts: null, wts_posts: null, wtb_posts: null } },
    { id: 'synthetic-unknown', display_name: 'Synthetic unknown source poster', rating: null, review_count: null,
      whatsapp_group_count: null, source_system: 'WATCHFACTS_SOURCE_POSTERS', stats: { total_posts: null, wts_posts: null, wtb_posts: null } },
  ];
  await page.route('**/api/**', async route => {
    const url = route.request().url();let payload = {};
    if (url.includes('/api/dealers?')) payload = { dealers: rows, total: 2 };
    else if (url.includes('/api/dealer-profile?')) {
      const dealer = rows.find(row => url.includes(row.id));
      payload = { dealer, stats: { wts_count: null, wtb_count: null, group_count: null }, listings: [], reviews: [], groups: [] };
    } else if (url.includes('/api/canary/trading-floor?')) payload = { status: 'ok', records: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  const check = (value, message) => { if (!value) throw new Error(message); };
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);await page.goto('http://127.0.0.1:5191/#/dealers');
    const feedback = page.locator('article').filter({ hasText: rows[0].display_name });await feedback.waitFor();
    const text = await feedback.innerText();check(text.includes('7 reviews') && !text.includes('Rated ·'), 'Feedback count never claims numeric rating');
    check(text.includes('Groups not captured'), 'Unknown groups remain unknown');
    check(await feedback.getByLabel('Source poster; dealer verification unavailable', { exact: true }).count() === 1, 'Source poster never gains verified dealer badge');
    const unknown = page.locator('article').filter({ hasText: rows[1].display_name });
    check((await unknown.innerText()).includes('Not rated'), 'Unknown numeric rating remains unavailable');
    check(!(await unknown.innerText()).includes('0 reviews'), 'Unknown review count never becomes zero');
    await feedback.getByRole('link', { name: 'Full profile', exact: true }).click();
    await page.getByRole('heading', { name: rows[0].display_name, exact: true }).waitFor();
    await page.getByText('7 reviews', { exact: true }).waitFor();
    await page.getByText('Source poster · Dealer verification unavailable', { exact: true }).waitFor();
    const profile = await page.locator('main').innerText();
    check(await page.getByText('Source poster · Dealer verification unavailable', { exact: true }).count() === 1 && await page.getByText('7 reviews', { exact: true }).count() === 1, 'Profile retains source poster and literal feedback count');
    check(profile.includes('Not available') && profile.includes('Groups not captured'), 'Profile null activity/group counts remain unknown');
    check(!profile.includes('0 reviews'), 'Profile does not invent review count');
  }
  return { status: 'PASS', desktop_mobile: true, numeric_rating_not_inferred_from_feedback: true,
    unknown_activity_group_review_counts_preserved: true, source_poster_not_verified_dealer: true, contact_navigation: false };
}
