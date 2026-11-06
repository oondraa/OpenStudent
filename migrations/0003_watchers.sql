-- Opt-in background checks for new grades and absences (scripts/watch.ts in a GitHub Action).
-- Only for students who switch it on in Settings: their SIS login, sealed with AES-GCM (SESSION_SECRET).
-- `seen` holds short hashes of the grades/absences already checked, never the grades themselves.
CREATE TABLE watchers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cred TEXT NOT NULL,
  seen TEXT,                    -- JSON {"g": [...], "a": [...]}, NULL until the first check
  created INTEGER NOT NULL,
  checked INTEGER
);
