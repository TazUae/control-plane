-- CreateTable
CREATE TABLE "PendingPaymentNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceName" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "customerName" TEXT,
    "grandTotal" DECIMAL(65,30),
    "currency" TEXT,
    "sessionDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "PendingPaymentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingPaymentNotification_tenantId_invoiceName_key" ON "PendingPaymentNotification"("tenantId", "invoiceName");

-- AddForeignKey
ALTER TABLE "PendingPaymentNotification" ADD CONSTRAINT "PendingPaymentNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
