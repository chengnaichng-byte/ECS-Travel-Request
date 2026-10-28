-- §6.2 ECS decision points on the workflow scenario (conditional Skip/Add/Replace modifiers).
ALTER TABLE "WorkflowScenario" ADD COLUMN "decisionPointsJson" TEXT NOT NULL DEFAULT '[]';
