import { gql } from 'lightning/uiGraphQLApi';

/**
 * Shared helper for the two reusable bricks (lscMobileInline_relatedList,
 * lscMobileInline_timeline).
 *
 * IMPORTANT: gql`...` must be called with a static, literal query per
 * call site. A tagged template's "strings" array is the same reference on
 * every evaluation of that exact source location, and gql caches the parsed
 * query by that identity — it assumes gql`...` is always literal text, never
 * runtime-built. Building query TEXT dynamically at one shared call site
 * (the earlier version of this file) meant every distinct query collapsed to
 * whichever one was built there first: reproduced live as "whichever
 * composable renders first works; the other silently shows empty," which
 * flips after a hard refresh depending on load order.
 *
 * The fix: one hand-written, literal gql`...` document per parent
 * object + relationship combination actually in use, registered below.
 * recordId and pageSize are the only things that vary per instance, so they
 * stay as GraphQL variables; field selection and sort order are baked into
 * each query's text, since GraphQL can't parameterize those.
 *
 * Add a new query here (and register it in QUERY_REGISTRY) whenever a brick
 * is composed against a new parent object / relationship. Each response is
 * normalized back into { records: [{ id, fields }] } — the shape
 * getRelatedListRecords used to return — so the rest of each brick's
 * rendering logic stays wire-adapter-agnostic.
 */

const ACCOUNT_VISITS_QUERY = gql`
    query AccountVisitsQuery($recordId: ID!, $pageSize: Int!) {
        uiapi {
            query {
                Account(where: { Id: { eq: $recordId } }) {
                    edges {
                        node {
                            Id
                            Visits(first: $pageSize, orderBy: { PlannedVisitStartTime: { order: DESC } }) {
                                edges {
                                    node {
                                        Id
                                        Name { value displayValue }
                                        Status { value displayValue }
                                        PlannedVisitStartTime { value displayValue }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`;

const ACCOUNT_CASES_QUERY = gql`
    query AccountCasesQuery($recordId: ID!, $pageSize: Int!) {
        uiapi {
            query {
                Account(where: { Id: { eq: $recordId } }) {
                    edges {
                        node {
                            Id
                            Cases(first: $pageSize, orderBy: { CreatedDate: { order: DESC } }) {
                                edges {
                                    node {
                                        Id
                                        CaseNumber { value displayValue }
                                        Subject { value displayValue }
                                        Status { value displayValue }
                                        Priority { value displayValue }
                                        CreatedDate { value displayValue }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`;

const QUERY_REGISTRY = {
    'Account.Visits': ACCOUNT_VISITS_QUERY,
    'Account.Cases': ACCOUNT_CASES_QUERY
};

/**
 * Looks up the static gql document for a parent object + relationship.
 * Throws if the combination hasn't been registered above — that's a config
 * error (a brick pointed at a relationship with no query yet), not a runtime
 * condition to silently swallow.
 */
export function getRelatedListQuery(parentObjectApiName, relatedListId) {
    const query = QUERY_REGISTRY[`${parentObjectApiName}.${relatedListId}`];
    if (!query) {
        throw new Error(
            `No static GraphQL query registered for ${parentObjectApiName}.${relatedListId}. ` +
                'Add one to lscMobileInlineGraphqlUtils.js.'
        );
    }
    return query;
}

/**
 * Normalizes a uiapi GraphQL response back into
 * { records: [{ id, fields: { ApiName: { value, displayValue } } }] } —
 * the exact shape getRelatedListRecords returns.
 */
export function extractRelatedListRecords(data, parentObjectApiName, relatedListId) {
    const parentEdges = data?.uiapi?.query?.[parentObjectApiName]?.edges ?? [];
    const parentNode = parentEdges[0]?.node;
    const childEdges = parentNode?.[relatedListId]?.edges ?? [];

    const records = childEdges.map((edge) => {
        const node = edge.node;
        const fields = {};
        Object.keys(node).forEach((key) => {
            if (key === 'Id') {
                return;
            }
            fields[key] = { value: node[key]?.value, displayValue: node[key]?.displayValue };
        });
        return { id: node.Id, fields };
    });

    return { records };
}
