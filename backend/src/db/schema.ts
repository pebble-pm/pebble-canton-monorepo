/**
 * SQLite schema definitions for Pebble backend
 */

export const SCHEMA_VERSION = 1;

/** All table creation statements */
export const TABLES = {
    markets: `
    CREATE TABLE IF NOT EXISTS markets (
      market_id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      description TEXT,
      resolution_time TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'resolved')),
      outcome INTEGER,
      contract_id TEXT,
      version INTEGER DEFAULT 0,
      yes_price REAL DEFAULT 0.5,
      no_price REAL DEFAULT 0.5,
      volume_24h REAL DEFAULT 0,
      total_volume REAL DEFAULT 0,
      open_interest REAL DEFAULT 0,
      last_updated TEXT NOT NULL
    )
  `,

    orders: `
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('yes', 'no')),
      action TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
      order_type TEXT NOT NULL CHECK (order_type IN ('limit', 'market')),
      price REAL,
      quantity REAL NOT NULL,
      filled_quantity REAL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('pending', 'open', 'partial', 'filled', 'cancelled', 'rejected')),
      locked_amount REAL DEFAULT 0,
      canton_lock_tx_id TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (market_id) REFERENCES markets(market_id)
    )
  `,

    trades: `
    CREATE TABLE IF NOT EXISTS trades (
      trade_id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('yes', 'no')),
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      buyer_order_id TEXT NOT NULL,
      seller_order_id TEXT NOT NULL,
      trade_type TEXT NOT NULL CHECK (trade_type IN ('share_trade', 'share_creation')),
      settlement_id TEXT,
      settlement_status TEXT NOT NULL CHECK (settlement_status IN ('pending', 'settling', 'settled', 'failed')),
      created_at TEXT NOT NULL,
      settled_at TEXT,
      FOREIGN KEY (market_id) REFERENCES markets(market_id),
      FOREIGN KEY (buyer_order_id) REFERENCES orders(order_id),
      FOREIGN KEY (seller_order_id) REFERENCES orders(order_id)
    )
  `,

    accounts: `
    CREATE TABLE IF NOT EXISTS accounts (
      user_id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL UNIQUE,
      account_contract_id TEXT,
      authorization_contract_id TEXT,
      available_balance REAL DEFAULT 0,
      locked_balance REAL DEFAULT 0,
      last_updated TEXT NOT NULL
    )
  `,

    positions: `
    CREATE TABLE IF NOT EXISTS positions (
      position_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('yes', 'no')),
      quantity REAL NOT NULL,
      locked_quantity REAL DEFAULT 0,
      avg_cost_basis REAL NOT NULL,
      is_archived INTEGER DEFAULT 0,
      last_updated TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES accounts(user_id),
      FOREIGN KEY (market_id) REFERENCES markets(market_id)
    )
  `,

    settlement_batches: `
    CREATE TABLE IF NOT EXISTS settlement_batches (
      batch_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('pending', 'proposing', 'accepting', 'executing', 'completed', 'failed')),
      canton_tx_id TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT
    )
  `,

    settlement_batch_trades: `
    CREATE TABLE IF NOT EXISTS settlement_batch_trades (
      batch_id TEXT NOT NULL,
      trade_id TEXT NOT NULL,
      PRIMARY KEY (batch_id, trade_id),
      FOREIGN KEY (batch_id) REFERENCES settlement_batches(batch_id),
      FOREIGN KEY (trade_id) REFERENCES trades(trade_id)
    )
  `,

    settlement_events: `
    CREATE TABLE IF NOT EXISTS settlement_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT NOT NULL,
      settlement_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      status TEXT NOT NULL,
      timestamp TEXT NOT NULL
    )
  `,

    compensation_failures: `
    CREATE TABLE IF NOT EXISTS compensation_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      account_cid TEXT NOT NULL,
      error TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      resolved INTEGER DEFAULT 0,
      resolved_at TEXT,
      resolved_by TEXT
    )
  `,

    reconciliation_history: `
    CREATE TABLE IF NOT EXISTS reconciliation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      previous_available REAL NOT NULL,
      previous_locked REAL NOT NULL,
      onchain_available REAL NOT NULL,
      onchain_locked REAL NOT NULL,
      drift_available REAL NOT NULL,
      drift_locked REAL NOT NULL,
      reconciled INTEGER NOT NULL,
      timestamp TEXT NOT NULL
    )
  `,

    system_state: `
    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `,

    idempotency_cache: `
    CREATE TABLE IF NOT EXISTS idempotency_cache (
      key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `,

    faucet_requests: `
    CREATE TABLE IF NOT EXISTS faucet_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      party_id TEXT NOT NULL,
      amount REAL NOT NULL,
      is_initial INTEGER NOT NULL DEFAULT 0,
      transaction_id TEXT,
      created_at TEXT NOT NULL
    )
  `,
};

/** Index creation statements */
export const INDEXES = [
    // Orders indexes
    "CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_orders_market ON orders(market_id)",
    "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)",
    "CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(user_id, idempotency_key)",
    "CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC)",

    // Trades indexes
    "CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id)",
    "CREATE INDEX IF NOT EXISTS idx_trades_settlement ON trades(settlement_status)",
    "CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_trades_buyer ON trades(buyer_id)",
    "CREATE INDEX IF NOT EXISTS idx_trades_seller ON trades(seller_id)",

    // Positions indexes
    "CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id)",
    "CREATE INDEX IF NOT EXISTS idx_positions_active ON positions(user_id, is_archived)",
    "CREATE INDEX IF NOT EXISTS idx_positions_market_side ON positions(market_id, side)",

    // Accounts indexes
    "CREATE INDEX IF NOT EXISTS idx_accounts_party ON accounts(party_id)",

    // Settlement indexes
    "CREATE INDEX IF NOT EXISTS idx_settlement_events_settlement ON settlement_events(settlement_id)",
    "CREATE INDEX IF NOT EXISTS idx_settlement_batches_status ON settlement_batches(status)",

    // Compensation indexes
    "CREATE INDEX IF NOT EXISTS idx_compensation_pending ON compensation_failures(resolved)",
    "CREATE INDEX IF NOT EXISTS idx_compensation_user ON compensation_failures(user_id)",

    // Reconciliation indexes
    "CREATE INDEX IF NOT EXISTS idx_reconciliation_user ON reconciliation_history(user_id)",

    // Idempotency cache indexes
    "CREATE INDEX IF NOT EXISTS idx_idempotency_user ON idempotency_cache(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_cache(expires_at)",

    // Faucet indexes
    "CREATE INDEX IF NOT EXISTS idx_faucet_user ON faucet_requests(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_faucet_created ON faucet_requests(created_at DESC)",
];

/** Table names for reference */
export const TableNames = {
    MARKETS: "markets",
    ORDERS: "orders",
    TRADES: "trades",
    ACCOUNTS: "accounts",
    POSITIONS: "positions",
    SETTLEMENT_BATCHES: "settlement_batches",
    SETTLEMENT_BATCH_TRADES: "settlement_batch_trades",
    SETTLEMENT_EVENTS: "settlement_events",
    COMPENSATION_FAILURES: "compensation_failures",
    RECONCILIATION_HISTORY: "reconciliation_history",
    SYSTEM_STATE: "system_state",
    IDEMPOTENCY_CACHE: "idempotency_cache",
    FAUCET_REQUESTS: "faucet_requests",
} as const;
