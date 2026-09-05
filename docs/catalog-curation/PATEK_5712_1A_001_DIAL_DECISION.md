# Patek Philippe 5712/1A-001 Dial Curation

## Decision

Use `Blue` as the canonical dial value for the steel Nautilus
`5712/1A-001`. Treat dealer shorthand `5712/1A` as a curated alias of that
canonical reference.

## Why

The local source catalog had one Blue variant and a second vendor title that
described the same dial as `black-blue`. The import pipeline split that phrase
into two independent variants, `Black` and `Blue`, creating an artificial
multi-dial catalog match and blocking deterministic review.

Independent market references describe the configuration as Blue or
black-blue, not as a separate Black-dial configuration. The curation keeps the
customer-facing normalized value as `Blue` while retaining the raw-source
history unchanged.

## Safety boundary

This curation changes catalog interpretation only. Existing unknown-dial
listings still require either a single-candidate shadow proposal or human
review before any live record is updated. Bundle rows and raw-text conflicts
remain excluded from price analytics.
