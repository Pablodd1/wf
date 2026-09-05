# Decision Log

## 2026-07-12: Phase 1 Audit Branch

Decision: Use `audit/cto-full-review` for documentation and audit only.

Reason: The repository needs durable memory and evidence before behavior changes.

## 2026-07-12: Raw Migration First

Decision: Historical MySQL/MariaDB import must copy raw messages before normalization.

Reason: Combining migration with parsing makes failures hard to resume, corrupts lineage, and can distort evidence.

## 2026-07-12: Green API Last

Decision: Green API should be connected after historical migration and normalization pipeline are stable.

Reason: Live ingestion should use the same pipeline as historical messages and should begin in shadow mode.

## 2026-07-12: Credentials Treated As Exposed

Decision: Credentials shared in chat or committed to Git must be rotated.

Reason: They cannot be considered secure after exposure.

