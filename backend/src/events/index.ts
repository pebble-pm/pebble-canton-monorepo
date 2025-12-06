/**
 * Events module - Ledger event processing for Canton blockchain synchronization
 */

// Types and configuration
export {
    type EventProcessorConfig,
    type EventProcessorStatus,
    type ParsedTemplateId,
    DEFAULT_EVENT_PROCESSOR_CONFIG,
    parseTemplateId,
} from "./types";

// Event processor (exported after implementation)
export { LedgerEventProcessor } from "./processor";
