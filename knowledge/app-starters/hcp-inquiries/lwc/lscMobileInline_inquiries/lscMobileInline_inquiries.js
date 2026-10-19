import { LightningElement, api } from 'lwc';

/**
 * lscMobileInline_inquiries
 *
 * Mobile inline widget on an HCP (Account) record showing the HCP's medical
 * inquiries (Cases). A DIFFERENT widget from hcpEngagement, but it COMPOSES the
 * SAME two self-querying bricks — a timeline stacked on a related list — just
 * configured for Cases, with its own slotted alert banner and event handling.
 */
export default class LscMobileInline_inquiries extends LightningElement {
    @api recordId;

    // Editable in Lightning App Builder via the js-meta.xml design property.
    @api mobileHeight;

    inquiryCount = 0;
    escalatedCount = 0;
    selectedCaseId;

    // The child hands back the raw records; this parent derives its own meaning.
    handleDataLoaded(event) {
        const records = event.detail.records || [];
        this.inquiryCount = records.length;
        this.escalatedCount = records.filter(
            (r) => r.fields?.Status?.value === 'Escalated'
        ).length;
    }

    handleRecordSelect(event) {
        this.selectedCaseId = event.detail.recordId;
    }

    get hasEscalations() {
        return this.escalatedCount > 0;
    }

    get alertText() {
        return `${this.escalatedCount} escalated inquiry(ies) — follow up before your next visit.`;
    }
}
