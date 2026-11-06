-- The SIS session (cookies) of the last background check, sealed with AES-GCM (SESSION_SECRET, its own key). The next
-- check reuses it and logs in again only once SIS has expired it: three requests fewer per student per check, and no
-- stream of fresh logins from the same GitHub address that could pass for password guessing. NULL until the first check.
ALTER TABLE watchers ADD COLUMN sis TEXT;
