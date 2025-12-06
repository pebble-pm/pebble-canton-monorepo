/**
 * Projections module - Off-chain state projections from Canton events
 */

// Base class
export { BaseProjectionService } from "./base.projection";

// Balance projection
export {
    BalanceProjectionService,
    type AccountProjection,
} from "./balance.projection";

// Position projection
export {
    PositionProjectionService,
    type PositionProjection,
    type PositionSide,
} from "./position.projection";

// Market projection
export {
    MarketProjectionService,
    type MarketProjection,
    type MarketStatus,
} from "./market.projection";
