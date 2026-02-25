PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  qualifier TEXT,
  use_case TEXT,
  source_url TEXT,
  landing_path TEXT,
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,
  accept_language TEXT,
  origin TEXT,
  host TEXT,
  screen_size TEXT,
  viewport_size TEXT,
  platform TEXT,
  timezone TEXT,
  timezone_offset_minutes INTEGER,
  color_scheme TEXT,
  reduced_motion TEXT,
  cookie_enabled INTEGER,
  do_not_track TEXT,
  device_memory_gb REAL,
  hardware_concurrency INTEGER,
  max_touch_points INTEGER,
  cf_country TEXT,
  cf_region TEXT,
  cf_region_code TEXT,
  cf_city TEXT,
  cf_postal_code TEXT,
  cf_continent TEXT,
  cf_timezone TEXT,
  cf_colo TEXT,
  cf_asn INTEGER,
  cf_as_organization TEXT,
  cf_latitude REAL,
  cf_longitude REAL,
  cf_metro_code TEXT,
  cf_bot_score INTEGER,
  cf_tls_version TEXT,
  cf_http_protocol TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(email)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_created
ON waitlist_entries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_ip_created
ON waitlist_entries(ip_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_qualifier_created
ON waitlist_entries(qualifier, created_at DESC);
