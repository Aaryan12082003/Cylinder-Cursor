export const MIGRATION_001 = `
CREATE TABLE companies (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  address TEXT,
  gst_number TEXT,
  phone TEXT,
  email TEXT,
  logo_path TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL
);

CREATE TABLE cylinder_sizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  capacity_litres REAL NOT NULL,
  sort_order INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  party_name TEXT NOT NULL,
  contact_person TEXT,
  mobile TEXT,
  alternate_mobile TEXT,
  email TEXT,
  gst_number TEXT,
  billing_address TEXT,
  delivery_address TEXT,
  city TEXT,
  state TEXT,
  pin_code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE inventory_balances (
  size_id INTEGER PRIMARY KEY REFERENCES cylinder_sizes(id),
  filled_available INTEGER NOT NULL DEFAULT 0 CHECK (filled_available >= 0),
  empty_available INTEGER NOT NULL DEFAULT 0 CHECK (empty_available >= 0),
  with_customer INTEGER NOT NULL DEFAULT 0 CHECK (with_customer >= 0),
  damaged INTEGER NOT NULL DEFAULT 0 CHECK (damaged >= 0),
  lost INTEGER NOT NULL DEFAULT 0 CHECK (lost >= 0),
  under_maintenance INTEGER NOT NULL DEFAULT 0 CHECK (under_maintenance >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE customer_balances (
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  size_id INTEGER NOT NULL REFERENCES cylinder_sizes(id),
  outstanding INTEGER NOT NULL DEFAULT 0 CHECK (outstanding >= 0),
  PRIMARY KEY (customer_id, size_id)
);

CREATE TABLE document_sequences (
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL,
  PRIMARY KEY (name, year)
);

CREATE TABLE opening_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  size_id INTEGER NOT NULL UNIQUE REFERENCES cylinder_sizes(id),
  filled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  empty_quantity INTEGER NOT NULL DEFAULT 0 CHECK (empty_quantity >= 0),
  damaged_quantity INTEGER NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  maintenance_quantity INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_quantity >= 0),
  notes TEXT,
  created_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE customer_opening_balances (
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  size_id INTEGER NOT NULL REFERENCES cylinder_sizes(id),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  recorded_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (customer_id, size_id)
);

CREATE TABLE dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  dispatch_date TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  vehicle_number TEXT,
  challan_number TEXT,
  driver_name TEXT,
  remarks TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reversed_at TEXT,
  reversal_reason TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE dispatch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_id INTEGER NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  size_id INTEGER NOT NULL REFERENCES cylinder_sizes(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  condition TEXT NOT NULL CHECK (condition IN ('filled', 'empty')),
  UNIQUE (dispatch_id, size_id, condition)
);

CREATE TABLE returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  return_date TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  challan_reference TEXT,
  remarks TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reversed_at TEXT,
  reversal_reason TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  size_id INTEGER NOT NULL REFERENCES cylinder_sizes(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  condition TEXT NOT NULL CHECK (condition IN ('filled', 'empty', 'damaged', 'lost', 'maintenance')),
  UNIQUE (return_id, size_id, condition)
);

CREATE TABLE customer_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  size_id INTEGER NOT NULL REFERENCES cylinder_sizes(id),
  entry_date TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  reference_number TEXT,
  opening_balance INTEGER NOT NULL,
  dispatched INTEGER NOT NULL DEFAULT 0,
  returned INTEGER NOT NULL DEFAULT 0,
  adjustment INTEGER NOT NULL DEFAULT 0,
  closing_balance INTEGER NOT NULL,
  remarks TEXT,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  size_id INTEGER NOT NULL REFERENCES cylinder_sizes(id),
  customer_id INTEGER REFERENCES customers(id),
  movement_date TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  reference_number TEXT,
  filled_delta INTEGER NOT NULL DEFAULT 0,
  empty_delta INTEGER NOT NULL DEFAULT 0,
  with_customer_delta INTEGER NOT NULL DEFAULT 0,
  damaged_delta INTEGER NOT NULL DEFAULT 0,
  lost_delta INTEGER NOT NULL DEFAULT 0,
  maintenance_delta INTEGER NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  adjustment_date TEXT NOT NULL,
  size_id INTEGER NOT NULL REFERENCES cylinder_sizes(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  reconciliation_date TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  size_id INTEGER NOT NULL REFERENCES cylinder_sizes(id),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta != 0),
  counter_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE month_end_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_key TEXT NOT NULL UNIQUE,
  period_label TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  total_with_customers INTEGER NOT NULL,
  customer_count INTEGER NOT NULL
);

CREATE TABLE month_end_snapshot_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES month_end_snapshots(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  mobile TEXT,
  balances_json TEXT NOT NULL,
  total_outstanding INTEGER NOT NULL,
  last_dispatch_date TEXT,
  last_return_date TEXT,
  days_since_movement INTEGER,
  overdue INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload_json TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL,
  dedupe_key TEXT UNIQUE
);

CREATE TABLE application_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  detail_json TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE backup_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT
);

CREATE INDEX idx_customers_party ON customers(party_name);
CREATE INDEX idx_customers_mobile ON customers(mobile);
CREATE INDEX idx_customers_status ON customers(status, archived_at);
CREATE INDEX idx_ledger_customer ON customer_ledger_entries(customer_id, entry_date, id);
CREATE INDEX idx_ledger_size ON customer_ledger_entries(size_id);
CREATE INDEX idx_movements_size ON inventory_movements(size_id, movement_date, id);
CREATE INDEX idx_movements_customer ON inventory_movements(customer_id);
CREATE INDEX idx_dispatches_date ON dispatches(dispatch_date);
CREATE INDEX idx_dispatches_customer ON dispatches(customer_id);
CREATE INDEX idx_dispatches_challan ON dispatches(challan_number);
CREATE INDEX idx_returns_date ON returns(return_date);
CREATE INDEX idx_returns_customer ON returns(customer_id);
CREATE INDEX idx_returns_challan ON returns(challan_reference);
CREATE INDEX idx_audit_time ON audit_logs(occurred_at);
CREATE INDEX idx_notifications_read ON notifications(read_at, created_at);
CREATE INDEX idx_snapshot_items ON month_end_snapshot_items(snapshot_id);
`
