CREATE TABLE "ApiRequestBucket" (
  "organizationId" TEXT NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "bucket" TEXT NOT NULL,
  "window" BIGINT NOT NULL,
  "count" INTEGER NOT NULL CHECK ("count" >= 0),
  PRIMARY KEY ("organizationId", "bucket")
);
CREATE INDEX "ApiRequestBucket_window_idx" ON "ApiRequestBucket"("window");
