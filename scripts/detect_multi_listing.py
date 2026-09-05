#!/usr/bin/env python3
"""
WatchFacts Multi-Watch Listing Detector

Detects whether a raw dealer message contains multiple distinct watches
(price list format) or a single watch listing.

A message is classified as MULTI when it has 3+ distinct reference numbers,
each accompanied by a price indicator on its line.

Returns: {count: int, lines: [...], is_multi: bool}
"""

import re
from typing import Dict, List


# ── Reference Number Patterns ──────────────────────────────────
# Match Rolex (5-6 digit + optional suffix), AP, Patek, VC, Panerai, etc.
REFERENCE_PATTERNS = [
    # Rolex: 5-6 digits + optional suffix (e.g., 126610LN, 52506, 126234)
    re.compile(r'\b([1-3][0-9]{4,5}[A-Z]{0,4})\b', re.IGNORECASE),
    # Audemars Piguet: 15/26/77/67 + 3 digits + 2 letters (e.g., 15510ST)
    re.compile(r'\b((?:15|26|77|67)[0-9]{3}[A-Z]{2})\b', re.IGNORECASE),
    # Patek Philippe: 3-7 + 3 digits + optional suffix (e.g., 5167A, 5711/1A)
    re.compile(r'\b([3-7][0-9]{3}[A-Z]{0,2}(?:/[0-9]{1,3}[A-Z]{1,2})?)\b', re.IGNORECASE),
    # Vacheron Constantin: 4/5 + 3 digits + V/ + suffix (e.g., 4500V/110A)
    re.compile(r'\b([458][0-9]{3}[Vv]/[0-9A-Za-z-]{1,10})\b', re.IGNORECASE),
    # Richard Mille (e.g., RM011, RM 35-02)
    re.compile(r'\b(RM\s*0*[0-9]{2,3}(?:[-\s][A-Z0-9]+)?)\b', re.IGNORECASE),
    # Panerai (e.g., PAM 111, PAM01312)
    re.compile(r'\b(PAM\s*0*\d{3,5})\b', re.IGNORECASE),
    # Cartier / other: letter prefix + digits (e.g., WSSA0029)
    re.compile(r'\b([A-Z]{1,3}[0-9]{4,6}[A-Z0-9]{2,8})\b'),
    # Generic: 4-6 digits + optional letters (catch-all for unknown formats)
    re.compile(r'\b([0-9]{4,6}[A-Z]{0,4})\b', re.IGNORECASE),
]

# ── Price Indicators ────────────────────────────────────────────
# Look for price-like numbers (5-8 digits, with optional commas/dots)
# and currency symbols on each line
PRICE_PATTERN = re.compile(
    r'(?:'
    r'[\$€£¥₽₿💰]'                          # currency symbol
    r'\s*[\d,]+(?:\.\d+)?'                  # amount
    r'\s*(?:[kKmMwW万]|'                     # multiplier
    r'(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB)'  # currency code
    r')?'                                    # optional
    r'|'
    r'[\d,]+(?:\.\d+)?'                     # amount first
    r'\s*(?:[kKmMwW万])?'                    # optional multiplier
    r'\s*(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB|\$|€|£|¥|💰)'  # currency (no amount after)
    r'|'
    r'(?:USD|USDT|HKD|EUR|GBP|CHF|SGD|AUD|CAD|JPY|CNY|RMB)'  # currency code
    r'\s*[\d,]+(?:\.\d+)?'                  # amount (no space after currency)
    r'\s*(?:[kKmMwW万])?'                     # optional multiplier
    r')',
    re.IGNORECASE
)

# Alternative: bare price amounts for price-list style (e.g., "52506 N3 FS?300000")
BARE_PRICE_PATTERN = re.compile(
    r'(?:\?|~|≈|about\s+)?'                  # optional approximate marker
    r'\b(\d{5,8})\b'                         # 5-8 digit number (price range)
)


def _extract_reference(text: str) -> str | None:
    """Extract a watch reference number from a line of text."""
    # Try patterns in priority order
    for pattern in REFERENCE_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(1).upper()
    return None


def _has_price(text: str) -> bool:
    """Check if a line of text contains a price indicator."""
    if PRICE_PATTERN.search(text):
        return True
    # Bare price check: 5-8 digits that are NOT a reference number
    # Remove any known reference from the text first to avoid false positives
    ref = _extract_reference(text)
    if ref:
        # Strip the reference from the text before checking for bare prices
        stripped = text.replace(ref, '', 1).replace(ref.lower(), '', 1)
    else:
        stripped = text
    if BARE_PRICE_PATTERN.search(stripped):
        return True
    return False


def detect_multi_listing(raw_message: str) -> Dict:
    """
    Count distinct watches in a raw dealer message.

    A message is MULTI if it contains 3+ distinct reference numbers,
    each on a line that also has a price indicator.

    Args:
        raw_message: Raw text from WhatsApp/Telegram dealer listing

    Returns:
        {
            count: int        — number of distinct watches detected
            lines: [str]      — individual watch lines extracted
            is_multi: bool    — True if 3+ distinct refs each with price
        }
    """
    # Split into lines, strip whitespace, filter empty
    all_lines = [
        line.strip()
        for line in raw_message.split('\n')
        if line.strip()
    ]

    if not all_lines:
        return {'count': 0, 'lines': [], 'is_multi': False}

    # ── Phase 1: Identify candidate watch lines ────────────────
    # A candidate line has both a reference number AND a price indicator
    watch_lines: List[tuple[str, str]] = []  # (line, ref_number)
    seen_refs: set = set()

    for line in all_lines:
        ref = _extract_reference(line)
        if not ref:
            continue

        if _has_price(line):
            if ref not in seen_refs:
                seen_refs.add(ref)
                watch_lines.append((line, ref))

    # ── Phase 2: Determine if multi ──────────────────────────
    # MULTI: 3+ distinct references, each with a price indicator
    unique_count = len(seen_refs)
    is_multi = unique_count >= 3

    return {
        'count': unique_count,
        'lines': [wl[0] for wl in watch_lines],
        'is_multi': is_multi,
    }


# ── Legacy alias ────────────────────────────────────────────────
# Provided for backward compatibility with the task spec naming
count_watches_in_message = detect_multi_listing


# ── Tests ───────────────────────────────────────────────────────
if __name__ == '__main__':
    test_cases = [
        # Single watch with currency format
        {
            'name': 'Single: Rolex with dollar price',
            'msg': 'Rolex 126610LN Black 2025 $14,300',
            'expected': {'count': 1, 'is_multi': False},
        },
        # Multi-watch price list
        {
            'name': 'Multi: 3-watch price list',
            'msg': '52506 N3 FS?300000\n126234 Wim Jub N3?94500\n126333G blk Jub N3?165000',
            'expected': {'count': 3, 'is_multi': True},
        },
        # Single with noise (no explicit price on same line as ref)
        {
            'name': 'Single: reference only, no price on same line',
            'msg': 'Rolex Submariner 126610LN Green 2025',
            'expected': {'count': 0, 'is_multi': False},
        },
        # Single watch — price present on same line
        {
            'name': 'Single: Rolex with ref + price on one line',
            'msg': 'Rolex 126610LN Black 2025 USD 14300',
            'expected': {'count': 1, 'is_multi': False},
        },
        # Edge: 2 watches (not quite multi)
        {
            'name': 'Edge: 2 watches, not multi',
            'msg': '126610LN Black $14,300\n126234 Wim $9,450',
            'expected': {'count': 2, 'is_multi': False},
        },
        # Edge: 3+ refs but prices scattered
        {
            'name': 'Edge: 3 refs, some without prices on same line',
            'msg': 'ROLEX PRICE LIST\n126610LN Black $14,300\n126234 Wim\n126333G blk $16,500',
            'expected': {'count': 2, 'is_multi': False},  # line 2 has no price on same line
        },
        # Multi with currency codes
        {
            'name': 'Multi: 4 watches with HKD prices',
            'msg': '126610LN Black HKD 112000\n126234 Wim HKD 74500\n126333G blk HKD 130000\n116500LN Wht HKD 168000',
            'expected': {'count': 4, 'is_multi': True},
        },
        # Empty message
        {
            'name': 'Edge: empty message',
            'msg': '',
            'expected': {'count': 0, 'is_multi': False},
        },
        # Duplicate refs (should deduplicate)
        {
            'name': 'Edge: duplicate ref lines',
            'msg': '126610LN Black $14,300\n126610LN Black $14,200\n126234 Wim $9,450\n126333G blk $16,500',
            'expected': {'count': 3, 'is_multi': True},  # 126610LN appears twice, deduped
        },
        # WhatsApp style with emoji
        {
            'name': 'Multi: WhatsApp price list with 💰',
            'msg': '52506 N3 FS 💰 300000\n126234 Wim Jub N3 💰 94500\n126333G blk Jub N3 💰 165000',
            'expected': {'count': 3, 'is_multi': True},
        },
    ]

    passed = 0
    failed = 0

    for tc in test_cases:
        result = detect_multi_listing(tc['msg'])
        count_ok = result['count'] == tc['expected']['count']
        multi_ok = result['is_multi'] == tc['expected']['is_multi']

        status = '✅' if (count_ok and multi_ok) else '❌'
        if count_ok and multi_ok:
            passed += 1
        else:
            failed += 1

        print(f"{status} {tc['name']}")
        if not count_ok:
            print(f"   count: expected={tc['expected']['count']}, got={result['count']}")
        if not multi_ok:
            print(f"   is_multi: expected={tc['expected']['is_multi']}, got={result['is_multi']}")
        print(f"   lines found: {result['lines']}")
        print()

    print(f"─── {passed}/{passed + failed} passed ───")
    if failed > 0:
        print(f"❌ {failed} test(s) FAILED")
    else:
        print("🎉 All tests passed!")
