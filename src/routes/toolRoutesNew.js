/**
 * ========================================
 * TOOL HEALTH PAGE ROUTES
 * ========================================
 *
 * Provides real-time tool monitoring and historical data export
 * Powers the Tool Health page in frontend
 *
 * Route Categories:
 * - Active Machine Detection (which tools are currently running)
 * - Intraday Monitoring (hourly data for last 24 hours)
 * - Cumulative Tracking (daily aggregates over date range)
 * - Data Export (complete history for Excel/analysis)
 *
 * Tool Identification:
 * - Uses drive_status table to find active tools
 * - Supports multi-factory viewing
 * - Handles both specific machine and "all factories" mode
 *
 * Note: No authentication middleware currently applied
 * TODO: Add authMiddleware before production deployment
 */
const express = require('express');
const router = express.Router();
// Import all controller functions
const { getActiveMachinesByType, getToolChartData, getCumulativeChartData, getCompleteToolHistory } = require('../controllers/toolControllerNew');
/**
 * Contract:
 * - Inputs: HTTP requests with query params and path params (machineId, toolType, startDate, endDate)
 * - Outputs: JSON payloads for active machines, intraday and cumulative chart data, and export CSVs
 * - Side-effects: none (routes delegate to controllers which read DB); file uploads handled by multer
 * - Error modes: validation errors -> 400, auth errors -> 401/403, DB/controller errors -> 500
 */
// ========================================
// ACTIVE TOOL DETECTION
// ========================================
/**
 * Get Active Machines by Tool Type
 *
 * GET /api/new-tools/active-machines-by-type
 * - Returns machines with currently active tools
 * - Filters by tool type (cutting, creasing, embossing)
 * - Query params: toolType, factoryId (optional - omit for all factories)
 *
 * Use Case:
 * - Populate machine selection dropdown
 * - Show which machines have tools in drive
 */
router.get('/active-machines-by-type', getActiveMachinesByType);
// ========================================
// REAL-TIME MONITORING
// ========================================
/**
 * Get Intraday Tool Chart Data
 *
 * GET /api/new-tools/chart-data
 * - Returns hourly data for last 24 hours
 * - Query params: machineId, toolType
 * - Data: HLP count, TS revolutions per hour
 *
 * Use Case:
 * - Real-time monitoring charts
 * - Current shift performance
 * - Immediate trend detection
 */
router.get('/chart-data', getToolChartData);
// ========================================
// HISTORICAL TRACKING
// ========================================
/**
 * Get Cumulative Chart Data
 *
 * GET /api/new-tools/cumulative-chart-data
 * - Returns daily aggregated data
 * - Query params: machineId, toolType, startDate, endDate
 * - Data: Daily totals for HLP and TS revolutions
 *
 * Use Case:
 * - Long-term trend analysis
 * - Performance over weeks/months
 * - Comparison between time periods
 */
router.get('/cumulative-chart-data', getCumulativeChartData);
// ========================================
// DATA EXPORT
// ========================================
/**
 * Get Complete Tool History for Export
 *
 * GET /api/new-tools/complete-history
 * - Returns ALL historical data for active tool
 * - Query params: machineId, toolType
 * - Includes: raw data, tool life, maintenance events, statistics
 *
 * Use Case:
 * - Excel export functionality
 * - Detailed performance reports
 * - Maintenance planning
 * - Tool life prediction modeling
 *
 * Warning: May return large datasets (thousands of records)
 */
router.get('/complete-history', getCompleteToolHistory);
module.exports = router;
