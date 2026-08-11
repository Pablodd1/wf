export interface PriorityReferenceCohort {
  brand: string;
  model: string;
  reference: string;
  tradingQuery: string;
  label: string;
  scope: string;
}

/**
 * First customer-facing reference cohorts selected for the controlled data launch.
 * Keep this list small: each shortcut must map to a catalog-backed reference that
 * can be opened directly in Price Research without partial-reference guessing.
 */
export const PRIORITY_REFERENCE_COHORTS: PriorityReferenceCohort[] = [
  {
    brand: 'Rolex',
    model: 'Daytona',
    reference: '116500LN',
    tradingQuery: '116500LN',
    label: 'Rolex Daytona 116500LN',
    scope: 'All matching offers',
  },
  {
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5712/1A-001',
    tradingQuery: '5712',
    label: 'Patek Philippe Nautilus 5712',
    scope: 'Entire 5712 family',
  },
];
