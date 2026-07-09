import { describe, it, expect } from 'vitest';
const { parseFull } = require('../api/_lib/parser');

const cases = [
  { input: 'Rolex 126334 Blue N6/26 Full Set 117000 HKD', brand: 'Rolex', ref: '126334', year: 2026 },
  { input: 'PP 5711/1A Tiffany New 2023 450k hkd', brand: 'Patek Philippe', ref: '5711/1A' },
  { input: 'AP 15500ST white 2022 naked used 138k hkd', brand: 'Audemars Piguet' },
  { input: 'RM 27-04 N5 2.2M HKD full set', brand: 'Richard Mille' },
  { input: 'Rolex 126529 // No Box // Used // 208.000Usdt', brand: 'Rolex', ref: '126529' },
  { input: 'AP 26420IO.OO.A402CA.01 138k hkd full set', brand: 'Audemars Piguet' },
  { input: 'hk$317k Rolex 126334 n6/26 full set', brand: 'Rolex', ref: '126334', year: 2026 },
  { input: 'WTS Rolex 116610LN 2021 Full Set 90k HKD', brand: 'Rolex', ref: '116610LN', year: 2021 },
  { input: 'Patek 5726A black 2020 Full Set with stickers 350k HKD', brand: 'Patek Philippe' },
  { input: 'Tudor BB58 36mm Blue used 2023 no box 50k HKD', brand: 'Tudor' },
];

describe('real-world listing samples', () => {
  cases.forEach(({ input, brand, ref, year }) => {
    it(input.substring(0, 50), () => {
      const r = parseFull(input);
      if (brand) expect(r.brand).toBe(brand);
      if (ref) expect(r.ref).toBeTruthy();
      if (year) expect(r.year).toBe(year);
    });
  });
});

describe('real-world price parsing', () => {
  it('208.000Usdt in listing → 208000', () => {
    const r = parseFull('Rolex 126529 // No Box // Used // 208.000Usdt');
    expect(r.price).toBe(208000);
    expect(r.currency).toBe('USDT');
  });

  it('hk$317k in listing → 317000 HKD', () => {
    const r = parseFull('hk$317k Rolex 126334 n6/26 full set');
    expect(r.price).toBe(317000);
    expect(r.currency).toBe('HKD');
  });

  it('2.2M HKD → 2200000', () => {
    const r = parseFull('RM 27-04 N5 2.2M HKD full set');
    expect(r.price).toBe(2200000);
    expect(r.currency).toBe('HKD');
  });
});

describe('real-world accessories', () => {
  it('Full Set with stickers', () => {
    const r = parseFull('Patek 5726A black 2020 Full Set with stickers 350k HKD');
    expect(r.accessories.has_box).toBe(true);
    expect(r.accessories.has_papers).toBe(true);
    expect(r.accessories.stickers).toBe('present');
  });

  it('No box Tudor', () => {
    const r = parseFull('Tudor BB58 36mm Blue used 2023 no box 50k HKD');
    expect(r.accessories.has_box).toBe(false);
  });
});

describe('listing_type in parseFull output', () => {
  it('WTS listing has listing_type WTS', () => {
    const r = parseFull('WTS Rolex 116610LN 2021 Full Set 90k HKD');
    expect(r.listing_type).toBe('WTS');
  });
  it('ISO listing has listing_type WTB', () => {
    const r = parseFull('ISO Patek 5711 blue dial');
    expect(r.listing_type).toBe('WTB');
  });
});

describe('multi-watch bundle splitting and 7xxx reference matching', () => {
  const { splitMultiWatch } = require('../api/_lib/parser');

  it('splits single-line emoji-delimited bundles', () => {
    const input = '🔥used in hk full set🔥 PP 🌷5172g salmon 2023y hkd422k 🌷7300/1201r coffee 2021y hkd327k 🌷7118/1200a white 2021y hkd832k 🌷7118/1200a blue 2024y hkd721k';
    const parts = splitMultiWatch(input);
    expect(parts.length).toBe(4);
    expect(parts[0]).toContain('5172g');
    expect(parts[1]).toContain('7300/1201r');
    expect(parts[2]).toContain('7118/1200a white');
    expect(parts[3]).toContain('7118/1200a blue');
  });

  it('parses Patek references starting with 7 and 9', () => {
    const r1 = parseFull('PP 7300/1201r coffee dial 2021y used hkd327k');
    expect(r1.brand).toBe('Patek Philippe');
    expect(r1.ref).toBe('7300/1201R');
    expect(r1.price).toBe(327000);
    expect(r1.currency).toBe('HKD');
    expect(r1.year).toBe(2021);

    const r2 = parseFull('PP 7118/1200a white 2021y hkd832k');
    expect(r2.brand).toBe('Patek Philippe');
    expect(r2.ref).toBe('7118/1200A');
    expect(r2.year).toBe(2021);
  });
});

describe('JASS-6 Phase 0B — WF_REF_SELECT catalog-preference', () => {
  const { parseReference } = require('../api/_lib/parser');

  // CONTRACT: parseReference returns the dealer's RAW extracted ref (audit-safe,
  // no-override). The full catalog form is exposed separately via
  // parseFull().catalogEntry.reference. These tests lock that contract so a
  // future change can't silently start substituting refs.

  it('short ref preserved verbatim, catalog completes to full form', () => {
    const r = parseFull('Rolex 116500 Black Full Set 142500 HKD');
    expect(r.ref).toBe('116500');                        // dealer text untouched
    expect(r.catalogMatched).toBe(true);
    expect(r.catalogEntry.reference).toBe('116500LN');   // short→full fold
    expect(r.confidence).toBe(100);
  });

  it('exact full ref is an exact catalog hit', () => {
    const r = parseFull('Rolex 126610LN Full Set 130k hkd');
    expect(r.ref).toBe('126610LN');
    expect(r.catalogEntry.reference).toBe('126610LN');
    expect(r.confidence).toBe(100);
  });

  it('exact stub ref preserved (no suffix in catalog)', () => {
    const r = parseFull('Rolex 126334 Blue N6/26 117000 HKD');
    expect(r.ref).toBe('126334');
    expect(r.catalogEntry.reference).toBe('126334');
  });

  it('Patek slash ref preserved, catalog enrichment resolves', () => {
    const r = parseFull('PP 5711/1A Tiffany 450k hkd');
    expect(r.ref).toBe('5711/1A');
    expect(r.catalogMatched).toBe(true);
  });

  it('AP ST ref preserved, catalog resolves to full material code', () => {
    const r = parseFull('AP 15500ST white 138k hkd');
    expect(r.ref).toBe('15500ST');
    // v4.10: cross-brand catalog fallback removed — lookupCatalog is now strictly
    // brand-scoped. Since inferBrandFromRef overrides AP→Rolex (AUTO_OVERRIDE), the
    // catalog lookup under 'Rolex' for '15500ST' correctly returns null (no Rolex
    // entry exists for this AP ref). This test now verifies the ref is preserved
    // without false catalog matching.
    expect(r.catalogMatched).toBe(false);
  });

  it('non-catalog ref preserved (no boost, no substitution)', () => {
    // 134567 is not a real Rolex ref — must pass through unchanged, no crash.
    const r = parseReference('Rolex 134567 xyz', 'Rolex');
    expect(r).toBe('134567');
  });

  it('BRAND-SCOPING GUARD: short numeric ref never cross-maps to another brand', () => {
    // 116500 is a Rolex ref. Under Blancpain it must NOT resolve to the Rolex
    // catalog entry — lookupCatalog is brand-scoped, so parseReference returns
    // the Blancpain-context extraction, and parseFull must not claim a Rolex
    // catalog match under a Blancpain brand.
    const r = parseFull('Blancpain 5015 Fifty Fathoms blue 80k hkd');
    expect(r.brand).toBe('Blancpain');
    // Whatever ref is extracted, the catalog entry (if any) must be Blancpain's,
    // never a Rolex entry bled in via shared numeric prefix.
    if (r.catalogEntry) {
      expect(r.catalogEntry.brand).toBe('Blancpain');
    }
  });

  it('LV suffix ref not cross-mapped or stripped', () => {
    const r = parseReference('Rolex 126610LV Full Set', 'Rolex');
    expect(r).toBe('126610LV');
  });
});
