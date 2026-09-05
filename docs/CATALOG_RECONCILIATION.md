# Catalog Reconciliation

## Rules

- Catalog validation is authoritative for valid configurations.
- Raw dealer claims must be preserved even when catalog disagrees.
- Exact catalog reference match should outrank heuristic brand inference.
- Partial references return ranked candidates, not silent full-reference expansion.
- Material, dial, bracelet, bezel, year/card date, and special-edition claims require evidence.
- Special edition terms such as Tiffany, Rainbow, Salmon, and Ombre Green should remain claimed until confirmed.

## Review Reasons

```text
REFERENCE_NOT_FOUND
REFERENCE_AMBIGUOUS
REFERENCE_MODEL_MISMATCH
DIAL_CATALOG_MISMATCH
POSSIBLE_SPECIAL_EDITION
CATALOG_VARIANT_CONFLICT
```

## Current Risk

The repository contains several brand/reference heuristics across different files. A canonical catalog reconciliation service should replace scattered inference logic.

