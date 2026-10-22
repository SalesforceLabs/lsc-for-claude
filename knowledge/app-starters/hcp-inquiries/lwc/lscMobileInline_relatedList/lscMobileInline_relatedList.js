import { LightningElement, api, wire } from 'lwc';
import { graphql } from 'lightning/uiGraphQLApi';
import { getRelatedListQuery, extractRelatedListRecords } from 'c/lscMobileInlineGraphqlUtils';

/**
 * lscMobileInline_relatedList
 *
 * A SELF-CONTAINED, reusable data brick. Given a parent record and a related
 * list, it queries the child records itself via lightning/uiGraphQLApi (the
 * offline-capable adapter — getRelatedListRecords is NOT resolved offline)
 * and renders them as a compact, tappable mobile list. It knows nothing
 * about HCPs, Tasks, or Cases — the PARENT configures WHAT to query and HOW
 * to label each row entirely through props.
 *
 * This is the composable unit: the same component queries different objects
 * in different parents. Props down, events up, plus a <slot> for injected
 * markup.
 *
 * Public API (props down):
 *   @api parentRecordId     - record whose children to load (e.g. the HCP Account)
 *   @api parentObjectApiName - API name of the parent object (e.g. "Account")
 *   @api relatedListId      - child relationship name (e.g. "Visits", "Cases") —
 *                             must have a matching static query registered in
 *                             lscMobileInlineGraphqlUtils.js; fields and sort
 *                             order live there, not as props, since GraphQL
 *                             can't parameterize field selections
 *   @api titleField         - field whose value is the row's primary text
 *   @api subtitleField      - optional field shown as secondary text
 *   @api badgeField         - optional field shown as a right-aligned badge
 *   @api pageSize           - max rows to fetch (default 50)
 *   @api iconName           - SLDS icon for the card header
 *   @api title              - card header title
 *
 * Events (up):
 *   recordselect - fired on row tap. detail = { recordId, record }
 *   dataloaded   - fired when records resolve. detail = { records, count }
 *
 * Slot:
 *   default <slot> renders above the list, so a parent can inject a summary,
 *   an alert banner, filters, etc.
 */
export default class LscMobileInline_relatedList extends LightningElement {
    @api parentRecordId;
    @api parentObjectApiName;
    @api relatedListId;
    @api titleField;
    @api subtitleField;
    @api badgeField;
    @api iconName = 'standard:record';
    @api title = 'Related Records';

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

    rows = [];
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

    // The reusable query. query/variables are driven entirely by public
    // props (via refreshQuery), so each parent gets a completely different
    // result from the same component. graphql (unlike getRelatedListRecords)
    // can return partial data alongside errors, so the callback must use
    // "errors" (plural) rather than "error".
    @wire(graphql, { query: '$query', variables: '$variables' })
    wiredGraphql({ data, errors }) {
        if (data) {
            const { records } = extractRelatedListRecords(data, this.parentObjectApiName, this.relatedListId);
            this.rows = this.shapeRows(records);
            this.error = undefined;
            this.loaded = true;
            this.dispatchEvent(
                new CustomEvent('dataloaded', {
                    detail: { records, count: records.length }
                })
            );
        } else if (errors) {
            this.error = this.reduceErrors(errors);
            this.rows = [];
            this.loaded = true;
        }
    }

    // Flatten each normalized record into a simple view model the template renders.
    shapeRows(records) {
        return records.map((rec) => ({
            id: rec.id,
            title: this.readField(rec, this.titleField),
            subtitle: this.subtitleField ? this.readField(rec, this.subtitleField) : null,
            badge: this.badgeField ? this.readField(rec, this.badgeField) : null,
            record: rec
        }));
    }

    // Normalized records carry values at record.fields.<ApiName>.value.
    // titleField may be qualified ("Task.Subject") — strip the object prefix.
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

    get hasRows() {
        return this.rows.length > 0;
    }

    get isEmpty() {
        return this.loaded && !this.error && this.rows.length === 0;
    }

    get cardTitle() {
        return this.loaded && !this.error ? `${this.title} (${this.rows.length})` : this.title;
    }

    handleRowSelect(event) {
        const recordId = event.currentTarget.dataset.id;
        const row = this.rows.find((r) => r.id === recordId);
        this.dispatchEvent(
            new CustomEvent('recordselect', {
                detail: { recordId, record: row?.record }
            })
        );
    }

    reduceErrors(errors) {
        return errors?.[0]?.message || 'Unable to load related records.';
    }
}
