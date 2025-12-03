/**
 * ========================================
 * CENTRALIZED INVENTORY ROUTES
 * ========================================
 *
 * Comprehensive tool inventory management system
 * Handles tool lifecycle from creation to disposal
 *
 * Route Categories:
 * - Tool CRUD Operations (create, read, update)
 * - Inventory Summary & Analytics
 * - Change History & Audit Trail
 * - Maintenance History Tracking
 * - Tool Health Monitoring
 * - Tool Logs (Engineering logbook for tools)
 * - Popular Issues Tracking
 * - Machine Stoppage Analytics
 *
 * Access Levels:
 * - BusinessAdmin: Full access to all operations
 * - UnitAdmin/UnitAdmin: Can modify tools in their factories
 * - User: Read-only access to inventory data
 *
 * Features:
 * - Automatic maintenance tracking (regrinding/resegmentation)
 * - Change history with database triggers
 * - Tool format-based filtering
 * - File attachments for tool logs
 * - Popular issues aggregation
 */
const express = require('express');
const router = express.Router();
const { getAllInventoryTools, getInventorySummary, getInventoryToolById, updateInventoryTool, deleteInventoryTool, createInventoryTool, createHistoricalTools, getInventoryHistory, getToolMaintenanceHistory, deleteMaintenanceHistory, getDistinctFormats, getToolsByFormat, getLastMaintenanceEvent, createToolLog, getToolLogs, getPopularIssues, addPopularIssue, getMachineStoppageAnalytics, getToolMachineStoppageAnalytics } = require('../controllers/inventoryController');
const upload = require('../middleware/uploadMiddleware');
const authMiddleware = require('../middleware/authMiddleware');
const authorize = require('../middleware/authorise');
// ========================================
// INVENTORY SUMMARY & OVERVIEW
// ========================================
/**
 * Get Inventory Summary Statistics
 *
 * GET /api/inventory/summary
 * - Aggregate counts by factory and status
 * - Used for dashboard widgets
 */
router.get('/summary', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getInventorySummary);
/**
 * Get Distinct Tool Formats
 *
 * GET /api/inventory/formats
 * - Returns unique format values
 * - Used for format filter dropdown
 */
router.get('/formats', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getDistinctFormats);
/**
 * Get Distinct Manufacturers
 *
 * GET /api/inventory/manufacturers
 * - Returns unique manufacturer values from inventory
 */
router.get('/manufacturers', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), 
// controller function added in inventoryController
require('../controllers/inventoryController').getDistinctManufacturers);
// ========================================
// TOOL CRUD OPERATIONS
// ========================================
/**
 * List and Create Tools
 *
 * GET /api/inventory/tools
 * - Paginated tool list with filtering
 * - Supports search, factory, status, type filters
 * - All authenticated users can view
 *
 * POST /api/inventory/tools
 * - Create single tool in inventory
 * - UnitAdmin/BusinessAdmin only
 * - Auto-registers in tools table via trigger
 */
router.route('/tools')
    .get(authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getAllInventoryTools)
    .post(authMiddleware, authorize('BusinessAdmin', 'UnitAdmin'), createInventoryTool);
/**
 * Import Historical Tools with Lifecycle Data
 *
 * POST /api/inventory/tools/import-historical
 * - Bulk import tools with maintenance history
 * - Accepts array of tools with lifecycle_events
 * - Creates maintenance records and daily summaries
 * - UnitAdmin/BusinessAdmin only
 */
router.post('/tools/import-historical', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin'), createHistoricalTools);
/**
 * Single Tool Operations
 *
 * GET /api/inventory/tools/:inventoryId
 * - Get complete tool details
 * - Includes factory name via JOIN
 *
 * PUT /api/inventory/tools/:inventoryId
 * - Update tool properties
 * - Auto-detects maintenance events
 * - Creates maintenance history records
 * - BusinessAdmin/UnitAdmin can edit tools in their factory
 *
 * DELETE /api/inventory/tools/:inventoryId
 * - Soft delete tool (marks as deleted)
 * - BusinessAdmin/UnitAdmin can delete tools in their factory
 */
router.route('/tools/:inventoryId')
    .get(authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getInventoryToolById)
    .put(authMiddleware, authorize('BusinessAdmin', 'UnitAdmin'), updateInventoryTool)
    .delete(authMiddleware, authorize('BusinessAdmin', 'UnitAdmin'), deleteInventoryTool);
// ========================================
// CHANGE HISTORY & AUDIT TRAIL
// ========================================
/**
 * Get Tool Change History
 *
 * GET /api/inventory/tools/:inventoryId/history
 * - Returns complete audit trail
 * - Includes field changes, timestamps, who made changes
 * - Links to maintenance history records
 * - Factory IDs converted to readable names
 */
router.get('/tools/:inventoryId/history', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getInventoryHistory);
// ========================================
// MAINTENANCE HISTORY TRACKING
// ========================================
/**
 * Get Tool Maintenance History
 *
 * GET /api/inventory/tools/:toolId/maintenance-history
 * - Returns regrinding and resegmentation events
 * - Ordered chronologically with sequence numbers
 * - Includes tool life at each event
 */
router.get('/tools/:toolId/maintenance-history', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getToolMaintenanceHistory);
/**
 * Get Last Maintenance Event
 *
 * GET /api/inventory/last-maintenance/:toolId
 * - Returns most recent event of specific type
 * - Query param: eventType (regrinding/resegmentation)
 * - Used for determining next action
 */
router.get('/last-maintenance/:toolId', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin'), getLastMaintenanceEvent);
/**
 * Delete Maintenance History Record
 *
 * DELETE /api/inventory/maintenance-history/:historyId
 * - Hard deletes maintenance record
 * - Decrements count in centralized_inventory
 * - May revert status if count becomes 0
 * - UnitAdmin/UnitAdmin only
 */
router.delete('/maintenance-history/:historyId', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin'), deleteMaintenanceHistory);
// ========================================
// TOOL HEALTH MONITORING
// ========================================
/**
 * Get Tools by Format (Tool Health Page)
 *
 * GET /api/inventory/tool-health
 * - Returns all tools with specified format
 * - Query param: format
 * - Includes complete maintenance history JSON
 * - Used for tool health dashboard
 */
router.get('/tool-health', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getToolsByFormat);
// ========================================
// TOOL LOGS (ENGINEERING LOGBOOK)
// ========================================
/**
 * Tool Log Operations
 *
 * POST /api/inventory/tool-logs
 * - Create engineering tool log entry
 * - Supports multiple file attachments (up to 10)
 * - Required: tool_name, date_time_of_event
 * - Optional: popular_issue_id, machine_stoppage, etc.
 *
 * GET /api/inventory/tool-logs
 * - List tool logs with filtering
 * - Paginated results
 * - Filters: factory, tool_name, material_id, batch_id, searchCategory
 */
router.route('/tool-logs')
    .post(authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), upload.array('attachments', 10), createToolLog)
    .get(authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getToolLogs);
// ========================================
// POPULAR ISSUES TRACKING
// ========================================
/**
 * Popular Issues Management
 *
 * GET /api/inventory/popular-issues
 * - Returns frequently occurring issues with counts
 * - Can filter by tool_name, material_id, batch_id
 * - Used for issue selection dropdown
 *
 * POST /api/inventory/popular-issues
 * - Add new popular issue
 * - Requires: issue_text
 * - Unique constraint prevents duplicates
 */
router.route('/popular-issues')
    .get(authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getPopularIssues)
    .post(authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), addPopularIssue);
// ========================================
// MACHINE STOPPAGE ANALYTICS
// ========================================
/**
 * Machine Stoppage Analytics (Factory-wide)
 *
 * GET /api/inventory/machine-stoppage-analytics
 * - Overall stoppage statistics for user's factory
 * - Top 10 tools by stoppage count
 * - Aggregate metrics: total, average, max
 */
router.get('/machine-stoppage-analytics', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getMachineStoppageAnalytics);
/**
 * Tool-Specific Machine Stoppage Analytics
 *
 * GET /api/inventory/tool-machine-stoppage-analytics
 * - Stoppage data for specific tool
 * - Query params: tool_name, material_id, batch_id
 * - Includes trend data by date/shift
 */
router.get('/tool-machine-stoppage-analytics', authMiddleware, authorize('BusinessAdmin', 'UnitAdmin', 'User'), getToolMachineStoppageAnalytics);
module.exports = router;
