ALTER TABLE admin_users ADD COLUMN can_manage_research_settings INTEGER NOT NULL DEFAULT 0
  CHECK (can_manage_research_settings IN (0, 1));

UPDATE admin_users SET can_manage_research_settings = 1 WHERE username = 'bruce';
