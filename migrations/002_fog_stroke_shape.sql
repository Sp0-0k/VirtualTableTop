ALTER TABLE fog_strokes
  ADD COLUMN shape TEXT NOT NULL DEFAULT 'brush'
    CHECK (shape IN ('brush', 'rect'));
