import * as XLSX from 'xlsx';

export function downloadCSV(data: Record<string, any>[], filename: string) {
  if (!data.length) return;
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function generatePriceResearchReport(
  reference: string,
  brand: string,
  model: string,
  stats: { min: number; avg: number; max: number; count: number; drift: number; previousAvg: number; currentAvg: number },
  listings: any[],
  liquidity?: { buyers?: number; sellers?: number; buyerSellerRatio?: number },
  forecast?: any
) {
  const timestamp = new Date().toISOString().split('T')[0];
  const report = {
    meta: {
      generatedAt: timestamp,
      reference,
      brand,
      model,
      reportType: 'Price Research'
    },
    summary: {
      totalListings: stats.count,
      minPriceUSD: stats.min,
      avgPriceUSD: stats.avg,
      maxPriceUSD: stats.max,
      previousAvg: stats.previousAvg,
      currentAvg: stats.currentAvg,
      priceDrift: `${stats.drift.toFixed(2)}%`,
      buyers: liquidity?.buyers || 0,
      sellers: liquidity?.sellers || 0,
      buyerSellerRatio: liquidity?.buyerSellerRatio?.toFixed(2) || 'N/A'
    },
    forecast: forecast ? {
      method: forecast.method,
      trend: `${forecast.trend.direction === 'up' ? '+' : ''}${forecast.trend.percent}%`,
      months: forecast.forecasts.map((f: any) => ({
        month: f.month,
        predicted: f.avg,
        range: `$${f.min.toLocaleString()} - $${f.max.toLocaleString()}`,
        change: `${f.change >= 0 ? '+' : ''}${f.change}%`
      }))
    } : null,
    listings: listings.map(l => ({
      title: l.title,
      priceNative: `${l.price?.toLocaleString()} ${l.currency}`,
      priceUSD: l.priceUSD,
      region: l.region,
      phone: l.phone,
      date: l.date,
      condition: l.condition || 'N/A',
      boxPapers: l.boxPapers || 'N/A',
      confidence: l.confidence?.score || 'N/A',
      aiFields: l.confidence?.aiFields?.join(', ') || 'None',
      catalogFields: l.confidence?.catalogFields?.join(', ') || 'None'
    }))
  };

  // Download as Excel
  const wb = XLSX.utils.book_new();
  
  // Summary sheet
  const summaryData = [
    ['Field', 'Value'],
    ['Reference', reference],
    ['Brand', brand],
    ['Model', model],
    ['Generated', timestamp],
    ['', ''],
    ['Metric', 'Value'],
    ['Total Listings', stats.count],
    ['Min Price (USD)', stats.min],
    ['Avg Price (USD)', stats.avg],
    ['Max Price (USD)', stats.max],
    ['Previous Avg (USD)', stats.previousAvg],
    ['Current Avg (USD)', stats.currentAvg],
    ['Price Drift', `${stats.drift.toFixed(2)}%`],
    ['', ''],
    ['Demand Metric', 'Value'],
    ['Buyers', liquidity?.buyers || 'N/A'],
    ['Sellers', liquidity?.sellers || 'N/A'],
    ['B/S Ratio', liquidity?.buyerSellerRatio?.toFixed(2) || 'N/A']
  ];
  
  // Add forecast to summary if available
  if (forecast) {
    summaryData.push(['', '']);
    summaryData.push(['Forecast', '']);
    summaryData.push(['Method', forecast.method]);
    summaryData.push(['Trend', `${forecast.trend.direction === 'up' ? '+' : ''}${forecast.trend.percent}%`]);
    summaryData.push(['Confidence Level', `${(forecast.confidence.level * 100).toFixed(0)}%`]);
    summaryData.push(['Std Error', `$${forecast.confidence.stdError}`]);
    summaryData.push(['', '']);
    summaryData.push(['Month', 'Predicted (USD)', 'Range (USD)', 'Change']);
    forecast.forecasts.forEach((f: any) => {
      summaryData.push([f.month, f.avg, `$${f.min.toLocaleString()} - $${f.max.toLocaleString()}`, `${f.change >= 0 ? '+' : ''}${f.change}%`]);
    });
  }
  
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // Listings sheet
  const wsListings = XLSX.utils.json_to_sheet(report.listings);
  XLSX.utils.book_append_sheet(wb, wsListings, 'Listings');

  XLSX.writeFile(wb, `PriceResearch_${reference}_${timestamp}.xlsx`);
  return report;
}

export function generateDemandReport(
  signals: any[],
  totals: { wtb: number; ntq: number; trade: number; forSale: number }
) {
  const timestamp = new Date().toISOString().split('T')[0];
  
  const wb = XLSX.utils.book_new();
  
  // Summary sheet
  const summaryData = [
    ['Field', 'Value'],
    ['Report Type', 'Demand Signals'],
    ['Generated', timestamp],
    ['', ''],
    ['Signal Type', 'Count'],
    ['WTB (Want To Buy)', totals.wtb],
    ['NTQ (Name Your Price)', totals.ntq],
    ['Trade Offers', totals.trade],
    ['For Sale', totals.forSale],
    ['Total References', signals.length]
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // Signals sheet
  const signalsData = signals.map(s => ({
    Reference: s.reference,
    Brand: s.brand,
    Collection: s.collection,
    WTB: s.wtbCount,
    NTQ: s.ntqCount,
    Trade: s.tradeCount,
    'For Sale': s.sellers,
    Buyers: s.buyers,
    'B/S Ratio': s.buyerSellerRatio.toFixed(2),
    'Liquidity Score': s.liquidityScore,
    'Demand Level': s.buyerSellerRatio > 0.8 ? 'HIGH' : s.buyerSellerRatio > 0.3 ? 'MEDIUM' : 'LOW'
  }));
  const wsSignals = XLSX.utils.json_to_sheet(signalsData);
  XLSX.utils.book_append_sheet(wb, wsSignals, 'Signals');

  XLSX.writeFile(wb, `DemandSignals_${timestamp}.xlsx`);
}

export function generateInsightReport(
  reference: string,
  brand: string,
  model: string,
  statsOriginal: any,
  statsFiltered: any,
  duplicated: any,
  outliers: any,
  listings: any[],
  liquidity?: { buyers?: number; sellers?: number; buyerSellerRatio?: number }
) {
  const timestamp = new Date().toISOString().split('T')[0];
  
  const wb = XLSX.utils.book_new();
  
  // Summary sheet
  const summaryData = [
    ['Field', 'Value'],
    ['Report Type', 'Insight Details'],
    ['Reference', reference],
    ['Brand', brand],
    ['Model', model],
    ['Generated', timestamp],
    ['', ''],
    ['Stage', 'Data Points', 'Min (USD)', 'Avg (USD)', 'Max (USD)'],
    ['Original', statsOriginal.dataPoints, statsOriginal.min, statsOriginal.avg, statsOriginal.max],
    ['Filtered', statsFiltered.dataPoints, statsFiltered.min, statsFiltered.avg, statsFiltered.max],
    ['', ''],
    ['Removed', 'Count', 'Prices (USD)'],
    ['Duplicated', duplicated.count, duplicated.prices.join(', ') || 'None'],
    ['Outliers', outliers.count, outliers.prices.join(', ') || 'None'],
    ['', ''],
    ['Demand Metric', 'Value'],
    ['Buyers', liquidity?.buyers || 'N/A'],
    ['Sellers', liquidity?.sellers || 'N/A'],
    ['B/S Ratio', liquidity?.buyerSellerRatio?.toFixed(2) || 'N/A']
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // Listings sheet
  const listingsData = listings.map(l => ({
    Title: l.title,
    'Price Native': `${l.price?.toLocaleString()} ${l.currency}`,
    'Price USD': l.priceUSD,
    Region: l.region,
    Phone: l.phone,
    Date: l.date,
    Condition: l.condition || 'N/A',
    Dial: l.dial || 'N/A',
    Confidence: l.confidence?.score || 'N/A',
    'AI Fields': l.confidence?.aiFields?.join(', ') || 'None',
    'Catalog Fields': l.confidence?.catalogFields?.join(', ') || 'None'
  }));
  const wsListings = XLSX.utils.json_to_sheet(listingsData);
  XLSX.utils.book_append_sheet(wb, wsListings, 'Listings');

  XLSX.writeFile(wb, `Insight_${reference}_${timestamp}.xlsx`);
}
