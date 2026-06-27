async function test() {
  const XLSX = await import('xlsx-js-style');
  console.log("ESM keys:", Object.keys(XLSX));
  console.log("Has utils:", !!XLSX.utils);
  console.log("Has default.utils:", !!(XLSX.default && XLSX.default.utils));
}
test();
