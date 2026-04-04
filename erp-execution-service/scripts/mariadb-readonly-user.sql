-- Run once against MariaDB as an admin (e.g. root), then set matching env on erp-execution-service:
--   ERP_DB_READONLY_USER / ERP_DB_READONLY_PASSWORD
-- Used only for information_schema validation (not application DB access).

CREATE USER IF NOT EXISTS 'erp_readonly'@'%' IDENTIFIED BY 'securepassword';
GRANT SELECT ON information_schema.* TO 'erp_readonly'@'%';
FLUSH PRIVILEGES;
