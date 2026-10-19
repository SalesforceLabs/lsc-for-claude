import { LightningElement, api } from 'lwc';

/**
 * lscMobileInline_hcpEngagement
 *
 * Mobile inline widget on an HCP (Account) record showing the rep's recent
 * Visits. It does NOT query anything itself — it COMPOSES the reusable,
 * self-querying lscMobileInline_relatedList, configuring it (props down) to
 * load Visits, and reacts to the child's events (events up).
 */
export default class LscMobileInline_hcpEngagement extends LightningElement {
    @api recordId;

    // Editable in Lightning App Builder via the js-meta.xml design property.
    @api mobileHeight;

    activityCount = 0;
    selected;

    handleDataLoaded(event) {
        this.activityCount = event.detail.count;
    }

    handleRecordSelect(event) {
        this.selected = event.detail.recordId;
    }

    get summaryText() {
        return `${this.activityCount} recent visit(s)`;
    }
}
