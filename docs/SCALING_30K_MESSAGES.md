# Scaling to 30,000 Messages/Day

## Current Architecture (Suitable for <1,000/day)

```
Vercel API (serverless)
  ├── In-memory queue
  ├── Rate limiter (30 msg/min)
  └── Direct Telegram/Twilio API calls
```

**Limitations:**
- Vercel functions timeout after 10 seconds
- In-memory queue lost on cold starts
- No persistence if function crashes

---

## Required Architecture for 30,000/day (21 msg/min average)

### Option A: Redis Queue + Worker (Recommended)

```
Vercel API (serverless)
  ├── Receives feedback requests
  └── Pushes to Redis queue (Upstash Redis)

Worker Service (Railway/Render/EC2)
  ├── Polls Redis queue
  ├── Rate limited sending (30 msg/min)
  └── Retries with exponential backoff
```

**Setup:**
1. Create Upstash Redis (free tier: 10K requests/day)
2. Deploy worker to Railway ($5/month)
3. Configure queue consumer

**Cost:** ~$5-10/month

---

### Option B: AWS SQS + Lambda

```
Vercel API
  └── Publishes to AWS SQS queue

AWS Lambda (scheduled)
  ├── Polls SQS every minute
  ├── Batch processes messages
  └── Sends via Telegram/Twilio
```

**Cost:** ~$2-5/month (1M SQS requests free)

---

### Option C: Vercel Cron + Database Queue

```
Vercel API (feedback endpoint)
  └── Stores in Supabase/PostgreSQL queue table

Vercel Cron Job (every minute)
  ├── Reads pending messages
  ├── Sends up to 30 messages
  └── Marks as sent
```

**Cost:** Free (Vercel cron + Supabase free tier)

---

## Rate Limits

| Service | Limit | Our Setting | Max/Day |
|---------|-------|-------------|---------|
| Telegram Bot | 30 msg/sec | 30 msg/min | 43,200 |
| Twilio WhatsApp | 1 msg/sec | 30 msg/min | 43,200 |
| Twilio SMS | 1 msg/sec | 30 msg/min | 43,200 |

**30,000/day = 20.8 msg/min average** — Within limits

---

## Implementation Steps

### Phase 1: Basic (Current)
- Direct API calls
- In-memory queue
- Suitable for testing

### Phase 2: Database Queue (Next)
1. Add Supabase table:
```sql
CREATE TABLE message_queue (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL, -- 'telegram' | 'whatsapp'
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending', -- pending | sent | failed
  retries INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  sent_at TIMESTAMP
);
```

2. Update API to insert into queue instead of sending directly

3. Add Vercel cron job to process queue

### Phase 3: Redis Worker (For 30K/day)
1. Set Upstash Redis
2. Deploy worker service
3. Monitor queue depth

---

## Monitoring

```bash
# Check queue depth
curl https://watchfacts-poc.vercel.app/api/feedback?action=queue-status

# Expected response:
{
  "telegram": { "pending": 12, "sent_today": 145, "failed": 2 },
  "whatsapp": { "pending": 8, "sent_today": 89, "failed": 0 }
}
```

---

## Environment Variables Checklist

```bash
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_ADMIN_CHAT_ID=your_chat_id_here

# Twilio (WhatsApp)
TWILIO_SID=your_account_sid
TWILIO_TOKEN=your_auth_token
TWILIO_WHATSAPP_FROM=+14155238886  # Twilio sandbox number
ADMIN_WHATSAPP_NUMBER=+1234567890   # Your number with country code

# Optional: Redis (for Phase 3)
REDIS_URL=redis://default:password@host:6379
```

---

## Testing

```bash
# Test Telegram
curl -X POST https://watchfacts-poc.vercel.app/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "52506",
    "listing": { "title": "Test", "price": 50000, "currency": "USD", "dial": "Blue" },
    "confidence": { "score": 60, "aiFields": ["price"], "catalogFields": ["reference"] },
    "type": "telegram"
  }'

# Test WhatsApp
curl -X POST https://watchfacts-poc.vercel.app/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "52506",
    "listing": { "title": "Test", "price": 50000, "currency": "USD", "dial": "Blue" },
    "confidence": { "score": 60, "aiFields": ["price"], "catalogFields": ["reference"] },
    "type": "whatsapp"
  }'
```

---

## Next Steps

1. **You provide env variables** → I activate the services
2. **Test with 10-50 messages** → Verify rate limiting works
3. **Add database queue** → Handle bursts >30/min
4. **Monitor for 1 week** → Check delivery rates
5. **Scale to Redis** → If volume exceeds 1K/day consistently
