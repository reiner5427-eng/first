ALTER TABLE runs ADD COLUMN segment_started INTEGER;
--> statement-breakpoint
ALTER TABLE runs ADD COLUMN bonus_score INTEGER NOT NULL DEFAULT 0;
