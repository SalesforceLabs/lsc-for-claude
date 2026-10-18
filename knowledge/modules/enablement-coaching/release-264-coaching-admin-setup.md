# Enablement Coaching Admin Setup - Winter '27 (264)

Personas: James (System Admin) and Olivia (Business Admin). Setup order: Grant Access -> Configure Interface -> Map the Assessment -> Workflow and Offline -> Roles and Calendar -> Build Assessment -> Activate and Share. For building the assessment itself see [assessment definition](./release-264-coaching-assessment-definition.md).

## Admin Setup (James)

### Grant Access (Permissions)
- Out of the box, Admin: Life Sciences Commercial Admin, Life Sciences Core.
- Out of the box, Employee/Coachee: Life Science Field Sales Representative, Life Sciences Core.
- Coach: customer-cloned. Use Life Sciences Core plus a clone of Life Science Field Sales Representative; give CRUD on Enablement Coaching, Enablement Coaching Attendee and Enablement Coaching Session, and add the user permission "Manage Enablement Coaching".
- Rationale: there is no shipped Coach permission set because coaches (selected managers or champions) vary by org; customers define coaches via permission assignment.
- Enable Discovery Framework in General Settings so coaching content can be built.

### Configure Interface
- Set up the Enablement Coaching tab, record page and page layouts.
- Add the mobile selection component to the page: `lscMobileInline_offlineAssessmentSelectionWrapper`.
- Recommended: add the Previous Enablement Coaching field to the Enablement Coaching compact layout for easy navigation; make the Previous field Read Only on the page.

### Map the Assessment (prerequisites for Admin Console Org Settings)
Setup -> Object Manager -> Fields & Relationships -> Picklist Values:
- Omni Process **Type**
- Omni Process **Sub-Type** (if needed)
- Enablement Coaching Attendee **Attendee Role**

### Org Level Settings
Admin Console -> Enablement Coaching -> Mapping Settings: map the org values for each role (select); OmniProcess type is text. Values are customer defined and support translation. The form Type must equal the Type defined here.

### Generic Workflow
Admin Console -> Workflow Configuration (Workflows for Life Sciences):
- Update Record Actions: Move to Self Evaluation; Move to Evaluation In Progress; Finish.
- Open Component Actions: Finalize Evaluation = `industries_ls_commercial:FinalizeEvaluationModal`; Acknowledge = `industries_ls_commercial:acknowledgeEvaluationModal`.
- Path: Status is the controlling field; follow the documented steps in the PDF (not in the deck).

### Mobile Metadata Cache
Admin Console -> Mobile -> Object Metadata Cache Configuration. Confirm these exist/are active (likely already for other features), add if not: User, User Additional Info, LifeSciStage (7 entities; likely present if Generic Workflow is used elsewhere).

Entities to add:
- EnablementCoaching: EnablementCoaching, EnablementCoachingAttendee, EnablementCoachingSession
- Assessment: Assessment, AssessmentDefinition, AssessmentQuestion, AssessmentQuestionVersion, AssessmentQstnVerChoice2, AssessmentQuestionResponse, AssessmentStagedData
- OmniProcess: OmniProcess, OmniProcessElement, OmniProcessAsmtQuestionVer, OmniScriptSavedSession
- Attachment (Attachment Support: BACKGROUND)

Three configuration entities ship out of the box: `DbSchema_EnablementCoachingSettings`, `DbSchema_EnablementCoachingOrgLevelSettings`, `DbSchema_EnablementCoachingUserBeingCoachedSettings`.
Then Create Object Metadata Cache Configuration and Generate Metadata Cache.

## Business Admin Setup (Olivia)

### Coach User Profile Settings (mandatory)
Admin Console -> Enablement Coaching -> Coach User Profile Settings. Mandatory for a coach to see and select coachees in the evaluation form. Applies to the profile of users acting as coach (example: District Manager); list the profiles they may select users from (example: EC Employee and Field Sales Representative). Further control via hierarchy settings and record visibility/access.

### Coachee Settings (employee centric)
Admin Console -> Enablement Coaching -> Coachee Settings. Governed by the employee as data subject; the form and workflow adapt only after the employee is added. A coach coaching different populations (countries, personas) gets different form variations per employee.
- **Coachee Engagement**: Enable Self-Evaluation ON/OFF; Enable Acknowledgement ON/OFF (drive self-evaluation stage and feedback review/acknowledged statuses regardless of coach).
- **Evaluation Score Visibility**: Show Total Score ON/OFF (follows the coach assessment); Show Previous ON/OFF (matches last completed event, same assessment definition, same user, in the past, regardless of previous coach, at the coach's first status move).
- **Rules and Validations (optional)**:
  - Hierarchy Validation, up to 5 levels: traverses the employee's User manager chain. Must be disabled for peer-coaching use cases.
  - Prevent Overlap: event cannot progress if the employee is part of a concomitant coaching event (assumes coach visibility to the employee's events).
  - Execution order (fast to slow): 1) Profile to Profiles validation (one setting), 2) Overlap validation (queries accessible Enablement Coaching records with date-range filter), 3) Hierarchy validation (manager chain traversal).
- Example: a DACH district manager can see a different form and stage evolution for Germany works-council users than for CH users.

### Scoring
- ChoiceScore is sourced from `AssessmentQstnVerChoice2.ChoiceScore`; Weight from `OmniScriptAssessmentQuestionVersion.Weight` (planned for 264 from Common Component).
- Only answered questions contribute; unanswered contribute 0.
- Output is a raw Double, not normalized. Convention for 0-100: configure weights so Sum(ChoiceScore x Weight) = 100; not enforced in this release.
- Total Score shows in view mode only, and only after the assessment is submitted (not saved/saved for later).

### Calendar
- Admin Console -> Planner -> Planner Settings: prerequisites, configure calendar parameters, enable Coaching Event, optionally override the OOB Enablement Coaching event indicator color. Cancelled coaching events are excluded from calendar display (not configurable in this release).
- Admin Console -> Planner -> Calendar Events: add a new entry for Enablement Coaching. TranslationLabel must be kept aligned with the EnablementCoaching object label to avoid a title mismatch (required).
See [calendar-tot-routine-myteam](../calendar-tot-routine-myteam/_index.md).

## Limitations / Gotchas
- Do not add extra Omni elements to the coaching form; they are untested and unsupported.
- Only Discovery Framework Data Type = Score is supported for Enablement Coaching in this release.
- Scoring is not normalized or enforced to 100.

## Verified Against Official Help
- Admins need the **Life Sciences Commercial Admin** permission set **and Assessment Platform User permission** to create and manage assessment templates (Help; the Assessment Platform User requirement is not in the deck section above).
- Calendar: in the Admin Console, admins configure calendar event metadata to map Enablement Coaching sessions to calendar views; coaches create sessions from the calendar grid or the Enablement Coaching tab and Salesforce automatically creates the associated calendar events.
- Previous scores: when a coach creates a session using a template used before, previous scores populate automatically and show in the **Evaluation** tab; the **Show Previous Evaluation Score** toggle switches the comparison on/off.
- Related Discovery Framework permission sets (general DF Help): OmniStudio Admin for admins who create/edit DF OmniScript assessments; OmniStudio User for users who run them.
- Not found in Help: Coach permission details, Mapping/Coachee/Coach User Profile settings, workflow action names, metadata cache entity list. These remain deck-sourced and unverified.

## Sources
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching_build_standardized_evaluations_with_discovery_framework.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching_schedule_and_track_from_calendar.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lsc_enablement_coaching_view_historical_evaluation_scores.htm&release=264.0.0&type=5
- https://help.salesforce.com/s/articleView?id=ind.discovery_framework_editions_permissions.htm&release=264.0.0&type=5 (search excerpt)
