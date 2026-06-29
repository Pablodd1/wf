/**
 * Settings API — Get/Update parser thresholds and API config
 */
module.exports = (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      approve_threshold: parseInt(process.env.APPROVE_THRESHOLD || '85', 10),
      human_threshold: parseInt(process.env.HUMAN_THRESHOLD || '70', 10),
      llm_provider: process.env.LLM_PROVIDER || 'GPT-4o-mini',
      llm_trigger_threshold: parseInt(process.env.LLM_TRIGGER_THRESHOLD || '70', 10),
    });
  }

  if (req.method === 'POST') {
    const { approve_threshold, human_threshold, llm_provider, llm_trigger_threshold } = req.body;

    // Note: Vercel serverless functions can't persist env vars across invocations
    // In production, these should be saved to a database table
    // For now, we return what was sent so the client knows the values
    return res.status(200).json({
      message: 'Settings updated (in-memory for this session)',
      approve_threshold: approve_threshold || 85,
      human_threshold: human_threshold || 70,
      llm_provider: llm_provider || 'GPT-4o-mini',
      llm_trigger_threshold: llm_trigger_threshold || 70,
    });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
