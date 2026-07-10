# WatchFacts Pipeline Architecture

## Overview
Two-pipeline system with batch processing, sub-agent validation, and human review workflow.

## Pipeline 1: Historical Batch Processing

### Flow
```
Raw Data (Supabase) 
  → Batch Queue (Redis/DB)
  → Batch Processor (chunks of 1000)
  → Parser v4.10+ (normalize)
  → Sub-agent Validation Layer
  → Human Review Queue
  → Permanent Storage (versioned)
```

### Batch Processing Steps
1. **Selection**: Choose batch size (100-10000 records)
2. **Queue**: Add to processing queue with priority
3. **Normalize**: Run through parser with latest patches
4. **Validate**: Sub-agent checks (see below)
5. **Flag Issues**: Mark records needing human review
6. **Review Queue**: Present to human reviewer
7. **Approve/Reject**: Human decision
8. **Store**: Save to permanent storage with version stamp

### Sub-agent Validation Checks
- **Currency Validator**: Verify HKD/USD conversions, detect outliers
- **Reference Validator**: Cross-check with catalog, validate format
- **Dial Validator**: Match dial colors to references
- **Outlier Detector**: IQR method, statistical analysis
- **Analytics Validator**: Verify computed stats
- **Image Validator**: Check image URLs, quality
- **Confidence Scorer**: Multi-factor confidence calculation

### Storage Model
```sql
CREATE TABLE normalized_records (
  id UUID PRIMARY KEY,
  raw_record_id UUID REFERENCES raw_records(id),
  version INT NOT NULL,
  normalized_data JSONB,
  validation_results JSONB,
  confidence_score FLOAT,
  status VARCHAR(20), -- PENDING, APPROVED, REJECTED
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Pipeline 2: Real-time Ingestion

### Flow
```
Incoming Message (WhatsApp/Green API)
  → Message Router
  → Parser (immediate)
  → Confidence Check
  → Route:
      ├─ High (>85%) → Auto-approve
      ├─ Medium (50-85%) → Review queue
      └─ Low (<50%) → Reject/Recycle
```

### No Override Policy
- Never modify existing records
- Create new version for each change
- Maintain complete change history
- Link versions via foreign key

## Human Review Workflow

### Review Queue Interface
- Batch view (see all flagged records)
- Record detail view (raw + normalized)
- Validation report (sub-agent findings)
- Side-by-side comparison (before/after)
- Bulk actions (approve/reject batch)

### Review Actions
1. **Approve**: Accept normalized data
2. **Reject**: Send back to queue for re-processing
3. **Edit**: Manually correct, then approve
4. **Skip**: Leave in queue for later

## Batch Management

### Batch States
```
QUEUED → PROCESSING → VALIDATING → REVIEW → APPROVED/REJECTED
```

### Batch Metadata
```json
{
  "batch_id": "uuid",
  "size": 1000,
  "status": "PROCESSING",
  "created_at": "2026-07-10T...",
  "processed_at": "2026-07-10T...",
  "parser_version": "v4.10",
  "validation_results": {
    "total": 1000,
    "passed": 850,
    "flagged": 150,
    "errors": 0
  }
}
```

## Sub-agent System

### Agent Types
1. **CurrencyAgent**: Validates currency conversions
2. **ReferenceAgent**: Validates reference numbers
3. **DialAgent**: Validates dial colors
4. **OutlierAgent**: Detects statistical outliers
5. **AnalyticsAgent**: Validates computed analytics
6. **ImageAgent**: Validates image URLs/quality

### Agent Communication
- Each agent runs independently
- Reports findings to validation coordinator
- Coordinator aggregates results
- Low confidence triggers human review

## Monitoring & Analytics

### Metrics Dashboard
- Batch processing rate (records/hour)
- Validation pass rate (%)
- Human review queue depth
- Average confidence score
- Error rate by validation type

### Alerts
- Queue depth > threshold
- Error rate spike
- Low confidence batch
- Processing timeout

## Implementation Phases

### Phase 1: Core Infrastructure ✓
- [ ] Queue system
- [ ] Batch processor
- [ ] Storage schema

### Phase 2: Validation Layer
- [ ] Sub-agent framework
- [ ] Individual validators
- [ ] Aggregation logic

### Phase 3: Human Review
- [ ] Review queue UI
- [ ] Batch management UI
- [ ] Approval workflow

### Phase 4: Real-time Pipeline
- [ ] Message router
- [ ] Confidence scoring
- [ ] Auto-routing logic

### Phase 5: Integration
- [ ] Connect to existing parsers
- [ ] Migrate historical data
- [ ] Monitoring dashboard
