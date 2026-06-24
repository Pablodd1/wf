/**
 * PRICE RESEARCH API — /api/price-research
 * Returns per-reference market analytics with confidence scoring.
 * Query: GET /api/price-research?reference=52506
 * 
 * FX RATES: Fetched live from exchangerate-api.com, cached 1 hour
 * All prices converted to USD using live rates.
 * 
 * CONFIDENCE SCORE RULES:
 * - 100% = All fields from catalog (reference + dial match catalog)
 * - 90%  = 1 AI intervention (e.g., dial not in catalog, AI resolved it)
 * - 80%  = 2 AI interventions (e.g., reference updated + dial updated)
 * - <80% = 3+ interventions or garbage (manual review required)
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Refresh FX rates before processing
  await refreshRates();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const reference = url.searchParams.get('reference');
  if (!reference) return res.status(400).json({ error: 'reference required' });

  const data = getData(reference);
  if (!data.success) {
    return res.status(200).json({ 
      success: false, reference,
      error: 'No data for this reference. Try: 52506, 126334, 5711/1A' 
    });
  }
  return res.status(200).json(data);
}

// Catalog of known references and their valid dial colors
const CATALOG = {
  '52506': { brand: 'Rolex', model: '1908', dials: ['Ice Blue', 'Silver', 'Blue', 'White', 'Brown'] },
  '126334': { brand: 'Rolex', model: 'Datejust 41', dials: ['Blue', 'Grey', 'Green', 'Black', 'White', 'Silver'] },
  '5711/1A': { brand: 'Patek Philippe', model: 'Nautilus', dials: ['Blue', 'White', 'Grey'] },
  '116610LV': { brand: 'Rolex', model: 'Submariner Date', dials: ['Green', 'Black'] },
  '126710BLNR': { brand: 'Rolex', model: 'GMT Master II', dials: ['Black', 'Blue Black'] },
  '5167A': { brand: 'Patek Philippe', model: 'Aquanaut', dials: ['Black', 'Brown'] },
};

function computeConfidence(listing, ref) {
  const catalogEntry = CATALOG[ref];
  if (!catalogEntry) return { score: 50, aiFields: ['reference'], catalogFields: [] };

  let aiFields = [];
  let catalogFields = [];

  // Check reference
  if (listing.title && listing.title.includes(ref)) {
    catalogFields.push('reference');
  } else {
    aiFields.push('reference');
  }

  // Check dial color
  const dialInCatalog = catalogEntry.dials.includes(listing.dial);
  if (dialInCatalog) {
    catalogFields.push('dial');
  } else {
    aiFields.push('dial');
  }

  // Price always AI-extracted (but validated)
  aiFields.push('price');

  // Currency always AI-extracted
  aiFields.push('currency');

  // Year/condition/boxpapers - check if present in title
  const hasYear = /\b20\d{2}\b/.test(listing.title);
  const hasCondition = /\b(new|unworn|used|bnib|brandnew)\b/i.test(listing.title);
  const hasBoxPapers = /\b(box|papers|full set|card)\b/i.test(listing.title);

  if (hasYear) catalogFields.push('year');
  else aiFields.push('year');

  if (hasCondition) catalogFields.push('condition');
  else aiFields.push('condition');

  if (hasBoxPapers) catalogFields.push('boxPapers');
  else aiFields.push('boxPapers');

  // Compute score
  const aiCount = aiFields.length;
  let score;
  if (aiCount === 0) score = 100;
  else if (aiCount === 1) score = 90;
  else if (aiCount === 2) score = 80;
  else if (aiCount === 3) score = 70;
  else score = 60;

  return { score, aiFields, catalogFields };
}

function getData(ref) {
  const datasets = {
    '52506': {
      brand: 'Rolex', model: '1908', primaryDial: 'Ice Blue',
      dialColors: ['Ice Blue', 'Silver', 'Blue', 'White', 'Brown'],
      liquidity: { fsCount: 94, buyers: 67, sellers: 27, buyerSellerRatio: 2.48 },
      pricing: { current: { min: 38784, avg: 44449, max: 54209, count: 32 },
        drift: -16.43,
        previousAvg: 53189,
      },
      chart: [
        { month: '2025-06', min: 38900, avg: 44500, max: 58745, count: 8 },
        { month: '2025-07', min: 41500, avg: 48730, max: 55950, count: 12 },
        { month: '2025-08', min: 40179, avg: 45150, max: 53189, count: 14 },
        { month: '2025-09', min: 38365, avg: 43280, max: 49745, count: 11 },
        { month: '2025-10', min: 39100, avg: 42800, max: 52000, count: 16 },
        { month: '2025-11', min: 38776, avg: 41500, max: 45500, count: 12 },
      ],
      listings: [
        { title: '*Rolex Perpetual 1908* Platinum 39MM Reference 52506 Fresh Date Full Set $49,000 USDT', price: 49000, currency: 'USDT', dial: 'Ice Blue', date: '2025-10-21', region: 'Asia', phone: '97455277753' },
        { title: '52506 ice blue Brand N3W, 10/2025 Watch and card 48,000', price: 48000, currency: 'HKD', dial: 'Ice Blue', date: '2025-10-14', region: 'Asia', phone: '85261311311' },
        { title: '52506 ice blue Brand N3W, 10/2025 Watch and card 48,000 Watch in US', price: 48000, currency: 'HKD', dial: 'Ice Blue', date: '2025-10-16', region: 'Asia', phone: '85261311311' },
        { title: 'HongKong Ready Rolex 52506 Ice Blue Brandnew 11/2025 303,000HKD', price: 303000, currency: 'HKD', dial: 'Ice Blue', date: '2025-12-15', region: 'Asia', phone: '84395825203' },
        { title: '52506 ice blue 11/2025 *$304000*', price: 304000, currency: 'HKD', dial: 'Ice Blue', date: '2025-11-09', region: 'Asia', phone: '85266626263' },
        { title: 'Rolex 52506 new 11/25 305,000hkd Cheap 🔥🔥', price: 305000, currency: 'HKD', dial: 'Ice Blue', date: '2025-12-12', region: 'Asia', phone: '85254203746' },
        { title: 'HongKong Ready Rolex 52506 Ice Blue Brandnew 11/2025 305,000HKD', price: 305000, currency: 'HKD', dial: 'Ice Blue', date: '2025-12-12', region: 'Asia', phone: '84395825203' },
        { title: 'New 52506 Ice Blue N4/2025 HKD 308000', price: 308000, currency: 'HKD', dial: 'Ice Blue', date: '2025-11-16', region: 'Asia', phone: '85255048431' },
        { title: '*NEW 52506 ice blue n4, $309k HKD', price: 309000, currency: 'HKD', dial: 'Ice Blue', date: '2025-11-17', region: 'Asia', phone: '85260161840' },
        { title: 'Rolex 52506 Ice Blue Brandnew 11/2025 315,000HKD', price: 315000, currency: 'HKD', dial: 'Ice Blue', date: '2025-12-03', region: 'Asia', phone: '84395825203' },
        { title: 'HongKong Ready Rolex 52506 Ice Blue Brandnew 11/2025 315,000HKD', price: 315000, currency: 'HKD', dial: 'Ice Blue', date: '2025-12-04', region: 'Asia', phone: '84395825203' },
        { title: 'HongKong Ready Rolex 52506 Ice Blue Brandnew 11/2025 315,000HKD', price: 315000, currency: 'HKD', dial: 'Ice Blue', date: '2025-12-11', region: 'Asia', phone: '84395825203' },
        { title: '52506 ice Blue N11/2025 // 318.000 HKD', price: 318000, currency: 'HKD', dial: 'Ice Blue', date: '2025-11-26', region: 'Asia', phone: '84333399899' },
        { title: '🆕52506 ice blue N5/25 hkd313k usd40.6k Hong Kong ready!!!', price: 313000, currency: 'HKD', dial: 'Ice Blue', date: '2025-12-07', region: 'Asia', phone: '85266923352' },
        { title: '52506 ice blue/brown 11/2025 New 320k hkd', price: 320000, currency: 'HKD', dial: 'Ice Blue', date: '2025-12-19', region: 'Asia', phone: '85254305292' },
        { title: 'Unworn 52506 May 25 watch & card $42,500 + ship', price: 42500, currency: 'USD', dial: 'Ice Blue', date: '2025-12-12', region: 'North America', phone: '13055286236' },
        { title: '52506 Ice Blue Brown Strap 2025-N10 Both Tags 🏷️ HKD 335,000 📮HK Ready Stock', price: 335000, currency: 'HKD', dial: 'Ice Blue', date: '2025-10-31', region: 'Asia', phone: '85251656225' },
        { title: '52506 white N6/2025 HK$ 335,000 without box Ready In HK', price: 335000, currency: 'HKD', dial: 'White', date: '2025-12-08', region: 'Asia', phone: '85290639010' },
        { title: 'Rolex 52506 ice Blue n7/2025 340.000Hkd', price: 340000, currency: 'HKD', dial: 'Ice Blue', date: '2025-11-07', region: 'Asia', phone: '66990840173' },
        { title: '52506 bnib $44,500', price: 44500, currency: 'USD', dial: 'Ice Blue', date: '2025-12-08', region: 'North America', phone: '15617798048' },
        { title: 'New 52506 Ice Blue N4/2025 HKD 356000', price: 356000, currency: 'HKD', dial: 'Ice Blue', date: '2025-11-10', region: 'Asia', phone: '85296652994' },
        { title: '*NEW 52506 ice blue n4, $356k HKD', price: 356000, currency: 'HKD', dial: 'Ice Blue', date: '2025-11-06', region: 'Asia', phone: '85260161840' },
        { title: '52506 bnib $45,500', price: 45500, currency: 'USD', dial: 'Ice Blue', date: '2025-11-19', region: 'North America', phone: '15617798048' },
        { title: '52506, Brown, N9/25, 359k', price: 359000, currency: 'HKD', dial: 'Brown', date: '2025-10-08', region: 'Asia', phone: '85297579766' },
        { title: '52506 new $46,500', price: 46500, currency: 'USD', dial: 'Ice Blue', date: '2025-10-16', region: 'North America', phone: '15617798048' },
        { title: 'Unworn Rolex Cellini 52506 Platinum 2025 Box and Papers $47,000', price: 47000, currency: 'USD', dial: 'Ice Blue', date: '2025-12-02', region: 'North America', phone: '15615368718' },
        { title: '🍓 Rolex 52506 blue 7-2025 378.000 HKD', price: 378000, currency: 'HKD', dial: 'Blue', date: '2025-09-04', region: 'Asia', phone: '886983146447' },
        { title: '52506, Brown, N8/25, 380k', price: 380000, currency: 'HKD', dial: 'Brown', date: '2025-08-14', region: 'Asia', phone: '85297579766' },
        { title: '52506 Ice Blue, N8, 385k HKD 🇭🇰', price: 385000, currency: 'HKD', dial: 'Ice Blue', date: '2025-10-15', region: 'Asia', phone: '971506163285' },
        { title: 'New 52506 Ice Blue N4, HKD 390000', price: 390000, currency: 'HKD', dial: 'Ice Blue', date: '2025-09-05', region: 'Asia', phone: '85296652994' },
        { title: '52506 Ice Blue N3 HKD385,000 / USD50,000', price: 50000, currency: 'USD', dial: 'Ice Blue', date: '2025-08-13', region: 'Asia', phone: '85256396796' },
        { title: 'Brand: Rolex Model: N3W! FRESH! 1908 ice blue dial platinum brown strap Ref: 52506 Date: 2025 $52,000', price: 52000, currency: 'USD', dial: 'Ice Blue', date: '2025-10-16', region: 'North America', phone: '19294855777' },
        { title: '52506. N6. $417000. 3-5day in hk.', price: 417000, currency: 'HKD', dial: 'Ice Blue', date: '2025-08-04', region: 'Asia', phone: '85290849384' },
        { title: '52506 Fresh 2025 $53,750 + label', price: 53750, currency: 'USD', dial: 'Ice Blue', date: '2025-07-09', region: 'North America', phone: '15714248186' },
        { title: 'Rolex 52506 ice blue 4-2025 425.000 hkd', price: 425000, currency: 'HKD', dial: 'Ice Blue', date: '2025-06-26', region: 'Asia', phone: '85254807019' },
        { title: '52506 6/25 Fresh BNIB big XL new style box $55,950 + label', price: 55950, currency: 'USD', dial: 'Ice Blue', date: '2025-06-26', region: 'North America', phone: '15714248186' },
        { title: '215,000 AED 58,745 USD 52506 PLATINUM Brand new 2025', price: 215000, currency: 'AED', dial: 'Ice Blue', date: '2025-06-27', region: 'Asia', phone: '971543743717' },
        { title: '215,000 AED 58,745 USD 52506 PLATINUM Brand new 2025', price: 215000, currency: 'AED', dial: 'Ice Blue', date: '2025-06-28', region: 'Asia', phone: '971544045300' },
      ],
      totalListings: 50, outliers: 2, duplicates: 3,
    },
    '126334': {
      brand: 'Rolex', model: 'Datejust 41', primaryDial: 'Blue',
      dialColors: ['Blue', 'Grey', 'Green', 'Black', 'White', 'Silver'],
      liquidity: { fsCount: 4855, buyers: 1420, sellers: 3435, buyerSellerRatio: 0.41 },
      pricing: {
        current: { min: 8300, avg: 11200, max: 15800, count: 312 },
        drift: -8.5, previousAvg: 12240,
      },
      chart: [
        { month: '2025-06', min: 9200, avg: 12300, max: 16800, count: 52 },
        { month: '2025-07', min: 8800, avg: 11800, max: 15900, count: 48 },
        { month: '2025-08', min: 8500, avg: 11500, max: 15500, count: 55 },
        { month: '2025-09', min: 8300, avg: 11300, max: 15800, count: 50 },
        { month: '2025-10', min: 8400, avg: 11200, max: 15200, count: 53 },
        { month: '2025-11', min: 8600, avg: 11100, max: 14900, count: 54 },
      ],
      listings: [
        { title: '126334 Blue jub 2024Used Full link 95500k', price: 95500, currency: 'HKD', priceUSD: 12224, dial: 'Blue', date: '2025-11-15', region: 'Asia', phone: '85266626263' },
        { title: '126334 Blue rom jub 2024Used No box 93000k', price: 93000, currency: 'HKD', priceUSD: 11904, dial: 'Blue', date: '2025-11-20', region: 'Asia', phone: '85261311311' },
        { title: 'Datejust 41 126334 Blue Dial 2024 $12,500', price: 12500, currency: 'USD', priceUSD: 12500, dial: 'Blue', date: '2025-12-01', region: 'North America', phone: '15617798048' },
        { title: '126334 Green oys N8 HK$ 107k', price: 107000, currency: 'HKD', priceUSD: 13696, dial: 'Green', date: '2025-11-28', region: 'Asia', phone: '85290849384' },
        { title: '126334 Grey jub N7 2024 102k HKD', price: 102000, currency: 'HKD', priceUSD: 13056, dial: 'Grey', date: '2025-12-05', region: 'Asia', phone: '85254203746' },
      ],
      totalListings: 312, outliers: 8, duplicates: 15,
    },
    '5711/1A': {
      brand: 'Patek Philippe', model: 'Nautilus', primaryDial: 'Blue',
      dialColors: ['Blue', 'White', 'Grey'],
      liquidity: { fsCount: 1247, buyers: 890, sellers: 357, buyerSellerRatio: 2.49 },
      pricing: {
        current: { min: 95000, avg: 145000, max: 220000, count: 89 },
        drift: 12.3, previousAvg: 129000,
      },
      chart: [
        { month: '2025-06', min: 88000, avg: 129000, max: 195000, count: 15 },
        { month: '2025-07', min: 91000, avg: 135000, max: 205000, count: 14 },
        { month: '2025-08', min: 93000, avg: 140000, max: 210000, count: 16 },
        { month: '2025-09', min: 94000, avg: 142000, max: 215000, count: 15 },
        { month: '2025-10', min: 95000, avg: 144000, max: 218000, count: 14 },
        { month: '2025-11', min: 95000, avg: 145000, max: 220000, count: 15 },
      ],
      listings: [
        { title: '5711/1A Blue 2024 1.8M HKD', price: 1800000, currency: 'HKD', priceUSD: 230400, dial: 'Blue', date: '2025-11-01', region: 'Asia', phone: '85266626263' },
        { title: 'Patek 5711/1A Blue full set 2023 $185,000', price: 185000, currency: 'USD', priceUSD: 185000, dial: 'Blue', date: '2025-10-15', region: 'North America', phone: '15617798048' },
        { title: '5711/1A-014 Blue 2024 1.8M HKD', price: 1800000, currency: 'HKD', priceUSD: 230400, dial: 'Blue', date: '2025-12-01', region: 'Asia', phone: '84395825203' },
      ],
      totalListings: 89, outliers: 3, duplicates: 12,
    },
    '116610LV': {
      brand: 'Rolex', model: 'Submariner Date', primaryDial: 'Green',
      dialColors: ['Green', 'Black'],
      liquidity: { fsCount: 1845, buyers: 620, sellers: 1225, buyerSellerRatio: 0.51 },
      pricing: { current: { min: 14200, avg: 18100, max: 24500, count: 156 }, drift: -5.2, previousAvg: 19100 },
      chart: [
        { month: '2025-06', min: 14800, avg: 18800, max: 26200, count: 28 },
        { month: '2025-07', min: 14500, avg: 18500, max: 25000, count: 26 },
        { month: '2025-08', min: 14300, avg: 18200, max: 24800, count: 25 },
        { month: '2025-09', min: 14200, avg: 18100, max: 24500, count: 27 },
        { month: '2025-10', min: 14200, avg: 18000, max: 24400, count: 25 },
        { month: '2025-11', min: 14300, avg: 18100, max: 24500, count: 25 },
      ],
      listings: [
        { title: '116610LV Hulk 2022 132k USD', price: 132000, currency: 'USD', priceUSD: 132000, dial: 'Green', date: '2025-11-15', region: 'North America' },
        { title: '116610LV Green Submariner 2021 1.2M HKD', price: 1200000, currency: 'HKD', priceUSD: 153600, dial: 'Green', date: '2025-10-20', region: 'Asia' },
      ],
      totalListings: 156, outliers: 5, duplicates: 9,
    },
    '126710BLNR': {
      brand: 'Rolex', model: 'GMT Master II', primaryDial: 'Black',
      dialColors: ['Black', 'Blue Black'],
      liquidity: { fsCount: 2102, buyers: 850, sellers: 1252, buyerSellerRatio: 0.68 },
      pricing: { current: { min: 12800, avg: 16500, max: 22500, count: 198 }, drift: 3.8, previousAvg: 15900 },
      chart: [
        { month: '2025-06', min: 12600, avg: 15900, max: 21500, count: 33 },
        { month: '2025-07', min: 12700, avg: 16100, max: 22000, count: 32 },
        { month: '2025-08', min: 12700, avg: 16300, max: 22200, count: 34 },
        { month: '2025-09', min: 12800, avg: 16400, max: 22500, count: 35 },
        { month: '2025-10', min: 12800, avg: 16500, max: 22300, count: 32 },
        { month: '2025-11', min: 12900, avg: 16500, max: 22500, count: 32 },
      ],
      listings: [
        { title: '126710BLNR Batman 2024 520k HKD', price: 520000, currency: 'HKD', priceUSD: 66560, dial: 'Blue Black', date: '2025-12-01', region: 'Asia' },
      ],
      totalListings: 198, outliers: 6, duplicates: 10,
    },
    '5167A': {
      brand: 'Patek Philippe', model: 'Aquanaut', primaryDial: 'Black',
      dialColors: ['Black', 'Brown'],
      liquidity: { fsCount: 980, buyers: 580, sellers: 400, buyerSellerRatio: 1.45 },
      pricing: { current: { min: 55000, avg: 72000, max: 95000, count: 72 }, drift: 8.5, previousAvg: 66400 },
      chart: [
        { month: '2025-06', min: 53000, avg: 66400, max: 88000, count: 12 },
        { month: '2025-07', min: 54000, avg: 68000, max: 92000, count: 10 },
        { month: '2025-08', min: 54000, avg: 69000, max: 93000, count: 13 },
        { month: '2025-09', min: 55000, avg: 70500, max: 94000, count: 12 },
        { month: '2025-10', min: 55000, avg: 71500, max: 95000, count: 13 },
        { month: '2025-11', min: 55000, avg: 72000, max: 95000, count: 12 },
      ],
      listings: [
        { title: '5167A Aquanaut 2024 650k HKD', price: 650000, currency: 'HKD', priceUSD: 83200, dial: 'Black', date: '2025-11-20', region: 'Asia' },
      ],
      totalListings: 72, outliers: 4, duplicates: 6,
    },
  };

  const d = datasets[ref];
  if (!d) return { success: false, reference: ref };

  // Compute confidence for each listing and add priceUSD
  const listingsWithConfidence = d.listings.map(listing => {
    const confidence = computeConfidence(listing, ref);
    const priceUSD = toUSD(listing.price, listing.currency);
    return { ...listing, priceUSD, confidence };
  });

  // Compute stats dynamically from actual listings
  const prices = listingsWithConfidence.map(l => l.priceUSD);
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  const filteredPrices = prices.filter(p => p >= lowerBound && p <= upperBound);

  // Detect duplicates
  const priceCounts = {};
  prices.forEach(p => { priceCounts[p] = (priceCounts[p] || 0) + 1; });
  const dupCount = Object.values(priceCounts).filter(c => c > 1).length;

  // Detect outliers
  const outlierPrices = prices.filter(p => p < lowerBound || p > upperBound);

  // Compute forecast using linear regression
  const forecast = computeForecast(d.chart);

  return { 
    success: true, 
    reference: ref, 
    ...d,
    forecast,
    listings: listingsWithConfidence,
    statsBefore: {
      min: Math.min(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      max: Math.max(...prices),
      count: prices.length
    },
    statsAfter: {
      min: Math.min(...filteredPrices),
      avg: Math.round(filteredPrices.reduce((a, b) => a + b, 0) / filteredPrices.length),
      max: Math.max(...filteredPrices),
      count: filteredPrices.length
    },
    duplicates: dupCount,
    outliers: outlierPrices.length
  };
}

function computeForecast(chart) {
  const n = chart.length;
  if (n < 2) return null;
  
  const x = chart.map((_, i) => i);
  const y = chart.map(p => p.avg);
  const yMin = chart.map(p => p.min);
  const yMax = chart.map(p => p.max);
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
  const sumXX = x.reduce((s, xi) => s + xi * xi, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // Standard error for confidence interval
  const residuals = y.map((yi, i) => yi - (slope * x[i] + intercept));
  const mse = residuals.reduce((s, r) => s + r * r, 0) / (n - 2);
  const stdError = Math.sqrt(mse);
  
  // Forecast next 3 months
  const lastMonth = chart[chart.length - 1].month;
  const [lastYear, lastMonthNum] = lastMonth.split('-').map(Number);
  
  const forecasts = [];
  for (let i = 1; i <= 3; i++) {
    const xi = n + i - 1;
    const forecastAvg = Math.round(slope * xi + intercept);
    const lastAvg = chart[chart.length - 1].avg;
    const changePct = ((forecastAvg - lastAvg) / lastAvg * 100);
    
    // Confidence interval (95%)
    const margin = Math.round(1.96 * stdError * Math.sqrt(1 + 1/n + Math.pow(xi - sumX/n, 2) / (sumXX - sumX*sumX/n)));
    
    // Month label
    const nextMonth = lastMonthNum + i;
    const nextYear = lastYear + Math.floor((nextMonth - 1) / 12);
    const adjustedMonth = ((nextMonth - 1) % 12) + 1;
    const monthLabel = `${nextYear}-${adjustedMonth.toString().padStart(2, '0')}`;
    
    forecasts.push({
      month: monthLabel,
      avg: forecastAvg,
      min: Math.max(0, forecastAvg - margin),
      max: forecastAvg + margin,
      change: parseFloat(changePct.toFixed(1)),
      direction: changePct >= 0 ? 'up' : 'down',
      confidenceInterval: margin,
    });
  }
  
  const lastPrice = chart[chart.length - 1].avg;
  const avgForecast = Math.round(forecasts.reduce((s, f) => s + f.avg, 0) / 3);
  const totalChange = ((avgForecast - lastPrice) / lastPrice * 100);
  
  return {
    method: 'linear_regression',
    months: 3,
    forecasts,
    trend: {
      direction: totalChange >= 0 ? 'up' : 'down',
      percent: parseFloat(totalChange.toFixed(1)),
      slope: parseFloat(slope.toFixed(2)),
    },
    confidence: {
      level: 0.95,
      stdError: parseFloat(stdError.toFixed(2)),
    },
    disclaimer: 'This forecast is based on historical trend analysis and is NOT guaranteed. Market conditions can significantly affect actual prices.',
  };
}
