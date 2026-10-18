# Data Cloud Singularity and TabNext Metrics

## Documentation Files

- [data-cloud-singularity-and-tableau-next-metrics-demo](./data-cloud-singularity-and-tableau-next-metrics-demo.md)
- [next-best-customer-predictive-model-demo](./next-best-customer-predictive-model-demo.md)

## Winter '27 (Release 264) Enhancements

**Tableau Next components on Lightning pages:** Metric, Visualization and Dashboard components can be dragged onto Lightning **record pages and home pages** in Lightning App Builder (previously only via the dedicated followed-metrics tab) and display in the Life Sciences Cloud mobile app.

**Prerequisites**
- Life Sciences Commercial Admin permission set (to configure Lightning pages in App Builder); Tableau Next add-on license.
- Complete "Embed Tableau Next in the Life Sciences Cloud Mobile App" first, and create the semantic model, metrics, visualizations and dashboards in Data 360 / Tableau Next (they populate the property-panel pickers).
- Optional dedicated metrics tab: Admin Console > **Mobile** > **UI Settings** > New; Label, Name, Mobile UI Type = **Tab**, Tab Name (and optional subheading), profiles, **Is Active**. For multi-language, create a custom label (Category `tabs`, all lowercase) and translations.

**Setup (all three components)**: Setup > Lightning App Builder > open/create a record or home page > Components panel, Standard section > drag the component > configure > **Save and activate**.

| Component | Required properties | Other properties |
|---|---|---|
| Tableau Next Metric | **Semantic Model**, **Metric** | Show Applied Filters, Show Period Over Period Change, Show Insight Summary, Show Chart; Set Metric Filters (Add Filter) |
| Tableau Next Visualization | **Visualization**, **Height** (pixels) | Set Visualization Filters |
| Tableau Next Dashboard | **Dashboard**, **Height** (pixels) | Hide Dashboard Header; Set Dashboard Filters |

All three also have **Set Component Visibility** rules.

**Mobile behavior**
- Metric: tap a data point for detailed values.
- Visualization: tap a bar for detailed values; **no filter UI on mobile** (only the Dashboard shows filters).
- Dashboard: tap dropdown menus to adjust the view; the "Open Dashboard" property is not used in the mobile app.
- If a field user lacks access to the component, it is hidden on mobile.

**Limits and troubleshooting**
- If a component doesn't appear for some users, check the visibility criteria are supported; some criteria (e.g. profiles) may not work. If rules are right, suspect network connectivity or server issues.
- Related Tableau Next help describes filter value types (Record Value or Static Value on record pages) for embedded metrics; not confirmed for the Life Sciences-specific article.

Sources:
- https://help.salesforce.com/s/articleView?id=ind.lsc_tableau_next_embed_metric_lightning_page.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_tableau_next_embed_visualization_lightning_page.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_tableau_next_embed_dashboard_lightning_page.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.lsc_tableau_next_mobile_app_embed.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=analytics.tua_embed_metric.htm&release=264.0.0&type=5
