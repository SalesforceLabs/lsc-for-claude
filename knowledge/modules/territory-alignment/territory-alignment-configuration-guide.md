# Territory Alignment — Configuration Guide

## Overview

Territory Alignment in Life Sciences Cloud (LSC) extends Salesforce Enterprise Territory Management (ETM) to support commercial life sciences requirements. It manages the assignment of healthcare accounts (HCPs/HCOs) to sales territories and creates ProviderAcctTerritoryInfo records that store territory-specific information about accounts.

## Key Objects

| Object | Purpose |
|--------|---------|
| `Territory2Model` | Top-level container for the territory hierarchy |
| `Territory2` | Individual territories in the hierarchy |
| `Territory2Type` | Types of territories (Region, District, etc.) |
| `UserTerritory2Association` | Links users (reps) to territories |
| `ObjectTerritory2Association` | Explicit account-to-territory assignments |
| `TerrGeoAssignmentRule` | Zip/Brick code-based auto-alignment rules |
| `TerrProvAffilAssignRule` | Affiliation-based auto-alignment rules |
| `ProviderAcctTerritoryInfo` | Territory-specific account info (ratings, last visit, etc.) |

## Prerequisites

Before configuring LSC territory alignment, standard Salesforce territory setup must be complete:

1. **Enable Enterprise Territory Management** in Setup
2. **Create Territory Types** (e.g., Region, District, Territory)
3. **Create a Territory Model** and activate it
4. **Build the territory hierarchy** (regions → districts → territories)
5. **Assign users to territories** via UserTerritory2Association records

## Alignment Methods

### 1. Explicit Assignments

Direct account-to-territory mapping via `ObjectTerritory2Association` records.

**Setup:**
- Create or load ObjectTerritory2Association records with:
  - `ObjectId`: The Account ID
  - `Territory2Id`: The Territory ID
  - `AssociationCause`: "Territory2Manual" for manual assignments
- Run the "Align Account to Territory" batch job

**Use case:** When account-territory assignments come from an external system (e.g., Veeva CRM migration, Excel planning).

### 2. Geo Assignment Rules (Zip/Brick)

Automatic alignment based on geographic data in ContactPointAddress records.

**Setup:**
1. Create `TerrGeoAssignmentRule` records:
   - **Zip-to-Territory:** Set `UsageType` = "ZipToTerritory", specify zip codes
   - **Brick-to-Territory:** Set `UsageType` = "BrickToTerritory", specify brick codes (common in Europe)
2. Ensure accounts have ContactPointAddress records with zip/brick values
3. Run the "Align Zip to Territory" or "Align Brick to Territory" batch job

**Use case:** Geographic-based territory designs where accounts are assigned based on their physical location.

### 3. Affiliation Alignment Rules

Automatic alignment of affiliated accounts based on ProviderAffiliation relationships.

**Setup:**
1. In Object Manager > TerrProvAffilAssignRule, ensure affiliation role picklist values exist (Attending, Admitting, Consulting, Staff, etc.)
2. Ensure matching roles exist on the ProviderAffiliation object
3. Create rules in Admin Console > Territories > Affiliation Rules:
   - Select the territory hierarchy node
   - Choose whether to apply to child territories
   - Select account types (HealthcareProvider, etc.)
   - Select affiliation roles
   - Optionally filter by specialty
4. The affiliation alignment job runs **automatically** after account/zip/brick alignment jobs complete

**Use case:** "If Dr. Smith (HCP) has an affiliation to Mercy Hospital (HCO), and Mercy Hospital is in Territory A, then align Dr. Smith to Territory A."

## Batch Jobs

Batch jobs are run from the **Territory Management Jobs** tab in the LSC app.

| Job | Processes | Trigger |
|-----|-----------|---------|
| Align Account to Territory | ObjectTerritory2Association records | Manual or scheduled |
| Align Zip to Territory | TerrGeoAssignmentRule (zip type) | Manual or scheduled |
| Align Brick to Territory | TerrGeoAssignmentRule (brick type) | Manual or scheduled |
| Affiliation Alignment | TerrProvAffilAssignRule | Auto (after above jobs) |

### Running Jobs

- **Immediate:** Select a territory node (and subordinates) or "All Territories", optionally set batch size, click Run
- **Scheduled:** Set frequency (Hourly, Daily, Weekly) and start time — recommended: schedule during off-hours (e.g., 2 AM)

### What Jobs Do

1. Create `ProviderAcctTerritoryInfo` records for aligned accounts
2. Set up data sharing (account visibility for reps in the territory)
3. Remove orphaned assignments for inactive accounts
4. Remove assignments for manually unaligned accounts

## ProviderAcctTerritoryInfo

This is the central record that links an account to a territory with LSC-specific data:

| Field | Description |
|-------|-------------|
| `AccountId` | The healthcare account |
| `Territory2Id` | The assigned territory |
| `Rating` | Territory-specific account rating |
| `LastVisitDate` | Date of most recent visit |
| `NextVisitDate` | Next planned visit date |
| `VisitCount` | Number of visits in current period |

These records are **created by batch jobs**, not manually. They drive:
- Account lists on the mobile app
- Visit planning and activity goals
- Account ratings and prioritization

## Admin Console Settings

In Admin Console > Territory Settings:
- Enable/disable territory alignment features
- Configure default alignment behavior
- Set batch job defaults

## Trigger Handlers

| Handler | Purpose |
|---------|---------|
| `TerritoryAlignmentTriggerHandler` | Processes territory alignment events |
| `ProviderAcctTerritoryInfoTriggerHandler` | Handles PATI record changes |

## Mobile Considerations

- ProviderAcctTerritoryInfo must be included in DB Schema for mobile sync
- Territory2 and UserTerritory2Association are also needed for mobile
- After running alignment jobs, regenerate the mobile metadata cache

## Common Issues

1. **Accounts not appearing on mobile:** Check if ProviderAcctTerritoryInfo records exist for the account/territory combination. Run alignment batch jobs if missing.
2. **Alignment job fails:** Check for duplicate ObjectTerritory2Association records or invalid territory IDs.
3. **Affiliation rules not working:** Ensure affiliation role picklist values match between TerrProvAffilAssignRule and ProviderAffiliation objects.
4. **Stale territory data:** Schedule alignment jobs to run daily during off-hours.
5. **Missing PATI records after data load:** Run all three alignment jobs (Account, Zip, Brick) after loading ObjectTerritory2Association or TerrGeoAssignmentRule records.
