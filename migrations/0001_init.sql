-- OpenŠtudent: students sign up with any e-mail (no school login), then pick their school and class.

CREATE TABLE users (
  id TEXT PRIMARY KEY,                 -- random UUID
  email TEXT NOT NULL UNIQUE,          -- lower-cased; only used to send the login code
  name TEXT,                           -- optional nickname shown next to tests they add
  school TEXT,                         -- school id from the catalog (datasets "schools"), NULL until chosen
  class TEXT,                          -- class name as the school writes it ("2.A", "T3")
  groups TEXT NOT NULL DEFAULT '[]',   -- JSON: the student's groups in split lessons ("2A1", "Aj2")
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  tests_blocked INTEGER NOT NULL DEFAULT 0  -- set by hand for a spammer
);
CREATE INDEX users_class ON users (school, class);

-- Pending login codes: only a salted hash, valid for a few minutes, a few attempts.
CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  p256dh TEXT,
  auth TEXT
);
CREATE INDEX push_user ON push_subscriptions (user_id);

-- What the nightly pipeline uploads: "schools", "tt-<school>", "menza". JSON as text.
CREATE TABLE datasets (
  name TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  hash TEXT NOT NULL,
  updated INTEGER NOT NULL
);

-- Last seen fingerprint of each class's timetable (per week), to notify students when the school changes it.
CREATE TABLE class_seen (
  school TEXT NOT NULL,
  class TEXT NOT NULL,
  week TEXT NOT NULL,
  hash TEXT NOT NULL,
  lessons TEXT NOT NULL,               -- JSON of the lessons, to tell what changed
  PRIMARY KEY (school, class, week)
);

-- Tests shared with the class (as in OpenSISAKHK), scoped to school + class.
CREATE TABLE tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school TEXT NOT NULL,
  class TEXT NOT NULL,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  subject TEXT NOT NULL,
  grp TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL
);
CREATE INDEX tests_class_date ON tests (school, class, date);
CREATE INDEX tests_author ON tests (author, created);

CREATE TABLE test_flags (
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (test_id, user_id)
);
