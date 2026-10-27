-- #7/#14 travel-class upgrade split — the entitlement-class fare (second quote) and how the delta
-- is funded (NTU → M6 cost centre, or SELF → traveller pays the TMC directly).
ALTER TABLE "EstimatedExpense" ADD COLUMN "entitlementFareSgd" REAL;
ALTER TABLE "EstimatedExpense" ADD COLUMN "upgradeFunding" TEXT;
