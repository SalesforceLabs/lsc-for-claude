import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { gql, graphql, refreshGraphQL } from 'lightning/uiGraphQLApi';

/**
 * Deeplink Account List (LSC Mobile).
 *
 * Lists Accounts using the GraphQL wire adapter (lightning/uiGraphQLApi),
 * the same technique the org's CarouselLwc "Test 2" diagnostic proves works
 * offline in the LSC mobile runtime: a plain, unfiltered Account query with
 * orderBy + first. (Filtering by a null recordId — or using getLookupRecords,
 * which doesn't resolve here — is what silently returned 0 rows before.)
 *
 * Tapping a row deeplinks the app to that Account record via the lsc:// scheme:
 *   lsc://deeplink/lightning/r/Account/{id}/view
 */

export default class HcpAnalyzer extends NavigationMixin(LightningElement) {
    @api mobileHeight = 700;

    accounts = [];
    error;
    lastDeeplink;

    // NOTE: the gql tag does NOT support ${} interpolation — a substituted
    // value gets stringified into the query as [object Object] and breaks
    // normalization ("Unknown Field: [object Object]"). Keep the query static,
    // exactly like the CarouselLwc "Test 2" diagnostic that works offline.
    @wire(graphql, {
        query: gql`
            query AccountList {
                uiapi {
                    query {
                        Account(orderBy: { Name: { order: ASC } }, first: 20) {
                            edges {
                                node {
                                    Id
                                    Name {
                                        value
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `
    })
    wiredAccounts(result) {
        this._wireResult = result;
        const { data, errors } = result;
        if (errors) {
            this.error = this._fmtError(errors);
            this.accounts = [];
            return;
        }
        const edges = data?.uiapi?.query?.Account?.edges || [];
        this.accounts = edges.map((e, i) => {
            const name = e.node.Name?.value || '(no name)';
            return {
                id: e.node.Id,
                name,
                initial: name.charAt(0).toUpperCase(),
                alt: i % 2 === 1
            };
        });
        this.error = undefined;
        // Best-effort offline cache priming.
        refreshGraphQL(result).catch(() => {});
    }

    get rootStyle() {
        return `min-height:${this.mobileHeight}px`;
    }

    get count() {
        return this.accounts.length;
    }

    get hasAccounts() {
        return this.accounts.length > 0;
    }

    get isLoading() {
        return !this.error && this.accounts.length === 0;
    }

    handleOpen(event) {
        const id = event.currentTarget.dataset.id;
        if (!id) return;

        const deeplink = `lsc://deeplink/lightning/r/Account/${id}/view`;
        this.lastDeeplink = deeplink;

        // Always attempt the native deeplink first. In the AFLS mobile app the
        // web view intercepts the lsc:// scheme and navigates natively. In a
        // desktop browser lsc:// isn't registered and Lightning Web Security's
        // SecureLocation.href throws synchronously ("supports http:, https:,
        // mailto: schemes and relative urls") — we catch that and fall back to
        // standard Lightning navigation for the same record. No environment
        // detection needed: the throw itself tells us the scheme is unsupported.
        try {
            window.location.href = deeplink;
        } catch (e) {
            this.navigateToRecord(id);
        }
    }

    navigateToRecord(recordId) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId,
                objectApiName: 'Account',
                actionName: 'view'
            }
        });
    }

    _fmtError(e) {
        if (!e) return null;
        if (Array.isArray(e)) {
            const messages = e.flatMap((g) => {
                if (Array.isArray(g.error)) return g.error.map((x) => x.message);
                if (g.message) return [g.message];
                return [];
            });
            if (messages.length) return messages.join(', ');
        }
        return e.body?.message || e.message || JSON.stringify(e);
    }
}
