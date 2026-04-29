-- AddColumn companyName and companyAbbr to Tenant
ALTER TABLE "Tenant" ADD COLUMN "companyName" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "companyAbbr" TEXT;
