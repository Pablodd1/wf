/**
 * First Batch Processing — Test Script
 * Creates, processes, and validates a small batch to verify pipeline
 * 
 * Run: curl -X POST https://watchfacts-poc.vercel.app/api/batch/process
 * Body: { batchId: "...", dryRun: true }
 */

import { getClient } from './_lib/supabase';
import { parseFull } from './_lib/parser';
import { routeMessage } from './_lib/message-router';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { batchId, dryRun = true } = req.body;
  if (!batchId) {
    return res.status(400).json({ error: 'batchId required' });
  }

  try {
    const supabase = getClient();

    // 1. Get batch details
    const { data: batch, error: batchError } = await supabase
      .from('batches')
      .select('*')
      .eq('id', batchId)
      .single();

    if (batchError) throw batchError;
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    // 2. Get records for this batch
    const { data: records, error: recordsError } = await supabase
      .from('watch_records')
      .select('id, raw_message, brand, reference')
      .limit(batch.batch_size || 10)
      .order('created_at', { ascending: false });

    if (recordsError) throw recordsError;

    // 3. Process each record through the pipeline
    const results = {
      total: records.length,
      processed: 0,
      skipped: 0,
      errors: 0,
      high_confidence: 0,
      medium_confidence: 0,
      low_confidence: 0,
      samples: []
    };

    for (const record of records) {
      try {
        if (!record.raw_message) {
          results.skipped++;
          continue;
        }

        // Route through pipeline
        const routing = await routeMessage(
          { 
            typeWebhook: 'incomingMessageReceived',
            messageData: { 
              typeMessage: 'textMessage',
              textMessageData: { textMessage: record.raw_message }
            },
            senderData: { 
              chatId: 'test-batch',
              sender: 'batch-processor',
              senderName: 'Batch Processor'
            },
            timestamp: Date.now() / 1000
          },
          supabase
        );

        if (routing.status === 'SKIP') {
          results.skipped++;
          continue;
        }

        if (routing.status === 'ERROR') {
          results.errors++;
          continue;
        }

        results.processed++;
        if (routing.confidence >= 85) results.high_confidence++;
        else if (routing.confidence >= 50) results.medium_confidence++;
        else results.low_confidence++;

        // Collect samples
        if (results.samples.length < 10) {
          results.samples.push({
            id: record.id,
            brand: routing.brand,
            reference: routing.reference,
            confidence: routing.confidence,
            status: routing.status,
            message: record.raw_message.substring(0, 80)
          });
        }
      } catch (error) {
        results.errors++;
        console.error(`Error processing record ${record.id}:`, error);
      }
    }

    // 4. Update batch with results
    if (!dryRun) {
      await supabase
        .from('batches')
        .update({
          status: results.high_confidence === results.total ? 'COMPLETED' : 'REVIEW',
          processed_count: results.total,
          success_count: results.processed,
          failed_count: results.errors + results.skipped,
          completed_at: new Date().toISOString()
        })
        .eq('id', batchId);
    }

    return res.status(200).json({
      dryRun,
      batch: {
        id: batch.id,
        name: batch.name || `Batch ${batch.id.slice(0, 8)}`,
        status: batch.status
      },
      results: {
        total_records: results.total,
        processed: results.processed,
        skipped: results.skipped,
        errors: results.errors,
        confidence_distribution: {
          high: results.high_confidence,
          medium: results.medium_confidence,
          low: results.low_confidence
        },
        approval_rate: results.total > 0 
          ? Math.round((results.high_confidence / results.total) * 100)
          : 0,
        samples: results.samples
      }
    });

  } catch (error) {
    console.error('Batch process error:', error);
    return res.status(500).json({ error: error.message });
  }
}
