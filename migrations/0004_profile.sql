-- More of the SIS profile, for extending the app: school e-mail, class groups, elective blocks and projects
-- (all from /Account/UserProfile), refreshed on every login. SIS doesn't show the class anywhere: the app guesses it
-- from the timetable and the student confirms it (NULL = not confirmed yet, the app asks).
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN groups TEXT;   -- JSON, e.g. ["1","p","t","r"]
ALTER TABLE users ADD COLUMN blocks TEXT;   -- JSON, e.g. [{"subject":"MPT","block":"B09"}]
ALTER TABLE users ADD COLUMN projects TEXT; -- JSON, e.g. ["P21"]
ALTER TABLE users ADD COLUMN class TEXT;    -- one of CLASSES in src/shared/schoolOcr.ts
