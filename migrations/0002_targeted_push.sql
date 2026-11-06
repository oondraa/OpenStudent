-- Targeted notifications: what a subscription needs to receive encrypted payloads, and whose changes it wants.
ALTER TABLE push_subscriptions ADD COLUMN p256dh TEXT;
ALTER TABLE push_subscriptions ADD COLUMN auth TEXT;
ALTER TABLE push_subscriptions ADD COLUMN cls TEXT;
ALTER TABLE push_subscriptions ADD COLUMN subjects TEXT NOT NULL DEFAULT '[]'; -- JSON, e.g. ["MAT","AGJ1"]

-- Last OCR reading of the public school timetable per day, to diff the next one against.
CREATE TABLE school_days (
  date TEXT PRIMARY KEY,
  cells TEXT NOT NULL,
  updated INTEGER NOT NULL
);
