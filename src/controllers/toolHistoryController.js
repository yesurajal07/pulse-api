/**
 * ========================================
 * TOOL HISTORY CONTROLLER
 * ========================================
 *
 * Manages tool lifecycle tracking and historical data retrieval
 *
 * Purpose:
 * - Track complete tool lifecycle from manufacturing to disposal
 * - Provide analytics for tool usage across machines and factories
 * - Generate chart data for tool performance visualization
 * - Support material and batch-based tool search
 *
 * Key Features:
 * - Material ID and batch ID based tool discovery
 * - Daily summary data with cumulative tracking
 * - Machine usage analytics with percentages
 * - Factory usage distribution
 * - Chart data for visualization (HLP, revolutions)
 *
 * Database Tables Used:
 * - centralized_inventory: Main tool records
 * - daily_tool_summary: Daily aggregated metrics
 * - tool_machine_map: Tool-machine assignment history
 * - machines: Machine details
 * - factories: Factory information
 */
const db = require('../config/db');
/**
 * Contract:
 * - Inputs: Express request object with query/path params for tool selection (materialId, batchId, toolId, date range, machine filters)
 * - Outputs: JSON payloads containing lists, chart data, analytics summaries, or 4xx/5xx errors
 * - Side-effects: Reads from multiple DB tables (no direct writes except for analytic triggers)
 * - Error modes: Database errors -> 500; invalid params -> 400
 */
// ========================================
// TOOL SEARCH & DISCOVERY
// ========================================
/**
 * Get All Unique Material IDs
 *
 * Returns list of all material IDs in inventory with tool count
 * Used for first-level search dropdown in Tool History page
 *
 * @route   GET /api/tool-history/materials
 * @access  Private
 * @returns {array} List of {material_id, tool_count} objects
 */
exports.getMaterials = async (req, res) => {
    try {
        console.log('Fetching materials...');
        /**
         * Query aggregates tools by material_id
         * COUNT gives number of tools per material type
         * Useful for showing popular material types
         */
        const query = `
            SELECT DISTINCT material_id, COUNT(*) as tool_count
            FROM centralized_inventory 
            WHERE material_id IS NOT NULL
            GROUP BY material_id
            ORDER BY material_id;
        `;
        const { rows } = await db.query(query);
        console.log(`Found ${rows.length} materials`);
        // Return empty array instead of error if no materials found
        if (!rows || rows.length === 0) {
            return res.status(200).json([]);
        }
        res.status(200).json(rows);
    }
    catch (err) {
        console.error('Error fetching materials:', err.message, err.stack);
        res.status(500).json({
            error: 'Failed to fetch materials',
            message: err.message,
            success: false
        });
    }
};
/**
 * Get All Batch IDs for Specific Material
 *
 * Second-level search after material selection
 * Returns all batch IDs for chosen material with tool details
 *
 * @route   GET /api/tool-history/materials/:materialId/batches
 * @access  Private
 * @param   {string} materialId - Material ID to filter batches
 * @returns {array} List of {batch_id, tool_name, inventory_id} objects
 */
exports.getBatches = async (req, res) => {
    const { materialId } = req.params;
    // Validate material ID parameter
    if (!materialId) {
        return res.status(400).json({
            error: 'Material ID is required',
            success: false
        });
    }
    try {
        console.log(`Fetching batches for material: ${materialId}`);
        /**
         * Get distinct batch IDs for the material
         * Include tool_name and inventory_id for display purposes
         */
        const query = `
            SELECT DISTINCT batch_id, tool_name, inventory_id
            FROM centralized_inventory 
            WHERE material_id = $1
            ORDER BY batch_id;
        `;
        const { rows } = await db.query(query, [materialId]);
        console.log(`Found ${rows.length} batches for material ${materialId}`);
        if (!rows || rows.length === 0) {
            return res.status(200).json([]);
        }
        res.status(200).json(rows);
    }
    catch (err) {
        console.error(`Error fetching batches for material ${materialId}:`, err.message, err.stack);
        res.status(500).json({
            error: 'Failed to fetch batches',
            message: err.message,
            success: false
        });
    }
};
/**
 * Get Complete Tool Details by Material and Batch
 *
 * Final step in tool search - returns full tool information
 * Includes all lifecycle data, current status, factory details
 *
 * @route   GET /api/tool-history/materials/:materialId/batches/:batchId/details
 * @access  Private
 * @param   {string} materialId - Material ID
 * @param   {string} batchId - Batch ID
 * @returns {object} Complete tool details with factory name
 */
exports.getToolDetails = async (req, res) => {
    const { materialId, batchId } = req.params;
    // Validate both parameters required
    if (!materialId || !batchId) {
        return res.status(400).json({
            error: 'Both Material ID and Batch ID are required',
            success: false
        });
    }
    try {
        console.log(`Fetching tool details for material: ${materialId}, batch: ${batchId}`);
        /**
         * Join with factories table to get current factory name
         * Returns complete tool record with all lifecycle events
         */
        const query = `
            SELECT 
                ci.*,
                f.name as factory_name
            FROM centralized_inventory ci
            LEFT JOIN factories f ON ci.current_factory_id = f.factory_id
            WHERE ci.material_id = $1 AND ci.batch_id = $2;
        `;
        const { rows } = await db.query(query, [materialId, batchId]);
        if (rows.length === 0) {
            console.log(`No tool found for material: ${materialId}, batch: ${batchId}`);
            return res.status(404).json({
                error: 'Tool not found',
                message: `No tool found for material ID ${materialId} and batch ID ${batchId}`,
                success: false
            });
        }
        console.log(`Found tool details for material: ${materialId}, batch: ${batchId}`);
        res.status(200).json(rows[0]);
    }
    catch (err) {
        console.error(`Error fetching tool details for material ${materialId}, batch ${batchId}:`, err.message, err.stack);
        res.status(500).json({
            error: 'Failed to fetch tool details',
            message: err.message,
            success: false
        });
    }
};
// ========================================
// CHART DATA & ANALYTICS
// ========================================
/**
 * Get Chart Data for Tool Visualization
 *
 * Provides time-series data for charting tool performance
 * Includes daily and cumulative metrics for comprehensive analysis
 *
 * Data Processing:
 * - Fetches daily summary records ordered by date
 * - Calculates cumulative totals as data accumulates
 * - Computes average HLP per revolution for efficiency tracking
 *
 * Chart Types Supported:
 * - Daily revolutions (bar chart)
 * - Daily HLP (bar chart)
 * - Cumulative revolutions (line chart)
 * - Cumulative HLP (line chart)
 * - Efficiency trend (average HLP/revolution)
 *
 * @route   GET /api/tool-history/:toolId/chart-data
 * @access  Private
 * @param   {number} toolId - Tool ID (inventory_id)
 * @returns {object} Chart data with processed daily and cumulative values
 */
exports.getChartData = async (req, res) => {
    const { toolId } = req.params;
    if (!toolId) {
        return res.status(400).json({
            error: 'Tool ID is required',
            success: false
        });
    }
    try {
        console.log(`Fetching chart data for tool: ${toolId}`);
        // ========================================
        // FETCH DAILY SUMMARY DATA
        // ========================================
        /**
         * Get daily metrics from daily_tool_summary table
         * Database trigger automatically populates this table
         * Ordered by date for chronological processing
         */
        const dailyDataQuery = `
            SELECT 
                summary_date as date,
                total_ts_revolutions,
                total_hlp_run,
                ROUND(total_hlp_run / NULLIF(total_ts_revolutions, 0), 4) as average_hlp_per_revolution
            FROM daily_tool_summary 
            WHERE tool_id = $1
            ORDER BY summary_date ASC;
        `;
        const { rows: dailyData } = await db.query(dailyDataQuery, [toolId]);
        // ========================================
        // CALCULATE CUMULATIVE VALUES
        // ========================================
        /**
         * Process daily data to calculate cumulative totals
         * Cumulative values show total tool usage over lifetime
         * Useful for comparing against tool life limits
         */
        let cumulativeRevolutions = 0;
        let cumulativeHlp = 0;
        const processedData = dailyData.map(row => {
            // Add today's values to cumulative totals
            cumulativeRevolutions += parseFloat(row.total_ts_revolutions || 0);
            cumulativeHlp += parseFloat(row.total_hlp_run || 0);
            return {
                date: row.date,
                // Daily values (for bar charts)
                daily_revolutions: parseFloat(row.total_ts_revolutions || 0),
                daily_hlp: parseFloat(row.total_hlp_run || 0),
                // Cumulative values (for line charts)
                cumulative_revolutions: cumulativeRevolutions,
                cumulative_hlp: cumulativeHlp,
                // Efficiency metric
                average_hlp_per_revolution: parseFloat(row.average_hlp_per_revolution || 0)
            };
        });
        // ========================================
        // CALCULATE SUMMARY STATISTICS
        // ========================================
        console.log(`Chart data fetched successfully for tool ${toolId}: ${processedData.length} data points`);
        res.status(200).json({
            toolId: toolId,
            chartData: processedData,
            summary: {
                totalRevolutions: cumulativeRevolutions,
                totalHlp: cumulativeHlp,
                totalDays: dailyData.length,
                averageDaily: dailyData.length > 0 ? cumulativeRevolutions / dailyData.length : 0
            }
        });
    }
    catch (err) {
        console.error(`Error fetching chart data for tool ${toolId}:`, err.message, err.stack);
        res.status(500).json({
            error: 'Failed to fetch chart data',
            message: err.message,
            success: false
        });
    }
};
// Get machine usage analytics for a specific tool
exports.getMachineUsage = async (req, res) => {
    const { toolId } = req.params;
    try {
        const query = `
            SELECT 
                m.machine_name,
                f.name as factory_name,
                COUNT(tmm.map_id) as usage_sessions,
                ROUND(SUM(tmm.duration_hours)::numeric, 2) as total_hours,
                MIN(tmm.assigned_at) as first_used,
                MAX(tmm.removed_at) as last_used
            FROM tool_machine_map tmm
            JOIN machines m ON tmm.machine_id = m.machine_id
            JOIN factories f ON tmm.factory_id = f.factory_id
            WHERE tmm.tool_id = $1
            GROUP BY m.machine_name, f.name, m.machine_id
            ORDER BY total_hours DESC;
        `;
        const { rows } = await db.query(query, [toolId]);
        // Calculate totals for percentages
        const totalHours = rows.reduce((sum, row) => sum + parseFloat(row.total_hours || 0), 0);
        const totalSessions = rows.reduce((sum, row) => sum + parseInt(row.usage_sessions || 0), 0);
        const processedData = rows.map(row => ({
            ...row,
            percentage_hours: totalHours > 0 ? ((parseFloat(row.total_hours) / totalHours) * 100).toFixed(1) : 0,
            percentage_sessions: totalSessions > 0 ? ((parseInt(row.usage_sessions) / totalSessions) * 100).toFixed(1) : 0
        }));
        res.status(200).json({
            machineUsage: processedData,
            summary: {
                totalMachines: rows.length,
                totalHours: totalHours,
                totalSessions: totalSessions
            }
        });
    }
    catch (err) {
        console.error(`Error fetching machine usage for tool ${toolId}:`, err.message);
        res.status(500).send('Server Error');
    }
};
// Get factory usage analytics for a specific tool
exports.getFactoryUsage = async (req, res) => {
    const { toolId } = req.params;
    try {
        const query = `
            SELECT 
                f.name as factory_name,
                COUNT(DISTINCT tmm.machine_id) as machines_used,
                COUNT(tmm.map_id) as total_sessions,
                ROUND(SUM(tmm.duration_hours)::numeric, 2) as total_hours,
                MIN(tmm.assigned_at) as first_used,
                MAX(tmm.removed_at) as last_used
            FROM tool_machine_map tmm
            JOIN factories f ON tmm.factory_id = f.factory_id
            WHERE tmm.tool_id = $1
            GROUP BY f.name, f.factory_id
            ORDER BY total_hours DESC;
        `;
        const { rows } = await db.query(query, [toolId]);
        // Calculate totals for percentages
        const totalHours = rows.reduce((sum, row) => sum + parseFloat(row.total_hours || 0), 0);
        const totalSessions = rows.reduce((sum, row) => sum + parseInt(row.total_sessions || 0), 0);
        const processedData = rows.map(row => ({
            ...row,
            percentage_hours: totalHours > 0 ? ((parseFloat(row.total_hours) / totalHours) * 100).toFixed(1) : 0,
            percentage_sessions: totalSessions > 0 ? ((parseInt(row.total_sessions) / totalSessions) * 100).toFixed(1) : 0
        }));
        res.status(200).json({
            factoryUsage: processedData,
            summary: {
                totalFactories: rows.length,
                totalHours: totalHours,
                totalSessions: totalSessions,
                totalMachines: rows.reduce((sum, row) => sum + parseInt(row.machines_used || 0), 0)
            }
        });
    }
    catch (err) {
        console.error(`Error fetching factory usage for tool ${toolId}:`, err.message);
        res.status(500).send('Server Error');
    }
};
// Get daily summary data for analytics chart
exports.getDailySummary = async (req, res) => {
    const { toolId } = req.params;
    const { startDate, endDate, machineId } = req.query;
    if (!toolId) {
        return res.status(400).json({
            error: 'Tool ID is required',
            success: false
        });
    }
    try {
        console.log(`Fetching daily summary for tool: ${toolId}, startDate: ${startDate}, endDate: ${endDate}, machineId: ${machineId}`);
        let query = `
            SELECT 
                dts.summary_date as date,
                dts.total_hlp_run,
                dts.total_ts_revolutions,
                dts.machine_id,
                m.machine_name,
                f.name as factory_name
            FROM daily_tool_summary dts
            JOIN machines m ON dts.machine_id = m.machine_id
            JOIN factories f ON m.factory_id = f.factory_id
            WHERE dts.tool_id = $1
        `;
        const queryParams = [toolId];
        let paramIndex = 2;
        // Add date filtering if provided
        if (startDate) {
            query += ` AND dts.summary_date >= $${paramIndex}`;
            queryParams.push(startDate);
            paramIndex++;
        }
        if (endDate) {
            query += ` AND dts.summary_date <= $${paramIndex}`;
            queryParams.push(endDate);
            paramIndex++;
        }
        // Add machine filtering if provided
        if (machineId && machineId !== 'all') {
            query += ` AND dts.machine_id = $${paramIndex}`;
            queryParams.push(machineId);
            paramIndex++;
        }
        query += ` ORDER BY dts.summary_date ASC, dts.machine_id ASC;`;
        const { rows } = await db.query(query, queryParams);
        // Get unique machines for filtering options
        const machinesQuery = `
            SELECT DISTINCT 
                dts.machine_id,
                m.machine_name,
                f.name as factory_name
            FROM daily_tool_summary dts
            JOIN machines m ON dts.machine_id = m.machine_id
            JOIN factories f ON m.factory_id = f.factory_id
            WHERE dts.tool_id = $1
            ORDER BY m.machine_name ASC;
        `;
        const { rows: machines } = await db.query(machinesQuery, [toolId]);
        // Group data by date if multiple machines per day
        const groupedData = {};
        rows.forEach(row => {
            // Use the date directly without timezone conversion
            let dateKey;
            if (row.date instanceof Date) {
                // Extract date in YYYY-MM-DD format without timezone conversion
                const year = row.date.getFullYear();
                const month = String(row.date.getMonth() + 1).padStart(2, '0');
                const day = String(row.date.getDate()).padStart(2, '0');
                dateKey = `${year}-${month}-${day}`;
            }
            else {
                // If it's already a string, use it as-is
                dateKey = row.date.toString().split('T')[0];
            }
            if (!groupedData[dateKey]) {
                groupedData[dateKey] = {
                    date: dateKey,
                    total_hlp_run: 0,
                    total_ts_revolutions: 0,
                    machines: []
                };
            }
            groupedData[dateKey].total_hlp_run += parseFloat(row.total_hlp_run || 0);
            groupedData[dateKey].total_ts_revolutions += parseFloat(row.total_ts_revolutions || 0);
            groupedData[dateKey].machines.push({
                machine_id: row.machine_id,
                machine_name: row.machine_name,
                factory_name: row.factory_name,
                hlp_run: parseFloat(row.total_hlp_run || 0),
                ts_revolutions: parseFloat(row.total_ts_revolutions || 0)
            });
        });
        const dailyData = Object.values(groupedData);
        console.log(`Daily summary fetched successfully for tool ${toolId}: ${dailyData.length} data points`);
        res.status(200).json({
            toolId: toolId,
            dailyData: dailyData,
            machines: machines,
            summary: {
                totalDays: dailyData.length,
                totalHlp: dailyData.reduce((sum, day) => sum + day.total_hlp_run, 0),
                totalRevolutions: dailyData.reduce((sum, day) => sum + day.total_ts_revolutions, 0),
                dateRange: {
                    start: dailyData.length > 0 ? dailyData[0].date : null,
                    end: dailyData.length > 0 ? dailyData[dailyData.length - 1].date : null
                }
            }
        });
    }
    catch (err) {
        console.error(`Error fetching daily summary for tool ${toolId}:`, err.message, err.stack);
        res.status(500).json({
            error: 'Failed to fetch daily summary',
            message: err.message,
            success: false
        });
    }
};
