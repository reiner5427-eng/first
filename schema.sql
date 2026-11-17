-- Create a NEW D1 database only for this game. Never point DB at market-quiz-cat data.
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY,
 nickname TEXT NOT NULL,
 coat TEXT NOT NULL,
 started INTEGER NOT NULL,
 deck TEXT NOT NULL,
 question_step INTEGER NOT NULL DEFAULT 0,
 checkpoints INTEGER NOT NULL DEFAULT 0,
 active_question INTEGER,
 active_order TEXT,
 correct_count INTEGER NOT NULL DEFAULT 0,
 mistakes INTEGER NOT NULL DEFAULT 0,
 max_distance INTEGER NOT NULL DEFAULT 0,
 score INTEGER NOT NULL DEFAULT 0,
 finished INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS runs_rank ON runs(finished,score DESC,started);
