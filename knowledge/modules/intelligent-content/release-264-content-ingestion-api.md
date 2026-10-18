# Content Ingestion API - Winter '27 (264)

Platform: Integration (REST API).

## What It Does

A source-agnostic REST API that ingests **remediated content** from external digital asset management (DAM) systems into Life Sciences Cloud:

- Prepared **ZIP packages** (CLM presentations)
- **PDFs**
- Preconfigured **email templates**

It also automates **territory distribution and activation** of the loaded content.

## Requirements

- Life Sciences Cloud license, Customer Engagement add-on license and managed package.
- A **MuleSoft Anypoint Platform** subscription.
- Integration users need **custom permission sets** based on the Life Sciences Commercial and Salesforce API Integration licenses, plus access to the mapped Life Sciences Cloud objects and fields.

## What Could Not Be Verified

Searches of Help, the Life Sciences developer guide and MuleSoft docs returned only the Winter '27 release note. No endpoint paths, request/response payloads, ZIP package structure, authentication flow, named permission sets or MuleSoft connector/template details are published (as of this search). Do not document them until an official source exists. Generic Data 360 "Ingestion API" articles that surfaced are a different API and do not apply.

Release note availability: Life Sciences Cloud license + Customer Engagement add-on license, with the Customer Engagement managed package installed. Integration users need custom permission sets based on the Life Sciences Commercial and Salesforce API Integration licenses.

## Related

- Manual/plugin upload path: the `upload_presentation`, `distribute_presentation` and `assign_presentation_content` MCP tools.
- Integration patterns: `lsc-integration-patterns` skill.

## Sources

- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_customer_engagement_automate_content_ingestion.htm&release=264.0.0&type=5
