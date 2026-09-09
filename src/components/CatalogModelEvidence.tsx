import type { ListingDisplayContract } from '../types/listing-display-contract';

export function CatalogModelEvidence({ listing }: { listing: Pick<ListingDisplayContract, 'model_source' | 'model_catalog_source_files'> }) {
  if (listing.model_source !== 'CATALOG_EXACT_BRAND_REFERENCE') return null;
  return <div className="mt-1 text-xs font-medium text-[#7A8699]" title={listing.model_catalog_source_files?.join(', ')}>
    Model from catalog · exact manufacturer and reference match
  </div>;
}
