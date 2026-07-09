import { describe, it, expect } from 'vitest';
const { parseFull, parsePrice, parseCurrency, verdict, splitMultiWatch, classifyListingType } = require('../api/_lib/parser');

describe('parseCurrency', () => {
  it('hk$ prefix → HKD', () => expect(parseCurrency('hk$317k')).toBe('HKD'));
  it('$ alone → USD', () => expect(parseCurrency('$50000')).toBe('USD'));
  it('USDT case-insensitive', () => expect(parseCurrency('208.000Usdt')).toBe('USDT'));
  it('HKD keyword → HKD', () => expect(parseCurrency('117000 HKD')).toBe('HKD'));
  it('EUR symbol → EUR', () => expect(parseCurrency('€50000')).toBe('EUR'));
});

describe('parsePrice - european decimal thousands', () => {
  it('64.000Usdt → 64000', () => expect(parsePrice('64.000Usdt')).toBe(64000));
  it('117.000Usdt → 117000', () => expect(parsePrice('117.000Usdt')).toBe(117000));
  it('208.000Usdt → 208000', () => expect(parsePrice('208.000Usdt')).toBe(208000));
  it('hk$317k → 317000', () => expect(parsePrice('hk$317k')).toBe(317000));
  it('hk$1.762m → 1762000', () => expect(parsePrice('hk$1.762m')).toBe(1762000));
  it('138k hkd → 138000', () => expect(parsePrice('138k hkd')).toBe(138000));
  it('2.2M HKD → 2200000', () => expect(parsePrice('2.2M HKD')).toBe(2200000));
});

describe('parseFull - conditions', () => {
  it('NOS detected', () => expect(parseFull('NOS Rolex 126334 2023').condition).toBe('New Old Stock'));
  it('new old stock detected', () => expect(parseFull('Rolex 126334 new old stock 117k hkd').condition).toBe('New Old Stock'));
  it('99%new → Like New', () => expect(parseFull('Rolex 126334 99%new 117k hkd').condition).toBe('Like New'));
  it('98%new → Like New', () => expect(parseFull('Rolex 126334 98%new 117k hkd').condition).toBe('Like New'));
  it('Brand New detected', () => expect(parseFull('Brand New AP 15500ST').condition).toBe('New'));
  it('like new detected', () => expect(parseFull('Rolex 126334 like new 117k hkd').condition).toBe('Like New'));
  it('likenew (no space) detected', () => expect(parseFull('Rolex 126334 likenew 117k hkd').condition).toBe('Like New'));
  it('good condition detected', () => expect(parseFull('Rolex 126334 good condition 90k hkd').condition).toBe('Good'));
  it('good cond detected', () => expect(parseFull('Rolex 116600 good cond 95k hkd').condition).toBe('Good'));
  it('unworn → New', () => expect(parseFull('Rolex 126334 unworn 117k hkd').condition).toBe('New'));
});

describe('parseFull - month codes', () => {
  it('n6/26 → year 2026, month N6, condition New', () => {
    const r = parseFull('Rolex 126334 n6/26 117k hkd');
    expect(r.year).toBe(2026);
    expect(r.month_code).toBe('N6');
    expect(r.condition).toBe('New');
  });
  it('n5/26 → year 2026, month N5', () => {
    const r = parseFull('Rolex 126334 n5/26 117k hkd');
    expect(r.year).toBe(2026);
    expect(r.month_code).toBe('N5');
  });
  it('N6 2026 → year 2026, month N6', () => {
    const r = parseFull('Rolex 126334 N6 2026 117k hkd');
    expect(r.year).toBe(2026);
    expect(r.month_code).toBe('N6');
  });
  it('N1 2026 → year 2026, month N1', () => {
    const r = parseFull('Rolex 126334 N1 2026 117k hkd');
    expect(r.year).toBe(2026);
    expect(r.month_code).toBe('N1');
  });
  it('no month code → month_code null', () => {
    const r = parseFull('Rolex 126334 2024 117k hkd');
    expect(r.month_code).toBeNull();
  });
});

describe('parseFull - accessories', () => {
  it('Full Set → box+papers', () => {
    const r = parseFull('Rolex 126334 Full Set 2024 117k hkd');
    expect(r.accessories.has_box).toBe(true);
    expect(r.accessories.has_papers).toBe(true);
  });
  it('fullset (no space) → box+papers', () => {
    const r = parseFull('Rolex 126334 fullset 2024 117k hkd');
    expect(r.accessories.has_box).toBe(true);
    expect(r.accessories.has_papers).toBe(true);
  });
  it('Naked → no box, no papers', () => {
    const r = parseFull('AP 15500ST Naked 138k hkd');
    expect(r.accessories.is_naked).toBe(true);
    expect(r.accessories.has_box).toBe(false);
    expect(r.accessories.has_papers).toBe(false);
  });
  it('No box', () => {
    const r = parseFull('Rolex 126334 no box 117k hkd');
    expect(r.accessories.has_box).toBe(false);
  });
  it('No papers', () => {
    const r = parseFull('Rolex 126334 no papers 117k hkd');
    expect(r.accessories.has_papers).toBe(false);
  });
  it('-2 links detected', () => {
    const r = parseFull('Rolex 126334 Full Set -2 links 117k hkd');
    expect(r.accessories.missing_links).toBe(2);
  });
  it('stickers detected', () => {
    const r = parseFull('AP 15500ST stickers full set 138k hkd');
    expect(r.accessories.stickers).toBe('present');
  });
  it('some stickers detected', () => {
    const r = parseFull('AP 15500ST some stickers 138k hkd');
    expect(r.accessories.stickers).toBe('some');
  });
  it('export only detected', () => {
    const r = parseFull('Rolex 126334 export only 117k hkd');
    expect(r.accessories.export_only).toBe(true);
  });
  it('unadjusted bracelet detected', () => {
    const r = parseFull('Rolex 126334 unadjusted full set 117k hkd');
    expect(r.accessories.bracelet_adjustment).toBe('unadjusted');
  });
});

describe('classifyListingType', () => {
  it('WTB - looking for', () => expect(classifyListingType('Looking For Brand New 126506')).toBe('WTB'));
  it('WTB - ISO', () => expect(classifyListingType('ISO Patek 5711 blue')).toBe('WTB'));
  it('WTB - WTB keyword', () => expect(classifyListingType('WTB Rolex Daytona')).toBe('WTB'));
  it('WTB - want to buy', () => expect(classifyListingType('Want to buy Patek 5711')).toBe('WTB'));
  it('WTB - wanted', () => expect(classifyListingType('Wanted: AP Royal Oak 15500')).toBe('WTB'));
  it('WTS default', () => expect(classifyListingType('Rolex 126334 117k hkd New')).toBe('WTS'));
  it('WTT detected', () => expect(classifyListingType('WTT Rolex for AP')).toBe('WTT'));
  it('WTT - want to trade', () => expect(classifyListingType('Want to trade my Rolex for Patek')).toBe('WTT'));
});

describe('reference patterns - long AP', () => {
  it('long AP ref captured (dot-separated)', () => {
    const r = parseFull('AP 26420IO.OO.A402CA.01 138k hkd');
    expect(r.ref).toContain('26420');
  });
  it('long AP ref second format', () => {
    const r = parseFull('AP 26420SO.OO.A029VE.01 138k hkd');
    expect(r.ref).toContain('26420');
  });
  it('standard 5-char AP ref still works', () => {
    const r = parseFull('AP 15500ST 138k hkd');
    expect(r.ref).toBe('15500ST');
  });
});

describe('splitMultiWatch - // separator', () => {
  it('splits on //', () => {
    const parts = splitMultiWatch('Rolex 126529 // Rolex 116610 // Used // 208.000Usdt');
    expect(parts.length).toBeGreaterThanOrEqual(1);
  });
  it('original + | still works', () => {
    const parts = splitMultiWatch('Rolex 126334 117k hkd | AP 15500ST 138k hkd');
    expect(parts.length).toBe(2);
  });
});

describe('parseFull - field_confidence', () => {
  it('returns field_confidence object', () => {
    const r = parseFull('Rolex 126334 Full Set 2024 117k hkd');
    expect(r.field_confidence).toBeDefined();
    expect(typeof r.field_confidence.brand).toBe('number');
    expect(typeof r.field_confidence.reference).toBe('number');
    expect(typeof r.field_confidence.price).toBe('number');
    expect(typeof r.field_confidence.currency).toBe('number');
    expect(typeof r.field_confidence.overall).toBe('number');
  });
  it('keeps integer confidence field', () => {
    const r = parseFull('Rolex 126334 Full Set 2024 117k hkd');
    expect(typeof r.confidence).toBe('number');
    expect(Number.isInteger(r.confidence)).toBe(true);
  });
});

describe('P7 - inferDialFromRef removes unsafe codes', () => {
  const { inferDialFromRef } = require('../api/_lib/parser');
  it('ST suffix no longer infers Blue', () => {
    // 15500ST — ST is steel code, not dial
    expect(inferDialFromRef('15500ST')).toBeNull();
  });
  it('BC suffix no longer infers Black', () => {
    expect(inferDialFromRef('26320BC')).toBeNull();
  });
  it('LN suffix still infers Black', () => {
    expect(inferDialFromRef('116610LN')).toBe('Black');
  });
  it('LV suffix still infers Green', () => {
    expect(inferDialFromRef('116610LV')).toBe('Green');
  });
});

// v4.10 fixes — JASS-6 quick wins batch
describe('v4.10 - NTQ intent → WTB', () => {
  it('NTQ Rolex 126710BLRO → listingType WTB', () => {
    expect(parseFull('NTQ Rolex 126710BLRO').listingType).toBe('WTB');
  });
  it('NTQ lowercase → WTB', () => {
    expect(parseFull('ntq AP 15500ST').listingType).toBe('WTB');
  });
});

describe('v4.10 - mil/mill/million → millions', () => {
  it('1.2mil → 1200000', () => expect(parsePrice('Rolex 1.2mil')).toBe(1200000));
  it('1.2mill → 1200000', () => expect(parsePrice('Rolex 1.2mill')).toBe(1200000));
  it('1.2 million → 1200000', () => expect(parsePrice('Rolex 1.2 million')).toBe(1200000));
  it('3mil → 3000000', () => expect(parsePrice('AP 3mil')).toBe(3000000));
  it('2.5 million → 2500000', () => expect(parsePrice('Patek 2.5 million')).toBe(2500000));
});

describe('v4.10 - glued k+currency', () => {
  it('165khkd → 165000', () => expect(parsePrice('Rolex 165khkd')).toBe(165000));
});

describe('v4.10 - ref# not parsed as price', () => {
  it('116500 Skeleton → price null (no real price)', () => {
    expect(parseFull('Rolex 116500 Skeleton').price).toBeNull();
  });
  it('$5500 wins over model name 1908', () => {
    expect(parseFull('Rolex 1908 black dial $5500').price).toBe(5500);
  });
});

describe('v4.10 - price-at-end tie-break', () => {
  it('two equal-priority prices → last wins', () => {
    expect(parsePrice('41000 42000')).toBe(42000);
  });
  it('$-prefixed still wins over bare number (priority)', () => {
    expect(parsePrice('$5500 9900')).toBe(5500);
  });
});

describe('v4.10 - slash-ref preservation', () => {
  it('82172/000R → ref keeps slash portion', () => {
    expect(parseFull('Patek 82172/000R').ref).toBe('82172/000R');
  });
  it('82172/000R-B654 → full composite ref preserved', () => {
    expect(parseFull('Patek 82172/000R-B654').ref).toBe('82172/000R-B654');
  });
  it('4020T/000R-B654 → letter-prefixed + slash preserved', () => {
    expect(parseFull('Patek 4020T/000R-B654').ref).toBe('4020T/000R-B654');
  });
  it('5711/1A → classic Patek slash ref still works', () => {
    expect(parseFull('Patek 5711/1A').ref).toBe('5711/1A');
  });
  it('5712/1A-001 → slash + dash composite preserved', () => {
    expect(parseFull('Patek 5712/1A-001').ref).toBe('5712/1A-001');
  });
});
