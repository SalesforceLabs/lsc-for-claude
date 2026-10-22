import { LightningElement, api, wire } from 'lwc';
import { graphql } from 'lightning/uiGraphQLApi';
import { getRelatedListQuery, extractRelatedListRecords } from 'c/lscMobileInlineGraphqlUtils';

/**
 * lscMobileInline_timeline
 *
 * A SECOND reusable, self-querying data brick — a sibling to
 * lscMobileInline_relatedList. Given the same style of configuration (parent
 * record + related list + fields), it queries the child records itself via
 * lightning/uiGraphQLApi (offline-capable, no Apex — getRelatedListRecords is
 * NOT resolved offline) and plots them along a horizontal timeline: one
 * status-colored dot per record on a shared axis, with a compact card above
 * each dot showing title, date, and status.
 *
 * Designed to sit ON TOP of the related list in a parent container: it fills
 * the width and scrolls horizontally, but is height-capped so a list fits
 * beneath it on an iPad.
 *
 * Public API (props down) — mirrors the related list, plus a date field:
 *   @api parentRecordId     - record whose children to plot
 *   @api parentObjectApiName - API name of the parent object (e.g. "Account")
 *   @api relatedListId      - child relationship name (e.g. "Visits") — must
 *                             have a matching static query registered in
 *                             lscMobileInlineGraphqlUtils.js; fields and sort
 *                             order live there, not as props, since GraphQL
 *                             can't parameterize field selections
 *   @api titleField         - field for each node's primary text
 *   @api dateField          - field used for the node's date label / ordering
 *   @api badgeField         - field driving the status color + badge text
 *   @api pageSize           - max nodes to fetch (default 50)
 *   @api iconName           - SLDS icon for the card header
 *   @api title              - card header title
 *
 * Events (up):
 *   nodeselect - fired when a node is tapped. detail = { recordId, record }
 *   dataloaded - fired when records resolve. detail = { records, count }
 */
export default class LscMobileInline_timeline extends LightningElement {
    @api parentRecordId;
    @api parentObjectApiName;
    @api relatedListId;
    @api titleField;
    @api dateField;
    @api badgeField;
    @api iconName = 'standard:events';
    @api title = 'Timeline';

    _pageSize = 50;

    @api
    get pageSize() {
        return this._pageSize;
    }
    set pageSize(val) {
        const num = Number(val);
        this._pageSize = num > 0 ? num : 50;
    }

    // The gql document + variables fed to @wire. query is a stable lookup
    // (see refreshQuery()); variables are rebuilt only when recordId/pageSize
    // actually change, so we don't re-fire the wire on every render.
    query;
    variables;
    _queryKey;
    _variablesKey;

    nodes = [];
    error;
    loaded = false;

    renderedCallback() {
        this.refreshQuery();
    }

    refreshQuery() {
        if (!this.parentObjectApiName || !this.relatedListId || !this.parentRecordId) {
            return;
        }

        const queryKey = `${this.parentObjectApiName}.${this.relatedListId}`;
        if (queryKey !== this._queryKey) {
            this._queryKey = queryKey;
            this.query = getRelatedListQuery(this.parentObjectApiName, this.relatedListId);
        }

        const variablesKey = `${this.parentRecordId}|${this._pageSize}`;
        if (variablesKey !== this._variablesKey) {
            this._variablesKey = variablesKey;
            this.variables = { recordId: this.parentRecordId, pageSize: this._pageSize };
        }
    }

    // Same reusable query as the related list — driven entirely by props.
    // graphql (unlike getRelatedListRecords) can return partial data
    // alongside errors, so the callback must use "errors" (plural).
    @wire(graphql, { query: '$query', variables: '$variables' })
    wiredGraphql({ data, errors }) {
        if (data) {
            const { records } = extractRelatedListRecords(data, this.parentObjectApiName, this.relatedListId);
            this.nodes = this.buildNodes(records);
            this.error = undefined;
            this.loaded = true;
            this.dispatchEvent(
                new CustomEvent('dataloaded', {
                    detail: { records, count: records.length }
                })
            );
        } else if (errors) {
            this.error = this.reduceErrors(errors);
            this.nodes = [];
            this.loaded = true;
        }
    }

    // Shape each normalized record into a timeline node view model.
    buildNodes(records) {
        return records.map((rec) => {
            const status = this.readField(rec, this.badgeField);
            return {
                id: rec.id,
                title: this.readField(rec, this.titleField),
                dateLabel: this.readDate(rec, this.dateField),
                status,
                dotClass: `tl-dot tl-dot_${this.severity(status)}`,
                record: rec
            };
        });
    }

    // Map a status string to a severity used for the dot color.
    severity(status) {
        const s = (status || '').toLowerCase();
        if (s.includes('escalat') || s.includes('overdue') || s.includes('cancel')) {
            return 'critical';
        }
        if (s.includes('new') || s.includes('planned') || s.includes('progress') || s.includes('open')) {
            return 'warning';
        }
        if (s.includes('complete') || s.includes('closed') || s.includes('submitted')) {
            return 'success';
        }
        return 'neutral';
    }

    // Normalized records carry values at record.fields.<ApiName>.value.
    readField(rec, qualifiedField) {
        if (!qualifiedField) {
            return '';
        }
        const apiName = qualifiedField.includes('.')
            ? qualifiedField.split('.').pop()
            : qualifiedField;
        const field = rec.fields?.[apiName];
        return field?.displayValue ?? field?.value ?? '';
    }

    // Prefer the UI-API displayValue (already locale-formatted) for dates;
    // fall back to a short date derived from the raw value.
    readDate(rec, qualifiedField) {
        if (!qualifiedField) {
            return '';
        }
        const apiName = qualifiedField.includes('.')
            ? qualifiedField.split('.').pop()
            : qualifiedField;
        const field = rec.fields?.[apiName];
        if (!field) {
            return '';
        }
        if (field.displayValue) {
            return field.displayValue;
        }
        const raw = field.value;
        if (!raw) {
            return '';
        }
        // raw is an ISO date/datetime; take the date portion for compactness.
        return typeof raw === 'string' ? raw.split('T')[0] : `${raw}`;
    }

    get hasNodes() {
        return this.nodes.length > 0;
    }

    get isEmpty() {
        return this.loaded && !this.error && this.nodes.length === 0;
    }

    get cardTitle() {
        return this.loaded && !this.error ? `${this.title} (${this.nodes.length})` : this.title;
    }

    handleNodeSelect(event) {
        const recordId = event.currentTarget.dataset.id;
        const node = this.nodes.find((n) => n.id === recordId);
        this.dispatchEvent(
            new CustomEvent('nodeselect', {
                detail: { recordId, record: node?.record }
            })
        );
    }

    reduceErrors(errors) {
        return errors?.[0]?.message || 'Unable to load timeline.';
    }
}
