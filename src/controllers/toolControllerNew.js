/**
 * ========================================
 * TOOL CONTROLLER (NEW)
 * ========================================
 *
 * Manages Tool Health Page and Logbook functionalities
 *
 * Purpose:
 * - Retrieve active tools currently in machine drives
 * - Provide intraday chart data (hourly HLP and TS revolutions)
 * - Provide cumulative chart data (daily aggregates over date range)
 * - Export complete tool history data
 * - Track popular issues from logbook entries
 *
 * Key Features:
 * - Real-time active tool detection per machine
 * - Multi-factory support (single factory or "all factories" view)
 * - Hourly data aggregation for intraday analysis
 * - Daily summary data for cumulative tracking
 * - Popular issues analytics from engineering logs
 *
 * Database Tables Used:
 * - tools: Tool master data (tool_id, tool_name, tool_type)
 * - drive_status: Tool status tracking (in_drive, removed, etc.)
 * - hlp_raw: Hourly HLP (High Load Power) and revolution data
 * - daily_tool_summary: Daily aggregated metrics
 * - machines: Machine information
 * - factories: Factory/plant information
 * - engineering_logs: Logbook entries with issues
 * - popular_issues: Aggregated issue frequency data
 *
 * Tool Status Logic:
 * - "in_drive": Tool currently active in machine
 * - "removed": Tool removed from machine
 * - Latest status per tool determines current state
 */
const db = require('../config/db');
/**
 * Contract:
 * - Inputs: request params/query including machineId, toolType, startDate, endDate
 * - Outputs: intraday and cumulative chart data, active machine lists, and CSV/export payloads
 * - Side-effects: reads daily summary and raw HLP tables; no direct DB writes
 * - Error modes: malformed params -> 400, DB failures -> 500
 */
// ========================================
// ACTIVE MACHINE RETRIEVAL
// ========================================
/**
 * Get Active Machines by Tool Type
 *
 * Returns machines that currently have an active tool of specified type
 * Supports both single factory and multi-factory ("all") queries
 *
 * Logic:
 * 1. Find latest status for each tool using DISTINCT ON
 * 2. Filter for tools with status = 'in_drive'
 * 3. Join with tools table to match tool type
 * 4. Join with machines and factories for display info
 * 5. Return unique machines (one tool type per machine)
 *
 * Use Cases:
 * - Machine selector dropdown in Tool Health page
 * - Identifying which machines have specific tool types active
 * - Cross-factory tool deployment analysis
 *
 * @route   GET /api/new-tools/active-machines
 * @access  Private
 * @query   {string|number} factoryId - Factory ID or 'all' for all factories
 * @query   {string} toolType - Tool type to filter (e.g., 'Drill', 'Mill')
 * @returns {array} List of machines with active tools of specified type
 */
const getActiveMachinesByType = async (req, res) => {
    const { factoryId, toolType } = req.query;
    // Validate required parameters
    if (!factoryId || !toolType) {
        return res.status(400).json({
            message: 'Factory ID and Tool Type are required.'
        });
    }
    let sqlQuery;
    let queryParams;
    // ========================================
    // BUILD QUERY BASED ON FACTORY SCOPE
    // ========================================
    if (factoryId === 'all') {
        /**
         * ALL FACTORIES QUERY
         *
         * Returns machines across all factories with active tools
         * Includes factory name for display/grouping
         * Sorted by factory name, then machine name
         *
         * CTE (Common Table Expression) Explanation:
         * - latest_tool_status: Gets most recent status per tool using DISTINCT ON
         * - Main query: Joins to filter only 'in_drive' status and matching tool type
         */
        sqlQuery = `
            WITH latest_tool_status AS (
                SELECT DISTINCT ON (tool_id) tool_id, status, machine_id 
                FROM public.drive_status 
                ORDER BY tool_id, timestamp DESC
            )
            SELECT DISTINCT 
                m.machine_id, 
                m.machine_name, 
                m.factory_id,
                f.name as factory_name
            FROM latest_tool_status lts
            JOIN public.tools AS t ON lts.tool_id = t.tool_id
            JOIN public.machines AS m ON lts.machine_id = m.machine_id
            LEFT JOIN public.factories AS f ON m.factory_id = f.factory_id
            WHERE lts.status = 'in_drive' AND UPPER(t.tool_type) = UPPER($1)
            ORDER BY f.name ASC, m.machine_name ASC;
        `;
        queryParams = [toolType];
    }
    else {
        /**
         * SINGLE FACTORY QUERY
         *
         * Returns machines in specific factory with active tools
         * Filtered by factory_id and tool_type
         * Sorted by machine name
         */
        sqlQuery = `
            WITH latest_tool_status AS (
                SELECT DISTINCT ON (tool_id) tool_id, status, machine_id 
                FROM public.drive_status 
                ORDER BY tool_id, timestamp DESC
            )
            SELECT DISTINCT 
                m.machine_id, 
                m.machine_name,
                m.factory_id,
                f.name as factory_name
            FROM latest_tool_status lts
            JOIN public.tools AS t ON lts.tool_id = t.tool_id
            JOIN public.machines AS m ON lts.machine_id = m.machine_id
            LEFT JOIN public.factories AS f ON m.factory_id = f.factory_id
            WHERE lts.status = 'in_drive' AND m.factory_id = $1 AND UPPER(t.tool_type) = UPPER($2)
            ORDER BY m.machine_name ASC;
        `;
        queryParams = [factoryId, toolType];
    }
    try {
        const { rows } = await db.query(sqlQuery, queryParams);
        res.status(200).json({ data: rows });
    }
    catch (error) {
        console.error('Error fetching active machines:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
// ========================================
// INTRADAY CHART DATA
// ========================================
/**
 * Get Intraday Tool Chart Data
 *
 * Returns hourly aggregated data for currently active tool on machine
 * Used for intraday performance visualization (24-hour view)
 *
 * Process:
 * 1. Identify currently active tool on specified machine
 * 2. Aggregate HLP and TS revolution data by hour
 * 3. Return hourly data points for chart rendering
 *
 * Time Range:
 * - Starts at 6:25 AM on specified date
 * - Covers 24-hour period from start time
 * - Aligns with typical factory shift schedules
 *
 * Data Aggregation:
 * - HLP (High Load Power) count summed per hour
 * - TS (Tool Spindle) revolutions summed per hour
 * - Hours with no data are not included (sparse data)
 *
 * Robust Tool Detection:
 * - Uses latest status on SPECIFIC machine only
 * - Prevents cross-machine tool confusion
 * - Handles cases where tool recently removed/replaced
 *
 * @route   GET /api/new-tools/chart-data
 * @access  Private
 * @query   {number} machineId - Machine ID
 * @query   {string} toolType - Tool type (e.g., 'Drill')
 * @query   {string} date - Date in YYYY-MM-DD format
 * @returns {object} {toolName, chartData: [{hour, hlp_count, ts_revolutions}]}
 */
const getToolChartData = async (req, res) => {
    const { machineId, toolType, date } = req.query;
    // Validate required parameters
    if (!machineId || !toolType || !date) {
        return res.status(400).json({
            message: 'Machine ID, Tool Type, and Date are required.'
        });
    }
    // ========================================
    // CALCULATE TIME RANGE
    // ========================================
    /**
     * Start time: 6:25 AM on specified date
     * End time: 24 hours later (6:24:59 AM next day)
     *
     * This aligns with factory shift schedules
     * Ensures full day of data is captured
     */
    const startDate = `${date} 06:25:00`;
    const endDate = new Date(new Date(startDate).getTime() + 24 * 60 * 60 * 1000 - 1);
    // ========================================
    // ROBUST TOOL IDENTIFICATION QUERY
    // ========================================
    /**
     * Three-Step CTE (Common Table Expression):
     *
     * Step 1: latest_status_on_machine
     * - Find most recent status for EVERY tool on THIS machine only
     * - Uses DISTINCT ON to get latest record per tool_id
     * - Scoped to specific machine to avoid cross-machine issues
     *
     * Step 2: target_tool
     * - From latest statuses, find tool that is:
     *   a) Currently 'in_drive' status
     *   b) Matches requested tool_type (case-insensitive)
     * - LIMIT 1 ensures only one tool returned
     *
     * Step 3: Main Query
     * - Aggregate hlp_raw data for identified tool
     * - Group by hour for intraday chart
     * - Filter by date range
     */
    const sqlQuery = `
        WITH latest_status_on_machine AS (
            SELECT DISTINCT ON (tool_id) tool_id, status
            FROM public.drive_status
            WHERE machine_id = $1
            ORDER BY tool_id, timestamp DESC
        ),
        target_tool AS (
            SELECT t.tool_id, t.tool_name
            FROM latest_status_on_machine lsom
            JOIN public.tools t ON lsom.tool_id = t.tool_id
            WHERE lsom.status = 'in_drive' AND UPPER(t.tool_type) = UPPER($2)
            LIMIT 1
        )
        SELECT
            EXTRACT(HOUR FROM hr.timestamp) AS hour,
            SUM(hr.hlp_count) AS total_hlp_count,
            SUM(hr.ts_revolutions) AS total_ts_revolutions,
            (SELECT tool_name FROM target_tool) AS tool_name
        FROM public.hlp_raw hr
        WHERE hr.tool_id = (SELECT tool_id FROM target_tool)
          AND hr.timestamp BETWEEN $3 AND $4
        GROUP BY hour
        ORDER BY hour ASC;
    `;
    try {
        const { rows } = await db.query(sqlQuery, [machineId, toolType, startDate, endDate]);
        // ========================================
        // HANDLE NO DATA SCENARIO
        // ========================================
        /**
         * If no hourly data found, still return tool name
         * Allows frontend to display tool name even without chart data
         * Useful when tool was installed but no operations performed yet
         */
        if (rows.length === 0) {
            const toolNameQuery = `
                WITH latest_status_on_machine AS (
                    SELECT DISTINCT ON (tool_id) tool_id, status 
                    FROM public.drive_status 
                    WHERE machine_id = $1 
                    ORDER BY tool_id, timestamp DESC
                ), 
                target_tool AS (
                    SELECT t.tool_name 
                    FROM latest_status_on_machine lsom 
                    JOIN public.tools t ON lsom.tool_id = t.tool_id 
                    WHERE lsom.status = 'in_drive' AND UPPER(t.tool_type) = UPPER($2) 
                    LIMIT 1
                ) 
                SELECT tool_name FROM target_tool;
            `;
            const toolNameResult = await db.query(toolNameQuery, [machineId, toolType]);
            const toolName = toolNameResult.rows.length > 0
                ? toolNameResult.rows[0].tool_name
                : 'Unknown Tool';
            return res.status(200).json({ toolName, chartData: [] });
        }
        // ========================================
        // FORMAT AND RETURN CHART DATA
        // ========================================
        /**
         * Extract tool name from first row (same for all rows)
         * Format chart data as array of hour objects
         * Convert strings to appropriate numeric types
         */
        const toolName = rows[0].tool_name;
        const chartData = rows.map(({ hour, total_hlp_count, total_ts_revolutions }) => ({
            hour: parseInt(hour),
            hlp_count: parseInt(total_hlp_count),
            ts_revolutions: parseFloat(total_ts_revolutions)
        }));
        res.status(200).json({ toolName, chartData });
    }
    catch (error) {
        console.error('Error fetching tool chart data:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
// ========================================
// CUMULATIVE CHART DATA
// ========================================
/**
 * Get Cumulative Tool Chart Data
 *
 * Returns daily aggregated data for currently active tool over date range
 * Used for cumulative performance tracking and trend analysis
 *
 * Process:
 * 1. Identify currently active tool on specified machine
 * 2. Retrieve daily summary data from daily_tool_summary table
 * 3. Return daily data points for specified date range
 *
 * Data Source:
 * - daily_tool_summary table (populated by database trigger)
 * - Pre-aggregated daily totals for performance
 * - Each day has sum of HLP and TS revolutions
 *
 * Use Cases:
 * - Cumulative tool wear tracking
 * - Long-term performance trends
 * - Comparison against tool life limits
 * - Historical analysis
 *
 * Robust Tool Detection:
 * - Same logic as intraday chart
 * - Scoped to specific machine
 * - Latest status determines current tool
 *
 * @route   GET /api/new-tools/cumulative-chart-data
 * @access  Private
 * @query   {number} machineId - Machine ID
 * @query   {string} toolType - Tool type
 * @query   {string} startDate - Start date (YYYY-MM-DD)
 * @query   {string} endDate - End date (YYYY-MM-DD)
 * @returns {object} {toolName, toolId, chartData: [{date, hlp_count, ts_revolutions}]}
 */
const getCumulativeChartData = async (req, res) => {
    const { machineId, toolType, startDate, endDate } = req.query;
    // Validate required parameters
    if (!machineId || !toolType || !startDate || !endDate) {
        return res.status(400).json({
            message: 'Machine ID, Tool Type, and Dates are required.'
        });
    }
    // ========================================
    // ROBUST TOOL IDENTIFICATION QUERY
    // ========================================
    /**
     * Same three-step CTE pattern as intraday chart
     * Ensures we get the correct currently active tool
     *
     * Main Query differences from intraday:
     * - Uses daily_tool_summary instead of hlp_raw
     * - Filters by date range instead of timestamp range
     * - Returns daily aggregates instead of hourly
     */
    const sqlQuery = `
        WITH latest_status_on_machine AS (
            SELECT DISTINCT ON (tool_id) tool_id, status
            FROM public.drive_status
            WHERE machine_id = $1
            ORDER BY tool_id, timestamp DESC
        ),
        target_tool AS (
            SELECT t.tool_id, t.tool_name
            FROM latest_status_on_machine lsom
            JOIN public.tools t ON lsom.tool_id = t.tool_id
            WHERE lsom.status = 'in_drive' AND UPPER(t.tool_type) = UPPER($2)
            LIMIT 1
        )
        SELECT
            dts.summary_date,
            dts.total_hlp_run,
            dts.total_ts_revolutions,
            (SELECT tool_name FROM target_tool) AS tool_name,
            (SELECT tool_id FROM target_tool) AS tool_id
        FROM public.daily_tool_summary dts
        WHERE dts.tool_id = (SELECT tool_id FROM target_tool)
          AND dts.summary_date BETWEEN $3 AND $4
        ORDER BY dts.summary_date ASC;
    `;
    try {
        const { rows } = await db.query(sqlQuery, [machineId, toolType, startDate, endDate]);
        // ========================================
        // HANDLE NO DATA SCENARIO
        // ========================================
        if (rows.length === 0) {
            const toolNameQuery = `
                WITH latest_status_on_machine AS (
                    SELECT DISTINCT ON (tool_id) tool_id, status 
                    FROM public.drive_status 
                    WHERE machine_id = $1 
                    ORDER BY tool_id, timestamp DESC
                ), 
                target_tool AS (
                    SELECT t.tool_name 
                    FROM latest_status_on_machine lsom 
                    JOIN public.tools t ON lsom.tool_id = t.tool_id 
                    WHERE lsom.status = 'in_drive' AND UPPER(t.tool_type) = UPPER($2) 
                    LIMIT 1
                ) 
                SELECT tool_name FROM target_tool;
            `;
            const toolNameResult = await db.query(toolNameQuery, [machineId, toolType]);
            const toolName = toolNameResult.rows.length > 0
                ? toolNameResult.rows[0].tool_name
                : 'Unknown Tool';
            return res.status(200).json({ toolName, chartData: [] });
        }
        // ========================================
        // FORMAT AND RETURN CHART DATA
        // ========================================
        /**
         * Extract tool identification from first row
         * Format daily data points for chart
         * Include tool_id for potential drill-down functionality
         */
        const toolName = rows[0].tool_name;
        const toolId = rows[0].tool_id;
        const chartData = rows.map(row => {
            // Format date without timezone conversion
            let dateString;
            if (row.summary_date instanceof Date) {
                const year = row.summary_date.getFullYear();
                const month = String(row.summary_date.getMonth() + 1).padStart(2, '0');
                const day = String(row.summary_date.getDate()).padStart(2, '0');
                dateString = `${year}-${month}-${day}`;
            }
            else {
                dateString = row.summary_date.toString().split('T')[0];
            }
            return {
                date: dateString,
                hlp_count: parseInt(row.total_hlp_run),
                ts_revolutions: parseFloat(row.total_ts_revolutions)
            };
        });
        res.status(200).json({ toolName, toolId, chartData });
    }
    catch (error) {
        console.error('Error fetching cumulative chart data:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
// ========================================
// COMPLETE TOOL HISTORY EXPORT
// ========================================
/**
 * Get Complete Tool History for Export
 *
 * Returns comprehensive historical data for currently active tool
 * Includes all raw data points, maintenance events, and statistics
 * Designed for Excel export and detailed analysis
 *
 * Data Included:
 * - Tool identification (name, ID, type)
 * - Date range of available data
 * - ALL raw HLP and TS revolution records (every timestamp)
 * - Tool life information from centralized inventory
 * - Maintenance event history (regrinding, resegmentation)
 * - Performance statistics (averages, peaks, totals)
 *
 * Use Cases:
 * - Excel export for offline analysis
 * - Detailed tool performance reports
 * - Maintenance planning and scheduling
 * - Tool life prediction modeling
 * - Historical trend analysis
 *
 * Performance Consideration:
 * - May return large dataset (thousands of records)
 * - Frontend should handle pagination or chunking if needed
 * - Consider adding date range filters if performance becomes issue
 *
 * @route   GET /api/new-tools/complete-history
 * @access  Private
 * @query   {number} machineId - Machine ID
 * @query   {string} toolType - Tool type
 * @returns {object} Comprehensive tool history with raw data, lifecycle, and statistics
 */
const getCompleteToolHistory = async (req, res) => {
    const { machineId, toolType } = req.query;
    // Validate required parameters
    if (!machineId || !toolType) {
        return res.status(400).json({
            message: 'Machine ID and Tool Type are required.'
        });
    }
    try {
        // ========================================
        // STEP 1: IDENTIFY TARGET TOOL
        // ========================================
        /**
         * Use same robust tool identification logic
         * Find currently active tool on specified machine
         */
        const toolQuery = `
            WITH latest_status_on_machine AS (
                SELECT DISTINCT ON (tool_id) tool_id, status
                FROM public.drive_status
                WHERE machine_id = $1
                ORDER BY tool_id, timestamp DESC
            )
            SELECT t.tool_id, t.tool_name, t.tool_type
            FROM latest_status_on_machine lsom
            JOIN public.tools t ON lsom.tool_id = t.tool_id
            WHERE lsom.status = 'in_drive' AND UPPER(t.tool_type) = UPPER($2)
            LIMIT 1;
        `;
        const toolResult = await db.query(toolQuery, [machineId, toolType]);
        if (toolResult.rows.length === 0) {
            return res.status(404).json({
                message: 'No active tool found for the specified machine and type.'
            });
        }
        const tool = toolResult.rows[0];
        const toolId = tool.tool_id;
        // ========================================
        // STEP 2: DEFINE DATA RETRIEVAL QUERIES
        // ========================================
        /**
         * Query 1: Raw Historical Data
         * - ALL hlp_raw records for this tool
         * - Includes date, time, HLP count, TS revolutions
         * - Ordered chronologically for time-series analysis
         */
        const rawDataQuery = `
            SELECT 
                DATE(timestamp) as date,
                TO_CHAR(timestamp, 'HH24:MI:SS') as time,
                hlp_count,
                ts_revolutions,
                timestamp
            FROM public.hlp_raw
            WHERE tool_id = $1
            ORDER BY timestamp ASC;
        `;
        /**
         * Query 2: Tool Life Information
         * - Current tool life and cumulative metrics
         * - From centralized_inventory table
         * - Includes maintenance counters (regrinding, resegmentation)
         */
        const toolLifeQuery = `
            SELECT current_tool_life, total_hlp
            FROM public.centralized_inventory
            WHERE tool_id = $1
            LIMIT 1;
        `;
        /**
         * Query 3: Maintenance Events
         * - Historical maintenance actions
         * - From tool_maintenance_history table (if exists)
         * - Includes event type, tool life at time, operator
         */
        const maintenanceQuery = `
            SELECT 
                DATE(created_at) as date,
                event_type,
                tool_life_at_event,
                description,
                operator,
                created_at as timestamp
            FROM public.tool_maintenance_history
            WHERE tool_id = $1
            ORDER BY created_at ASC;
        `;
        /**
         * Query 4: Performance Statistics
         * - Date range (first to last record)
         * - Averages and peaks for HLP and TS revolutions
         * - Total record count
         * - Used for summary statistics
         */
        const statsQuery = `
            SELECT 
                MIN(DATE(timestamp)) as start_date,
                MAX(DATE(timestamp)) as end_date,
                COUNT(*) as total_records,
                AVG(ts_revolutions) as avg_ts_revolutions,
                AVG(hlp_count) as avg_hlp_count,
                MAX(ts_revolutions) as peak_ts_revolutions,
                MAX(hlp_count) as peak_hlp_count
            FROM public.hlp_raw
            WHERE tool_id = $1;
        `;
        // ========================================
        // STEP 3: EXECUTE QUERIES IN PARALLEL
        // ========================================
        /**
         * Run core queries in parallel for better performance
         * Promise.all waits for all queries to complete
         * Maintenance query handled separately (table may not exist)
         */
        const [rawDataResult, toolLifeResult, statsResult] = await Promise.all([
            db.query(rawDataQuery, [toolId]),
            db.query(toolLifeQuery, [toolId]),
            db.query(statsQuery, [toolId])
        ]);
        // ========================================
        // STEP 4: GET MAINTENANCE EVENTS (OPTIONAL)
        // ========================================
        /**
         * Try to fetch maintenance events
         * Table may not exist in all deployments
         * Gracefully handle missing table (return empty array)
         */
        let maintenanceResult = { rows: [] };
        try {
            maintenanceResult = await db.query(maintenanceQuery, [toolId]);
        }
        catch (maintenanceError) {
            console.log('Maintenance history table not available:', maintenanceError.message);
            // Continue without maintenance data
        }
        // ========================================
        // STEP 5: CALCULATE DERIVED METRICS
        // ========================================
        const stats = statsResult.rows[0];
        const startDate = stats.start_date;
        const endDate = stats.end_date;
        /**
         * Calculate total days of operation
         * Includes both start and end dates (+1)
         */
        const totalDays = startDate && endDate ?
            Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1 : 0;
        // ========================================
        // STEP 6: FORMAT COMPREHENSIVE RESPONSE
        // ========================================
        /**
         * Build complete data object for export
         * Includes all available information about tool lifecycle
         * Formatted for easy Excel import and analysis
         */
        const completeData = {
            // Tool identification
            toolName: tool.tool_name,
            toolId: tool.tool_id,
            toolType: tool.tool_type,
            // Data coverage
            startDate: startDate,
            endDate: endDate,
            totalRecords: parseInt(stats.total_records) || 0,
            // Raw historical data (all timestamps)
            rawData: rawDataResult.rows.map(row => ({
                date: row.date,
                time: row.time,
                hlp_count: parseInt(row.hlp_count) || 0,
                ts_revolutions: parseFloat(row.ts_revolutions) || 0,
                timestamp: row.timestamp
            })),
            // Tool life data from centralized inventory
            toolLife: toolLifeResult.rows.map(row => ({
                material_id: row.material_id,
                batch_id: row.batch_id,
                current_factory_id: row.current_factory_id,
                current_tool_life: parseFloat(row.current_tool_life) || 0,
                total_hlp: parseInt(row.total_hlp) || 0,
                status: row.status,
                number_of_regrinding: parseInt(row.number_of_regrinding) || 0,
                number_of_resegmentation: parseInt(row.number_of_resegmentation) || 0,
                type: row.type,
                format: row.format,
                created_at: row.created_at,
                updated_at: row.updated_at
            })),
            // Maintenance events (if available)
            maintenanceEvents: maintenanceResult.rows.map(row => ({
                date: row.date,
                event_type: row.event_type,
                tool_life_at_event: parseFloat(row.tool_life_at_event) || 0,
                description: row.description || '',
                operator: row.operator || '',
                timestamp: row.timestamp
            })),
            // Performance statistics and metrics
            statistics: {
                totalDays: totalDays,
                // Daily averages (hourly average * 24)
                avgDailyTsRevolutions: totalDays > 0 ?
                    (parseFloat(stats.avg_ts_revolutions) * 24).toFixed(2) : 0,
                avgDailyHlpCount: totalDays > 0 ?
                    (parseFloat(stats.avg_hlp_count) * 24).toFixed(2) : 0,
                // Peak values
                peakDailyTsRevolutions: parseFloat(stats.peak_ts_revolutions) || 0,
                peakDailyHlpCount: parseInt(stats.peak_hlp_count) || 0,
                // Hourly averages
                avgTsRevolutions: parseFloat(stats.avg_ts_revolutions) || 0,
                avgHlpCount: parseFloat(stats.avg_hlp_count) || 0
            }
        };
        res.status(200).json(completeData);
    }
    catch (error) {
        console.error('Error fetching complete tool history:', error);
        res.status(500).json({
            message: 'Internal Server Error',
            error: error.message
        });
    }
};
// ========================================
// EXPORTS
// ========================================
/**
 * Export all tool controller functions
 * Used in toolRoutesNew.js for route configuration
 */
module.exports = {
    getActiveMachinesByType,
    getToolChartData,
    getCumulativeChartData,
    getCompleteToolHistory
};
