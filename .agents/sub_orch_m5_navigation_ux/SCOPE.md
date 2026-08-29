# Milestone M5 Scope: Smooth Navigation UX (R5)

## Objective
Implement Milestone M5 (Smooth Navigation UX) for WatchFacts according to Requirement R5.

## Work Items
1. **Persistent Top Navigation Bar (`src/components/MarketHeader.tsx`)**:
   - Ensure `HEADER_LINKS` includes 1-click links for all key surfaces:
     - Trading Floor (`/trading`)
     - Price Research (`/price-research`)
     - Telegram Test Staging (`/telegram-test`)
     - Dealer Login (`/dealer-login`)
2. **Page Header Unification**:
   - Render `MarketNav` (or `MarketHeader`) consistently across all pages currently missing it:
     - `src/pages/TelegramTest.tsx`
     - `src/pages/DealerLogin.tsx`
     - `src/pages/InsightDetails.tsx` (replace old inline custom `<NavBar>` with `MarketNav`)
3. **Reusable Breadcrumb / Back-Link Component**:
   - Create or update `<Breadcrumb>` / back-link component (`ArrowLeft` icon with clear label) on detail views:
     - `src/pages/InsightDetails.tsx`
     - `src/pages/FlashSaleDetail.tsx`
     - `src/pages/DealerProfile.tsx`
   - Allow users to easily navigate back to parent views (e.g., Trading Floor or Price Research) without relying solely on browser back button.
4. **Verification**:
   - TypeScript build (`npm run build`) succeeds with zero errors.
   - Reviewer, Challenger, and Auditor verification gates pass.

## Affected Files
- `src/components/MarketHeader.tsx`
- `src/components/Breadcrumb.tsx` (or `Breadcrumbs.tsx`)
- `src/pages/TelegramTest.tsx`
- `src/pages/DealerLogin.tsx`
- `src/pages/InsightDetails.tsx`
- `src/pages/FlashSaleDetail.tsx`
- `src/pages/DealerProfile.tsx`
