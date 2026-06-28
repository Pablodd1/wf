export interface CatalogComparison {
  brand: string;
  reference: string;
  confidence: number;
}

export interface FeatureScores {
  [key: string]: number;
}

export const FEATURE_LABELS: Record<string, string> = {
  brand: 'Brand',
  reference: 'Reference',
  dialColor: 'Dial Color',
  condition: 'Condition',
  price: 'Price',
  year: 'Year',
};

export function computeFeatureScores(
  _parsed: Record<string, unknown>,
  _catalog: CatalogComparison
): FeatureScores {
  return {};
}

export function scoreColors(_score: number): string {
  return 'gray';
}
