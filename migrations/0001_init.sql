-- Students who signed in to the app: name and profile photo only. Never passwords.
CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- SIS user id
  name TEXT NOT NULL,
  photo BLOB,
  photo_type TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL
);

-- Hash of each public school timetable image, to notice when SIS rewrites it.
CREATE TABLE school_images (
  file TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  checked INTEGER NOT NULL
);
