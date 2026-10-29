-- §6.2/§6.3 Overarching DOCUMENT scope on the workflow + policy configurations (shared framework
-- serves both Travel Request and Expense Claim). Additive; existing rows default to Travel Request.
ALTER TABLE "WorkflowScenario" ADD COLUMN "documentType" TEXT NOT NULL DEFAULT 'TRAVEL_REQUEST';
ALTER TABLE "PolicyConfig" ADD COLUMN "documentType" TEXT NOT NULL DEFAULT 'TRAVEL_REQUEST';
