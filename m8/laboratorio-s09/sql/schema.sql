-- Final table of the S09 lab (runs automatically the first time the Postgres container starts).
-- One row per enrollment; external_id is the id that comes from the source system (the CSV).
-- Staging tables, reject tables or import logs are yours to design: add them in your own SQL file.
CREATE TABLE IF NOT EXISTS enrollments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id  text          NOT NULL,
  student_name text          NOT NULL CHECK (btrim(student_name) <> ''),
  email        text          NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  course_code  text          NOT NULL CHECK (course_code ~ '^[A-Z]{2,4}-[0-9]{3}$'),
  enrolled_on  date          NOT NULL,
  amount       numeric(10,2) NOT NULL CHECK (amount >= 0),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT enrollments_external_id_key UNIQUE (external_id)
);
