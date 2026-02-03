# SynaptaGrid Website — Marketing Review (Saved)

Date: 2026-02-03

## Scope
- Landing page
- Product pages: EGAV, Automation
- Case studies
- Contact + demo request
- Login + register
- Metadata (`public/index.html`)

## What’s working well
- **Clear ICP**: “Automation infrastructure for SaaS” + emphasis on **multi-tenant, white-label, governance** is consistent and credible for B2B platform buyers.
- **Strong narrative flow**: problems → solution → differentiators → plans → comparison → use cases → proof → CTA.
- **Consistent primary CTA**: “Schedule your technical review” matches an enterprise/technical sales motion.

## Highest-impact opportunities
- **Hero is overloaded**: the opening paragraph tries to explain EGAV + Automation + transports + OpenAPI + conditions + controls + multi-tenancy in one breath. This reduces comprehension and conversion.
- **Proof/credibility gaps**:
  - “99.9% execution reliability” needs a definition (SLA vs observed, period, scope). If it’s not defensible, it can reduce trust.
  - “Temporal-backed” is good for technical buyers, but should be framed as a benefit first (“durable execution with retries/state”) and the tech second.
- **Offer/CTA mismatch**:
  - “Request access” vs “Create account” vs “Start your free trial” implies mixed motions (approval-gated vs self-serve). Tightening this improves conversion.

## Professional wording + consistency (quick wins)
- Replace casual/unprofessional phrases:
  - “We can do all.” → more specific and professional wording.
  - Reduce/replace repeated “you name it”.
  - “one-off zaps” → “one-off automations”.
- Normalize terminology:
  - “on-premise” → “on‑premises”.
- Normalize CTA wording:
  - Demo form button text should match the primary CTA (“Schedule your technical review”).
  - “Sign in” casing should be consistent across headings/buttons.

## Suggested copy direction (principles)
- **Lead with outcomes**, then a **short list of proofs** (bring-your-own-API, tenant isolation, durable execution).
- **Prefer benefit-first** phrasing (“durable, stateful execution”) and add implementation detail (“Temporal”) as secondary.
- **One CTA per stage**: pick self-serve trial *or* request access, and align labels everywhere.

## Implementation notes (what we changed now)
- Kept changes limited to **copy-only tweaks** in `src/App.tsx` for tone and consistency.

