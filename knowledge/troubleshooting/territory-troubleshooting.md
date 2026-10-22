# Territory Alignment — Troubleshooting

## "Accounts not showing for rep on mobile"
**Cause:** ProviderAcctTerritoryInfo records missing for the rep's territory
**Fix:** Run "Align Account to Territory" batch job from Territory Management Jobs tab. Verify ObjectTerritory2Association records exist.

## "Alignment batch job fails"
**Cause:** Duplicate ObjectTerritory2Association records or invalid territory IDs
**Fix:** Query for duplicates: `SELECT ObjectId, Territory2Id, COUNT(Id) FROM ObjectTerritory2Association GROUP BY ObjectId, Territory2Id HAVING COUNT(Id) > 1`. Remove duplicates.

## "Affiliation rules not applying"
**Cause:** Affiliation role picklist values don't match between TerrProvAffilAssignRule and ProviderAffiliation
**Fix:** In Setup > Object Manager, ensure affiliation role values exist on both objects with identical names.

## "Territory model not active"
**Cause:** Territory model in Draft or Planning state
**Fix:** In Setup > Territory Models, activate the model. Only one model can be active at a time.

## "Rep sees wrong accounts after territory change"
**Cause:** Alignment batch jobs haven't run after territory reassignment
**Fix:** Run all three alignment jobs (Account, Zip, Brick) for the affected territories. Schedule jobs to run daily.

## "ProviderAcctTerritoryInfo records are stale"
**Cause:** Alignment batch jobs not scheduled or last run was too long ago
**Fix:** Schedule alignment jobs to run daily during off-hours (e.g., 2 AM). Check Territory Management Jobs tab for schedule status.
