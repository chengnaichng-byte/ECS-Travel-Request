-- DD-31 CTA reversal refund/penalty split: the penalty retained on cancellation (not reversed).
ALTER TABLE "CtaPostingDocument" ADD COLUMN "retainedSgd" REAL NOT NULL DEFAULT 0;
