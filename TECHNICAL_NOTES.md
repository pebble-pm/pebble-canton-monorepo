# Pebble Canton Prediction Market Technical Notes

Pebble is a prediction market platform built on the Canton blockchain using Daml for on-chain contracts and an off-chain matching engine for order management. This architecture follows the proven hybrid model used by successful prediction markets where matching happens off-chain and only settlement touches the ledger, working around the limitations of concurrency limitation of Canton's UTXO-like design.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React/Vite)                          │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ REST/WebSocket
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND API (Bun/TypeScript)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Market     │  │  Order      │  │  Matching   │  │  Settlement         │ │
│  │  Service    │  │  Service    │  │  Engine     │  │  Service            │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────────────────┐ │
│  │  Oracle     │  │  Balance    │  │  Ledger Event Processor              │ │
│  │  Service    │  │  Projection │  │  (Transaction Stream)                │ │
│  └─────────────┘  └─────────────┘  └──────────────────────────────────────┘ │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ JSON Ledger API v2
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CANTON SANDBOX / PARTICIPANT NODE                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                      DAML Smart Contracts                               ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ ││
│  │  │ TradingAcct  │  │ Market       │  │ Position     │  │ Settlement   │ ││
│  │  │              │  │ Contract     │  │ Contract     │  │ Contract     │ ││
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

### Required Tools

| Tool         | Version | Purpose                          |
| ------------ | ------- | -------------------------------- |
| **Daml SDK** | 3.4.9   | Smart contracts & Canton sandbox |
| **Bun**      | 1.3.3   | Backend & frontend runtime       |

---

## Quick Start (Local Development)

### 1. Start the Canton Sandbox

The sandbox provides a local Canton ledger with the JSON Ledger API v2.

```bash
# From the repository root
cd canton
./scripts/start.sh
```

This will:

1. Build the Pebble DAR if not already built
2. Start Canton sandbox with JSON Ledger API
3. Auto-allocate system parties (PebbleAdmin, Oracle)

> **Note**: Some test parties (Alice, Bob, Charlie) are later created by the backend on startup, topped up with test tokens.

**Ports exposed:**

| Service         | Port | URL                   |
| --------------- | ---- | --------------------- |
| JSON Ledger API | 7575 | http://localhost:7575 |
| gRPC Ledger API | 6865 | localhost:6865        |
| Admin API       | 6866 | localhost:6866        |

### 2. Start the Backend

Open a new terminal:

```bash
cd backend
bun install
bun run dev
```

The backend will:

- Connect to Canton at localhost:7575
- Auto-discover system parties (PebbleAdmin, Oracle)
- Bootstrap test parties (Alice, Bob, Charlie) with trading accounts
- Start the REST API on port 3000
- Start WebSocket server for real-time updates

**Fresh Start (Reset Database):**

If you restarted the Canton sandbox, the backend's local SQLite database will be out of sync, so you need to start with a fresh database.

```bash
# Via bun scripts
bun run dev:fresh      # Development with watch mode
bun run start:fresh    # Production mode

# Or with flag
bun run dev -- --fresh
```

You can also reset the database manually:

```bash
./scripts/reset-db.sh
```

### 3. Start the Frontend

Open another terminal:

```bash
cd frontend
bun install
bun run dev
```

The frontend runs on http://localhost:5173 with API proxy to the backend.

---

## Headless Interaction Scripts

The `scripts` directory contains useful scripts for interacting with the backend API and Canton sandbox directly, for testing without a frontend UI.

---

## Building Daml Contracts

The Daml contracts are built automatically when starting the sandbox, but you can build them manually:

```bash
cd daml
dpm build
```

This creates `.daml/dist/pebble-0.1.0.dar` which is uploaded to the sandbox.

### Running Daml Tests

```bash
cd daml
dpm test
```
