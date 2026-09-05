import { normalizeWatch } from './src/lib/normalize.ts';

const tests = [
  ['5524R  2020Y HKD258K', 'Patek Philippe'],
  ['7041R 2019Y HKD162K', 'Patek Philippe'],
  ['6654-1127-55B 2025N 85500HKD', 'Blancpain'],
  ['PP 5712-1A Nautilus Blue 2022', 'Patek Philippe'],
  ['5168G Khaki 2024 HKD420k', 'Patek Philippe'],
  ['patek philippe 5712/1a blue 2024', 'Patek Philippe'],
  ['PATEK PHILIPPE 5712/1A blue', 'Patek Philippe'],
  ['Rm11-01ti 2024 245k usdt', 'Richard Mille'],
  ['WTB: Rolex 126334 blue 2024', 'Rolex'],
  ['WTB 26240OR 50th anniversary', 'Audemars Piguet'],
  ['5711/1R Aftermarket Diamonds', 'Patek Philippe'],
  ['🔵127336 ice blue N5/2026 New 1.14m HKD', 'Rolex'],
  ['⭐216570 NEW 2021 HKD95k', 'Rolex'],
  ['126500 Daytona 2024 HKD620k', 'Rolex'],
  ['127336 ice blue', 'Rolex'],
  ['Patek 5168g khaki 2024 420k HKD', 'Patek Philippe'],
  ['26240BA Frosted Gold 2022 HKD1.366M', 'Audemars Piguet'],
  ['W69012Z4 Cartier Tank 2024 HKD45k', 'Cartier'],
  ['IW379403 Pilot 2024 HKD120k', 'IWC'],
  ['Q9068180 Reverso 2024 HKD95k', 'Jaeger-LeCoultre'],
  ['⭕New 5980/1400g 2022y 4.4m hkd', 'Patek Philippe'],
  ['🔥116610LV Green Submariner 2021 1.2M HKD', 'Rolex'],
  ['Tudor 79030B Black Bay 2024', 'Tudor'],
  ['Omega 311.30.42.30.01.005 Speedmaster 2024', 'Omega'],
];

let pass = 0, fail = 0;
const failures = [];
for (const [input, expect] of tests) {
  const r = normalizeWatch(input);
  if (r.brand === expect) pass++;
  else { fail++; failures.push({ input, expect, got: r.brand, ref: r.reference, intent: r.intent, dial: r.dialColor, price: r.price, curr: r.currency, conf: r.confidence }); }
}
console.log(`${pass}/${tests.length} passed, ${fail} failed`);
for (const f of failures) {
  console.log(`\n✗ "${f.input}"`);
  console.log(`   expected: ${f.expect}, got: ${f.got} | ref=${f.ref} | dial=${f.dial} | $${f.price} ${f.curr} | conf=${f.conf} | intent=${f.intent}`);
}
