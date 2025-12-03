/**
 * ========================================
 * TOOL HISTORY ROUTES
 * ========================================
 *
 * Provides access to tool lifecycle tracking and analytics.
 * Focuses on historical tool performance and usage patterns.
 *
 * Route Categories:
 *  - Tool Search (material/batch hierarchy)
 *  - Tool Details (comprehensive tool information)
 *  - Chart Data (daily metrics and cumulative tracking)
 *  - Analytics (machine usage, factory usage, trends)
 *
 * Note: Authentication currently commented out for testing.
 * TODO: Enable authMiddleware and authorise before production.
 *
 * Access: Should be User, UnitAdmin, or BusinessAdmin when enabled.
 *
 * Contract:
 *  - Inputs: Express req (params, query, body) depending on route. Typical params: materialId, batchId, toolId.
 *  - Outputs: JSON responses via res.json({ ... }) or res.status(code).json({ error }).
 *  - Error modes: returns 4xx for client errors (bad params), 5xx for server/DB errors. Handled by controllers and global error handler.
 *  - Side-effects: Reads from database; no direct file or external network writes. Authentication/authorization gated when enabled.
 */
const express = require('express');
const router = express.Router();
const toolHistoryController = require('../controllers/toolHistoryController');
// const authMiddleware = require('../middleware/authMiddleware');
// const authorise = require('../middleware/authorise');
// ========================================
// TOOL SEARCH & SELECTION ROUTES
// ========================================
/**
 * Get Material IDs
 *
 * GET /api/tool-history/materials
 * - Returns distinct material IDs with tool counts
 * - Used for first-level search dropdown
 * - Ordered by material_id for easy selection
 */
router.get('/materials', 
// authMiddleware,
// authorise('BusinessAdmin', 'UnitAdmin', 'User'),
toolHistoryController.getMaterials);
/**
 * Get Batches for Material
 *
 * GET /api/tool-history/batches/:materialId
 * - Returns batch IDs for selected material
 * - Used for second-level search dropdown
 * - Filters tools by material_id
 */
router.get('/batches/:materialId', 
// authMiddleware,
// authorise('BusinessAdmin', 'UnitAdmin', 'User'),
toolHistoryController.getBatches);
// ========================================
// TOOL DETAILS ROUTE
// ========================================
/**
 * Get Complete Tool Details
 *
 * GET /api/tool-history/tool/:materialId/:batchId
 * - Returns comprehensive tool information
 * - Includes: basic info, current status, metrics, history
 * - Used after material/batch selection
 */
router.get('/tool/:materialId/:batchId', 
// authMiddleware,
// authorise('BusinessAdmin', 'UnitAdmin', 'User'),
toolHistoryController.getToolDetails);
// ========================================
// CHART DATA ROUTES
// ========================================
/**
 * Get Chart Data
 *
 * GET /api/tool-history/chart-data/:toolId
 * - Returns daily and cumulative metrics for visualization
 * - Includes: HLP count, TS revolutions, tool life trends
 * - Optimized for chart rendering
 */
router.get('/chart-data/:toolId', 
// authMiddleware,
// authorise('BusinessAdmin', 'UnitAdmin', 'User'),
toolHistoryController.getChartData);
/**
 * Get Daily Summary
 *
 * GET /api/tool-history/daily-summary/:toolId
 * - Daily aggregated data for analytics
 * - Supports date range and machine filtering
 * - Query params: startDate, endDate, machineId (optional)
 */
router.get('/daily-summary/:toolId', 
// authMiddleware,
// authorise('BusinessAdmin', 'UnitAdmin', 'User'),
toolHistoryController.getDailySummary);
// ========================================
// ANALYTICS ROUTES
// ========================================
/**
 * Get Machine Usage Analytics
 *
 * GET /api/tool-history/machine-usage/:toolId
 * - Shows which machines used the tool
 * - Includes usage duration and metrics per machine
 * - Helps identify machine-specific performance patterns
 */
router.get('/machine-usage/:toolId', 
// authMiddleware,
// authorise('BusinessAdmin', 'UnitAdmin', 'User'),
toolHistoryController.getMachineUsage);
/**
 * Get Factory Usage Analytics
 *
 * GET /api/tool-history/factory-usage/:toolId
 * - Shows tool movement between factories
 * - Tracks tool lifecycle across locations
 * - Useful for tool allocation planning
 */
router.get('/factory-usage/:toolId', 
// authMiddleware,
// authorise('BusinessAdmin', 'UnitAdmin', 'User'),
toolHistoryController.getFactoryUsage);
module.exports = router;
