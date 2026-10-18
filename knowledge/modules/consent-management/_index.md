# Consent Management

## Documentation Files

- [consent-management-demo-talk-track](./consent-management-demo-talk-track.md)

## Support Engineering Training (LSC4CE Value Chain)

### Key Concepts

- **PSL gating** — LS Core Permission Set License + Consent Management permission set are both required; without either, Consent tab and LWC are hidden.
- **Sharing model** — `CommunicationSubscription`, `CommunicationSubscriptionChannel`, and `CommunicationSubscriptionEngagement` ALL need explicit sharing. Territory edit access alone does NOT grant access.
- **Dual proof model** — Signature (mobile-only) AND Attachment can both be enabled per Module Type; each has `None` / `Optional` / `Required` setting values.
- **Filtering logic** — Three rules in priority order: (1) PATI → use PATI; (2) No PATI but account column set → use account column match; (3) Neither → record silently NOT shown.
- **Disclaimer text** — Comes from `ComplianceStatementDef` with `ModuleType = Consent Management`, `StatementType = Disclaimer`; record-level sharing required.

- [support-engineering-consent-management](./support-engineering-consent-management.md) — Jun 2026 session. LS Core PSL + perm set requirements, Consent tab + LWC placement on Account page, communication subscription/channel/engagement sharing (CRITICAL: territory edit access ≠ consent access), signature vs attachment proof modes per Module Type, PATI vs account-column filter logic with 3 priority rules, disclaimer setup via Compliance Statement Definition, 7 troubleshooting patterns.

## Winter '27 (Release 264) Enhancements

- [release-264-verbal-and-paper-consent](./release-264-verbal-and-paper-consent.md) — Verbal consent and paper-form document reference as consent proof; `IsVerbalConsent`, `ConsentDocumentReference`.
