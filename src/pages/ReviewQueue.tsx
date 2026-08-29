import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { TabNav } from '@/components/TabNav';
import { verifyImageReference, type VerifyImageResult } from '@/lib/verifyImage';
import { DealerSubmissionReviewLane } from '@/components/DealerSubmissionReviewLane';
import {
  CheckCircle2, AlertTriangle, Eye,
  Search, Clock, MessageSquare, Shield, Database, RefreshCw, KeyRound,
  Loader2, Sparkles, XCircle
} from 'lucide-react';

interface CatalogEvidence {
  reference?: string | null;
  brand?: string | null;
  model?: string | null;
  collection?: string | null;
  dialColors?: string[];
  source?: string | null;
  matchType?: string | null;
}

interface CopilotSuggestion {
  field: 'brand' | 'model' | 'reference' | 'dialColor' | 'condition' | 'year' | 'price' | 'currency' | 'listingType';
  value: string | null;
  status: 'RAW_SUPPORTED' | 'CATALOG_SUPPORTED' | 'NEEDS_REVIEW' | 'AMBIGUOUS' | 'MISSING';
  support: 'RAW_MESSAGE' | 'CATALOG';
  evidenceQuote: string | null;
  reason: string;
  applicable: boolean;
}

interface CopilotResult {
  brand: string | null;
  model: string | null;
  reference: string | null;
  dialColor: string | null;
  condition: string | null;
  year: string | null;
  price: string | null;
  currency: string | null;
  listingType: string | null;
  confidence: number;
  interpretations: string[];
  ambiguities: string[];
  summary: string;
  suggestions: CopilotSuggestion[];
  fillableFields: string[];
  unresolvedFields: string[];
  catalogEvidence?: CatalogEvidence | null;
}

interface ReviewItem {
  id: string;
  reference: string;
  brand: string;
  model: string;
  dial: string;
  price: number;
  currency: string;
  aiFields: string[];
  catalogFields: string[];
  catalog: CatalogEvidence | null;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  imageUrl?: string;
  multiListing?: boolean;
  listingTitle: string;
  reviewReasons: string[];
  disposition: 'HUMAN_REVIEW' | 'READY_FOR_HUMAN_APPROVAL' | 'CATALOG_CONFIRMATION_REQUIRED';
  priority: number;
  rawMessage?: string;
  reviewEvidence?: Record<string, unknown>;
  sellerName?: string | null;
  sellerPhone?: string | null;
  originalPostedAt?: string | null;
  source?: string | null;
  sourceType?: string | null;
  condition?: string | null;
  year?: number | null;
  priceRaw?: number | null;
  priceUsd?: number | null;
  listingType?: string | null;
  duplicate?: {
    candidateId: string;
    canonical?: Record<string, unknown> | null;
    duplicate?: Record<string, unknown> | null;
    matchType: string;
    confidence: number;
    bundleRisk: boolean;
    status: string;
  };
}

const reasonFilters = [
  { value: '', label: 'Priority' },
  { value: 'CURRENCY_AMBIGUOUS', label: 'Currency' },
  { value: 'PRICE_PARSE_FAILED', label: 'Price parse' },
  { value: 'BUNDLE_SPLIT_REQUIRED', label: 'Bundles' },
  { value: 'NO_CANDIDATE', label: 'No candidate' },
  { value: 'REFERENCE_CHANGED', label: 'Reference' },
  { value: 'DIAL_CHANGED', label: 'Dial correction' },
  { value: 'DIAL_AMBIGUOUS', label: 'Dial ambiguous' },
] as const;

interface ShadowProgress {
  rowsAnalyzed: number;
  total: number;
  changed: number;
  pending: number;
  countsEstimated: boolean;
  lastUpdatedAt: string | null;
  checkpointAgeSeconds?: number | null;
  checkpointDelayed?: boolean;
}

interface ShadowQueueApiItem {
  id: string;
  candidate?: Record<string, string | number | null>;
  source?: Record<string, string | null>;
  changeFlags?: string[];
  analyzedAt: string;
  priority?: number;
  decision?: {
    disposition?: ReviewItem['disposition'];
    reasons?: string[];
    catalog?: CatalogEvidence;
  };
  sourceEvidence?: {
    rawMessage?: string | null;
    sellerName?: string | null;
    sellerPhone?: string | null;
    originalPostingDate?: string | null;
    source?: string | null;
    sourceType?: string | null;
    imageUrls?: unknown[];
    thumbnailUrl?: string | null;
  };
}

interface DuplicateQueueApiItem {
  id: string;
  canonical_id: string;
  duplicate_id: string;
  match_type: string;
  confidence: number;
  bundle_risk?: boolean;
  status: string;
  created_at?: string;
  evidence?: Record<string, unknown>;
  canonical?: Record<string, unknown> | null;
  duplicate?: Record<string, unknown> | null;
}

interface UnbundledQueueApiItem {
  id: string;
  batchId?: string | null;
  raw_message?: string | null;
  brand?: string | null;
  reference?: string | null;
  dial_color?: string | null;
  condition?: string | null;
  year?: number | null;
  price_raw?: number | null;
  price_usd?: number | null;
  currency?: string | null;
  source?: string | null;
  listing_type?: string | null;
  created_at?: string | null;
  flags?: string[];
  reviewBucket?: 'review-ready' | 'human-correction';
  dealerAttributionMissing?: boolean;
  catalogConfirmed?: boolean;
  exactRawLineage?: boolean;
  field_confidence?: Record<string, unknown>;
  seller_name?: string | null;
  seller_phone?: string | null;
  seller_contact_available?: boolean;
  original_posted_at?: string | null;
  front_image?: string | null;
  multi_listing?: boolean;
  recycle_image_url?: string | null;
  isUnbundledChild?: boolean;
  seller_lineage_status?: string | null;
}

interface PriceRemediationQueueApiItem {
  id: number;
  source_record_id: string;
  normalization_version: string;
  stored_price_usd: number;
  proposed_price_usd: number;
  normalization_reason: string;
  evidence_line: string;
  audit_flags?: string[];
  review_status: string;
  created_at?: string;
  source?: Record<string, unknown> | null;
}

interface ImageReviewQueueApiItem {
  source_object_key: string;
  public_url?: string | null;
  record_id: string;
  brand?: string | null;
  model?: string | null;
  reference?: string | null;
  dial_color?: string | null;
  raw_message?: string | null;
  image_status?: string | null;
  identity_status?: string | null;
  review_blocked?: boolean;
  review_blockers?: string[];
  evidence?: Record<string, unknown> | null;
}

interface IdentityReviewQueueApiItem {
  record_id: string;
  identity_status: 'UNVERIFIED' | 'CONFLICT';
  brand?: string | null;
  model?: string | null;
  reference?: string | null;
  dial_color?: string | null;
  raw_message?: string | null;
  seller_name?: string | null;
  seller_phone?: string | null;
  source?: string | null;
  source_type?: string | null;
  listing_date?: string | null;
  created_at?: string | null;
  thumbnail_url?: string | null;
  image_urls?: string[] | null;
  release_blockers?: string[];
  review_disposition?: 'READY_FOR_IDENTITY_REVIEW';
}

interface IdentityDraft {
  brand: string;
  model: string;
  reference: string;
  dial_color: string;
}

const identitySuggestionField = (field: CopilotSuggestion['field']): keyof IdentityDraft | null => {
  if (field === 'dialColor') return 'dial_color';
  if (field === 'brand' || field === 'model' || field === 'reference') return field;
  return null;
};

const correctionSuggestionField = (field: CopilotSuggestion['field']): keyof CorrectionDraft | null => {
  const fields: Partial<Record<CopilotSuggestion['field'], keyof CorrectionDraft>> = {
    brand: 'brand',
    reference: 'reference',
    dialColor: 'dial_color',
    condition: 'condition',
    year: 'year',
    price: 'price_raw',
    currency: 'currency',
    listingType: 'listing_type',
  };
  return fields[field] || null;
};

const suggestionCanPopulateDraft = (suggestion: CopilotSuggestion) => {
  if (!suggestion.applicable || !suggestion.value) return false;
  if (suggestion.field === 'price') return false;
  return true;
};

const preferredSuggestions = (suggestions: CopilotSuggestion[]) => {
  const priority = (suggestion: CopilotSuggestion) => {
    if (suggestion.applicable && suggestion.support === 'RAW_MESSAGE') return 4;
    if (suggestion.applicable && suggestion.support === 'CATALOG') return 3;
    if (suggestion.status === 'NEEDS_REVIEW' || suggestion.status === 'AMBIGUOUS') return 2;
    return 1;
  };
  const best = new Map<CopilotSuggestion['field'], CopilotSuggestion>();
  for (const suggestion of suggestions) {
    const current = best.get(suggestion.field);
    if (!current || priority(suggestion) > priority(current)) best.set(suggestion.field, suggestion);
  }
  return [...best.values()].filter(suggestion => suggestion.status !== 'MISSING');
};

interface SellerLineageReviewQueueApiItem {
  lineage_id: string;
  record_id?: string | null;
  source_record_id?: string | null;
  observed_name?: string | null;
  source_identity?: string | null;
  source_identity_masked?: string | null;
  source_system?: string | null;
  source_listing_type?: string | null;
  source_posted_at?: string | null;
  front_image?: string | null;
  raw_message?: string | null;
  match_status?: string | null;
  match_evidence?: Record<string, unknown> | null;
  dealer_id?: string | null;
  dealer_name?: string | null;
  dealer_company?: string | null;
  proposed_dealer?: {
    id?: string | null;
    display_name?: string | null;
    company_name?: string | null;
    status?: string | null;
  } | null;
}

interface CorrectionDraft {
  brand: string;
  reference: string;
  dial_color: string;
  condition: string;
  year: string;
  price_raw: string;
  price_usd: string;
  currency: string;
  listing_type: string;
}

interface ReviewPacketSummary {
  id: string;
  reason: string;
  itemCount: number;
  normalizationVersion: string | null;
  status: string;
}

interface ReviewPacketCompactItem {
  id: string;
  ordinal: number;
  sourceRecordId: string;
  normalizationVersion: string;
  status: string;
  summary: string;
  correctionProposed: boolean;
}

interface ReviewPacketEvidence {
  id: string;
  packetId: string;
  sourceRecordId: string;
  reason: string;
  reviewEvidenceExcerpt: string;
  rawEvidenceHash: string;
  proposalHash: string;
  normalizationVersion: string | null;
  evidenceFresh: boolean;
  sellerNameMasked: string | null;
  sellerPhoneMasked: string | null;
  fields: CorrectionDraft;
}

const packetReasons = [
  'DETERMINISTIC_CHANGE_REVIEW',
  'EMOJI_PRICE_AMBIGUOUS',
] as const;

const emptyCorrectionDraft = (): CorrectionDraft => ({
  brand: '',
  reference: '',
  dial_color: '',
  condition: '',
  year: '',
  price_raw: '',
  price_usd: '',
  currency: '',
  listing_type: '',
});

const packetItemSummary = (summary: Record<string, unknown>) => [
  summary.brand,
  summary.reference,
  summary.dialColor,
  summary.condition,
  summary.priceRaw && `${summary.priceRaw} ${summary.currency || ''}`.trim(),
].filter(Boolean).map(String).join(' · ') || 'Evidence summary unavailable';

function PacketReviewLane({ openUnbundled }: { openUnbundled: () => void }) {
  const pageSize = 25;
  const [refresh, setRefresh] = useState(0);
  const [packets, setPackets] = useState<ReviewPacketSummary[]>([]);
  const [summaryAfter, setSummaryAfter] = useState('');
  const [summaryHistory, setSummaryHistory] = useState<string[]>([]);
  const [nextSummaryCursor, setNextSummaryCursor] = useState<string | null>(null);
  const [selectedPacket, setSelectedPacket] = useState<ReviewPacketSummary | null>(null);
  const [packetItems, setPacketItems] = useState<ReviewPacketCompactItem[]>([]);
  const [afterOrdinal, setAfterOrdinal] = useState(0);
  const [nextOrdinal, setNextOrdinal] = useState<number | null>(null);
  const [item, setItem] = useState<ReviewPacketEvidence | null>(null);
  const [draft, setDraft] = useState<CorrectionDraft>(emptyCorrectionDraft);
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: String(pageSize) });
    if (summaryAfter) params.set('after', summaryAfter);
    setError(null);
    fetch(`/api/review-packets?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Review packets are unavailable');
        return data;
      })
      .then(data => {
        const rows = (data.items || []) as Record<string, unknown>[];
        setPackets(rows.map(row => ({
          id: String(row.id),
          reason: String(row.reason),
          itemCount: Number(row.itemCount || 0),
          normalizationVersion: String(row.normalizationVersion || '') || null,
          status: String(row.status || 'OPEN'),
        })));
        setNextSummaryCursor(String(data.nextCursor || '') || null);
      })
      .catch(fetchError => {
        if (fetchError?.name !== 'AbortError') {
          setError(fetchError instanceof Error ? fetchError.message : 'Review packets are unavailable');
        }
      });
    return () => controller.abort();
  }, [summaryAfter, refresh]);

  useEffect(() => {
    if (!selectedPacket) {
      setPacketItems([]);
      setNextOrdinal(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      packetId: selectedPacket.id,
      limit: String(pageSize),
      afterOrdinal: String(afterOrdinal),
    });
    setError(null);
    fetch(`/api/review-packets?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Packet items are unavailable');
        return data;
      })
      .then(data => {
        const rows = (data.items || []) as Record<string, unknown>[];
        setPacketItems(rows.map(row => {
          const summary = (row.summary || {}) as Record<string, unknown>;
          return {
            id: String(row.id),
            ordinal: Number(row.ordinal || 0),
            sourceRecordId: String(row.sourceRecordId || ''),
            normalizationVersion: String(row.normalizationVersion || ''),
            status: String(row.status || 'PENDING'),
            summary: packetItemSummary(summary),
            correctionProposed: Boolean(row.correctionProposed),
          };
        }));
        setNextOrdinal(data.nextOrdinal == null ? null : Number(data.nextOrdinal));
      })
      .catch(fetchError => {
        if (fetchError?.name !== 'AbortError') {
          setError(fetchError instanceof Error ? fetchError.message : 'Packet items are unavailable');
        }
      });
    return () => controller.abort();
  }, [afterOrdinal, refresh, selectedPacket]);

  const openPacket = (packet: ReviewPacketSummary) => {
    setSelectedPacket(packet);
    setAfterOrdinal(0);
    setItem(null);
  };

  const openItem = async (compactItem: ReviewPacketCompactItem) => {
    setBusy(compactItem.id);
    setError(null);
    try {
      const params = new URLSearchParams({ itemId: compactItem.id });
      const response = await fetch(`/api/review-packet-item?${params.toString()}`, {
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Packet evidence is unavailable');
      const row = (data.item || data) as Record<string, unknown>;
      const sourceEvidence = (row.sourceEvidence || {}) as Record<string, unknown>;
      const frozenProposal = (row.proposal || {}) as Record<string, unknown>;
      const proposedCandidates = Array.isArray(frozenProposal.proposed_candidates)
        ? frozenProposal.proposed_candidates as Record<string, unknown>[]
        : [];
      const proposal = (proposedCandidates[0] || frozenProposal.candidate || frozenProposal) as Record<string, unknown>;
      const contact = (row.contact || {}) as Record<string, unknown>;
      const fields = { ...emptyCorrectionDraft() };
      for (const field of Object.keys(fields) as (keyof CorrectionDraft)[]) {
        const value = proposal[field];
        if (value != null) fields[field] = String(value);
      }
      const evidence: ReviewPacketEvidence = {
        id: String(row.id),
        packetId: String(row.packetId),
        sourceRecordId: compactItem.sourceRecordId,
        reason: String(row.reason || selectedPacket?.reason || ''),
        reviewEvidenceExcerpt: String(sourceEvidence.rawMessage || ''),
        rawEvidenceHash: String(row.rawEvidenceHash || ''),
        proposalHash: String(row.proposalHash || ''),
        normalizationVersion: String(row.normalizationVersion || '') || null,
        evidenceFresh: row.evidenceFresh === true,
        sellerNameMasked: String(contact.sellerNameMasked || '') || null,
        sellerPhoneMasked: String(contact.sellerPhoneMasked || '') || null,
        fields,
      };
      setItem(evidence);
      setDraft(fields);
      setRationale('');
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Packet evidence is unavailable');
    } finally {
      setBusy(null);
    }
  };

  const submitCorrection = async () => {
    if (!item || !item.evidenceFresh || rationale.trim().length < 10 || !item.reviewEvidenceExcerpt || !item.rawEvidenceHash || !item.proposalHash) return;
    const fields: Record<string, string | number | null> = {};
    for (const [field, value] of Object.entries(draft)) {
      const trimmed = value.trim();
      if (!trimmed) {
        fields[field] = null;
        continue;
      }
      if (field === 'year' || field === 'price_raw' || field === 'price_usd') {
        const numeric = Number(trimmed);
        const invalidYear = field === 'year' && (!Number.isInteger(numeric) || numeric < 1000 || numeric > new Date().getUTCFullYear() + 1);
        if (!Number.isFinite(numeric) || invalidYear || (field !== 'year' && numeric <= 0)) {
          setError(`${field.replace('_', ' ')} must be a valid ${field === 'year' ? 'year' : 'positive number'}.`);
          return;
        }
        fields[field] = numeric;
        continue;
      }
      fields[field] = trimmed;
    }
    setBusy(item.id);
    setError(null);
    try {
      const response = await fetch('/api/review-packet-decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          decision: 'CORRECTION_PROPOSED',
          fields,
          rationale: rationale.trim(),
          expectedRawSha256: item.rawEvidenceHash,
          expectedProposalSha256: item.proposalHash,
          evidenceHashes: [item.rawEvidenceHash, item.proposalHash],
        }),
      });
      const data = await response.json();
      if (response.status === 409 || data.stale === true || data.code === 'STALE_EVIDENCE') {
        setItem(null);
        setError(data.error || 'Evidence changed after this item opened. Reopen it before proposing a correction.');
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Correction proposal failed');
      setItem(null);
      setRefresh(value => value + 1);
    } catch (decisionFailure) {
      setError(decisionFailure instanceof Error ? decisionFailure.message : 'Correction proposal failed');
    } finally {
      setBusy(null);
    }
  };

  const isBundle = (reviewReason: string) => reviewReason === 'BUNDLE_SPLIT_REQUIRED';

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border-default bg-bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Normalization reason packets</h2>
            <p className="mt-1 text-xs text-text-muted">
              Compact summaries only. Evidence opens one item at a time; AI remains advisory and cannot submit decisions.
            </p>
          </div>
          <span className="text-xs text-text-muted">{packets.length.toLocaleString()} packet summaries loaded</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-text-muted">
          {packetReasons.map(packetReason => (
            <span key={packetReason} className="rounded border border-border-default px-2 py-1">
              {packetReason}
            </span>
          ))}
        </div>
        {error && <p className="mt-3 text-xs text-red-400" role="alert">{error}</p>}
      </div>

      <div className="space-y-2">
        {packets.map(packet => (
          <div key={packet.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border-default bg-bg-card p-4">
            <AlertTriangle size={17} className="text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="break-all text-xs font-bold text-text-primary">{packet.reason}</div>
              <div className="mt-1 text-[11px] text-text-muted">
                {packet.itemCount.toLocaleString()} compact items · {packet.status}
                {packet.normalizationVersion ? ` · ${packet.normalizationVersion}` : ''}
              </div>
            </div>
            {isBundle(packet.reason) ? (
              <button onClick={openUnbundled} className="rounded-lg border border-gold-primary/40 px-3 py-2 text-xs font-bold text-gold-primary">
                Open unbundled workflow
              </button>
            ) : (
              <button
                onClick={() => openPacket(packet)}
                className="rounded-lg border border-gold-primary/40 px-3 py-2 text-xs font-bold text-gold-primary disabled:opacity-50"
              >
                Review compact items
              </button>
            )}
          </div>
        ))}
        {!packets.length && !error && <p className="py-8 text-center text-sm text-text-muted">No packets on this page.</p>}
      </div>

      {(summaryHistory.length > 0 || nextSummaryCursor) && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <button
            disabled={!summaryHistory.length}
            onClick={() => setSummaryHistory(history => {
              const previous = history.at(-1) || '';
              setSummaryAfter(previous);
              return history.slice(0, -1);
            })}
            className="rounded border border-border-default px-3 py-2 disabled:opacity-40"
          >
            Previous packets
          </button>
          <button
            disabled={!nextSummaryCursor}
            onClick={() => {
              setSummaryHistory(history => [...history, summaryAfter]);
              setSummaryAfter(nextSummaryCursor || '');
            }}
            className="rounded border border-border-default px-3 py-2 disabled:opacity-40"
          >
            Next packets
          </button>
        </div>
      )}

      {selectedPacket && (
        <div className="rounded-xl border border-border-default bg-bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-text-primary">{selectedPacket.reason}</h3>
              <p className="mt-1 text-[11px] text-text-muted">Compact rows only; raw evidence remains unloaded until opened.</p>
            </div>
            <button onClick={() => { setSelectedPacket(null); setItem(null); }} className="rounded border border-border-default px-3 py-2 text-xs text-text-secondary">Close packet</button>
          </div>
          <div className="mt-3 space-y-2">
            {packetItems.map(compactItem => (
              <div key={compactItem.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border-default bg-bg-elevated/40 p-3">
                <span className="text-[10px] font-bold text-text-muted">#{compactItem.ordinal}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-text-primary">{compactItem.summary}</div>
                  <div className="mt-1 text-[10px] text-text-muted">
                    Source {compactItem.sourceRecordId} · {compactItem.status}{compactItem.correctionProposed ? ' · correction proposed' : ''}
                  </div>
                </div>
                <button
                  onClick={() => void openItem(compactItem)}
                  disabled={busy === compactItem.id}
                  className="rounded border border-gold-primary/40 px-3 py-2 text-xs font-bold text-gold-primary disabled:opacity-50"
                >
                  {busy === compactItem.id ? 'Opening…' : 'Open evidence'}
                </button>
              </div>
            ))}
            {!packetItems.length && !error && <p className="py-5 text-center text-xs text-text-muted">No compact items on this page.</p>}
          </div>
          {(afterOrdinal > 0 || nextOrdinal != null) && (
            <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
              <button
                disabled={afterOrdinal === 0}
                onClick={() => setAfterOrdinal(value => Math.max(0, value - pageSize))}
                className="rounded border border-border-default px-3 py-2 disabled:opacity-40"
              >
                Previous items
              </button>
              <button
                disabled={nextOrdinal == null}
                onClick={() => setAfterOrdinal(nextOrdinal || 0)}
                className="rounded border border-border-default px-3 py-2 disabled:opacity-40"
              >
                Next items
              </button>
            </div>
          )}
        </div>
      )}

      {item && (
        <div className="rounded-xl border border-gold-primary/30 bg-bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-gold-primary">{item.reason}</div>
              <div className="mt-1 text-[11px] text-text-muted">
                Source {item.sourceRecordId} · {item.normalizationVersion || 'version unavailable'}
              </div>
            </div>
            <button onClick={() => setItem(null)} className="rounded border border-border-default px-3 py-2 text-xs text-text-secondary">Close</button>
          </div>

          <div className="mt-4 rounded-lg border border-border-default bg-bg-elevated/40 p-3 text-xs">
            <div className="font-bold text-text-primary">Review evidence excerpt (contact redacted)</div>
            <div className="mt-2 whitespace-pre-wrap break-words text-text-secondary">{item.reviewEvidenceExcerpt || 'Review evidence is unavailable.'}</div>
            <div className="mt-2 text-[10px] text-text-muted">The raw evidence hash below identifies the exact immutable source message.</div>
            <div className="mt-2 break-all text-[10px] text-text-muted">Raw evidence hash: {item.rawEvidenceHash || 'Unavailable — correction is blocked'}</div>
            <div className="mt-1 break-all text-[10px] text-text-muted">Proposal hash: {item.proposalHash || 'Unavailable — correction is blocked'}</div>
          </div>

          <div className="mt-3 grid gap-2 text-xs text-text-muted sm:grid-cols-2">
            <span>Seller: <strong className="text-text-secondary">{item.sellerNameMasked || 'Masked'}</strong></span>
            <span>Contact: <strong className="text-text-secondary">{item.sellerPhoneMasked || 'Masked'}</strong></span>
          </div>

          {!item.evidenceFresh && (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
              Evidence is stale. Close and reopen this item before proposing a correction.
            </p>
          )}

          {isBundle(item.reason) ? (
            <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-text-secondary">
              Bundle parents cannot be corrected here. <button onClick={openUnbundled} className="font-bold text-gold-primary underline">Open the existing unbundled workflow.</button>
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.keys(draft) as (keyof CorrectionDraft)[]).map(field => (
                  <label key={field} className="text-[10px] uppercase tracking-wide text-text-muted">
                    {field.replace('_', ' ')}
                    <input
                      type={field === 'year' || field === 'price_raw' || field === 'price_usd' ? 'number' : 'text'}
                      value={draft[field]}
                      onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))}
                      className="mt-1 w-full rounded border border-border-default bg-bg-elevated px-2 py-2 text-xs normal-case text-text-primary"
                    />
                  </label>
                ))}
              </div>
              <label className="mt-4 block text-xs font-bold text-text-primary">
                Reviewer rationale <span className="text-red-400">*</span>
                <textarea
                  required
                  value={rationale}
                  onChange={event => setRationale(event.target.value)}
                  placeholder="At least 10 characters. Cite the exact excerpt and explain only the supported correction."
                  className="mt-2 min-h-24 w-full rounded-lg border border-border-default bg-bg-elevated p-3 text-xs font-normal text-text-primary"
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] text-text-muted">Proposal only. Catalog, duplicate, and publication gates still revalidate it.</p>
                <button
                  onClick={() => void submitCorrection()}
                  disabled={Boolean(busy) || !item.evidenceFresh || rationale.trim().length < 10 || !item.reviewEvidenceExcerpt || !item.rawEvidenceHash || !item.proposalHash}
                  className="rounded-lg bg-gold-primary px-4 py-2 text-xs font-bold text-black disabled:opacity-40"
                >
                  Propose correction
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function IdentityReviewLane() {
  const [items, setItems] = useState<IdentityReviewQueueApiItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, IdentityDraft>>({});
  const [assistResults, setAssistResults] = useState<Record<string, CopilotResult>>({});
  const [assistErrors, setAssistErrors] = useState<Record<string, string>>({});
  const [inspected, setInspected] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [brand, setBrand] = useState('');
  const [cursor, setCursor] = useState('');
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const page = cursorHistory.length + 1;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: '50', bucket: 'release-ready' });
    if (brand) params.set('brand', brand);
    if (cursor) params.set('after', cursor);
    setError(null);
    fetch(`/api/identity-review-queue?${params.toString()}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Identity review queue is unavailable');
        return data;
      })
      .then(data => {
        const nextItems = (data.items || []) as IdentityReviewQueueApiItem[];
        setItems(nextItems);
        setNextCursor(data.nextCursor || null);
        setDrafts(Object.fromEntries(nextItems.map(item => [item.record_id, {
          brand: item.brand || '',
          model: item.model || '',
          reference: item.reference || '',
          dial_color: item.dial_color || '',
        }])));
      })
      .catch(fetchError => {
        if (fetchError?.name !== 'AbortError') {
          setError(fetchError instanceof Error ? fetchError.message : 'Identity review queue is unavailable');
        }
      });
    return () => controller.abort();
  }, [brand, cursor]);

  const requestAssist = async (item: IdentityReviewQueueApiItem) => {
    const draft = drafts[item.record_id] || { brand: '', model: '', reference: '', dial_color: '' };
    setBusy(`assist:${item.record_id}`);
    setAssistErrors(current => ({ ...current, [item.record_id]: '' }));
    try {
      const response = await fetch('/api/co-pilot', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawMessage: item.raw_message,
          currentGuess: {
            brand: draft.brand,
            model: draft.model,
            reference: draft.reference,
            dialColor: draft.dial_color,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'AI review assistance failed');
      setAssistResults(current => ({ ...current, [item.record_id]: data.copilot as CopilotResult }));
    } catch (assistError) {
      setAssistErrors(current => ({
        ...current,
        [item.record_id]: assistError instanceof Error ? assistError.message : 'AI review assistance failed',
      }));
    } finally {
      setBusy(null);
    }
  };

  const applyIdentitySuggestions = (item: IdentityReviewQueueApiItem, onlyMissing: boolean, selected?: CopilotSuggestion) => {
    const result = assistResults[item.record_id];
    if (!result) return;
    const currentDraft = drafts[item.record_id] || { brand: '', model: '', reference: '', dial_color: '' };
    const suggestions = selected ? [selected] : result.suggestions;
    const nextDraft = { ...currentDraft };
    for (const suggestion of suggestions) {
      const field = identitySuggestionField(suggestion.field);
      if (!field || !suggestionCanPopulateDraft(suggestion) || (onlyMissing && nextDraft[field].trim())) continue;
      nextDraft[field] = suggestion.value || '';
    }
    setDrafts(current => ({ ...current, [item.record_id]: nextDraft }));
  };

  const submit = async (item: IdentityReviewQueueApiItem, decision: 'APPROVE' | 'CONFLICT') => {
    const reason = reasons[item.record_id]?.trim() || '';
    const canonical = drafts[item.record_id];
    if (!inspected[item.record_id] || reason.length < 12) return;
    if (decision === 'APPROVE' && (!canonical || Object.values(canonical).some(value => !value.trim()))) return;

    setBusy(item.record_id);
    setError(null);
    setResult(null);
    try {
      const response = await fetch('/api/identity-review-decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: item.record_id,
          decision,
          reason,
          canonical: decision === 'APPROVE' ? canonical : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Identity review decision failed');
      setItems(current => current.filter(candidate => candidate.record_id !== item.record_id));
      setResult(data.customer_publishable
        ? `${item.record_id} is human-approved and now customer-publishable.`
        : `${item.record_id} identity decision saved; other release blockers still prevent publication.`);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Identity review decision failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-default bg-bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Released watch identity review</h2>
            <p className="mt-1 max-w-3xl text-xs text-text-muted">
              Actionable identities are loaded in bounded pages of 50, with no synchronous global count across the 1.4M-row unresolved universe. Normalization, market-data, bundle, duplicate, and missing-evidence cases stay in their own lanes. Approval requires the exact reference in the preserved raw listing and a catalog-compatible dial.
            </p>
          </div>
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            Brand
            <select
              value={brand}
              onChange={event => {
                setBrand(event.target.value);
                setCursor('');
                setCursorHistory([]);
                setNextCursor(null);
              }}
              className="mt-1 block rounded-lg border border-border-default bg-bg-elevated px-3 py-2 text-xs normal-case text-text-primary"
            >
              <option value="">Rolex + Patek</option>
              <option value="Rolex">Rolex</option>
              <option value="Patek Philippe">Patek Philippe</option>
            </select>
          </label>
        </div>
        {result && <p className="mt-3 text-xs text-emerald-300">{result}</p>}
        {error && <p className="mt-3 text-xs text-red-400" role="alert">{error}</p>}
      </div>

      {items.map(item => {
        const draft = drafts[item.record_id] || { brand: '', model: '', reference: '', dial_color: '' };
        const assistance = assistResults[item.record_id];
        const identitySuggestions = preferredSuggestions(assistance?.suggestions || [])
          .filter(suggestion => identitySuggestionField(suggestion.field));
        const reason = reasons[item.record_id] || '';
        const candidateImage = item.thumbnail_url || item.image_urls?.[0] || null;
        const approvalReady = Boolean(
          item.review_disposition === 'READY_FOR_IDENTITY_REVIEW'
          &&
          inspected[item.record_id]
          && item.raw_message
          && reason.trim().length >= 12
          && Object.values(draft).every(value => value.trim()),
        );
        return (
          <article key={item.record_id} className="rounded-xl border border-border-default bg-bg-card p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-amber-500/30 px-2 py-1 font-bold text-amber-300">{item.identity_status}</span>
                  <span className="break-all text-text-muted">{item.record_id}</span>
                  <span className="text-text-muted">{item.source || 'Unknown source'}{item.source_type ? ` · ${item.source_type}` : ''}</span>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Immutable raw listing</div>
                  <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border-default bg-bg-elevated p-3 text-xs text-text-secondary">
                    {item.raw_message || 'Raw evidence missing. Approval is blocked.'}
                  </div>
                </div>
                <div className="rounded-lg border border-gold-primary/25 bg-gold-primary/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-bold text-text-primary">
                        <Sparkles size={13} className="text-gold-primary" />
                        Missing-field assistant
                      </div>
                      <p className="mt-1 text-[11px] text-text-muted">
                        Finds exact raw-message evidence and exact-reference catalog identity. Suggestions only fill this draft; you still inspect and approve.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void requestAssist(item)}
                      disabled={busy === `assist:${item.record_id}` || !item.raw_message}
                      className="inline-flex items-center gap-2 rounded-lg border border-gold-primary/40 px-3 py-2 text-xs font-bold text-gold-primary disabled:opacity-40"
                    >
                      {busy === `assist:${item.record_id}` ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                      Complete supported fields
                    </button>
                  </div>
                  {assistErrors[item.record_id] && <p className="mt-3 text-xs text-red-400">{assistErrors[item.record_id]}</p>}
                  {assistance && (
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded border border-border-default px-2 py-1 text-[10px] font-bold text-text-secondary">
                          {assistance.fillableFields.filter(field => identitySuggestionField(field as CopilotSuggestion['field'])).length} missing fields supported
                        </span>
                        <span className="rounded border border-border-default px-2 py-1 text-[10px] text-text-muted">
                          AI confidence {Math.max(0, Math.min(100, assistance.confidence || 0))}% — advisory only
                        </span>
                        <button
                          type="button"
                          onClick={() => applyIdentitySuggestions(item, true)}
                          disabled={!identitySuggestions.some(suggestion => {
                            const field = identitySuggestionField(suggestion.field);
                            return field && !draft[field].trim() && suggestionCanPopulateDraft(suggestion);
                          })}
                          className="ml-auto rounded border border-emerald-500/40 px-2 py-1 text-[10px] font-bold text-emerald-300 disabled:opacity-40"
                        >
                          Fill supported blanks
                        </button>
                      </div>
                      <p className="text-xs text-text-secondary">{assistance.summary}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {identitySuggestions.map((suggestion, index) => {
                          const field = identitySuggestionField(suggestion.field);
                          const canUse = Boolean(field && suggestionCanPopulateDraft(suggestion));
                          return (
                            <div key={`${suggestion.field}:${suggestion.support}:${index}`} className="rounded border border-border-default bg-bg-elevated p-2 text-[11px]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold uppercase tracking-wide text-text-muted">{suggestion.field}</span>
                                <span className={suggestion.support === 'CATALOG' ? 'text-blue-300' : canUse ? 'text-emerald-300' : 'text-amber-300'}>
                                  {suggestion.status.replaceAll('_', ' ')}
                                </span>
                              </div>
                              <div className="mt-1 break-words font-bold text-text-primary">{suggestion.value || 'No supported value'}</div>
                              <div className="mt-1 break-words text-text-muted">{suggestion.evidenceQuote || suggestion.reason}</div>
                              {canUse && (
                                <button
                                  type="button"
                                  onClick={() => applyIdentitySuggestions(item, false, suggestion)}
                                  className="mt-2 rounded border border-gold-primary/40 px-2 py-1 font-bold text-gold-primary"
                                >
                                  Use in draft
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {assistance.unresolvedFields.some(field => identitySuggestionField(field as CopilotSuggestion['field'])) && (
                        <p className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-200">
                          Still requires human evidence: {assistance.unresolvedFields.filter(field => identitySuggestionField(field as CopilotSuggestion['field'])).join(', ')}. These remain blank instead of being guessed.
                        </p>
                      )}
                      {assistance.ambiguities.length > 0 && (
                        <p className="text-[11px] text-amber-200">
                          Check manually: {assistance.ambiguities.join('; ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.keys(draft) as (keyof IdentityDraft)[]).map(field => (
                    <label key={field} className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                      {field.replace('_', ' ')}
                      {field === 'brand' ? (
                        <select
                          value={draft[field]}
                          onChange={event => setDrafts(current => ({
                            ...current,
                            [item.record_id]: { ...draft, [field]: event.target.value },
                          }))}
                          className="mt-1 w-full rounded-lg border border-border-default bg-bg-elevated px-3 py-2 text-xs normal-case text-text-primary"
                        >
                          <option value="">Select brand</option>
                          <option value="Rolex">Rolex</option>
                          <option value="Patek Philippe">Patek Philippe</option>
                        </select>
                      ) : (
                        <input
                          value={draft[field]}
                          onChange={event => setDrafts(current => ({
                            ...current,
                            [item.record_id]: { ...draft, [field]: event.target.value },
                          }))}
                          className="mt-1 w-full rounded-lg border border-border-default bg-bg-elevated px-3 py-2 text-xs normal-case text-text-primary"
                        />
                      )}
                    </label>
                  ))}
                </div>
                {Boolean(item.release_blockers?.length) && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
                    Other release blockers: {item.release_blockers?.join(', ')}. Identity approval is audited separately and does not bypass them.
                  </p>
                )}
                <label className="flex items-start gap-3 rounded-lg border border-border-default bg-bg-elevated p-3 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={Boolean(inspected[item.record_id])}
                    onChange={event => setInspected(current => ({ ...current, [item.record_id]: event.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>I inspected the complete raw listing and confirm my decision is supported by that evidence.</span>
                </label>
                <label className="block text-xs font-bold text-text-primary">
                  Reviewer reason <span className="text-red-400">*</span>
                  <textarea
                    value={reason}
                    onChange={event => setReasons(current => ({ ...current, [item.record_id]: event.target.value }))}
                    placeholder="At least 12 characters. Cite the exact reference and dial evidence."
                    className="mt-2 min-h-20 w-full rounded-lg border border-border-default bg-bg-elevated p-3 text-xs font-normal text-text-primary"
                  />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => void submit(item, 'APPROVE')}
                    disabled={busy === item.record_id || !approvalReady}
                    className="rounded-lg bg-gold-primary px-4 py-2 text-xs font-bold text-black disabled:opacity-40"
                  >
                    Human approve identity
                  </button>
                  <button
                    onClick={() => void submit(item, 'CONFLICT')}
                    disabled={busy === item.record_id || !inspected[item.record_id] || reason.trim().length < 12}
                    className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-300 disabled:opacity-40"
                  >
                    Confirm conflict
                  </button>
                </div>
              </div>

              <aside className="space-y-3">
                <div className="rounded-lg border border-border-default bg-bg-elevated p-3 text-xs text-text-secondary">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Observed seller evidence</div>
                  <div className="mt-2">Name: <strong className="text-text-primary">{item.seller_name || 'Not provided'}</strong></div>
                  <div>Phone: <strong className="text-text-primary">{item.seller_phone || 'Not provided'}</strong></div>
                  <div>Posted: <strong className="text-text-primary">{item.listing_date || item.created_at || 'Not provided'}</strong></div>
                </div>
                <div className="overflow-hidden rounded-lg border border-border-default bg-bg-elevated">
                  {candidateImage ? (
                    <>
                      <img src={candidateImage} alt="Source-linked candidate requiring separate visual review" className="h-72 w-full object-contain" />
                      <p className="border-t border-border-default p-2 text-[10px] text-amber-200">
                        Source candidate only. Customer image publication still requires the separate Images decision.
                      </p>
                    </>
                  ) : (
                    <div className="flex h-40 items-center justify-center p-4 text-center text-xs text-text-muted">
                      No source image candidate is linked to this identity.
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </article>
        );
      })}

      {!error && items.length === 0 && (
        <div className="rounded-xl border border-border-default bg-bg-card p-6 text-center text-sm text-text-muted">
          No unresolved identities were returned for this page.
        </div>
      )}
      {(page > 1 || nextCursor) && (
        <div className="flex justify-center gap-3">
          <button
            onClick={() => {
              const priorCursors = [...cursorHistory];
              setCursor(priorCursors.pop() || '');
              setCursorHistory(priorCursors);
            }}
            disabled={page === 1}
            className="rounded-lg border border-border-default px-4 py-2 text-xs text-text-secondary disabled:opacity-40"
          >
            Previous
          </button>
          <span className="px-3 py-2 text-xs text-text-muted">Page {page}</span>
          <button
            onClick={() => {
              if (!nextCursor) return;
              setCursorHistory(current => [...current, cursor]);
              setCursor(nextCursor);
            }}
            disabled={!nextCursor}
            className="rounded-lg border border-border-default px-4 py-2 text-xs text-text-secondary disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function ImageReviewLane() {
  const [items, setItems] = useState<ImageReviewQueueApiItem[]>([]);
  const [choices, setChoices] = useState<Record<string, 'MATCH' | 'NO_MATCH' | undefined>>({});
  const [inspected, setInspected] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [visualChecks, setVisualChecks] = useState<Record<string, VerifyImageResult | undefined>>({});
  const [visualBusy, setVisualBusy] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    const imageQueueUrl = `/api/image-review-queue?release=true&limit=50${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`;
    fetch(imageQueueUrl, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Image review queue is unavailable');
        return data;
      })
      .then(data => {
        setItems((data.items || []) as ImageReviewQueueApiItem[]);
        setNextCursor(String(data.nextCursor || '') || null);
      })
      .catch(fetchError => {
        if (fetchError?.name !== 'AbortError') {
          setError(fetchError instanceof Error ? fetchError.message : 'Image review queue is unavailable');
        }
      });
    return () => controller.abort();
  }, [cursor]);

  const submit = async (item: ImageReviewQueueApiItem) => {
    const visualMatch = choices[item.source_object_key];
    const reason = reasons[item.source_object_key]?.trim() || '';
    if (item.review_blocked || !item.public_url || !visualMatch || !inspected[item.source_object_key] || reason.length < 12) return;

    setBusy(item.source_object_key);
    setError(null);
    try {
      const response = await fetch('/api/image-review-decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceObjectKey: item.source_object_key,
          recordId: item.record_id,
          visualMatch,
          reason,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image review decision failed');
      setItems(current => current.filter(candidate => candidate.source_object_key !== item.source_object_key));
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Image review decision failed');
    } finally {
      setBusy(null);
    }
  };

  const runVisualCheck = async (item: ImageReviewQueueApiItem) => {
    if (!item.public_url || !item.reference) return;
    setVisualBusy(item.source_object_key);
    setError(null);
    try {
      const result = await verifyImageReference(
        item.public_url,
        item.reference,
        item.brand || undefined,
        item.dial_color || undefined,
        item.model || undefined,
      );
      setVisualChecks(current => ({ ...current, [item.source_object_key]: result }));
    } finally {
      setVisualBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-default bg-bg-card p-4">
        <h2 className="text-sm font-bold text-text-primary">Exact image-to-listing review</h2>
        <p className="mt-1 text-xs text-text-muted">
          Full reviewed Rolex/Patek scope. Compare the actual source image with the preserved raw listing. No image is attached until a reviewer makes an explicit decision.
        </p>
        {error && <p className="mt-3 text-xs text-red-400" role="alert">{error}</p>}
      </div>

      {items.map(item => {
        const key = item.source_object_key;
        const choice = choices[key];
        const reason = reasons[key] || '';
        const visualCheck = visualChecks[key];
        return (
          <article key={key} className="rounded-xl border border-border-default bg-bg-card p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(240px,360px)_1fr]">
              <div className="overflow-hidden rounded-lg border border-border-default bg-bg-elevated">
                {item.public_url ? (
                  <img
                    src={item.public_url}
                    alt={`Source candidate for ${item.brand || 'watch'} ${item.reference || item.record_id}`}
                    className="h-80 w-full object-contain"
                  />
                ) : (
                  <div className="flex h-80 items-center justify-center p-6 text-center text-xs text-red-300">
                    Reachable source image unavailable. This item cannot be approved.
                  </div>
                )}
              </div>

              <div className="min-w-0 space-y-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Current listing identity</div>
                  <div className="mt-2 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                    <span>Brand: <strong className="text-text-primary">{item.brand || 'Unresolved'}</strong></span>
                    <span>Model: <strong className="text-text-primary">{item.model || 'Unresolved'}</strong></span>
                    <span>Reference: <strong className="text-text-primary">{item.reference || 'Unresolved'}</strong></span>
                    <span>Dial: <strong className="text-text-primary">{item.dial_color || 'Unresolved'}</strong></span>
                    <span>Record: <strong className="break-all text-text-primary">{item.record_id}</strong></span>
                    <span>Image status: <strong className="text-text-primary">{item.image_status || 'Pending'}</strong></span>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Preserved raw listing</div>
                  <div className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border-default bg-bg-elevated p-3 text-xs text-text-secondary">
                    {item.raw_message || String(item.evidence?.raw_message || '') || 'Raw listing unavailable. Do not approve.'}
                  </div>
                </div>

                <section className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs text-text-secondary">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-text-primary">AI visual check (advisory only)</h3>
                      <p className="mt-1 max-w-2xl">Reads only this source image. It does not receive the raw listing, change fields, attach the image, or make your review decision.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void runVisualCheck(item)}
                      disabled={!item.public_url || !item.reference || visualBusy === key}
                      className="rounded-lg border border-sky-400/40 px-3 py-2 text-xs font-bold text-sky-200 disabled:opacity-40"
                    >
                      {visualBusy === key ? 'Checking image…' : 'Compare image to listing identity'}
                    </button>
                  </div>
                  {!item.reference && <p className="mt-2 text-amber-200">A reference is required before AI can make an exact visual comparison.</p>}
                  {visualCheck && (
                    <div className="mt-3 rounded-md border border-border-default bg-bg-elevated p-3">
                      {visualCheck.success ? (
                        <>
                          <p className={visualCheck.verdict === 'MISMATCH' ? 'font-bold text-red-300' : 'font-bold text-text-primary'}>
                            {visualCheck.verdict === 'MATCH' ? 'Visible reference agrees; reviewer decision is still required.' : visualCheck.verdict === 'MISMATCH' ? 'Visible conflict; do not attach until a reviewer adjudicates.' : 'No exact visual proof; keep this unverified until you inspect it.'}
                          </p>
                          <p className="mt-1">{visualCheck.reason}</p>
                          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                            <div><dt className="text-text-muted">Observed brand</dt><dd>{visualCheck.image?.brand || 'UNKNOWN'} ({visualCheck.checks?.brand || 'NOT_VISIBLE'})</dd></div>
                            <div><dt className="text-text-muted">Observed reference</dt><dd>{visualCheck.image?.referenceVisible || 'UNKNOWN'} ({visualCheck.checks?.reference || 'NOT_VISIBLE'})</dd></div>
                            <div><dt className="text-text-muted">Observed model</dt><dd>{visualCheck.image?.modelGuess || 'UNKNOWN'} ({visualCheck.checks?.model || 'NOT_VISIBLE'})</dd></div>
                            <div><dt className="text-text-muted">Observed dial</dt><dd>{visualCheck.image?.dialColor || 'UNKNOWN'} ({visualCheck.checks?.dial || 'NOT_VISIBLE'})</dd></div>
                          </dl>
                        </>
                      ) : <p className="text-red-300">AI visual check unavailable: {visualCheck.error || visualCheck.reason}</p>}
                    </div>
                  )}
                </section>

                {item.review_blocked && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
                    Review blocked: {item.review_blockers?.join(', ') || 'the exact image or listing evidence is incomplete'}.
                  </p>
                )}

                <label className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={Boolean(inspected[key])}
                    onChange={event => setInspected(current => ({ ...current, [key]: event.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>I inspected this exact image beside this exact raw listing.</span>
                </label>

                <fieldset>
                  <legend className="text-xs font-bold text-text-primary">Visual decision (required)</legend>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {(['MATCH', 'NO_MATCH'] as const).map(value => (
                      <label key={value} className="flex items-center gap-2 rounded-lg border border-border-default px-3 py-2 text-xs text-text-secondary">
                        <input
                          type="radio"
                          name={`image-decision-${key}`}
                          checked={choice === value}
                          onChange={() => setChoices(current => ({ ...current, [key]: value }))}
                        />
                        {value === 'MATCH' ? 'MATCH — attach to this listing' : 'NO MATCH — keep unattached'}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="block text-xs font-bold text-text-primary">
                  Reviewer reason <span className="text-red-400">*</span>
                  <textarea
                    value={reason}
                    onChange={event => setReasons(current => ({ ...current, [key]: event.target.value }))}
                    minLength={12}
                    placeholder="At least 12 characters citing the visual and listing evidence."
                    className="mt-2 min-h-20 w-full rounded-lg border border-border-default bg-bg-elevated p-3 text-xs font-normal text-text-primary"
                  />
                </label>

                <button
                  onClick={() => void submit(item)}
                  disabled={busy === key || item.review_blocked || !item.public_url || !inspected[key] || !choice || reason.trim().length < 12}
                  className="rounded-lg bg-gold-primary px-4 py-2 text-xs font-bold text-black disabled:opacity-40"
                >
                  {busy === key ? 'Saving decision…' : 'Submit image decision'}
                </button>
              </div>
            </div>
          </article>
        );
      })}

      {!error && items.length === 0 && (
        <div className="rounded-xl border border-border-default bg-bg-card p-6 text-center text-sm text-text-muted">
          No pending image matches were returned on this page.
        </div>
      )}

      {(cursorHistory.length > 0 || nextCursor) && (
        <div className="flex items-center justify-between rounded-xl border border-border-default bg-bg-card p-4 text-xs text-text-muted">
          <button
            type="button"
            disabled={cursorHistory.length === 0}
            onClick={() => {
              const previous = cursorHistory.at(-1) ?? null;
              setCursorHistory(current => current.slice(0, -1));
              setCursor(previous);
            }}
            className="rounded-lg border border-border-default px-4 py-2 disabled:opacity-40"
          >
            Previous
          </button>
          <span>Image review page {cursorHistory.length + 1}</span>
          <button
            type="button"
            disabled={!nextCursor}
            onClick={() => {
              if (!nextCursor) return;
              setCursorHistory(current => [...current, cursor]);
              setCursor(nextCursor);
            }}
            className="rounded-lg border border-border-default px-4 py-2 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function SellerLineageReviewLane() {
  const [items, setItems] = useState<SellerLineageReviewQueueApiItem[]>([]);
  const [exactMatches, setExactMatches] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<number | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<number | null>>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    const sellerQueueUrl = `/api/seller-lineage-review-queue?limit=50${cursor !== null ? `&cursor=${cursor}` : ''}`;
    fetch(sellerQueueUrl, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Seller lineage queue is unavailable');
        return data;
      })
      .then(data => {
        setItems((data.items || []) as SellerLineageReviewQueueApiItem[]);
        const returnedCursor = Number(data.nextCursor);
        setNextCursor(Number.isSafeInteger(returnedCursor) && returnedCursor > 0 ? returnedCursor : null);
      })
      .catch(fetchError => {
        if (fetchError?.name !== 'AbortError') {
          setError(fetchError instanceof Error ? fetchError.message : 'Seller lineage queue is unavailable');
        }
      });
    return () => controller.abort();
  }, [cursor]);

  const submit = async (item: SellerLineageReviewQueueApiItem, decision: 'APPROVE' | 'REJECT') => {
    const reason = reasons[item.lineage_id]?.trim() || '';
    const dealerId = item.proposed_dealer?.id || item.dealer_id || '';
    const recordId = item.record_id || item.source_record_id || '';
    if (reason.length < 12 || !recordId || (decision === 'APPROVE' && (!exactMatches[item.lineage_id] || !dealerId))) return;

    setBusy(item.lineage_id);
    setError(null);
    try {
      const response = await fetch('/api/seller-lineage-review-decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineageId: item.lineage_id,
          recordId,
          dealerId: dealerId || null,
          decision,
          reason,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Seller lineage decision failed');
      setItems(current => current.filter(candidate => candidate.lineage_id !== item.lineage_id));
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Seller lineage decision failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-default bg-bg-card p-4">
        <h2 className="text-sm font-bold text-text-primary">Exact seller-to-listing review</h2>
        <p className="mt-1 text-xs text-text-muted">
          Approve only when the preserved listing identity maps exactly to the proposed verified dealer. Contact details remain private.
        </p>
        {error && <p className="mt-3 text-xs text-red-400" role="alert">{error}</p>}
      </div>

      {items.map(item => {
        const proposedDealer = item.proposed_dealer;
        const dealerId = proposedDealer?.id || item.dealer_id || '';
        const reason = reasons[item.lineage_id] || '';
        const rawMessage = item.raw_message || String(item.match_evidence?.raw_message || '');
        return (
          <article key={item.lineage_id} className="rounded-xl border border-border-default bg-bg-card p-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Observed private source evidence</div>
                <div className="grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                  <span>Seller name: <strong className="text-text-primary">{item.observed_name || 'Not present'}</strong></span>
                  <span>Masked identity: <strong className="text-text-primary">{item.source_identity_masked || item.source_identity || 'Unavailable'}</strong></span>
                  <span>Source: <strong className="text-text-primary">{item.source_system || 'Unknown'}</strong></span>
                  <span>Listing type: <strong className="text-text-primary">{item.source_listing_type || 'Unknown'}</strong></span>
                  <span>Posted: <strong className="text-text-primary">{item.source_posted_at ? new Date(item.source_posted_at).toLocaleString() : 'Not preserved'}</strong></span>
                  <span>Record: <strong className="break-all text-text-primary">{item.record_id || item.source_record_id || 'Not linked'}</strong></span>
                </div>
                <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border-default bg-bg-elevated p-3 text-xs text-text-secondary">
                  {rawMessage || 'Raw listing unavailable. Do not approve.'}
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Proposed verified dealer</div>
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs text-text-secondary">
                  <div>Dealer: <strong className="text-text-primary">{proposedDealer?.display_name || item.dealer_name || 'Unresolved'}</strong></div>
                  <div className="mt-2">Company: <strong className="text-text-primary">{proposedDealer?.company_name || item.dealer_company || 'Unresolved'}</strong></div>
                  <div className="mt-2">Verified dealer ID: <strong className="break-all text-text-primary">{dealerId || 'Unresolved'}</strong></div>
                  <div className="mt-2">Status: <strong className="text-text-primary">{proposedDealer?.status || item.match_status || 'Pending'}</strong></div>
                </div>

                <label className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={Boolean(exactMatches[item.lineage_id])}
                    onChange={event => setExactMatches(current => ({ ...current, [item.lineage_id]: event.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>I confirm the source seller, this exact listing, and the proposed verified dealer are the same identity.</span>
                </label>

                <label className="block text-xs font-bold text-text-primary">
                  Reviewer reason <span className="text-red-400">*</span>
                  <textarea
                    value={reason}
                    onChange={event => setReasons(current => ({ ...current, [item.lineage_id]: event.target.value }))}
                    minLength={12}
                    placeholder="At least 12 characters citing the exact identity evidence."
                    className="mt-2 min-h-20 w-full rounded-lg border border-border-default bg-bg-elevated p-3 text-xs font-normal text-text-primary"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void submit(item, 'APPROVE')}
                    disabled={busy === item.lineage_id || !dealerId || !exactMatches[item.lineage_id] || reason.trim().length < 12 || !rawMessage}
                    className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black disabled:opacity-40"
                  >
                    Approve exact seller link
                  </button>
                  <button
                    onClick={() => void submit(item, 'REJECT')}
                    disabled={busy === item.lineage_id || reason.trim().length < 12}
                    className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-300 disabled:opacity-40"
                  >
                    Reject proposed link
                  </button>
                </div>
              </div>
            </div>
          </article>
        );
      })}

      {!error && items.length === 0 && (
        <div className="rounded-xl border border-border-default bg-bg-card p-6 text-center text-sm text-text-muted">
          No pending seller matches were returned on this page.
        </div>
      )}

      {(cursorHistory.length > 0 || nextCursor !== null) && (
        <div className="flex items-center justify-between rounded-xl border border-border-default bg-bg-card p-4 text-xs text-text-muted">
          <button
            type="button"
            disabled={cursorHistory.length === 0}
            onClick={() => {
              const previous = cursorHistory.at(-1) ?? null;
              setCursorHistory(current => current.slice(0, -1));
              setCursor(previous);
            }}
            className="rounded-lg border border-border-default px-4 py-2 disabled:opacity-40"
          >
            Previous
          </button>
          <span>Seller review page {cursorHistory.length + 1}</span>
          <button
            type="button"
            disabled={nextCursor === null}
            onClick={() => {
              if (nextCursor === null) return;
              setCursorHistory(current => [...current, cursor]);
              setCursor(nextCursor);
            }}
            className="rounded-lg border border-border-default px-4 py-2 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default function ReviewQueue() {
  const [lane, setLane] = useState<'dealer-posts' | 'identity' | 'shadow' | 'unbundled' | 'duplicates' | 'price' | 'packets' | 'images' | 'sellers'>('dealer-posts');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [reasonFilter, setReasonFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ShadowProgress | null>(null);
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<Record<string, CopilotResult>>({});
  const [aiErrors, setAiErrors] = useState<Record<string, string>>({});
  const [unbundledBucket, setUnbundledBucket] = useState<'review-ready' | 'human-correction'>('review-ready');
  const [unbundledPage, setUnbundledPage] = useState(1);
  const [unbundledTotal, setUnbundledTotal] = useState(0);
  const [duplicateReviewed, setDuplicateReviewed] = useState<Set<string>>(new Set());
  const [reviewerSession, setReviewerSession] = useState<{ email?: string; role?: string } | null>(null);
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, CorrectionDraft>>({});
  const [contactRevealBusy, setContactRevealBusy] = useState<string | null>(null);
  const [contactRevealErrors, setContactRevealErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/dealer-auth', { credentials: 'include', signal: controller.signal })
      .then(async response => response.ok ? response.json() : null)
      .then(result => {
        if (result?.authenticated === true) setReviewerSession(result.user || null);
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setReviewerSession(null);
      });
    return () => controller.abort();
  }, []);

  // Decisions are sent to the audited server transaction. The client never
  // writes market records directly.
  useEffect(() => {
    let active = true;
    setLoadError(null);
    if (lane === 'duplicates') {
      const params = new URLSearchParams({ limit: '50', page: '1', status: 'PENDING' });
      fetch(`/api/duplicate-review-queue?${params.toString()}`, { credentials: 'include' })
        .then(async response => {
          if (!response.ok) throw new Error('Duplicate review queue is unavailable');
          return response.json();
        })
        .then(data => {
          if (!active) return;
          setUnbundledTotal(Number(data.total || 0));
          setItems(((data.items || []) as DuplicateQueueApiItem[]).map((item): ReviewItem => {
            const duplicate = item.duplicate || {};
            return {
              id: item.id,
              reference: String(duplicate.reference || item.evidence?.reference || 'Unresolved'),
              brand: String(duplicate.brand || 'Unknown'),
              model: 'Duplicate candidate',
              dial: String(duplicate.dial_color || item.evidence?.dial || 'Unverified'),
              price: Number(duplicate.price_usd || item.evidence?.candidate_price || 0),
              currency: String(duplicate.currency || 'Unknown'),
              aiFields: [item.match_type],
              catalogFields: [],
              catalog: null,
              status: 'pending',
              submittedAt: String(item.created_at || new Date(0).toISOString()),
              listingTitle: String(duplicate.raw_message || 'Raw duplicate candidate message unavailable'),
              reviewReasons: [item.match_type, ...(item.bundle_risk ? ['BUNDLE_RISK'] : [])],
              disposition: 'HUMAN_REVIEW',
              priority: Math.round(Number(item.confidence || 0) * 100),
              rawMessage: String(duplicate.raw_message || ''),
              sellerName: String(duplicate.seller_name || '') || null,
              sellerPhone: String(duplicate.seller_phone || '') || null,
              originalPostedAt: String(duplicate.listing_date || duplicate.created_at || '') || null,
              source: String(duplicate.source || '') || null,
              sourceType: String(duplicate.source_type || '') || null,
              duplicate: {
                candidateId: item.id,
                canonical: item.canonical,
                duplicate: item.duplicate,
                matchType: item.match_type,
                confidence: Number(item.confidence || 0),
                bundleRisk: Boolean(item.bundle_risk),
                status: item.status,
              },
            };
          }));
        })
        .catch(error => {
          if (active) setLoadError(error instanceof Error ? error.message : 'Duplicate review queue is unavailable');
        });
      return () => { active = false; };
    }
    if (lane === 'price') {
      const params = new URLSearchParams({ limit: '50', page: '1' });
      fetch(`/api/price-remediation-review?${params.toString()}`, { credentials: 'include' })
        .then(async response => {
          if (!response.ok) throw new Error('Price remediation queue is unavailable');
          return response.json();
        })
        .then(data => {
          if (!active) return;
          setUnbundledTotal(Number(data.total || 0));
          setItems(((data.items || []) as PriceRemediationQueueApiItem[]).map((item): ReviewItem => {
            const source = item.source || {};
            return {
              id: String(item.id),
              reference: String(source.reference || 'Unresolved'),
              brand: String(source.brand || 'Unknown'),
              model: String(source.model || 'Price-only correction'),
              dial: String(source.dial_color || 'Unverified'),
              price: Number(item.proposed_price_usd || 0),
              currency: 'USD',
              aiFields: [item.normalization_reason, ...(item.audit_flags || [])],
              catalogFields: [],
              catalog: null,
              status: 'pending',
              submittedAt: String(item.created_at || new Date(0).toISOString()),
              listingTitle: `Stored $${Number(item.stored_price_usd).toLocaleString()} -> proposed $${Number(item.proposed_price_usd).toLocaleString()}`,
              reviewReasons: [item.normalization_reason, ...(item.audit_flags || [])],
              disposition: 'HUMAN_REVIEW',
              priority: 100,
              rawMessage: String(source.raw_message || ''),
              reviewEvidence: {
                source_record_id: item.source_record_id,
                stored_price_usd: item.stored_price_usd,
                proposed_price_usd: item.proposed_price_usd,
                evidence_line: item.evidence_line,
                front_image: source.thumbnail_url || null,
              },
              sellerName: String(source.seller_name || '') || null,
              sellerPhone: String(source.seller_phone || '') || null,
              originalPostedAt: String(source.listing_date || source.created_at || '') || null,
              source: String(source.source || '') || null,
              sourceType: String(source.source_type || '') || null,
            };
          }));
        })
        .catch(error => {
          if (active) setLoadError(error instanceof Error ? error.message : 'Price remediation queue is unavailable');
        });
      return () => { active = false; };
    }
    if (lane === 'unbundled') {
      const params = new URLSearchParams({ limit: '50', page: String(unbundledPage), bucket: unbundledBucket });
      if (search.trim()) params.set('search', search.trim());
      fetch(`/api/unbundled-review-queue?${params.toString()}`, { credentials: 'include' })
        .then(async response => {
          if (!response.ok) throw new Error('Unbundled review queue is unavailable');
          return response.json();
        })
        .then(data => {
          if (!active) return;
          setUnbundledTotal(Number(data.total || 0));
          setItems(((data.items || []) as UnbundledQueueApiItem[]).map((item): ReviewItem => {
            const ready = item.reviewBucket === 'review-ready' && item.catalogConfirmed && item.exactRawLineage;
            const flags = item.flags || [];
            return {
              id: item.id,
              reference: item.reference || 'Unresolved',
              brand: item.brand || 'Unknown',
              model: 'Unbundled child',
              dial: item.dial_color || 'Unverified',
              price: Number(item.price_usd || item.price_raw || 0),
              currency: item.currency || 'Unknown',
              aiFields: flags.filter(flag => flag.startsWith('BLOCKER:')),
              catalogFields: ready ? ['reference', 'brand', ...(item.dial_color ? ['dial'] : [])] : [],
              catalog: ready ? { reference: item.reference, brand: item.brand, matchType: 'exact' } : null,
              status: 'pending',
              submittedAt: item.created_at || new Date(0).toISOString(),
              listingTitle: item.raw_message || 'Raw child line unavailable',
              reviewReasons: [
                ...flags.filter(flag => flag.startsWith('REVIEW:') || flag.startsWith('BLOCKER:')),
                ...(item.dealerAttributionMissing ? ['DEALER_ATTRIBUTION_MISSING'] : []),
              ...(item.multi_listing ? ['MULTI_LISTING'] : []),
              ],
              disposition: ready ? 'READY_FOR_HUMAN_APPROVAL' : 'HUMAN_REVIEW',
              priority: ready ? 30 : 90,
              rawMessage: item.raw_message || undefined,
              reviewEvidence: {
                ...(item.field_confidence || {}),
                ...(item.seller_lineage_status ? { seller_lineage_status: item.seller_lineage_status } : {}),
                ...(item.seller_contact_available ? { seller_contact_available: true } : {}),
                // ponytail: multi-listing children show no front_image, but recycle_image_url is preserved for admin
                ...(item.recycle_image_url ? { recycle_image_url: item.recycle_image_url } : {}),
              },
              sellerName: item.seller_name || String(item.field_confidence?.seller_name || '') || null,
              sellerPhone: item.seller_phone || String(item.field_confidence?.seller_phone || '') || null,
              originalPostedAt: item.original_posted_at || item.created_at || null,
              // ponytail: multi-listing children get no imageUrl — image suppressed to avoid wrong-watch misattribution
              imageUrl: item.multi_listing ? undefined : (item.front_image || undefined),
              multiListing: item.multi_listing || false,
              source: String(item.source || '') || null,
              condition: item.condition || null,
              year: item.year ?? null,
              priceRaw: item.price_raw ?? null,
              priceUsd: item.price_usd ?? null,
              listingType: item.listing_type || null,
            };
          }));
        })
        .catch(error => {
          if (active) setLoadError(error instanceof Error ? error.message : 'Unbundled review queue is unavailable');
        });
      return () => { active = false; };
    }
    if (lane === 'dealer-posts' || lane === 'identity' || lane === 'images' || lane === 'sellers' || lane === 'packets') {
      setItems([]);
      return () => { active = false; };
    }
    const params = new URLSearchParams({ limit: '100', sort: reasonFilter ? 'recent' : 'priority' });
    if (reasonFilter) params.set('reason', reasonFilter);
    fetch(`/api/shadow-review-queue?${params.toString()}`, { credentials: 'include' })
      .then(async response => {
        if (!response.ok) throw new Error('Review queue is unavailable');
        return response.json();
      })
      .then(data => {
        if (!active) return;
        setItems(((data.items || []) as ShadowQueueApiItem[]).map((item): ReviewItem => {
          const candidate = item.candidate || {};
          const catalog = item.decision?.catalog || {};
          const ready = item.decision?.disposition === 'READY_FOR_HUMAN_APPROVAL';
          return {
            id: item.id,
            reference: String(candidate.reference || item.source?.reference || 'Unresolved'),
            brand: String(candidate.brand || item.source?.brand || 'Unknown'),
            model: catalog.model || catalog.collection || 'Catalog review',
            dial: String(candidate.dial_color || 'Unverified'),
            price: Number(candidate.price_usd || candidate.price_raw || 0),
            currency: String(candidate.currency || item.source?.currency || 'Unknown'),
             aiFields: item.changeFlags || [],
             catalogFields: catalog.reference ? ['reference', 'brand', ...(ready && candidate.dial_color ? ['dial'] : [])] : [],
             catalog: catalog.reference ? catalog : null,
            status: 'pending',
            submittedAt: item.analyzedAt,
            listingTitle: String(candidate.raw_line || 'No deterministic candidate extracted'),
            reviewReasons: item.decision?.reasons || [],
            disposition: item.decision?.disposition || 'HUMAN_REVIEW',
            priority: Number(item.priority || 0),
            rawMessage: item.sourceEvidence?.rawMessage || undefined,
            sellerName: item.sourceEvidence?.sellerName || null,
            sellerPhone: item.sourceEvidence?.sellerPhone || null,
            originalPostedAt: item.sourceEvidence?.originalPostingDate || null,
            source: item.sourceEvidence?.source || null,
            sourceType: item.sourceEvidence?.sourceType || null,
          };
        }));
      })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Review queue is unavailable');
      });
    return () => { active = false; };
  }, [lane, reasonFilter, search, unbundledBucket, unbundledPage]);

  useEffect(() => {
    let active = true;
    const loadProgress = async () => {
      try {
        const response = await fetch('/api/shadow-status');
        if (!response.ok) throw new Error('Normalization progress is unavailable');
        const data = await response.json();
        if (active && data.status === 'ok') {
          setProgress({
            rowsAnalyzed: Number(data.rowsAnalyzed || 0),
            total: Number(data.total || 0),
            changed: Number(data.changed || 0),
            pending: Number(data.pending || 0),
            countsEstimated: Boolean(data.countsEstimated),
            lastUpdatedAt: data.lastUpdatedAt || null,
            checkpointAgeSeconds: data.checkpointAgeSeconds,
            checkpointDelayed: Boolean(data.checkpointDelayed),
          });
        }
      } catch {
        // Queue data remains useful when the progress monitor has a transient failure.
      }
    };
    void loadProgress();
    const interval = window.setInterval(loadProgress, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const filtered = items.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false;
    if (search && !item.reference.toLowerCase().includes(search.toLowerCase()) && 
        !item.brand.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const requestAiAssist = async (item: ReviewItem) => {
    setAiBusy(item.id);
    setAiErrors(current => ({ ...current, [item.id]: '' }));
    try {
      const response = await fetch('/api/co-pilot', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawMessage: item.rawMessage || item.listingTitle,
          currentGuess: {
            brand: item.brand,
            model: item.model,
            reference: item.reference,
            dialColor: item.dial,
            condition: item.condition,
            year: item.year,
            price: item.price || null,
            currency: item.currency,
            listingType: item.listingType,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'AI assistance failed');
      setAiResults(current => ({ ...current, [item.id]: data.copilot as CopilotResult }));
    } catch (error) {
      setAiErrors(current => ({
        ...current,
        [item.id]: error instanceof Error ? error.message : 'AI assistance failed',
      }));
    } finally {
      setAiBusy(null);
    }
  };

  const applyCorrectionSuggestions = (item: ReviewItem, selected?: CopilotSuggestion) => {
    const result = aiResults[item.id];
    if (!result) return;
    const draft = draftFor(item);
    const nextDraft = { ...draft };
    const suggestions = selected ? [selected] : result.suggestions;
    for (const suggestion of suggestions) {
      const field = correctionSuggestionField(suggestion.field);
      if (!field || nextDraft[field].trim() || !suggestionCanPopulateDraft(suggestion)) continue;
      nextDraft[field] = suggestion.value || '';
    }
    setCorrectionDrafts(current => ({ ...current, [item.id]: nextDraft }));
  };

  const submitDecision = async (item: ReviewItem, decision: 'APPROVED' | 'REJECTED') => {
    const priceReview = lane === 'price';
    const reason = priceReview
      ? window.prompt(decision === 'APPROVED'
        ? 'Confirm the preserved raw evidence supports this exact USD correction:'
        : 'Reason for rejecting this price correction (required for audit):')
      : decision === 'REJECTED'
        ? window.prompt('Reason for rejection (required for audit):')
        : 'Catalog-confirmed human approval.';
    if (!reason?.trim()) return;

    setDecisionBusy(item.id);
    setDecisionError(null);
    try {
      const response = await fetch(
        lane === 'price' ? '/api/price-remediation-review-decision' : lane === 'unbundled' ? '/api/unbundled-review-decision' : '/api/shadow-review-decision',
        {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lane === 'price'
            ? { reviewId: Number(item.id), decision: decision === 'APPROVED' ? 'APPLY' : 'REJECT', reason }
            : lane === 'unbundled'
              ? { stagingId: item.id, decision, reason, duplicateReviewed: duplicateReviewed.has(item.id) }
              : { sourceRecordId: item.id, decision, operatorId: null, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Review decision failed');
      setItems(current => current.map(candidate => (
        candidate.id === item.id
          ? { ...candidate, status: decision === 'APPROVED' ? 'approved' : 'rejected' }
          : candidate
      )));
      setSelected(null);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Review decision failed');
    } finally {
      setDecisionBusy(null);
    }
  };

  const submitDuplicateDecision = async (item: ReviewItem, decision: 'SUPPRESS' | 'KEEP_BOTH' | 'DEFER') => {
    const reason = window.prompt(
      decision === 'SUPPRESS'
        ? 'Why is this the same observation and safe to suppress from analytics?'
        : decision === 'KEEP_BOTH'
          ? 'Why are both observations valid and distinct?'
          : 'Why should duplicate review remain deferred?'
    );
    if (!reason?.trim()) return;
    setDecisionBusy(item.id);
    setDecisionError(null);
    try {
      const response = await fetch('/api/duplicate-review-decision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: item.id, decision, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Duplicate review decision failed');
      setItems(current => current.filter(candidate => candidate.id !== item.id));
      setSelected(null);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Duplicate review decision failed');
    } finally {
      setDecisionBusy(null);
    }
  };

  const draftFor = (item: ReviewItem): CorrectionDraft => correctionDrafts[item.id] || {
    brand: item.brand === 'Unknown' ? '' : item.brand,
    reference: item.reference === 'Unresolved' ? '' : item.reference,
    dial_color: item.dial === 'Unverified' ? '' : item.dial,
    condition: item.condition || '',
    year: item.year == null ? '' : String(item.year),
    price_raw: item.priceRaw == null ? '' : String(item.priceRaw),
    price_usd: item.priceUsd == null ? '' : String(item.priceUsd),
    currency: item.currency === 'Unknown' ? '' : item.currency,
    listing_type: item.listingType || 'OTHER',
  };

  const submitHumanAction = async (item: ReviewItem, action: 'SAVE' | 'DEFER' | 'RECYCLE') => {
    const reason = action === 'SAVE'
      ? 'Human correction saved; catalog and duplicate gates must revalidate before approval.'
      : window.prompt(action === 'RECYCLE' ? 'Why is this being sent to recycle?' : 'Why should this remain pending?');
    if (action !== 'SAVE' && !reason?.trim()) return;
    setDecisionBusy(item.id);
    setDecisionError(null);
    try {
      const response = await fetch('/api/unbundled-review-action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stagingId: item.id,
          action,
          reason,
          fields: action === 'SAVE' ? draftFor(item) : {},
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Human review action failed');
      setItems(current => current.map(candidate => candidate.id === item.id
        ? { ...candidate, status: action === 'RECYCLE' ? 'rejected' : 'pending' }
        : candidate));
      setSelected(null);
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Human review action failed');
    } finally {
      setDecisionBusy(null);
    }
  };

  const revealContact = async (item: ReviewItem) => {
    setContactRevealBusy(item.id);
    setContactRevealErrors(current => ({ ...current, [item.id]: '' }));
    try {
      const response = await fetch('/api/reviewer-contact-reveal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stagingId: item.id,
          reason: 'Reviewer opened contact while auditing exact raw listing lineage.',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Contact reveal failed');
      setItems(current => current.map(candidate => candidate.id === item.id ? {
        ...candidate,
        sellerName: data.contact?.seller_name || candidate.sellerName,
        sellerPhone: data.contact?.seller_phone || candidate.sellerPhone,
        originalPostedAt: data.contact?.original_posted_at || candidate.originalPostedAt,
      } : candidate));
    } catch (error) {
      setContactRevealErrors(current => ({
        ...current,
        [item.id]: error instanceof Error ? error.message : 'Contact reveal failed',
      }));
    } finally {
      setContactRevealBusy(null);
    }
  };

  const dedicatedLane = lane === 'dealer-posts' || lane === 'identity' || lane === 'packets' || lane === 'images' || lane === 'sellers';

  return (
    <Layout>
      <TabNav />
      <div className="max-w-7xl mx-auto px-5 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-text-primary tracking-tight flex items-center gap-2">
            <Shield size={22} className="text-gold-primary" />
            Human Review Queue
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Catalog-confirmed candidates are ready for human approval and audited publication; other rows remain blocked for review.
          </p>
          {loadError && <p className="text-xs text-red-400 mt-2">{loadError}</p>}
        </div>

        <div className="mb-6 border border-border-default bg-bg-card px-4 py-3 rounded-xl flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2 text-text-secondary mr-1">
            <KeyRound size={14} className="text-gold-primary" />
            <span className="text-xs font-semibold">Reviewer session</span>
          </div>
          <span className="text-[11px] text-text-muted pb-1">
            {reviewerSession
              ? `Signed in as ${reviewerSession.role || 'reviewer'}${reviewerSession.email ? ` · ${reviewerSession.email}` : ''}.`
              : 'Approval requires a signed-in reviewer or administrator account.'}
          </span>
          {decisionError && <span className="w-full text-xs text-red-400">{decisionError}</span>}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setLane('dealer-posts'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'dealer-posts' ? 'bg-gold-primary text-black' : 'border border-border-default text-text-secondary'}`}
          >
            Post an Item
          </button>
          <button
            onClick={() => { setLane('identity'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'identity' ? 'bg-gold-primary text-black' : 'border border-border-default text-text-secondary'}`}
          >
            Rolex + Patek identity
          </button>
          <button
            onClick={() => { setLane('unbundled'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'unbundled' ? 'bg-gold-primary text-black' : 'border border-border-default text-text-secondary'}`}
          >
            All unbundled batches
          </button>
          <button
            onClick={() => { setLane('shadow'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'shadow' ? 'bg-gold-primary text-black' : 'border border-border-default text-text-secondary'}`}
          >
            Normalization corrections
          </button>
          <button
            onClick={() => { setLane('duplicates'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'duplicates' ? 'bg-red-400 text-black' : 'border border-border-default text-text-secondary'}`}
          >
            Duplicate candidates
          </button>
          <button
            onClick={() => { setLane('price'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'price' ? 'bg-amber-400 text-black' : 'border border-border-default text-text-secondary'}`}
          >
            Price corrections
          </button>
          <button
            onClick={() => { setLane('packets'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'packets' ? 'bg-gold-primary text-black' : 'border border-border-default text-text-secondary'}`}
          >
            Reason packets
          </button>
          <button
            onClick={() => { setLane('images'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'images' ? 'bg-gold-primary text-black' : 'border border-border-default text-text-secondary'}`}
          >
            Images
          </button>
          <button
            onClick={() => { setLane('sellers'); setSelected(null); }}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${lane === 'sellers' ? 'bg-gold-primary text-black' : 'border border-border-default text-text-secondary'}`}
          >
            Sellers
          </button>
          {(lane === 'unbundled' || lane === 'price') && (
            <span className="ml-auto text-xs text-text-muted">{unbundledTotal.toLocaleString()} pending in this lane</span>
          )}
        </div>

        {lane === 'dealer-posts' && <DealerSubmissionReviewLane />}
        {lane === 'identity' && <IdentityReviewLane />}
        {lane === 'packets' && (
          <PacketReviewLane openUnbundled={() => { setLane('unbundled'); setSelected(null); }} />
        )}
        {lane === 'images' && <ImageReviewLane />}
        {lane === 'sellers' && <SellerLineageReviewLane />}

        {lane === 'shadow' && progress && (
          <div className="mb-6 border border-border-default bg-bg-card px-4 py-3 rounded-xl flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div className="flex items-center gap-2 text-text-secondary">
              <Database size={14} className="text-gold-primary" />
              <span><strong className="text-text-primary">{progress.rowsAnalyzed.toLocaleString()}</strong> analyzed in shadow</span>
            </div>
            <span className="text-text-muted"><strong className="text-amber-400">{progress.pending.toLocaleString()}</strong> pending review{progress.countsEstimated ? ' est.' : ''}</span>
            <span className="text-text-muted"><strong className="text-text-primary">{progress.changed.toLocaleString()}</strong> corrections flagged{progress.countsEstimated ? ' est.' : ''}</span>
            <span className="text-text-muted"><strong className="text-text-primary">{progress.total.toLocaleString()}</strong> proposals stored{progress.countsEstimated ? ' est.' : ''}</span>
            <span className="ml-auto flex items-center gap-1 text-text-muted">
              <RefreshCw size={11} />
              {progress.lastUpdatedAt ? `Updated ${new Date(progress.lastUpdatedAt).toLocaleTimeString()}` : 'Waiting for first checkpoint'}
            </span>
            {progress.checkpointDelayed && <span className="w-full text-warning">Checkpoint is delayed; planner estimates may continue changing while the worker is not advancing.</span>}
          </div>
        )}

        {/* Stats */}
        {!dedicatedLane && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Loaded for review', count: items.filter(i => i.status === 'pending').length, color: 'text-amber-400' },
            { label: 'Catalog-confirmed', count: items.filter(i => i.disposition === 'READY_FOR_HUMAN_APPROVAL').length, color: 'text-emerald-400' },
            { label: 'Currency blocked', count: items.filter(i => i.reviewReasons.includes('CURRENCY_AMBIGUOUS')).length, color: 'text-red-400' },
            { label: 'Bundle/manual review', count: items.filter(i => i.reviewReasons.includes('BUNDLE_SPLIT_REQUIRED')).length, color: 'text-blue-400' },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl border border-border-default bg-bg-card p-4">
              <div className={`text-2xl font-extrabold ${stat.color}`}>{stat.count}</div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">{stat.label}</div>
            </div>
          ))}
        </div>}

        {/* Filters */}
        {!dedicatedLane && <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-2 bg-bg-card border border-border-default rounded-lg px-3 py-2">
            <Search size={14} className="text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                if (lane === 'unbundled') setUnbundledPage(1);
              }}
              placeholder="Search reference or brand..."
              className="bg-transparent border-none outline-none text-sm text-text-primary w-64"
            />
          </div>
          <div className="flex items-center gap-1 bg-bg-card border border-border-default rounded-lg p-1">
            {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                  filter === f ? 'bg-gold-primary text-black' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 overflow-x-auto bg-bg-card border border-border-default rounded-lg p-1">
            {(lane === 'shadow' ? reasonFilters : lane === 'unbundled' ? [
              { value: 'review-ready', label: 'Review ready' },
              { value: 'human-correction', label: 'Needs correction' },
            ] : []).map(reason => (
              <button
                key={reason.value || 'priority'}
                onClick={() => {
                  if (lane === 'shadow') setReasonFilter(reason.value);
                  else {
                    setUnbundledBucket(reason.value as 'review-ready' | 'human-correction');
                    setUnbundledPage(1);
                  }
                }}
                className={`whitespace-nowrap px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                  (lane === 'shadow' ? reasonFilter === reason.value : unbundledBucket === reason.value) ? 'bg-bg-elevated text-gold-primary' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {reason.label}
              </button>
            ))}
          </div>
        </div>}

        {/* Queue List */}
        {!dedicatedLane && <div className="space-y-3">
          {filtered.map(item => (
            <div
              key={item.id}
              className={`rounded-xl border p-4 transition-all ${
                selected?.id === item.id 
                  ? 'border-gold-primary bg-gold-primary/5' 
                  : 'border-border-default bg-bg-card hover:border-gold-primary/30'
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Publication gate */}
                <div className={`w-16 h-16 shrink-0 rounded-lg flex flex-col items-center justify-center border ${
                  item.disposition === 'READY_FOR_HUMAN_APPROVAL'
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                    : 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                }`}>
                  {item.disposition === 'READY_FOR_HUMAN_APPROVAL'
                    ? <CheckCircle2 size={20} />
                    : <AlertTriangle size={20} />}
                  <span className="mt-1 text-[9px] uppercase font-bold">
                    {item.disposition === 'READY_FOR_HUMAN_APPROVAL' ? 'Catalog' : 'Blocked'}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-text-primary">{item.brand} {item.model}</span>
                    <span className="text-xs font-mono text-gold-primary">{item.reference}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' :
                      item.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                      'bg-amber-500/20 text-amber-400'
                    }`}>
                      {item.status}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      item.disposition === 'READY_FOR_HUMAN_APPROVAL'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {item.disposition === 'READY_FOR_HUMAN_APPROVAL' ? 'catalog confirmed' : 'review blocked'}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-bg-elevated text-[10px] font-bold uppercase text-text-muted">P{item.priority}</span>
                  </div>
                  <p className="text-xs text-text-secondary truncate">{item.listingTitle}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-xs text-text-muted">
                      <Clock size={10} className="inline mr-1" />
                      {new Date(item.submittedAt).toLocaleTimeString()}
                    </span>
                    <span className="text-xs text-text-muted">
                      Change flags: <span className="text-red-400">{item.aiFields.join(', ') || 'none'}</span>
                    </span>
                    <span className="text-xs text-text-muted">
                      Catalog: <span className="text-emerald-400">{item.catalogFields.join(', ')}</span>
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelected(selected?.id === item.id ? null : item)}
                    aria-label={`Inspect ${item.brand} ${item.reference}`}
                    title="Inspect listing evidence"
                    className="p-2 rounded-lg border border-border-default hover:border-gold-primary/50 transition-colors"
                  >
                    <Eye size={14} className="text-text-muted" />
                  </button>
                  {item.status === 'pending' && (item.disposition === 'READY_FOR_HUMAN_APPROVAL' || lane === 'price') && (
                    <button
                      onClick={() => void submitDecision(item, 'APPROVED')}
                      disabled={decisionBusy === item.id || (lane === 'unbundled' && !duplicateReviewed.has(item.id))}
                      className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-emerald-500 text-black text-xs font-bold disabled:opacity-50"
                    >
                      {decisionBusy === item.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      {lane === 'price' ? 'Apply price correction' : 'Approve & publish'}
                    </button>
                  )}
                  {item.status === 'pending' && lane !== 'duplicates' && (
                    <button
                      onClick={() => void submitDecision(item, 'REJECTED')}
                      disabled={decisionBusy === item.id}
                      className="p-2 rounded-lg border border-red-500/30 hover:border-red-400 transition-colors disabled:opacity-50"
                      aria-label={`Reject ${item.brand} ${item.reference}`}
                      title="Reject proposal"
                    >
                      {decisionBusy === item.id ? <Loader2 size={14} className="animate-spin text-red-400" /> : <XCircle size={14} className="text-red-400" />}
                    </button>
                  )}
                  {item.status === 'pending' && lane === 'duplicates' && (
                    <>
                      <button
                        onClick={() => void submitDuplicateDecision(item, 'SUPPRESS')}
                        disabled={decisionBusy === item.id}
                        className="rounded-lg bg-red-400 px-2.5 py-2 text-xs font-bold text-black disabled:opacity-50"
                      >
                        Suppress duplicate
                      </button>
                      <button
                        onClick={() => void submitDuplicateDecision(item, 'KEEP_BOTH')}
                        disabled={decisionBusy === item.id}
                        className="rounded-lg border border-emerald-500/40 px-2.5 py-2 text-xs font-bold text-emerald-300 disabled:opacity-50"
                      >
                        Keep both
                      </button>
                      <button
                        onClick={() => void submitDuplicateDecision(item, 'DEFER')}
                        disabled={decisionBusy === item.id}
                        className="p-2 rounded-lg border border-border-default disabled:opacity-50"
                        aria-label={`Defer duplicate ${item.reference}`}
                        title="Defer duplicate review"
                      >
                        <Clock size={14} className="text-text-muted" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Expanded Detail */}
              {selected?.id === item.id && (
                  <div className="mt-4 pt-4 border-t border-border-default">
                  {(lane === 'unbundled' || item.rawMessage || item.sellerName || item.sellerPhone) && (
                    <div className="mb-4 rounded-lg border border-border-default bg-bg-elevated/40 p-3">
                      <h4 className="text-xs font-bold text-text-primary mb-2">Preserved raw source evidence</h4>
                      <div className="grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                        <span>Parent/source: <strong className="text-text-primary">{String(item.reviewEvidence?.source_record_id || item.id || 'Not linked')}</strong></span>
                        <span>Child source: <strong className="text-text-primary">{String(item.reviewEvidence?.source_child_id || item.id)}</strong></span>
                        <span>Seller: <strong className="text-text-primary">{String(item.sellerName || item.reviewEvidence?.seller_name || 'Not present')}</strong></span>
                        <span>Phone: <strong className="text-text-primary">{String(item.sellerPhone || item.reviewEvidence?.seller_phone || 'Not present')}</strong></span>
                        <span>Posted: <strong className="text-text-primary">{item.originalPostedAt ? new Date(item.originalPostedAt).toLocaleString() : 'Not preserved'}</strong></span>
                        <span>Source: <strong className="text-text-primary">{String(item.source || item.sourceType || 'Not identified')}</strong></span>
                        <span>Image: <strong className="text-text-primary">{String(item.reviewEvidence?.front_image || 'Not lineage-confirmed')}</strong></span>
                      </div>
                      {lane === 'unbundled' && Boolean((item.reviewEvidence as Record<string, unknown>)?.seller_contact_available) && (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => void revealContact(item)}
                            disabled={contactRevealBusy === item.id}
                            className="inline-flex items-center gap-2 rounded-lg border border-gold-primary/40 px-3 py-2 text-xs font-bold text-gold-primary disabled:opacity-50"
                          >
                            {contactRevealBusy === item.id ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                            Reveal audited contact
                          </button>
                          {contactRevealErrors[item.id] && <span className="text-xs text-red-400">{contactRevealErrors[item.id]}</span>}
                        </div>
                      )}
                      <div className="mt-3 rounded border border-border-default bg-bg-card p-3 text-xs text-text-secondary whitespace-pre-wrap break-words">
                        {item.rawMessage || 'Raw child listing unavailable. Do not approve until the parent/source message is recovered.'}
                      </div>
                      {!!item.reviewEvidence?.parent_raw_message && (
                        <div className="mt-2 rounded border border-border-default bg-bg-card p-3 text-xs text-text-muted whitespace-pre-wrap break-words">
                          <strong className="text-text-secondary">Parent raw message:</strong>{'\n'}{String(item.reviewEvidence.parent_raw_message)}
                        </div>
                      )}
                    </div>
                  )}
                  {lane === 'duplicates' && item.duplicate && (
                    <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">
                      <div className="font-bold text-red-200">Duplicate comparison</div>
                      <div className="mt-2 grid gap-2 text-text-secondary sm:grid-cols-2">
                        <span>Match: <strong className="text-text-primary">{item.duplicate.matchType}</strong></span>
                        <span>Confidence: <strong className="text-text-primary">{Math.round(item.duplicate.confidence * 100)}%</strong></span>
                        <span>Bundle risk: <strong className="text-text-primary">{item.duplicate.bundleRisk ? 'Yes - defer' : 'No'}</strong></span>
                        <span>Raw records: <strong className="text-text-primary">preserved; never deleted</strong></span>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {(['canonical', 'duplicate'] as const).map(side => {
                          const record = item.duplicate?.[side] || {};
                          return (
                            <div key={side} className="rounded border border-border-default bg-bg-card p-3">
                              <div className="font-bold text-text-primary">{side === 'canonical' ? 'Canonical observation' : 'Candidate duplicate'}</div>
                              <div className="mt-2 text-text-secondary whitespace-pre-wrap break-words">{String(record.raw_message || 'Raw message unavailable')}</div>
                              <div className="mt-2 text-text-muted">{String(record.brand || 'Unknown')} · {String(record.reference || 'Unresolved')} · {String(record.dial_color || 'Unverified')} · {String(record.price_usd || 'No price')}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="text-xs font-bold text-text-primary mb-2">Deterministic change flags</h4>
                      <div className="space-y-1">
                        {item.aiFields.map(field => (
                          <div key={field} className="flex items-center gap-2 text-xs">
                            <AlertTriangle size={10} className="text-amber-400" />
                            <span className="text-text-secondary">{field}</span>
                            <span className="text-[10px] text-text-muted">(not approved)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-text-primary mb-2">Catalog cross-reference</h4>
                      <div className="space-y-1">
                        {item.catalogFields.map(field => (
                          <div key={field} className="flex items-center gap-2 text-xs">
                            <CheckCircle2 size={10} className="text-emerald-400" />
                            <span className="text-text-secondary">{field}</span>
                            <span className="text-[10px] text-text-muted">(exact catalog gate)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <MessageSquare size={12} className="text-text-muted" />
                    <span className="text-xs text-text-muted">Review reasons: {item.reviewReasons.join(', ') || 'Manual verification required'}</span>
                  </div>
                  {lane === 'price' && (
                    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-text-secondary">
                      <div className="font-bold text-amber-200">Price-only proposal</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <span>Stored: <strong className="text-text-primary">${Number(item.reviewEvidence?.stored_price_usd || 0).toLocaleString()}</strong></span>
                        <span>Proposed: <strong className="text-text-primary">${Number(item.reviewEvidence?.proposed_price_usd || 0).toLocaleString()}</strong></span>
                        <span>Source record: <strong className="text-text-primary">{String(item.reviewEvidence?.source_record_id || 'Unknown')}</strong></span>
                      </div>
                      <div className="mt-2 rounded border border-border-default bg-bg-card p-2 whitespace-pre-wrap break-words">
                        <strong className="text-text-primary">Exact raw price evidence:</strong>{'\n'}{String(item.reviewEvidence?.evidence_line || '[NULL]')}
                      </div>
                      <p className="mt-2 text-text-muted">Applying updates only the approved USD price, creates an immutable audit record, and does not alter the raw message or any other listing field.</p>
                    </div>
                  )}
                  {item.catalog && (
                    <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
                      <div className="font-bold text-emerald-300">Catalog evidence</div>
                      <div className="mt-2 grid gap-2 text-text-secondary sm:grid-cols-2 lg:grid-cols-4">
                        <span>Reference: <strong className="text-text-primary">{item.catalog.reference || 'Unresolved'}</strong></span>
                        <span>Brand: <strong className="text-text-primary">{item.catalog.brand || 'Unresolved'}</strong></span>
                        <span>Model: <strong className="text-text-primary">{item.catalog.model || item.catalog.collection || 'Unresolved'}</strong></span>
                        <span>Match: <strong className="text-text-primary">{item.catalog.matchType || 'exact'}</strong></span>
                      </div>
                      <div className="mt-2 text-text-muted">
                        Catalog dials: {item.catalog.dialColors?.join(', ') || 'No dial configuration in catalog'}
                        {item.catalog.source ? ` · Source: ${item.catalog.source}` : ''}
                      </div>
                    </div>
                  )}
                  {lane === 'unbundled' && item.disposition === 'READY_FOR_HUMAN_APPROVAL' && (
                    <label className="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={duplicateReviewed.has(item.id)}
                        onChange={event => setDuplicateReviewed(current => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(item.id); else next.delete(item.id);
                          return next;
                        })}
                        className="mt-0.5"
                      />
                      <span>
                        <strong className="text-amber-300">Duplicate review completed.</strong> I checked the preserved raw line and context and confirm this is a distinct listing observation. Approval remains disabled until this is acknowledged.
                      </span>
                    </label>
                  )}
                  {lane === 'unbundled' && (
                    <div className="mt-4 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold text-orange-200">Human correction</div>
                          <div className="mt-1 text-[11px] text-text-muted">Edit only what the raw evidence supports. Saving keeps this row pending for catalog, duplicate, and publication revalidation.</div>
                        </div>
                        <span className="text-[10px] uppercase font-bold text-orange-300">AI advisory only</span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {(['brand', 'reference', 'dial_color', 'condition', 'year', 'price_raw', 'price_usd', 'currency', 'listing_type'] as const).map(field => {
                          const draft = draftFor(item);
                          return (
                            <label key={field} className="text-[10px] uppercase tracking-wide text-text-muted">
                              {field.replace('_', ' ')}
                              {field === 'listing_type' ? (
                                <select
                                  value={draft[field]}
                                  onChange={event => setCorrectionDrafts(current => ({ ...current, [item.id]: { ...draft, [field]: event.target.value } }))}
                                  className="mt-1 w-full rounded border border-border-default bg-bg-card px-2 py-2 text-xs normal-case text-text-primary"
                                >
                                  <option value="WTS">WTS / For sale</option>
                                  <option value="WTB">WTB / Looking for</option>
                                  <option value="NTQ">NTQ / Price check</option>
                                  <option value="OTHER">Other</option>
                                </select>
                              ) : (
                                <input
                                  value={draft[field]}
                                  onChange={event => setCorrectionDrafts(current => ({ ...current, [item.id]: { ...draft, [field]: event.target.value } }))}
                                  className="mt-1 w-full rounded border border-border-default bg-bg-card px-2 py-2 text-xs normal-case text-text-primary"
                                />
                              )}
                            </label>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={() => void submitHumanAction(item, 'SAVE')} disabled={decisionBusy === item.id} className="rounded-lg bg-orange-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-50">Save correction & revalidate</button>
                        <button onClick={() => void submitHumanAction(item, 'DEFER')} disabled={decisionBusy === item.id} className="rounded-lg border border-border-default px-3 py-2 text-xs font-bold text-text-secondary disabled:opacity-50">Leave pending</button>
                        <button onClick={() => void submitHumanAction(item, 'RECYCLE')} disabled={decisionBusy === item.id} className="rounded-lg border border-red-500/40 px-3 py-2 text-xs font-bold text-red-300 disabled:opacity-50">Send to recycle</button>
                      </div>
                    </div>
                  )}
                  <div className="mt-4 rounded-lg border border-border-default bg-bg-elevated/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold text-text-primary">AI review assistant</div>
                        <div className="mt-1 text-[11px] text-text-muted">Advisory only. AI cannot confirm the catalog, approve, or publish a listing.</div>
                      </div>
                      <button
                        onClick={() => void requestAiAssist(item)}
                        disabled={aiBusy === item.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-gold-primary/40 px-3 py-2 text-xs font-bold text-gold-primary disabled:opacity-50"
                      >
                        {aiBusy === item.id ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                        Analyze raw evidence
                      </button>
                    </div>
                    {aiErrors[item.id] && <div className="mt-3 text-xs text-red-400">{aiErrors[item.id]}</div>}
                    {aiResults[item.id] && (
                      <div className="mt-3 space-y-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded border border-border-default px-2 py-1 text-[10px] font-bold text-emerald-300">
                            {aiResults[item.id].fillableFields.length} missing fields supported
                          </span>
                          {lane === 'unbundled' && (
                            <button
                              type="button"
                              onClick={() => applyCorrectionSuggestions(item)}
                              disabled={!aiResults[item.id].suggestions.some(suggestion => {
                                const field = correctionSuggestionField(suggestion.field);
                                return field && !draftFor(item)[field].trim() && suggestionCanPopulateDraft(suggestion);
                              })}
                              className="ml-auto rounded border border-emerald-500/40 px-2 py-1 text-[10px] font-bold text-emerald-300 disabled:opacity-40"
                            >
                              Fill supported blanks
                            </button>
                          )}
                        </div>
                        <div className="text-text-secondary"><strong className="text-text-primary">Reviewer guidance:</strong> {aiResults[item.id].summary}</div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {preferredSuggestions(aiResults[item.id].suggestions).map((suggestion, index) => {
                            const correctionField = correctionSuggestionField(suggestion.field);
                            const canUse = lane === 'unbundled' && Boolean(correctionField && suggestionCanPopulateDraft(suggestion));
                            return (
                              <div key={`${suggestion.field}:${suggestion.support}:${index}`} className="rounded border border-border-default bg-bg-card p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <strong className="uppercase tracking-wide text-text-muted">{suggestion.field}</strong>
                                  <span className={suggestion.status === 'RAW_SUPPORTED' || suggestion.status === 'CATALOG_SUPPORTED' ? 'text-emerald-300' : 'text-amber-300'}>
                                    {suggestion.status.replaceAll('_', ' ')}
                                  </span>
                                </div>
                                <div className="mt-1 break-words font-bold text-text-primary">{suggestion.value || 'Leave blank'}</div>
                                <div className="mt-1 break-words text-text-muted">{suggestion.evidenceQuote || suggestion.reason}</div>
                                {canUse && (
                                  <button
                                    type="button"
                                    onClick={() => applyCorrectionSuggestions(item, suggestion)}
                                    className="mt-2 rounded border border-gold-primary/40 px-2 py-1 text-[10px] font-bold text-gold-primary"
                                  >
                                    Use in draft
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {aiResults[item.id].unresolvedFields.length > 0 && (
                          <div className="text-amber-300"><strong>Still missing:</strong> {aiResults[item.id].unresolvedFields.join(', ')}. No value was guessed.</div>
                        )}
                        <div className="text-amber-300"><strong>Ambiguities:</strong> {aiResults[item.id].ambiguities.join('; ') || 'None reported'}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>}
        {lane === 'unbundled' && unbundledTotal > 50 && (
          <div className="mt-6 flex items-center justify-between border-t border-border-default pt-4 text-xs text-text-muted">
            <button
              disabled={unbundledPage === 1}
              onClick={() => setUnbundledPage(page => Math.max(1, page - 1))}
              className="rounded-lg border border-border-default px-3 py-2 disabled:opacity-40"
            >
              Previous
            </button>
            <span>Page {unbundledPage} of {Math.ceil(unbundledTotal / 50).toLocaleString()}</span>
            <button
              disabled={unbundledPage >= Math.ceil(unbundledTotal / 50)}
              onClick={() => setUnbundledPage(page => page + 1)}
              className="rounded-lg border border-border-default px-3 py-2 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
