# Account Management

## Documentation Files

- [account-ratings-talk-track](./account-ratings-talk-track.md)
- [account-search-sbc-admin-talk-track](./account-search-sbc-admin-talk-track.md)
- [account-search-sbc-talk-track](./account-search-sbc-talk-track.md)
- [account-summarization](./account-summarization.md)
- [acct-multi-object-component-talk-track](./acct-multi-object-component-talk-track.md)
- [addresses-talk-track](./addresses-talk-track.md)
- [affiliations-talk-track](./affiliations-talk-track.md)
- [business-licenses-talk-track](./business-licenses-talk-track.md)
- [data-change-request-talk-track](./data-change-request-talk-track.md)
- [provider-card](./provider-card.md)

## Support Engineering Training (LSC4CE Value Chain)

Deep-dive support engineering content on Search Before Create (SBC) from the Engineering → Support training series. Two-part series covering internal search flows + external OneKey integration.

### Key Concepts

- **Data flattening** — HCP fields (phones, emails, NPI, social IDs, specialties) populated from child contact-point records via triggers + batch job. Required for cross-entity search.
- **Two search flavors** — Search Outside Territory (fuzzy / keyword across Account + HCP + ContactPointAddress) vs Advanced Search (HCP / HCO / By ID, with field-set-mapped form).
- **Manual Alignment** — Bridge from "found via Search Outside Territory" → "now in my book"; creates/activates `ObjectTerritory2Association` + `ProviderAcctTerritoryInfo`.
- **External Search (OneKey)** — Via MuleSoft Integration Definition; `Show External Results Along With Internal` runs them in parallel; In/Out of Contract classification gates downloads against per-user + org-wide limits.
- **DCR vs External Download** — DCR enforces approval workflow for Create Account; **external downloads SKIP DCR** because OneKey is treated as source of truth.

- [support-engineering-search-before-create-part1](./support-engineering-search-before-create-part1.md) — May 8, 2026 (Saumya Sharma). Data flattening (triggers + job), Search Outside Territory, Advanced Search (HCP/HCO/By ID), License Search, default + custom field sets via Field Set Mapping, Manual Alignment, 4 troubleshooting patterns.
- [support-engineering-search-before-create-part2](./support-engineering-search-before-create-part2.md) — May 12, 2026 (Saumya Sharma). External Search settings (MuleSoft integration, contract checks, granular download controls), External Account Download (auto-territory alignment + DCR skip), Create Account flow (record-type selector + auto-population + field sets), Affiliated-account auto-alignment, DCR approval workflow, 8 troubleshooting patterns.

## Winter '27 (Release 264) Enhancements

- [release-264-relevance-based-account-search](./release-264-relevance-based-account-search.md) — iPad Account Search ranks by relevance with dynamic filters (address-only / account-only / consolidated).
