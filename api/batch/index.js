/**
 * Batch Management API
 * POST /api/batch - Create new batch
 * GET /api/batch - List batches
 * GET /api/batch/:id - Get batch details
 * POST /api/batch/:id/process - Start processing
 * POST /api/batch/:id/review - Submit review decision
 */

import { createClient } from '@supabase/supabase-js';
import { parseMessage } from '../parser.js';
import { ValidationCoordinator } from '../validators/coordinator.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  const { method } = req;

  try {
    switch (method) {
      case 'POST':
        if (req.query.id && req.query.action === 'process') {
          return await processBatch(req, res);
        } else if (req.query.id && req.query.action === 'review') {
          return await reviewBatch(req, res);
        } else {
          return await createBatch(req, res);
        }
      
      case 'GET':
        if (req.query.id) {
          return await getBatch(req, res);
        } else {
          return await listBatches(req, res);
        }
      
      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Batch API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Create new batch
async function createBatch(req, res) {
  const { size = 1000, priority = 5, filter_criteria } = req.body;

  const { data, error } = await supabase
    .from('processing_batches')
    .insert({
      batch_size: size,
      priority,
      filter_criteria: filter_criteria || {},
      status: 'QUEUED'
    })
    .select()
    .single();

  if (error) throw error;

  return res.status(201).json({
    success: true,
    batch: data
  });
}

// List batches
async function listBatches(req, res) {
  const { status, limit = 50, offset = 0 } = req.query;

  let query = supabase
    .from('processing_batches')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;

  if (error) throw error;

  return res.json({
    batches: data,
    total: count,
    limit: parseInt(limit),
    offset: parseInt(offset)
  });
}

// Get batch details
async function getBatch(req, res) {
  const { id } = req.query;

  const { data: batch, error: batchError } = await supabase
    .from('processing_batches')
    .select('*')
    .eq('id', id)
    .single();

  if (batchError) throw batchError;

  const { data: records, error: recordsError } = await supabase
    .from('normalized_records')
    .select('*')
    .eq('batch_id', id)
    .order('created_at', { ascending: true });

  if (recordsError) throw recordsError;

  return res.json({
    batch,
    records
  });
}

// Process batch
async function processBatch(req, res) {
  const { id } = req.query;
  const { parser_version = 'v4.10' } = req.body;

  // Get batch
  const { data: batch, error: batchError } = await supabase
    .from('processing_batches')
    .select('*')
    .eq('id', id)
    .single();

  if (batchError) throw batchError;

  if (batch.status !== 'QUEUED') {
    return res.status(400).json({ 
      error: 'Batch must be in QUEUED status to process' 
    });
  }

  // Update status to PROCESSING
  await supabase
    .from('processing_batches')
    .update({ 
      status: 'PROCESSING',
      started_at: new Date().toISOString(),
      parser_version
    })
    .eq('id', id);

  // Get raw records based on filter criteria
  const filters = batch.filter_criteria || {};
  let query = supabase
    .from('watch_records')
    .select('id, raw_message, created_at')
    .limit(batch.batch_size)
    .order('created_at', { ascending: true });

  // Apply filters
  if (filters.verdict) {
    query = query.eq('verdict', filters.verdict);
  }
  if (filters.brand) {
    query = query.eq('brand', filters.brand);
  }
  if (filters.date_from) {
    query = query.gte('created_at', filters.date_from);
  }
  if (filters.date_to) {
    query = query.lte('created_at', filters.date_to);
  }

  const { data: rawRecords, error: recordsError } = await query;

  if (recordsError) throw recordsError;

  // Process each record
  const validationCoordinator = new ValidationCoordinator();
  const results = {
    total: rawRecords.length,
    passed: 0,
    flagged: 0,
    errors: 0
  };

  const normalizedRecords = [];

  for (const raw of rawRecords) {
    try {
      // Parse message
      const parsed = await parseMessage(raw.raw_message, parser_version);

      // Validate with sub-agents
      const validation = await validationCoordinator.validate(parsed, raw);

      // Determine status
      let status = 'PENDING';
      if (validation.overall_status === 'PASSED' && validation.confidence > 0.85) {
        status = 'APPROVED';
        results.passed++;
      } else if (validation.overall_status === 'FAILED' || validation.confidence < 0.5) {
        status = 'REJECTED';
        results.errors++;
      } else {
        status = 'PENDING';
        results.flagged++;
      }

      normalizedRecords.push({
        batch_id: id,
        raw_record_id: raw.id,
        version: 1,
        brand: parsed.brand,
        reference: parsed.reference,
        dial_color: parsed.dial_color,
        condition: parsed.condition,
        year: parsed.year,
        price_usd: parsed.price_usd,
        currency: parsed.currency,
        parser_version,
        confidence_score: validation.confidence,
        raw_message: raw.raw_message,
        validation_status: validation.overall_status,
        validation_results: validation,
        flagged_issues: validation.issues || [],
        status
      });

    } catch (error) {
      console.error(`Error processing record ${raw.id}:`, error);
      results.errors++;
    }
  }

  // Insert normalized records
  if (normalizedRecords.length > 0) {
    const { error: insertError } = await supabase
      .from('normalized_records')
      .insert(normalizedRecords);

    if (insertError) throw insertError;
  }

  // Update batch status
  const newStatus = results.flagged > 0 ? 'REVIEW' : 'COMPLETED';
  
  await supabase
    .from('processing_batches')
    .update({
      status: newStatus,
      completed_at: new Date().toISOString(),
      processed_count: results.total,
      validation_summary: results
    })
    .eq('id', id);

  return res.json({
    success: true,
    batch_id: id,
    status: newStatus,
    results
  });
}

// Review batch
async function reviewBatch(req, res) {
  const { id } = req.query;
  const { decision, reviewer, notes, record_ids } = req.body;

  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    return res.status(400).json({ 
      error: 'Decision must be APPROVED or REJECTED' 
    });
  }

  // Update batch
  await supabase
    .from('processing_batches')
    .update({
      status: decision === 'APPROVED' ? 'COMPLETED' : 'FAILED',
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      review_notes: notes
    })
    .eq('id', id);

  // Update records
  let updateQuery = supabase
    .from('normalized_records')
    .update({
      status: decision,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      review_notes: notes
    })
    .eq('batch_id', id);

  if (record_ids && record_ids.length > 0) {
    updateQuery = updateQuery.in('id', record_ids);
  } else {
    updateQuery = updateQuery.eq('status', 'PENDING');
  }

  await updateQuery;

  // Log change history
  const { data: records } = await supabase
    .from('normalized_records')
    .select('id')
    .eq('batch_id', id);

  if (records && records.length > 0) {
    const historyEntries = records.map(r => ({
      normalized_record_id: r.id,
      change_type: decision,
      changed_by: reviewer,
      change_reason: notes
    }));

    await supabase
      .from('record_change_history')
      .insert(historyEntries);
  }

  return res.json({
    success: true,
    batch_id: id,
    decision,
    records_updated: records?.length || 0
  });
}
