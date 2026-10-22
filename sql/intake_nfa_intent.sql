-- The intake form's single "NFA item" yes/no couldn't tell apart two very
-- different shipments (2026-10-22): a customer mailing in something that is
-- already NFA-registered (suppressor, SBR, SBS - its own ATF transport rules
-- and paperwork) vs. a customer mailing an ordinary parts kit they want built
-- INTO an SBR/SBS. Shawn ships and prepares for each differently. is_nfa
-- stays (builds use it for the NFA stage pipeline) and is true for both.
-- Purely additive. Older rows stay 'none' (they never said which kind); the
-- admin list falls back to a plain "NFA" badge for those via is_nfa.
-- Run in the Supabase SQL editor BEFORE deploying the matching intake code -
-- the Worker writes this column on every intake insert.

alter table intake_submissions
  add column if not exists nfa_intent text not null default 'none'
  check (nfa_intent in ('none', 'build_to_nfa', 'already_nfa'));
