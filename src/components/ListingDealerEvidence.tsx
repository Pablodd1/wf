/* eslint-disable react-refresh/only-export-components -- the shared evidence classifier must stay identical across both exported renderers */
import { Link } from 'react-router-dom';

export type DealerRatingEvidenceStatus = 'SOURCE_SUPPLIED' | 'SOURCE_FEEDBACK_COUNT' | 'UNAVAILABLE';

type DealerEvidence = {
  sellerName?: string | null;
  sellerPhone?: string | null;
  contactPublicationApproved?: boolean;
  rating?: number | null;
  reviewCount?: number | null;
  ratingEvidenceStatus?: DealerRatingEvidenceStatus | null;
  groupCount?: number | null;
  profilePath?: string | null;
};

export function sourceBackedDealerRating(evidence: Pick<DealerEvidence, 'rating' | 'reviewCount' | 'ratingEvidenceStatus'>) {
  const rating = Number(evidence.rating);
  const reviewCount = Number(evidence.reviewCount);
  const hasReviews = Number.isFinite(reviewCount) && reviewCount > 0;
  if (evidence.ratingEvidenceStatus === 'SOURCE_SUPPLIED'
    && Number.isFinite(rating) && rating > 0 && hasReviews) {
    return { kind: 'score' as const, rating, reviewCount };
  }
  if (evidence.ratingEvidenceStatus === 'SOURCE_FEEDBACK_COUNT' && hasReviews) {
    return { kind: 'feedback' as const, rating: null, reviewCount };
  }
  return null;
}

export function DealerRatingBadge({
  rating,
  reviewCount,
  ratingEvidenceStatus,
  showUnrated = true,
}: Pick<DealerEvidence, 'rating' | 'reviewCount' | 'ratingEvidenceStatus'> & { showUnrated?: boolean }) {
  const evidence = sourceBackedDealerRating({ rating, reviewCount, ratingEvidenceStatus });
  if (!evidence) return showUnrated ? <span className="text-xs font-medium text-[#6B7280]">Rating unavailable</span> : null;
  const accessibleLabel = evidence.kind === 'score'
    ? `Dealer rating ${evidence.rating.toFixed(1)} from ${evidence.reviewCount} reviews`
    : `Rated dealer with ${evidence.reviewCount} positive feedback records`;
  return (
    <span className="text-xs font-semibold text-[#7B5719]" aria-label={accessibleLabel}>
      ★ {evidence.kind === 'score' ? evidence.rating.toFixed(1) : 'Rated'} ({evidence.reviewCount.toLocaleString()})
    </span>
  );
}

export function ListingDealerEvidence({
  sellerName,
  sellerPhone,
  contactPublicationApproved = false,
  rating,
  reviewCount,
  ratingEvidenceStatus,
  groupCount,
  profilePath,
}: DealerEvidence) {
  const publishedGroupCount = Number(groupCount);
  return (
    <div className="space-y-1">
      <div>{sellerName || 'Seller not supplied'}</div>
      <DealerRatingBadge
        rating={rating}
        reviewCount={reviewCount}
        ratingEvidenceStatus={ratingEvidenceStatus}
        showUnrated
      />
      {Number.isFinite(publishedGroupCount) && publishedGroupCount > 0 && (
        <div className="text-[10px] text-[#6B7280]">{publishedGroupCount.toLocaleString()} source-backed groups</div>
      )}
      {contactPublicationApproved && sellerPhone && (
        <div className="text-[10px] font-medium text-[#16794b]">Direct contact available</div>
      )}
      {profilePath && <Link to={profilePath} className="inline-flex text-[10px] font-semibold text-[#7B5719] underline underline-offset-2">Reference Check profile</Link>}
    </div>
  );
}
