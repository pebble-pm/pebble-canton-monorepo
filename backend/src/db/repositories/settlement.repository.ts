/**
 * Settlement repository for database operations
 */

import { BaseRepository } from "./base.repository";
import type {
    SettlementBatch,
    SettlementEvent,
    CompensationFailure,
    ReconciliationRecord,
    BatchStatus,
} from "../../types";

// Row types
interface BatchRow {
    batch_id: string;
    status: string;
    canton_tx_id: string | null;
    created_at: string;
    processed_at: string | null;
    retry_count: number;
    last_error: string | null;
}

interface EventRow {
    id: number;
    contract_id: string;
    settlement_id: string;
    transaction_id: string;
    status: string;
    timestamp: string;
}

interface CompensationRow {
    id: number;
    order_id: string;
    user_id: string;
    amount: number;
    account_cid: string;
    error: string;
    timestamp: string;
    resolved: number;
    resolved_at: string | null;
    resolved_by: string | null;
}

interface ReconciliationRow {
    id: number;
    user_id: string;
    previous_available: number;
    previous_locked: number;
    onchain_available: number;
    onchain_locked: number;
    drift_available: number;
    drift_locked: number;
    reconciled: number;
    timestamp: string;
}

export class SettlementRepository extends BaseRepository {
    // ============================================
    // Settlement Batches
    // ============================================

    /**
     * Get batch by ID
     */
    getBatchById(batchId: string): SettlementBatch | null {
        const row = this.db
            .query("SELECT * FROM settlement_batches WHERE batch_id = ?")
            .get(batchId) as BatchRow | null;

        if (!row) return null;

        const tradeIds = this.getBatchTradeIds(batchId);
        return this.rowToBatch(row, tradeIds);
    }

    /**
     * Get batches by status
     */
    getBatchesByStatus(statuses: BatchStatus[]): SettlementBatch[] {
        const placeholders = statuses.map(() => "?").join(", ");
        const rows = this.db
            .query(
                `SELECT * FROM settlement_batches
         WHERE status IN (${placeholders})
         ORDER BY created_at ASC`,
            )
            .all(...statuses) as BatchRow[];

        return rows.map((row) => {
            const tradeIds = this.getBatchTradeIds(row.batch_id);
            return this.rowToBatch(row, tradeIds);
        });
    }

    /**
     * Get pending batches for processing
     */
    getPendingBatches(limit: number = 10): SettlementBatch[] {
        return this.getBatchesByStatus(["pending"]).slice(0, limit);
    }

    /**
     * Create a new batch
     */
    createBatch(batch: SettlementBatch): void {
        this.db.run(
            `INSERT INTO settlement_batches
       (batch_id, status, canton_tx_id, created_at, processed_at, retry_count, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                batch.batchId,
                batch.status,
                batch.cantonTransactionId ?? null,
                this.toSqlDate(batch.createdAt),
                batch.processedAt ? this.toSqlDate(batch.processedAt) : null,
                batch.retryCount,
                batch.lastError ?? null,
            ],
        );

        // Insert trade associations
        for (const tradeId of batch.tradeIds) {
            this.db.run(`INSERT INTO settlement_batch_trades (batch_id, trade_id) VALUES (?, ?)`, [
                batch.batchId,
                tradeId,
            ]);
        }
    }

    /**
     * Update batch status
     */
    updateBatchStatus(batchId: string, status: BatchStatus, error?: string): void {
        if (status === "completed" || status === "failed") {
            this.db.run(
                `UPDATE settlement_batches
         SET status = ?, processed_at = ?, last_error = ?
         WHERE batch_id = ?`,
                [status, this.now(), error ?? null, batchId],
            );
        } else {
            this.db.run(
                `UPDATE settlement_batches
         SET status = ?, last_error = ?
         WHERE batch_id = ?`,
                [status, error ?? null, batchId],
            );
        }
    }

    /**
     * Increment retry count
     */
    incrementBatchRetry(batchId: string, error: string): void {
        this.db.run(
            `UPDATE settlement_batches
       SET retry_count = retry_count + 1, last_error = ?
       WHERE batch_id = ?`,
            [error, batchId],
        );
    }

    /**
     * Set Canton transaction ID
     */
    setBatchCantonTxId(batchId: string, txId: string): void {
        this.db.run(
            `UPDATE settlement_batches
       SET canton_tx_id = ?
       WHERE batch_id = ?`,
            [txId, batchId],
        );
    }

    private getBatchTradeIds(batchId: string): string[] {
        const rows = this.db.query("SELECT trade_id FROM settlement_batch_trades WHERE batch_id = ?").all(batchId) as {
            trade_id: string;
        }[];
        return rows.map((r) => r.trade_id);
    }

    // ============================================
    // Settlement Events (Audit Trail)
    // ============================================

    /**
     * Create a settlement event
     */
    createEvent(event: Omit<SettlementEvent, "id">): void {
        this.db.run(
            `INSERT INTO settlement_events
       (contract_id, settlement_id, transaction_id, status, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
            [event.contractId, event.settlementId, event.transactionId, event.status, this.toSqlDate(event.timestamp)],
        );
    }

    /**
     * Get events by settlement ID
     */
    getEventsBySettlementId(settlementId: string): SettlementEvent[] {
        const rows = this.db
            .query(
                `SELECT * FROM settlement_events
         WHERE settlement_id = ?
         ORDER BY timestamp ASC`,
            )
            .all(settlementId) as EventRow[];

        return rows.map((row) => this.rowToEvent(row));
    }

    // ============================================
    // Compensation Failures
    // ============================================

    /**
     * Create a compensation failure record
     */
    createCompensationFailure(
        failure: Omit<CompensationFailure, "id" | "resolved" | "resolvedAt" | "resolvedBy">,
    ): void {
        this.db.run(
            `INSERT INTO compensation_failures
       (order_id, user_id, amount, account_cid, error, timestamp, resolved)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
            [
                failure.orderId,
                failure.userId,
                this.toSqlNumber(failure.amount),
                failure.accountCid,
                failure.error,
                this.toSqlDate(failure.timestamp),
            ],
        );
    }

    /**
     * Get unresolved compensation failures
     */
    getUnresolvedCompensationFailures(): CompensationFailure[] {
        const rows = this.db
            .query(
                `SELECT * FROM compensation_failures
         WHERE resolved = 0
         ORDER BY timestamp ASC`,
            )
            .all() as CompensationRow[];

        return rows.map((row) => this.rowToCompensation(row));
    }

    /**
     * Resolve a compensation failure
     */
    resolveCompensationFailure(id: number, resolvedBy: string): void {
        this.db.run(
            `UPDATE compensation_failures
       SET resolved = 1, resolved_at = ?, resolved_by = ?
       WHERE id = ?`,
            [this.now(), resolvedBy, id],
        );
    }

    // ============================================
    // Reconciliation History
    // ============================================

    /**
     * Create a reconciliation record
     */
    createReconciliation(record: Omit<ReconciliationRecord, "id">): void {
        this.db.run(
            `INSERT INTO reconciliation_history
       (user_id, previous_available, previous_locked, onchain_available,
        onchain_locked, drift_available, drift_locked, reconciled, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                record.userId,
                this.toSqlNumber(record.previousAvailable),
                this.toSqlNumber(record.previousLocked),
                this.toSqlNumber(record.onchainAvailable),
                this.toSqlNumber(record.onchainLocked),
                this.toSqlNumber(record.driftAvailable),
                this.toSqlNumber(record.driftLocked),
                this.toSqlBool(record.reconciled),
                this.toSqlDate(record.timestamp),
            ],
        );
    }

    /**
     * Get reconciliation history for a user
     */
    getReconciliationHistory(userId: string, limit: number = 100): ReconciliationRecord[] {
        const rows = this.db
            .query(
                `SELECT * FROM reconciliation_history
         WHERE user_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`,
            )
            .all(userId, limit) as ReconciliationRow[];

        return rows.map((row) => this.rowToReconciliation(row));
    }

    // ============================================
    // Row Converters
    // ============================================

    private rowToBatch(row: BatchRow, tradeIds: string[]): SettlementBatch {
        return {
            batchId: row.batch_id,
            tradeIds,
            status: row.status as BatchStatus,
            cantonTransactionId: row.canton_tx_id ?? undefined,
            createdAt: this.fromSqlDate(row.created_at),
            processedAt: row.processed_at ? this.fromSqlDate(row.processed_at) : undefined,
            retryCount: row.retry_count,
            lastError: row.last_error ?? undefined,
        };
    }

    private rowToEvent(row: EventRow): SettlementEvent {
        return {
            id: row.id,
            contractId: row.contract_id,
            settlementId: row.settlement_id,
            transactionId: row.transaction_id,
            status: row.status,
            timestamp: this.fromSqlDate(row.timestamp),
        };
    }

    private rowToCompensation(row: CompensationRow): CompensationFailure {
        return {
            id: row.id,
            orderId: row.order_id,
            userId: row.user_id,
            amount: this.fromSqlNumber(row.amount),
            accountCid: row.account_cid,
            error: row.error,
            timestamp: this.fromSqlDate(row.timestamp),
            resolved: this.fromSqlBool(row.resolved),
            resolvedAt: row.resolved_at ? this.fromSqlDate(row.resolved_at) : undefined,
            resolvedBy: row.resolved_by ?? undefined,
        };
    }

    private rowToReconciliation(row: ReconciliationRow): ReconciliationRecord {
        return {
            id: row.id,
            userId: row.user_id,
            previousAvailable: this.fromSqlNumber(row.previous_available),
            previousLocked: this.fromSqlNumber(row.previous_locked),
            onchainAvailable: this.fromSqlNumber(row.onchain_available),
            onchainLocked: this.fromSqlNumber(row.onchain_locked),
            driftAvailable: this.fromSqlNumber(row.drift_available),
            driftLocked: this.fromSqlNumber(row.drift_locked),
            reconciled: this.fromSqlBool(row.reconciled),
            timestamp: this.fromSqlDate(row.timestamp),
        };
    }
}
