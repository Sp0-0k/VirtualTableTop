-- Players that have joined (one row per friend who picks a name).
-- The DM does NOT have a row here — DM is identified solely by the vtt_dm cookie.
CREATE TABLE players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color         TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

-- Uploaded image files. Content-hashed so identical re-uploads dedupe.
CREATE TABLE assets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  hash           TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL CHECK (kind IN ('map', 'token')),
  original_name  TEXT NOT NULL,
  mime           TEXT NOT NULL,
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  size_bytes     INTEGER NOT NULL,
  uploaded_at    INTEGER NOT NULL
);

-- A page = one map background + tokens + fog. is_active flags which page
-- is currently shown to players.
CREATE TABLE pages (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL,
  background_asset_id   INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  grid_width_squares    INTEGER NOT NULL,
  grid_height_squares   INTEGER NOT NULL,
  sort_order            INTEGER NOT NULL,
  is_active             INTEGER NOT NULL DEFAULT 0,
  settings_json         TEXT NOT NULL DEFAULT '{}',
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_pages_one_active ON pages(is_active) WHERE is_active = 1;

-- Tokens placed on a page.
CREATE TABLE tokens (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id                  INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  asset_id                 INTEGER NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  name                     TEXT,
  x                        REAL NOT NULL,
  y                        REAL NOT NULL,
  size_squares             INTEGER NOT NULL DEFAULT 1,
  owner_player_id          INTEGER REFERENCES players(id) ON DELETE SET NULL,
  hidden                   INTEGER NOT NULL DEFAULT 0,
  current_hp               INTEGER,
  max_hp                   INTEGER,
  conditions_json          TEXT NOT NULL DEFAULT '[]',
  hp_visible_to_players    INTEGER NOT NULL DEFAULT 1,
  vision_distance          REAL,
  light_radius             REAL,
  z_index                  INTEGER NOT NULL DEFAULT 0,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

-- Fog brush strokes. Vector-stored so the same data structure can be
-- composited with future dynamic-lighting visibility polygons.
CREATE TABLE fog_strokes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id      INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL CHECK (mode IN ('reveal', 'hide')),
  radius       REAL NOT NULL,
  points_json  TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

-- v2 stretch: walls for dynamic line-of-sight. Empty in v1.
CREATE TABLE walls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id         INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  x1              REAL NOT NULL,
  y1              REAL NOT NULL,
  x2              REAL NOT NULL,
  y2              REAL NOT NULL,
  blocks_sight    INTEGER NOT NULL DEFAULT 1,
  blocks_movement INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_tokens_page  ON tokens(page_id);
CREATE INDEX idx_fog_page     ON fog_strokes(page_id);
CREATE INDEX idx_walls_page   ON walls(page_id);
CREATE INDEX idx_pages_sort   ON pages(sort_order);
