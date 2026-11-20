---
name: lsc-health-check
description: Guides org health assessment and configuration verification. Use when the user asks about org health, configuration status, or a general assessment of their LSC setup.
---
For health check guidance, call `search_lsc_knowledge({ query: "health check configuration" })` to get sourced documentation.

# Life Sciences Cloud (LSC) Health Check

This skill activates when users ask about org health, configuration status, or want a general assessment of their LSC setup.

## When to Activate

- User asks "Is my org set up correctly?" or "Check my org health"
- User asks about missing configuration or setup issues
- User wants to verify their LSC deployment is complete
- User is preparing for a go-live or deployment

## Steps

1. Run the `health_check` tool to get a comprehensive assessment
2. Present findings organized by severity (errors first, then warnings, then info)
3. For each issue, explain:
   - What it means in business terms
   - The impact if not fixed
   - How to resolve it (with specific tool/command references)
4. Offer to fix issues using the appropriate tools

## Key Areas Checked

- **Trigger Handlers:** Inactive handlers that may prevent LSC features from working
- **Permission Sets:** Missing LSC permission set licenses that prevent user access
- **Territory Model:** No active territory model means territory features are broken
- **DB Schema:** Missing records mean mobile app won't sync data
- **Mobile Cache:** Stale cache means recent config changes aren't reflected on mobile

## Follow-up Actions

After a health check, common next steps include:
- `/lsc:audit` for detailed validation rule checks
- `toggle_trigger_handler` to enable missing handlers
- `assign_permission_set` to fix user access
- `/lsc:generate-metadata-cache` to refresh mobile cache

