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
  stats?: BatchStats;
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
  verdict?: string;
  
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
  
  // Supabase join fields (runtime only)
  watch_records?: {
    raw_message?: string;
    received_at?: string;
    source?: string;
    [key: string]: any;
  };
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
