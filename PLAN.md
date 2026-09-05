# WATCHFACTS OWNER DASHBOARD — IMPLEMENTATION PLAN

## CONTEXT
From previous Instagram crawl analysis and admin panel studies for other projects, we identified key owner needs. Now applying to WatchFacts.

---

## PHASE 1: OWNER ADMIN PANEL (/admin)

### 1.1 Dashboard Overview
- Total records: 117,744
- APPROVED: 39,694 (33.7%)
- HUMAN: 45,850 (38.9%) 
- RECYCLE: 32,200 (27.4%)
- Processing rate: records/hour
- AI cost tracker: DeepSeek/Gemini/Kimi calls + spend

### 1.2 Bulk Operations
- [ ] Bulk re-process all HUMAN/RECYCLE (78k records)
- [ ] Bulk export (Excel + CSV) with date range
- [ ] Bulk status change (APPROVED→HUMAN→RECYCLE)
- [ ] Bulk delete permanently

### 1.3 AI Performance Metrics
- [ ] Per-provider success rate (DeepSeek vs Gemini vs Kimi)
- [ ] Average confidence by stage (PARSE/AI_TEXT/ONLINE/IMAGE)
- [ ] Timeout/failure rate per provider
- [ ] Cost per record processed

### 1.4 Data Quality Audit
- [ ] Records with missing reference (7,425)
- [ ] Records with missing price (42,682)
- [ ] Records with unknown brand (31,834)
- [ ] Records with unknown dial (21,095)
- [ ] Records with missing year (54,153)

---

## PHASE 2: SOCIAL MEDIA INTEGRATION

### 2.1 Instagram Auto-Post (/admin/social)
- [ ] Connect Instagram Business account
- [ ] Auto-generate watch listing posts from APPROVED records
- [ ] Image + caption template: "🔵 Patek Philippe 5712/1A Blue | N5/2026 | 850k HKD | DM for details"
- [ ] Schedule posts (max 3/day to avoid ban)
- [ ] Hashtag generator: #patekphilippe #5712 #luxurywatches #hkdwatches

### 2.2 WhatsApp Integration
- [ ] Webhook for incoming dealer messages
- [ ] Auto-parse → AI analyze → human review queue
- [ ] Reply with structured data: "Got it. Ref: 5712/1A | Price: 850k HKD | Confidence: 95%"

### 2.3 Telegram Bot
- [ ] Bot for owner alerts: "5 new HUMAN reviews pending"
- [ ] Bot for stats: /stats → current counts
- [ ] Bot for search: /search 5712/1A → find records

---

## PHASE 3: WEB ENRICHMENT EXPANSION

### 3.1 Price Tracking
- [ ] Chrono24 scrape (currently blocked on Vercel)
- [ ] WatchCharts scrape (currently blocked)
- [ ] DuckDuckGo fallback working
- [ ] Historical price chart per reference

### 3.2 Image Pipeline
- [ ] Client-side vision (Gemini browser API) — avoid Vercel timeout
- [ ] Auto-extract dial color from image
- [ ] Auto-extract reference from caseback photo
- [ ] Image deduplication (don't process same photo twice)

### 3.3 Catalog Expansion
- [ ] Merge catalog.json (177 refs) + enriched_refs.json (976 refs)
- [ ] Add AP, Rolex, RM, VC patterns
- [ ] Reference → family → collection → brand mapping
- [ ] Production years lookup

---

## PHASE 4: HUMAN OPTICS (REVIEW UI)

### 4.1 Side-by-Side Review
- [ ] Image preview (left) + parsed fields (right)
- [ ] One-click approve / edit / recycle
- [ ] Keyboard shortcuts: A=approve, E=edit, R=recycle, N=next
- [ ] Bulk select + bulk action

### 4.2 Confidence Visualization
- [ ] Color-coded confidence bars per field
- [ ] Stage-by-stage breakdown (already in StudyPage)
- [ ] Flag suspicious: price outliers, wrong currency, fake refs

### 4.3 Owner Override
- [ ] Override AI verdict with one click
- [ ] Add owner notes per record
- [ ] Track who approved what (audit trail)

---

## PHASE 5: REPORTING & EXPORTS

### 5.1 Colored Excel Reports (already exists)
- [ ] Green = APPROVED, Yellow = HUMAN, Red = RECYCLE
- [ ] 3 sheets: Summary, Records, Analytics
- [ ] Branded header with logo

### 5.2 Automated Reports
- [ ] Daily digest: new records, approvals, issues
- [ ] Weekly summary: trends, top refs, price changes
- [ ] Monthly export: full dataset backup

### 5.3 API Access
- [ ] REST API for external tools
- [ ] API key management
- [ ] Rate limiting

---

## PRIORITY ORDER

1. **Owner Admin Panel** — Immediate visibility + control
2. **Bulk Re-process** — Reduce 78k HUMAN/RECYCLE backlog
3. **Human Optics Review** — Faster manual review
4. **Social Media** — Instagram auto-post for revenue
5. **Web Enrichment** — Better data quality
6. **Reporting** — Automated insights

---

## ESTIMATED TIME

| Phase | Hours | Complexity |
|-------|-------|------------|
| 1. Admin Panel | 4-6 | Medium |
| 2. Social Media | 6-8 | High (Meta APIs) |
| 3. Web Enrichment | 4-6 | Medium |
| 4. Human Optics | 6-8 | High |
| 5. Reporting | 3-4 | Low |
| **Total** | **23-32** | **5 phases** |

---

## NEXT STEPS

1. Build `/admin` route with dashboard + bulk ops
2. Integrate enriched_refs.json into reprocess pipeline
3. Add Instagram posting to approved records
4. Build side-by-side review UI
5. Add automated daily reports

Ready to proceed with Phase 1.