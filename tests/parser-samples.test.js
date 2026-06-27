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
