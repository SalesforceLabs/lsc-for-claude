# Enablement Coaching Assessment Definition - Winter '27 (264)

Persona: Olivia (Business Admin). Builds on Discovery Framework (see Discovery Framework Omni documentation for details). Prepare the assessments, dimensions, questions, scores, descriptions and dates beforehand.

## Steps
1. **Create questions** (Discovery Framework question list): Data Type = **Score** (other DF data types not supported for coaching in this release); Category is mandatory; define question score. Creating a question creates a question version. Activate when ready; questions can be deactivated and versioned.
2. **Select Questions** from the questions list view, then pick the needed questions.
3. **Discovery Framework Usage Type** must be **Life Sciences Customer Engagement**.
4. **Create form - Details**:
   - Type must equal the value defined in Admin Console -> Enablement Coaching -> Org Settings (Mapping Settings).
   - Add Language.
   - Subtype is the picklist defined earlier (Omni Process Sub-Type); helps version uniqueness per customer business rules.
   - Only one active OmniScript per type, subtype and language; each active OmniScript needs a unique subtype.
5. Drag and drop questions; add Steps to organize them if needed.
6. Build OmniScript, preview the form (edit to change questions/steps). Do NOT add additional Omni elements; not supported/tested in the coaching form.
7. **Activate OmniScript**; confirm it is active in the Omni Processes list view.
8. **Create the Assessment Definition**: it must be between Effective From and Effective To to be active. Customers can use any field on AssessmentDefinition; no implication on sharing or functionality.
9. **Share** the active Assessment Definition with the needed coaches (Business Admin). No need to share with employees: employee sharing happens automatically when the coach makes the first status move (to Self-Evaluation when ON, otherwise Evaluation in Progress).

## Notes
- Once a coaching event is saved, its linked Assessment Definition becomes immutable.
- Scoring details: see [admin setup](./release-264-coaching-admin-setup.md).

## Verified Against Official Help
- Help: admins author question banks, configure scoring, and assign weights to competencies using Discovery Framework and OmniStudio; templates support scoring questions. Requires Life Sciences Commercial Admin permission set + Assessment Platform User permission. Available starting September 2026.
- Not in Help (deck only): Usage Type, Type/Subtype/Language uniqueness rules, immutability, sharing steps.

## Sources
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching_build_standardized_evaluations_with_discovery_framework.htm&release=264.0.0&type=5
