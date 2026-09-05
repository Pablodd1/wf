'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessReferenceQuality } = require('../api/_lib/reference-quality.cjs');

test('replaces a captured price only when the exact raw reference is visible', () => {
  const result = assessReferenceQuality({
    brand: 'Patek Philippe',
    reference: '20300USD',
    rawLine: 'Patek Philippe 5296g 2016year used full set 20300USD',
  });
  assert.equal(result.proposed_reference, '5296G');
  assert.ok(result.reasons.includes('REFERENCE_IS_PRICE_OR_LISTING_TEXT'));
  assert.ok(result.reasons.includes('REFERENCE_CORRECTION_AVAILABLE'));
});

test('cleans a Cartier Ref- prefix from exact source evidence', () => {
  const result = assessReferenceQuality({
    brand: 'Cartier',
    reference: 'Ref-WSSA0030',
    rawLine: 'Cartier Ref-WSSA0030 full set',
  });
  assert.equal(result.proposed_reference, 'WSSA0030');
});

test('holds accessories and non-watch categories out of watch publication', () => {
  assert.ok(assessReferenceQuality({
    brand: 'Audemars Piguet', reference: '15500', rawLine: 'BRACELET 15500/26331OR',
  }).reasons.includes('ACCESSORY_NOT_WATCH'));
  assert.ok(assessReferenceQuality({
    brand: 'Hermes', reference: 'Hermes', rawLine: 'Hermes Birkin 25 Gold',
  }).reasons.includes('NON_WATCH_OR_WRONG_CATEGORY'));
});

test('never invents a replacement when no exact reference is visible', () => {
  const result = assessReferenceQuality({
    brand: 'F.P. Journe', reference: '186000USDT', rawLine: 'Octa Reserve de Marche 186000USDT',
  });
  assert.equal(result.proposed_reference, null);
  assert.ok(result.reasons.includes('NEEDS_MANUAL_REVIEW'));
});

test('recognizes exact Omega, JLC, IWC, Tudor, and Piaget reference formats', () => {
  const cases = [
    ['Omega', 'HKD111000', 'Omega Snoopy 310.32.42.50.02.001 HKD111000', '310.32.42.50.02.001'],
    ['Jaeger-LeCoultre', '20700USD', 'Jaeger q1322410 20700USD', 'Q1322410'],
    ['IWC', 'only watch', 'IWC IW371702 only watch', 'IW371702'],
    ['Tudor', 'HKD28600', 'Tudor M7939G1AONRU-0001 HKD28600', 'M7939G1AONRU-0001'],
    ['Piaget', '900HKD', 'Piaget G0A49024 900HKD', 'G0A49024'],
  ];
  for (const [brand, reference, rawLine, expected] of cases) {
    assert.equal(assessReferenceQuality({ brand, reference, rawLine }).proposed_reference, expected);
  }
});

test('applies exact brand-aware cleanup examples without guessing', () => {
  const cases = [
    ['Rolex', 'DJ41', 'Mar 2026 DJ41 Azzurro Jubilee 126334', '126334'],
    ['Patek Philippe', 'CUBITUS', 'CUBITUS 5821/1AR', '5821/1AR'],
    ['Richard Mille', '11-03', 'Richard Mille 11-03', 'RM11-03'],
    ['Panerai', 'Panerai', 'Panerai Pam 422', 'PAM00422'],
    ['Bell & Ross', '03-92', 'Bell & Ross BR 03-92', 'BR03-92'],
  ];
  for (const [brand, reference, rawLine, expected] of cases) {
    assert.equal(assessReferenceQuality({ brand, reference, rawLine }).proposed_reference, expected);
  }
});

test('holds a brand stock list rather than selecting its first reference', () => {
  const result = assessReferenceQuality({
    brand: 'Vacheron Constantin',
    reference: '$541,000',
    rawLine: 'VC 4500V 541000 HKD / 4200H/222J-B935 900000 HKD',
  });
  assert.equal(result.proposed_reference, null);
  assert.ok(result.reasons.includes('MULTI_WATCH_STOCK_LIST'));
});

test('covers the supplied brand cleanup examples conservatively', () => {
  const cases = [
    ['Audemars Piguet', '20300USD', 'Audemars Piguet 26470st 20300USD', '26470ST'],
    ['Breitling', '123500HKD', 'Breitling RB0136E31Q1R1 123500HKD', 'RB0136E31Q1R1'],
    ['Bvlgari', 'Used Bvlgari 102532 black', 'Used Bvlgari 102532 black 2019 card and watch', '102532'],
    ['TAG Heuer', '12968', 'TAG Heuer - CAL5113', 'CAL5113'],
    ['Chopard', '298600-3001 N10', 'Chopard 298600-3001 N10', '298600-3001'],
    ['Zenith', 'DEFY', 'Zenith 03.2040.4061/69.C496 Defy', '03.2040.4061/69.C496'],
    ['Blancpain', '19900USD', 'Blancpain AC02-12B53-63A 19900USD', 'AC02-12B53-63A'],
    ['Girard-Perregaux', 'Girard', 'Girard Perregaux 81060-21-2010-FH7A', '81060-21-2010-FH7A'],
    ['Grand Seiko', '6556', 'Grand Seiko SBGC221', 'SBGC221'],
    ['Glashutte Original', 'Glashutte', 'Glashutte Original 2-39-47-12-12-14', '2-39-47-12-12-14'],
  ];
  for (const [brand, reference, rawLine, expected] of cases) {
    assert.equal(assessReferenceQuality({ brand, reference, rawLine }).proposed_reference, expected, brand);
  }
});

test('does not misclassify valid numeric Bvlgari references as Rolex', () => {
  const result = assessReferenceQuality({
    brand: 'Bvlgari', reference: '102532', rawLine: 'Used Bvlgari 102532 black 2019 card and watch',
  });
  assert.ok(!result.reasons.includes('WRONG_BRAND_SUSPECT'));
});

test('holds supplied accessory examples instead of publishing them as watches', () => {
  const cases = [
    ['Patek Philippe', 'D31', 'Aquanaut Strap D31'],
    ['Richard Mille', '67-01', 'Richard Mille 67-01 Strap'],
    ['Hublot', 'HUBLOT', 'Hublot wooden box'],
  ];
  for (const [brand, reference, rawLine] of cases) {
    const result = assessReferenceQuality({ brand, reference, rawLine });
    assert.ok(result.reasons.includes('ACCESSORY_NOT_WATCH'), brand);
  }
});

test('does not treat the separately parsed bare price as a second Rolex reference', () => {
  const result = assessReferenceQuality({
    brand: 'Rolex',
    reference: '124300',
    rawLine: '124300 Celebration 03/2024 153000',
    priceRaw: 153000,
  });
  assert.ok(!result.reasons.includes('MULTI_WATCH_STOCK_LIST'));
});

test('holds a mixed-brand child line even when one brand-specific reference is valid', () => {
  const result = assessReferenceQuality({
    brand: 'Rolex',
    reference: '52508',
    rawLine: '52508 black n8 184000hkd both tags 127334 white n11 212000hkd both tags',
    priceRaw: 184000,
  });
  assert.equal(result.proposed_reference, null);
  assert.ok(result.reasons.includes('MULTI_WATCH_STOCK_LIST'));
});

test('does not extract a Patek reference from inside another dotted reference', () => {
  const result = assessReferenceQuality({
    brand: 'Patek Philippe',
    reference: '3652/21',
    rawLine: '49.4000.3652/21.I001',
  });
  assert.notEqual(result.proposed_reference, '3652/21');
});

test('uses dated or configured line shape to distinguish a trailing bare price', () => {
  for (const rawLine of [
    '126334 green oys n11 106500',
    '126503 champ 06/2025 184000',
  ]) {
    const result = assessReferenceQuality({ brand: 'Rolex', reference: rawLine.slice(0, 6), rawLine });
    assert.ok(!result.reasons.includes('MULTI_WATCH_STOCK_LIST'), rawLine);
  }
  const trueSecondReference = assessReferenceQuality({
    brand: 'Rolex', reference: '116509', rawLine: '116509 upgrade 116599',
  });
  assert.ok(trueSecondReference.reasons.includes('MULTI_WATCH_STOCK_LIST'));
});

test('keeps material and adjacent prefixed price out of the reference', () => {
  assert.equal(assessReferenceQuality({
    brand: 'Richard Mille', reference: 'RM65-01', rawLine: 'RM65-01 Ti 11/2025 HKD2.25m',
  }).proposed_reference, null);
  assert.equal(assessReferenceQuality({
    brand: 'Tudor', reference: 'M79000N-0001', rawLine: '79000n-0001 hkd23000', priceRaw: 23000,
  }).proposed_reference, null);
});
