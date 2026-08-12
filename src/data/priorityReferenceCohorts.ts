export interface PriorityReferenceCohort {
  brand: string;
  model: string;
  reference: string;
  tradingQuery: string;
  label: string;
  scope: string;
}

/**
 * Customer-facing reference cohorts selected from the controlled Rolex and
 * Patek Philippe release. Every shortcut must map to a catalog-backed reference
 * that opens the same live cohort in Trading Floor and Price Research.
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
    reference: '5712',
    tradingQuery: '5712',
    label: 'Patek Philippe Nautilus 5712',
    scope: 'Entire 5712 family',
  },
  {
    brand: 'Rolex',
    model: 'Daytona',
    reference: '126500LN',
    tradingQuery: '126500LN',
    label: 'Rolex Daytona 126500LN',
    scope: 'All matching offers',
  },
  {
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5712/1A-001',
    tradingQuery: '5712/1A-001',
    label: 'Patek Philippe Nautilus 5712/1A-001',
    scope: 'Exact steel reference',
  },
  {
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5990/1R',
    tradingQuery: '5990/1R',
    label: 'Patek Philippe Nautilus 5990/1R',
    scope: 'All matching offers',
  },
  {
    brand: 'Rolex',
    model: 'GMT-Master II',
    reference: '126710BLNR',
    tradingQuery: '126710BLNR',
    label: 'Rolex GMT-Master II 126710BLNR',
    scope: 'All matching offers',
  },
  {
    brand: 'Rolex',
    model: 'Submariner',
    reference: '126610LN',
    tradingQuery: '126610LN',
    label: 'Rolex Submariner 126610LN',
    scope: 'All matching offers',
  },
  {
    brand: 'Patek Philippe',
    model: 'Aquanaut',
    reference: '5164A',
    tradingQuery: '5164A',
    label: 'Patek Philippe Aquanaut 5164A',
    scope: 'All matching offers',
  },
  {
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5740/1G',
    tradingQuery: '5740/1G',
    label: 'Patek Philippe Nautilus 5740/1G',
    scope: 'All matching offers',
  },
  {
    brand: 'Rolex',
    model: 'Day-Date',
    reference: '116688',
    tradingQuery: '116688',
    label: 'Rolex Day-Date 116688',
    scope: 'All matching offers',
  },
  {
    brand: 'Rolex',
    model: 'Datejust',
    reference: '126334',
    tradingQuery: '126334',
    label: 'Rolex Datejust 126334',
    scope: 'All matching offers',
  },
  {
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5980/1R',
    tradingQuery: '5980/1R',
    label: 'Patek Philippe Nautilus 5980/1R',
    scope: 'All matching offers',
  },
  {
    brand: 'Rolex',
    model: 'Submariner',
    reference: '124060',
    tradingQuery: '124060',
    label: 'Rolex Submariner 124060',
    scope: 'All matching offers',
  },
  {
    brand: 'Rolex',
    model: 'GMT-Master II',
    reference: '126710BLRO',
    tradingQuery: '126710BLRO',
    label: 'Rolex GMT-Master II 126710BLRO',
    scope: 'All matching offers',
  },
  {
    brand: 'Rolex',
    model: 'Submariner',
    reference: '126610LV',
    tradingQuery: '126610LV',
    label: 'Rolex Submariner 126610LV',
    scope: 'All matching offers',
  },
  {
    brand: 'Rolex',
    model: 'GMT-Master II',
    reference: '126711CHNR',
    tradingQuery: '126711CHNR',
    label: 'Rolex GMT-Master II 126711CHNR',
    scope: 'All matching offers',
  },
  {
    brand: 'Rolex',
    model: 'Day-Date',
    reference: '228238',
    tradingQuery: '228238',
    label: 'Rolex Day-Date 228238',
    scope: 'All matching offers',
  },
  {
    brand: 'Patek Philippe',
    model: 'Aquanaut',
    reference: '5167A',
    tradingQuery: '5167A',
    label: 'Patek Philippe Aquanaut 5167A',
    scope: 'All matching offers',
  },
  {
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5811/1G',
    tradingQuery: '5811/1G',
    label: 'Patek Philippe Nautilus 5811/1G',
    scope: 'All matching offers',
  },
  {
    brand: 'Patek Philippe',
    model: 'Nautilus',
    reference: '5711/1A',
    tradingQuery: '5711/1A',
    label: 'Patek Philippe Nautilus 5711/1A',
    scope: 'All matching offers',
  },
  {
    brand: 'Patek Philippe',
    model: 'Calatrava',
    reference: '5226G',
    tradingQuery: '5226G',
    label: 'Patek Philippe Calatrava 5226G',
    scope: 'All matching offers',
  },
  {
    brand: 'Patek Philippe',
    model: 'Complications',
    reference: '5326G',
    tradingQuery: '5326G',
    label: 'Patek Philippe Complications 5326G',
    scope: 'All matching offers',
  },
];
