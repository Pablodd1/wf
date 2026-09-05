function partitionExcludedEvidence(requiredFieldExclusions, repostRows, classifiedRows) {
  const statisticalOutlierRows = classifiedRows.filter(
    row => row.is_outlier && row.outlier_reason !== 'INVALID_PRICE'
  );
  const repostExclusions = repostRows.map(row => ({
    ...row,
    is_outlier: true,
    outlier_reason: 'REPOST_DUPLICATE',
  }));

  return {
    statisticalOutlierRows,
    repostExclusions,
    allExcludedRows: [
      ...requiredFieldExclusions,
      ...repostExclusions,
      ...statisticalOutlierRows,
    ],
  };
}

module.exports = { partitionExcludedEvidence };
