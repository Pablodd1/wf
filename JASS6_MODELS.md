# JASS-6 MODEL STRATEGY
# Who does what — cost vs capability
# 2026-07-09

=== MODEL ROSTER ===

SONNET 5 (Anthropic) — $15/M tokens
  Best for: Architecture design, state machine logic, complex refactoring,
           code review, security audit, spec writing
  Use when: Designing new modules, debugging multi-file interactions,
            anything where wrong code = data corruption
  Avoid: Mechanical work (regex addition, pattern expansion, test writing)
  Token strategy: Give it the SPEC + the FILE to modify + the GOAL.
                  Keep context tight. Never give it the full codebase.

KIMI K2.6 (Moonshot) — $0.40/M tokens
  Best for: Bulk pattern addition (adding 6 new brand REF_PATTERNS),
            mechanical refactoring (extracting modules from parser.js),
            test suite expansion, documentation generation
  Use when: "Add these 30 lines in this exact pattern to this file"
  Avoid: Anything requiring judgment about data quality or edge cases
  Token strategy: Cheapest. Can give it large files. Use for grunt work.

DEEPSEEK V4 PRO (DeepSeek) — $1.50/M tokens  
  Best for: Mid-complexity work, API integration, Supabase queries,
            Vercel deployment, regex optimization, live testing
  Use when: Sonnet is overkill, Kimi can't handle nuance
  Token strategy: General workhorse. Good balance.

=== COST ESTIMATES FOR JASS-6 BUILD ===

Phase A (Safe Refactor):
  Sonnet 5:   ~50K tokens → $0.75  (architecture design)
  DeepSeek:  ~200K tokens → $0.30  (file extraction, wire-up)
  Kimi:      ~500K tokens → $0.20  (test migration, bulk moves)
  TOTAL: ~$1.25

Phase B (Additive Features):
  Sonnet 5:  ~100K tokens → $1.50  (emoji detection design, red flags)
  DeepSeek:  ~300K tokens → $0.45  (pattern additions, testing)
  Kimi:      ~800K tokens → $0.32  (25 emoji mappings, 30 brand keywords)
  TOTAL: ~$2.27

Phase C (State Machine):
  Sonnet 5:  ~150K tokens → $2.25  (state machine logic, audit trail)
  DeepSeek:  ~200K tokens → $0.30  (integration testing)
  Kimi:      ~300K tokens → $0.12  (boilerplate, output formatting)
  TOTAL: ~$2.67

Phase D (Catalog Table):
  Sonnet 5:  ~200K tokens → $3.00  (schema design, migration, 100% rule)
  DeepSeek:  ~400K tokens → $0.60  (migration scripts, Supabase queries)
  Kimi:     ~1000K tokens → $0.40  (data import from Excel, JSON export)
  TOTAL: ~$4.00

Phase E (AI Integration):
  Sonnet 5:  ~100K tokens → $1.50  (prompt design, fallback logic)
  DeepSeek:  ~300K tokens → $0.45  (API integration, cost gating)
  Kimi:      ~200K tokens → $0.08  (response parsing, retry logic)
  TOTAL: ~$2.03

FULL JASS-6 BUILD: ~$12 total across all models

=== RULES FOR HERMES ===

1. Sonnet 5 = ARCHITECT. Give it the spec, one file, one goal.
   Never use Sonnet for "add 30 patterns to this array."

2. Kimi = LABOR. Give it the exact pattern, the file, and say 
   "add variants for these 6 brands using the same structure."

3. DeepSeek = FOREMAN. Wire modules together, run tests, deploy.
   Handles the integration layer between Sonnet-designed modules
   and Kimi-generated bulk work.

4. Token saving: 
   - Never give Sonnet files it doesn't need
   - Bundle Kimi tasks into batches (all 6 brand patterns in one call)
   - DeepSeek runs verifications after each phase
   - Subagents inherit parent model (not selectable per call)

5. After reset: mention "use the model strategy from JASS6_MODELS.md"
   and Hermes will load this file.

=== SAVED ===
File: /home/jasme/wf/JASS6_MODELS.md
Branch: preview-cleaner-theme
