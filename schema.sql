-- Smart Attendance Register — MySQL schema
-- Run this once against your database before starting the server.

CREATE TABLE IF NOT EXISTS students (
  roll  VARCHAR(20)  NOT NULL PRIMARY KEY,
  name  VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS marks (
  roll     VARCHAR(20) NOT NULL,
  date     DATE        NOT NULL,
  lecture  TINYINT     NOT NULL,
  status   ENUM('present','absent') NOT NULL,
  PRIMARY KEY (roll, date, lecture),
  FOREIGN KEY (roll) REFERENCES students(roll) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cancelled_lectures (
  date     DATE    NOT NULL,
  lecture  TINYINT NOT NULL,
  PRIMARY KEY (date, lecture)
);