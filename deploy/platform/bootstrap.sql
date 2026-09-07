-- NEW platform database only, after automatic migrations. Synthetic identities.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM companies) OR EXISTS (SELECT 1 FROM platform_roles)
     OR EXISTS (SELECT 1 FROM company_memberships) THEN
    RAISE EXCEPTION 'Authorization data exists; refusing bootstrap';
  END IF;
END $$;
INSERT INTO companies (id, display_name, created_at)
VALUES ('company-a', 'VCP Demo Company', now());
INSERT INTO platform_roles (subject, role, active, created_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'operator', true, now());
INSERT INTO company_memberships (company_id, subject, role, active, created_at)
VALUES ('company-a', '22222222-2222-4222-8222-222222222222', 'company-user', true, now());
COMMIT;
