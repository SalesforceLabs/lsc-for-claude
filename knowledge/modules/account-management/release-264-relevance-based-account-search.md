# Relevance-Based Account Search on the iPad - Winter '27 (264)

Platform: iPad (offline, standard Account Search).

## What's New

- Account Search now surfaces the **strongest matches first**, ranked by relevance rather than alphabetically.
- **Dynamic filters** switch between address-only matches, account-only matches and a consolidated view, so reps no longer drill into a result to see which field matched.
- Before Winter '27, Account Search returned a single alphabetical list with no indication of the matching field.

## Notes

- Applies to the offline standard Account Search on the Life Sciences Cloud mobile app for iOS (iPad only).
- Release note updated the week of Oct 5, 2026. Official help topics: "Relevance Based Account Search on the iPad" and "Relevance Based Account Search for iPad Users".
- Search Before Create / external (OneKey) search behavior is separate; see the `support-engineering-search-before-create-*` docs in this module.

## Admin Configuration (related, from Help)

The two Winter '27 articles ("Relevance Based Account Search on the iPad" / "...for iPad Users") could not be found in the Help index, so relevance ranking and dynamic-filter behavior above are from the release note only (unverified against Help). Existing standard-search admin settings that still apply:

- Admin Console > **Account Management** > **Account Search Preferences** (org and profile level; hierarchical settings).
- Sections: Search Outside Territory, country-based search / country filter, Advanced Search (business license-based searching, limit by user's available countries), Additional Search Preferences (map view in mobile app, auto-align affiliated accounts, default customer filter, record types available for filtering).
- Standard search fields are defined via field sets in the Admin Console (Help: "Configure Standard Search Field Sets in the Admin Console").

## Sources

- https://help.salesforce.com/s/articleView?id=ind.lsc_account_search_customize_account_search_preferences.htm&release=264.0.0&type=5 (search excerpt only)
- https://help.salesforce.com/s/articleView?id=ind.lsc_account_search_set_account_search.htm&release=264.0.0&type=5 (search excerpt only)
- Not found: "Relevance Based Account Search on the iPad", "Relevance Based Account Search for iPad Users".
