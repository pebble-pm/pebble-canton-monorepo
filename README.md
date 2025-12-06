# Pebble Canton Prediction Market

**A decentralized prediction market platform built on Canton blockchain**

## What is Pebble?

Pebble enables users to trade binary YES/NO predictions on real-world events-sports, politics, finance, crypto, and more. Think Polymarket or Kalshi, but with Canton's privacy-first architecture and bulletproof settlement guarantees.

## The Problem

Existing prediction markets suffer from:

- **Public exposure** - All trading activity visible on-chain (Ethereum)
- **Slow settlement** - On-chain order matching creates bottlenecks
- **Partial fills & race conditions** - Mutable state leads to failed transactions

## Our Solution

Pebble implements a **hybrid off-chain/on-chain architecture**:

| Layer                   | What It Does                                         |
| ----------------------- | ---------------------------------------------------- |
| **Off-chain Orderbook** | Fast order matching & price discovery                |
| **On-chain Settlement** | Atomic, privacy-preserving trade execution on Canton |
| **Event Streaming**     | Real-time sync between layers                        |

This delivers the speed of centralized exchanges with the security of blockchain settlement.

## Tech Stack

- **Smart Contracts**: DAML on Canton (privacy-first UTXO model)
- **Backend**: Bun + Hono + SQLite (TypeScript)
- **Frontend**: React 19 + Vite + TanStack Router + Tailwind CSS
- **Real-time**: WebSocket subscriptions for live orderbooks & trades

## Key Features

- **Binary Markets** - Trade YES/NO outcomes with collateral-backed positions
- **Live Orderbooks** - Real-time price-time-priority matching engine
- **Atomic Settlement** - Three-stage protocol ensures no partial fills
- **Privacy by Default** - Canton's party model keeps trades private to stakeholders
- **Full Trading UI** - Markets, portfolio, order management, and admin dashboard

## Architecture Highlights

```
User places order → Funds locked on-chain
                  → Order added to off-chain orderbook
                  → Matching engine finds counterparty
                  → Settlement proposal created on Canton
                  → Atomic execution: accounts debited, positions created
                  → WebSocket broadcasts updates to UI
```

## What Makes This Novel

1. **First prediction market on Canton** - New category of dApps for this blockchain
2. **True privacy** - Unlike Ethereum, user-to-user privacy means trading activity isn't public
3. **Production patterns** - Reconciliation, retry logic, event sourcing
4. **Full stack** - Complete working implementation from contracts to UI

## Demo

The platform includes:

- Browse & trade on active markets
- Real-time orderbook visualization
- Portfolio management with P&L tracking
- Admin tools for market creation & resolution
- Test token faucet for onboarding

## Technical Notes

See [TECHNICAL_NOTES.md](TECHNICAL_NOTES.md) for architecture diagrams and setup instructions.

## License

Pebble is not open source. All rights reserved by the author.
