ALTER TABLE admin_users ADD COLUMN can_manage_accounts INTEGER NOT NULL DEFAULT 0
  CHECK (can_manage_accounts IN (0, 1));
