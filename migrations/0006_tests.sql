-- Tests, written exams and the like that students add to a lesson of their class, shared with the classmates who
-- have the same lesson (class + date + start + subject + group). Added only to a lesson that's in the author's own
-- SIS timetable, so nobody can fill another class's timetable. The Testy screen shows who added each one.
CREATE TABLE tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class TEXT NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  start TEXT NOT NULL,             -- the lesson's start as SIS gives it, e.g. "8:45"
  subject TEXT NOT NULL,
  grp TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,              -- test | zkouseni | odevzdani
  note TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL
);
CREATE INDEX tests_class_date ON tests (class, date);
CREATE INDEX tests_author ON tests (author, created);

-- "To neplatí" from classmates: enough of them hide the test for everyone but its author.
CREATE TABLE test_flags (
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (test_id, user_id)
);

-- Set by hand (wrangler d1 execute) for a student who spams: they can't add tests any more.
ALTER TABLE users ADD COLUMN tests_blocked INTEGER NOT NULL DEFAULT 0;
