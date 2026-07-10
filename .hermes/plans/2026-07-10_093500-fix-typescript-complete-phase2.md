# Fix TypeScript Errors & Complete Phase 2 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Resolve all TypeScript compilation errors and deliver a fully functional Phase 2 Human Review Workflow

**Architecture:** Three new pages (ReviewDashboard, BatchReview, CreateBatch) with backend API endpoints, connecting to Supabase for batch management and record review

**Tech Stack:** React 19, TypeScript, Vite, Supabase Client, React Router v6, Lucide Icons

---

## Current Context

### What's Built
- ✅ Database schema (batches, normalized_records tables)
- ✅ Batch management API (create, process, review)
- ✅ Validation coordinator with 6 sub-agents
- ✅ Three frontend pages (ReviewDashboard, BatchReview, CreateBatch)
- ✅ Router integration (added routes to App.tsx)

### What's Broken
- ❌ TypeScript compilation failing with ~30 errors
- ❌ Type definitions missing for batch data structures
- ❌ Supabase client import path inconsistent
- ❌ Implicit 'any' types throughout components
- ❌ Build blocked, cannot deploy

### Root Cause Analysis
The pages were written in JSX syntax (.jsx extension) but project uses TypeScript. Renamed to .tsx but didn't add type annotations. TypeScript strict mode requires explicit types for all parameters and state.

---

## Step-by-Step Plan

### Task 1: Create Type Definitions File

**Objective:** Centralize all TypeScript interfaces for batch/review data structures

**Files:**
- Create: `src/types/pipeline.ts`

**Step 1: Create the types file**

```typescript
// src/types/pipeline.ts

export interface Batch {
  id: string;
  name?: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PENDING_REVIEW';
  filter_criteria?: FilterCriteria;
  batch_size: number;
  priority: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  processed_count: number;
  success_count: number;
  failed_count: number;
  validation_summary?: ValidationSummary;
  normalized_records?: NormalizedRecord[];
}

export interface FilterCriteria {
  brand?: string;
  reference?: string;
  price_min?: number;
  price_max?: number;
  date_from?: string;
  date_to?: string;
}

export interface NormalizedRecord {
  id: string;
  batch_id: string;
  raw_record_id: string;
  version: number;
  parser_version?: string;
  
  // Parsed fields
  brand?: string;
  reference?: string;
  dial_color?: string;
  condition?: string;
  year?: number;
  price_usd?: number;
  currency?: string;
  price_raw?: string;
  
  // Validation
  confidence_score: number;
  raw_message?: string;
  validation_status: 'pending' | 'passed' | 'flagged' | 'error';
  validation_results?: ValidationResults;
  flagged_issues?: string[];
  
  // Review
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
  
  created_at: string;
  updated_at: string;
}

export interface ValidationSummary {
  total: number;
  passed: number;
  flagged: number;
  errors: number;
}

export interface ValidationResults {
  overall_status: 'passed' | 'flagged' | 'error';
  confidence: number;
  validators: ValidatorResult[];
  issues: ValidationIssue[];
  summary: ValidationSummaryDetail;
}

export interface ValidatorResult {
  validator: string;
  version: string;
  status: 'passed' | 'failed' | 'warning' | 'error';
  confidence: number;
  message: string;
  input_data?: any;
  output_data?: any;
  issues?: ValidationIssue[];
}

export interface ValidationIssue {
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  validator?: string;
}

export interface ValidationSummaryDetail {
  total_validators: number;
  passed: number;
  failed: number;
  warnings: number;
  errors: number;
  details: {
    validator: string;
    status: string;
    confidence: string;
    message: string;
  }[];
}

export interface BatchStats {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
}

export type ReviewAction = 'APPROVED' | 'REJECTED';
```

**Step 2: Commit**

```bash
git add src/types/pipeline.ts
git commit -m "feat: add TypeScript type definitions for pipeline data structures"
```

---

### Task 2: Fix Supabase Client Import

**Objective:** Standardize Supabase client import across all pages

**Files:**
- Modify: `src/pages/ReviewDashboard.tsx`
- Modify: `src/pages/BatchReview.tsx`
- Modify: `src/pages/CreateBatch.tsx`

**Step 1: Check existing Supabase client implementation**

Run: `cat src/lib/supabaseClient.ts`

Expected: Export named `supabase` instance from createClient

**Step 2: Update ReviewDashboard.tsx imports**

Find line ~12:
```typescript
import { supabase } from '@/lib/supabaseClient';
```

Already correct ✅ (just fixed)

**Step 3: Update BatchReview.tsx imports**

Find line ~12 and change:
```typescript
// Before
import { supabase } from '@/lib/supabase';

// After
import { supabase } from '@/lib/supabaseClient';
```

**Step 4: Update CreateBatch.tsx imports**

Find line ~8 and change:
```typescript
// Before
import { supabase } from '@/lib/supabase';

// After
import { supabase } from '@/lib/supabaseClient';
```

**Step 5: Verify imports**

Run: `grep -n "from '@/lib/supabase'" src/pages/*.tsx`

Expected: No matches (all should use supabaseClient)

**Step 6: Commit**

```bash
git add src/pages/BatchReview.tsx src/pages/CreateBatch.tsx
git commit -m "fix: standardize supabase client imports across pipeline pages"
```

---

### Task 3: Add Type Annotations to ReviewDashboard

**Objective:** Fix all TypeScript errors in ReviewDashboard.tsx

**Files:**
- Modify: `src/pages/ReviewDashboard.tsx`

**Step 1: Add imports at top of file**

After line 12, add:
```typescript
import type { Batch, BatchStats } from '@/types/pipeline';
```

**Step 2: Add type to state declarations**

Find lines ~14-16 and change:
```typescript
// Before
const [batches, setBatches] = useState([]);
const [loading, setLoading] = useState(true);
const [searchTerm, setSearchTerm] = useState('');

// After
const [batches, setBatches] = useState<Batch[]>([]);
const [loading, setLoading] = useState(true);
const [searchTerm, setSearchTerm] = useState('');
```

**Step 3: Add type to loadBatches function**

Find line ~18 and change:
```typescript
// Before
const loadBatches = async () => {

// After
const loadBatches = async (): Promise<void> => {
```

**Step 4: Add type to processed batches mapping**

Find line ~47 (inside map callback) and change:
```typescript
// Before
const processedBatches = data.map((batch) => {

// After
const processedBatches = data.map((batch: Batch) => {
```

**Step 5: Add type to stats calculation**

Find line ~49-52 and change:
```typescript
// Before
const records = batch.normalized_records || [];
const approved = records.filter((r) => r.status === 'APPROVED').length;
const rejected = records.filter((r) => r.status === 'REJECTED').length;
const pending = records.filter((r) => r.status === 'PENDING').length;

// After
const records = batch.normalized_records || [];
const approved = records.filter((r: NormalizedRecord) => r.status === 'APPROVED').length;
const rejected = records.filter((r: NormalizedRecord) => r.status === 'REJECTED').length;
const pending = records.filter((r: NormalizedRecord) => r.status === 'PENDING').length;
```

Add NormalizedRecord to imports:
```typescript
import type { Batch, BatchStats, NormalizedRecord } from '@/types/pipeline';
```

**Step 6: Add type to getStatusColor function**

Find line ~82 and change:
```typescript
// Before
const getStatusColor = (status) => {

// After
const getStatusColor = (status: string): string => {
```

**Step 7: Add type to filteredBatches calculation**

Find line ~97 and change:
```typescript
// Before
const filteredBatches = batches.filter((batch) => {

// After
const filteredBatches = batches.filter((batch: Batch) => {
```

**Step 8: Verify no TypeScript errors**

Run: `npm run build 2>&1 | grep ReviewDashboard.tsx`

Expected: No errors from ReviewDashboard.tsx

**Step 9: Commit**

```bash
git add src/pages/ReviewDashboard.tsx
git commit -m "fix: add type annotations to ReviewDashboard component"
```

---

### Task 4: Add Type Annotations to BatchReview

**Objective:** Fix all TypeScript errors in BatchReview.tsx

**Files:**
- Modify: `src/pages/BatchReview.tsx`

**Step 1: Add imports at top of file**

After line 12, add:
```typescript
import type { Batch, NormalizedRecord, ReviewAction } from '@/types/pipeline';
```

**Step 2: Add type to state declarations**

Find lines ~14-18 and change:
```typescript
// Before
const [batch, setBatch] = useState(null);
const [records, setRecords] = useState([]);
const [currentIndex, setCurrentIndex] = useState(0);
const [loading, setLoading] = useState(true);

// After
const [batch, setBatch] = useState<Batch | null>(null);
const [records, setRecords] = useState<NormalizedRecord[]>([]);
const [currentIndex, setCurrentIndex] = useState(0);
const [loading, setLoading] = useState(true);
```

**Step 3: Add type to loadBatch function**

Find line ~20 and change:
```typescript
// Before
const loadBatch = async () => {

// After
const loadBatch = async (): Promise<void> => {
```

**Step 4: Add type to handleUpdateRecord function**

Find line ~95 and change:
```typescript
// Before
const handleUpdateRecord = async (action) => {

// After
const handleUpdateRecord = async (action: ReviewAction): Promise<void> => {
```

**Step 5: Add type to handleBulkAction function**

Find line ~120 and change:
```typescript
// Before
const handleBulkAction = async (action) => {

// After
const handleBulkAction = async (action: ReviewAction): Promise<void> => {
```

**Step 6: Add type to getStatusBadge function**

Find line ~155 and change:
```typescript
// Before
const getStatusBadge = (status) => {

// After
const getStatusBadge = (status: string): JSX.Element => {
```

**Step 7: Add type to getConfidenceColor function**

Find line ~180 and change:
```typescript
// Before
const getConfidenceColor = (confidence) => {

// After
const getConfidenceColor = (confidence: number): string => {
```

**Step 8: Verify no TypeScript errors**

Run: `npm run build 2>&1 | grep BatchReview.tsx`

Expected: No errors from BatchReview.tsx

**Step 9: Commit**

```bash
git add src/pages/BatchReview.tsx
git commit -m "fix: add type annotations to BatchReview component"
```

---

### Task 5: Add Type Annotations to CreateBatch

**Objective:** Fix all TypeScript errors in CreateBatch.tsx

**Files:**
- Modify: `src/pages/CreateBatch.tsx`

**Step 1: Add imports at top of file**

After line 8, add:
```typescript
import type { FilterCriteria } from '@/types/pipeline';
```

**Step 2: Add type to state declarations**

Find lines ~10-18 and change:
```typescript
// Before
const [formData, setFormData] = useState({
  name: '',
  batch_size: 100,
  priority: 5,
  filter_criteria: {
    brand: '',
    reference: '',
    price_min: '',
    price_max: '',
    date_from: '',
    date_to: '',
  },
});
const [loading, setLoading] = useState(false);

// After
const [formData, setFormData] = useState<{
  name: string;
  batch_size: number;
  priority: number;
  filter_criteria: FilterCriteria;
}>({
  name: '',
  batch_size: 100,
  priority: 5,
  filter_criteria: {
    brand: '',
    reference: '',
    price_min: undefined,
    price_max: undefined,
    date_from: '',
    date_to: '',
  },
});
const [loading, setLoading] = useState(false);
```

**Step 3: Add type to handleSubmit function**

Find line ~53 and change:
```typescript
// Before
const handleSubmit = async (e) => {

// After
const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
```

**Step 4: Fix price_min/price_max type conversion**

Find lines ~70-80 (where filter_criteria is being set) and ensure:
```typescript
filter_criteria: {
  brand: formData.filter_criteria.brand || undefined,
  reference: formData.filter_criteria.reference || undefined,
  price_min: formData.filter_criteria.price_min ? Number(formData.filter_criteria.price_min) : undefined,
  price_max: formData.filter_criteria.price_max ? Number(formData.filter_criteria.price_max) : undefined,
  date_from: formData.filter_criteria.date_from || undefined,
  date_to: formData.filter_criteria.date_to || undefined,
}
```

**Step 5: Verify no TypeScript errors**

Run: `npm run build 2>&1 | grep CreateBatch.tsx`

Expected: No errors from CreateBatch.tsx

**Step 6: Commit**

```bash
git add src/pages/CreateBatch.tsx
git commit -m "fix: add type annotations to CreateBatch component"
```

---

### Task 6: Build & Verify

**Objective:** Confirm all TypeScript errors are resolved and build succeeds

**Files:**
- None (verification only)

**Step 1: Run full build**

Run: `npm run build`

Expected: Build completes successfully with no errors

**Step 2: Check for any remaining warnings**

Run: `npm run build 2>&1 | grep -i warning`

Expected: Minimal or no warnings

**Step 3: Test the application locally**

Run: `npm run dev`

Expected: App starts on http://localhost:5173

**Step 4: Navigate to pipeline pages**

Manual testing:
- Visit `/pipeline` - should show ReviewDashboard
- Click "Create New Batch" - should show CreateBatch form
- Submit form - should create batch and redirect to BatchReview

**Step 5: Commit**

```bash
git add -A
git commit -m "build: verify TypeScript compilation and local dev server"
```

---

### Task 7: Deploy to Production

**Objective:** Deploy the completed Phase 2 to production

**Files:**
- None (deployment only)

**Step 1: Run production build**

Run: `npm run build`

Expected: Build succeeds

**Step 2: Deploy with Vercel**

Run: `vercel --prod`

Expected: 
- Deployment completes
- Production URL provided
- No build errors

**Step 3: Verify deployment**

Manual testing:
- Visit production URL
- Navigate to `/pipeline`
- Test all three pages work correctly

**Step 4: Commit deployment**

```bash
git add -A
git commit -m "deploy: Phase 2 Human Review Workflow to production"
git push origin main
```

---

## Verification Checklist

After completing all tasks, verify:

- [ ] `npm run build` completes with no errors
- [ ] No TypeScript errors in any pipeline pages
- [ ] ReviewDashboard loads and displays batches
- [ ] CreateBatch form submits successfully
- [ ] BatchReview shows record details
- [ ] Approve/Reject actions work
- [ ] Bulk actions work
- [ ] Navigation between pages works
- [ ] Production deployment succeeds
- [ ] All pages accessible on production URL

---

## Risks & Mitigations

### Risk 1: Supabase Client Type Issues
**Problem:** supabaseClient.ts might not have proper type exports  
**Mitigation:** Check file first, add type exports if missing

### Risk 2: Missing Database Tables
**Problem:** batches/normalized_records tables don't exist  
**Mitigation:** Run migration script first: `psql $DATABASE_URL < docs/pipeline_schema.sql`

### Risk 3: API Endpoint Errors
**Problem:** Backend endpoints return errors  
**Mitigation:** Test each endpoint with curl before frontend integration

### Risk 4: Router Configuration
**Problem:** Routes not properly configured  
**Mitigation:** Verify App.tsx has all three routes before testing

---

## Open Questions

1. **Authentication:** Should pipeline pages require login? Currently using AuthProvider wrapper.
2. **Permissions:** Should all users be able to approve/reject, or only admins?
3. **Batch Size Limits:** Should we cap batch_size at 1000, or allow larger?
4. **Real-time Updates:** Should we add WebSocket for live batch status updates?

---

## Success Criteria

✅ All TypeScript errors resolved  
✅ Build completes successfully  
✅ All three pages functional  
✅ Can create batch  
✅ Can review records  
✅ Can approve/reject  
✅ Production deployment working  
✅ No console errors in browser

---

**Estimated Time:** 45-60 minutes for all tasks  
**Complexity:** Medium (mostly type annotations)  
**Dependencies:** None (can start immediately)
