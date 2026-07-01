# WatchFacts Normalization Engine — White-Label Product Strategy

## Executive Summary

The WatchFacts data normalization pipeline (parser v3.1, confidence scoring, bulk upsert) is a **standalone product** that can be white-labeled for any collectible market. The engine is domain-agnostic at its core — only the parser rules and brand dictionaries are watch-specific.

**Product name**: **Normalize.io** (working title)

---

## What Makes It Defensible

| Component | WatchFacts | White-Label Value |
|-----------|-----------|-------------------|
| **Parser v3.1** | NLP + regex for watch descriptions | Swap dictionaries → any collectible |
| **Confidence scoring** | 4-tier matrix (auto/review/manual/recycle) | Universal quality gate |
| **Bulk upsert** | 740 rec/s, zero regressions | Handles millions of records |
| **Chinese aliases** | 百达雵丽 → Patek Philippe | Any language/abbreviation mapping |
| **Currency normalization** | HKD/USD/EUR/GBP detection | Any currency pair |
| **Reference patterns** | Omega dotted refs, Patek 4-digit | Any SKU/model/serial format |

---

## Target Markets

### Tier 1: High-Value Collectibles
| Market | Record Volume | Avg Item Value | Use Case |
|--------|--------------|----------------|----------|
| **Luxury watches** | 2-5M | $5K-$500K | ✅ Current — WatchFacts |
| **Classic cars** | 500K-2M | $50K-$5M | Auction listings, VIN parsing |
| **Fine art** | 1-3M | $10K-$50M | Provenance, artist attribution |
| **Wine & spirits** | 5-10M | $100-$50K | Vintage, vineyard, bottle condition |
| **Sports memorabilia** | 2-5M | $500-$1M | Autograph authentication, grading |

### Tier 2: B2B Data Cleansing
| Market | Volume | Value Prop |
|--------|--------|-----------|
| **E-commerce catalogs** | 10-100M | Normalize vendor feeds |
| **Real estate listings** | 5-20M | Standardize property descriptions |
| **Job boards** | 10-50M | Skill extraction, salary normalization |
| **Medical devices** | 1-5M | Regulatory compliance, UDI parsing |

---

## Architecture for White-Labeling

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                        Normalize.io Core (Domain-Agnostic)                           │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Ingestion   │  │  Parser     │  │ Confidence │  │   Bulk     │  │  Review   │  │
│  │  Engine      │  │  Engine     │  │  Scorer     │  │  Upsert    │  │  Queue    │  │
│  │             │  │            │  │            │  │           │  │          │  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                    Domain Adapter Layer (Market-Specific)                        │  │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐            │  │
│  │  │  Brand      │  │  Reference  │  │  Currency   │  │  Condition  │            │  │
│  │  │ Dictionary  │  │  Patterns   │  │  Rules      │  │  Taxonomy   │            │  │
│  │  │  (YAML)     │  │  (Regex)    │  │  (JSON)     │  │  (YAML)     │            │  │
│  │  └───────────┘  └───────────┘  └───────────┘  └───────────┘            │  │
│  └─────────────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Domain Adapter Format

### Brand Dictionary (YAML)
```yaml
# markets/watches/brands.yaml
brands:
  - canonical: "Patek Philippe"
    aliases:
      - "Patek"
      - "PP"
      - "百达雵丽"
      - "Nautilus"  # model-as-brand fallback
    priority: 1

  - canonical: "Rolex"
    aliases:
      - "劳力士"
      - "Daytona"
      - "Submariner"
    priority: 1
```

### Reference Patterns (Regex)
```yaml
# markets/watches/references.yaml
patterns:
  - name: "omega_dotted"
    regex: "\\b(\\d{3}\\.\\d{3}[\\-\\u2013]?\\d{0,2})\\b"
    weight: 0.9

  - name: "rolex_5digit"
    regex: "\\b(1\\d{4}|2\\d{4}|3\\d{4}|5\\d{4}|6\\d{4}|7\\d{4})\\b"
    weight: 0.85
```

### Confidence Weights (JSON)
```json
{
  "markets/watches/confidence.json": {
    "brand": 0.25,
    "reference": 0.25,
    "price": 0.20,
    "condition": 0.15,
    "dial": 0.10,
    "year": 0.05
  }
}
```

---

## Pricing Model

### SaaS Tiers

| Tier | Records/Month | Price | Features |
|------|--------------|-------|----------|
| **Starter** | 10K | $99/mo | Basic parsing, email support |
| **Growth** | 100K | $499/mo | Custom dictionaries, API access, Slack support |
| **Enterprise** | 1M+ | $2,499/mo | Dedicated instance, custom models, SLA |
| **White-Label** | Unlimited | $10K/mo + rev share | Full rebrand, embedded, priority roadmap |

### One-Time Setup
| Service | Price | Deliverable |
|---------|-------|-------------|
| Domain adapter | $5K-$15K | Brand dict, ref patterns, currency rules |
| Custom parser training | $10K-$50K | Fine-tuned NLP for your descriptions |
| On-premise deploy | $25K | Kubernetes cluster, air-gapped |

---

## Competitive Landscape

| Competitor | Strength | Weakness | Our Edge |
|-----------|----------|----------|----------|
| **OpenRefine** | Free, open source | Manual, no NLP | Fully automated, confidence scoring |
| **Trifacta** | Enterprise UI | $50K+/yr, generic | Watch-specific parsers, 740 rec/s |
| **Talend** | Integration hub | Heavy, slow | Lightweight, real-time queue |
| **Custom Python** | Flexible | Dev overhead, brittle | Production-ready, zero regressions |

---

## Go-to-Market

### Phase 1: Validate (Now — 3 months)
- [ ] Extract parser engine from WatchFacts into standalone npm package
- [ ] Build adapter for **classic cars** (Bring a Trailer, Hemmings)
- [ ] Run pilot with 1-2 car dealers/auction houses
- [ ] Measure: parse accuracy, time saved, deal flow improvement

### Phase 2: Productize (3-6 months)
- [ ] Launch Normalize.io with 2 markets: watches + cars
- [ ] Self-serve adapter builder (YAML upload, test sandbox)
- [ ] Stripe billing, usage-based pricing
- [ ] Docs + API reference

### Phase 3: Scale (6-12 months)
- [ ] Add wine, art, sports memorabilia adapters
- [ ] Partner with marketplace platforms (eBay, 1stDibs, Chrono24)
- [ ] Enterprise sales for e-commerce catalog cleansing
- [ ] Series A pitch: "Stripe for collectible data"

---

## Technical Extraction Plan

### Step 1: Isolate Core (Week 1)
```
api/_lib/parser.js → packages/normalize-core/src/parser.ts
api/_lib/confidence.js → packages/normalize-core/src/scorer.ts
scripts/normalize-all.js → packages/normalize-core/src/batch.ts
```

### Step 2: Adapter Interface (Week 2)
```typescript
interface DomainAdapter {
  brands: BrandDictionary;
  references: ReferencePattern[];
  currencies: CurrencyRule[];
  conditions: ConditionTaxonomy;
  confidenceWeights: Record<string, number>;
}
```

### Step 3: CLI + API (Week 3-4)
```bash
# CLI
npx normalize --adapter watches.yaml --input records.csv --output normalized.json

# API
POST /api/v1/normalize
{ "adapter": "watches", "records": [...] }
```

### Step 4: Dashboard (Week 5-6)
- Fork PipelineDashboard.tsx → standalone React app
- Connect to Normalize.io API
- White-label theming (CSS variables)

---

## Revenue Projection

| Year | Markets | Customers | MRR | ARR |
|------|---------|-----------|-----|-----|
| 1 | 2 (watches, cars) | 20 | $50K | $600K |
| 2 | 4 (+ wine, art) | 80 | $200K | $2.4M |
| 3 | 6 (+ sports, real estate) | 200 | $600K | $7.2M |
| 4 | 8 (+ medical, jobs) | 500 | $1.5M | $18M |

---

## Next Steps

1. **Extract core parser** to `packages/normalize-core/` (1 week)
2. **Build car adapter** as proof of concept (2 weeks)
3. **Launch landing page** at normalize.io (1 week)
4. **Pilot with 3 car dealers** (2 weeks)
5. **Pitch to Nous/WatchFacts investors** (ongoing)

---

*Document version: 1.0*
*Created: 2026-07-01*
*Author: WatchFacts Engineering*
