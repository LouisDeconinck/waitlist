PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  use_case TEXT,
  ip_address TEXT,
  user_agent TEXT,
  accept_language TEXT,
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
  cf_bot_score INTEGER,
  cf_tls_version TEXT,
  cf_http_protocol TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(email)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_created
ON waitlist_entries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_ip_created
ON waitlist_entries(ip_address, created_at DESC);
