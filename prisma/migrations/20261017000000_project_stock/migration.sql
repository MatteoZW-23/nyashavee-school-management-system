
-- CreateTable
CREATE TABLE "project_stock_items" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'units',
    "onHand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'adjustment',
    "quantity" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "ledgerEntryId" TEXT,
    "occurredOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_stock_items_schoolId_active_idx" ON "project_stock_items"("schoolId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "project_stock_items_projectId_name_key" ON "project_stock_items"("projectId", "name");

-- CreateIndex
CREATE INDEX "stock_movements_schoolId_occurredOn_idx" ON "stock_movements"("schoolId", "occurredOn");

-- AddForeignKey
ALTER TABLE "project_stock_items" ADD CONSTRAINT "project_stock_items_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_stock_items" ADD CONSTRAINT "project_stock_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "income_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "project_stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "school_ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

