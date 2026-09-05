# Green API Integration

## Target Flow

```text
Green API webhook
-> verify signature/source
-> idempotency check by external event/message ID
-> raw_messages
-> queue
-> segmentation
-> normalization
-> review/approval
```

## Shadow Mode

Before public release:

- store Green API events
- normalize them
- show results only to admins
- compare against source chats
- measure duplicates, misses, false positives, currency errors, and media failures
- release to Trading Floor after acceptance thresholds

## Requirements

- webhook authentication
- retry-safe idempotency
- media download isolation
- error queue
- event ordering strategy
- no direct writes to final analytics tables

