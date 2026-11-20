---
name: lsc-integration-patterns
description: Guides integration patterns (MDM, ERP, IQVIA, email providers, video platforms). Use when the user asks how to integrate LSC with other systems.
---

For integration pattern details, call `search_lsc_knowledge({ query: "integration patterns" })` to get sourced documentation.


|----------|
| MuleSoft | Complex enterprise integrations, API-led connectivity |
| Informatica | MDM integrations, data quality |
| Salesforce Connect | Real-time external data access (no data copy) |
| Platform Events | Real-time event-driven integration |
| Bulk API 2.0 | High-volume batch data loading |
| REST/SOAP API | Real-time record operations |

## Best Practices

1. **Use External IDs:** Always map external system IDs to Salesforce external ID fields for upsert
2. **Respect API limits:** Monitor API call usage, especially during bulk operations
3. **Error handling:** Implement retry logic and dead letter queues for failed records
4. **Data quality:** Validate data before loading — Life Sciences Cloud (LSC) has strict object relationships
5. **Incremental sync:** Use timestamp-based delta queries instead of full loads
6. **Test in sandbox:** Always test integrations in a sandbox before production

