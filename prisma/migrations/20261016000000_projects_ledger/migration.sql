
-- CreateTable
CREATE TABLE "income_projects" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_ledger_entries" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'income',
    "counterpart" TEXT,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "occurredOn" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "income_projects_schoolId_active_idx" ON "income_projects"("schoolId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "income_projects_schoolId_name_key" ON "income_projects"("schoolId", "name");

-- CreateIndex
CREATE INDEX "school_ledger_entries_schoolId_kind_currency_idx" ON "school_ledger_entries"("schoolId", "kind", "currency");

-- CreateIndex
CREATE INDEX "school_ledger_entries_schoolId_occurredOn_idx" ON "school_ledger_entries"("schoolId", "occurredOn");

-- AddForeignKey
ALTER TABLE "income_projects" ADD CONSTRAINT "income_projects_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_ledger_entries" ADD CONSTRAINT "school_ledger_entries_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_ledger_entries" ADD CONSTRAINT "school_ledger_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "income_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

