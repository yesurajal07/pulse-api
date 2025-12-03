/**
 * Inventory Controller
 *
 * Handles all tool inventory operations including:
 * - Listing tools with pagination, filtering, and search
 * - Creating single tools
 * - Importing historical tools with lifecycle data
 * - Updating tool information
 * - Getting tool history and summaries
 *
 * Database Tables Used:
 * - centralized_inventory: Main tool inventory
 * - tool_maintenance_history: Lifecycle events
 * - daily_tool_summary: Chart data
 * - ups: UPS values
 * - factories: Factory information
 */
const db = require('../config/db');
/**
 * Get All Inventory Tools with Pagination, Filtering, and Search
 *
 * GET /api/inventory/tools
 *
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10)
 * - sortBy: Column to sort by (default: 'updated_at')
 * - sortDirection: 'ascending' or 'descending' (default: 'descending')
 * - factory: Filter by factory ID or name
 * - status: Filter by tool status
 * - searchCategory: Column to search in (material_id, batch_id, tool_name, factory_name, format)
 * - searchTerm: Search term for partial matching
 *
 * Returns:
 * - tools: Array of tool objects
 * - totalPages: Total number of pages
 * - currentPage: Current page number
 */
/**
 * Contract:
 * - Inputs: query params (page, limit, filters, searchCategory, searchTerm) or request body for create/update
 * - Outputs: JSON responses for list, single tool, summary stats, and CRUD confirmations
 * - Side-effects: Inserts/updates may trigger DB triggers that register tools in related tables
 * - Error modes: validation errors -> 400, auth/permission -> 401/403, DB errors -> 500
 */
exports.getAllInventoryTools = async (req, res) => {
    // ========================================
    // EXTRACT & VALIDATE PARAMETERS
    // ========================================
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy || 'updated_at';
    const sortDirection = req.query.sortDirection === 'ascending' ? 'ASC' : 'DESC';
    const filterFactory = req.query.factory || null;
    const filterStatus = req.query.status || null;
    const searchCategory = req.query.searchCategory || null;
    const searchTerm = req.query.searchTerm || null;
    // ========================================
    // BUILD DYNAMIC SQL QUERY
    // ========================================
    let baseQuery = `
        FROM centralized_inventory ci
        LEFT JOIN factories f ON ci.current_factory_id = f.factory_id
    `;
    const whereClauses = [];
    const queryParams = [];
    // Always exclude deleted tools unless specifically requested
    whereClauses.push(`ci.status != 'deleted'`);
    // Add factory filter
    if (filterFactory) {
        const maybeId = Number(filterFactory);
        if (!Number.isNaN(maybeId)) {
            queryParams.push(maybeId);
            whereClauses.push(`ci.current_factory_id = $${queryParams.length}`);
        }
        else {
            queryParams.push(filterFactory);
            whereClauses.push(`f.name = $${queryParams.length}`);
        }
    }
    // Add status filter
    if (filterStatus) {
        queryParams.push(filterStatus);
        whereClauses.push(`ci.status = $${queryParams.length}`);
    }
    // Add search clause (prevents SQL injection with whitelist)
    if (searchCategory && searchTerm) {
        const validSearchCategories = {
            material_id: 'ci.material_id::text',
            batch_id: 'ci.batch_id',
            tool_name: 'ci.tool_name',
            factory_name: 'f.name',
            format: 'ci.format'
        };
        if (validSearchCategories[searchCategory]) {
            queryParams.push(`%${searchTerm}%`);
            whereClauses.push(`${validSearchCategories[searchCategory]} ILIKE $${queryParams.length}`);
        }
    }
    if (whereClauses.length > 0) {
        baseQuery += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    // ========================================
    // EXECUTE QUERIES
    // ========================================
    try {
        // Get total count for pagination
        const countQuery = `SELECT COUNT(*) ${baseQuery}`;
        const countResult = await db.query(countQuery, queryParams);
        const totalTools = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalTools / limit);
        // Get paginated data with sorting
        const dataQuery = `
            SELECT
                ci.inventory_id, ci.tool_id, ci.tool_name, ci.material_id,
                ci.batch_id, ci.current_factory_id, f.name AS factory_name,
                ci.status, ci.type, ci.format, ci.current_tool_life, ci.total_hlp,
                ci.number_of_regrinding, ci.number_of_resegmentation, ci.updated_at,
                ci.manufacturer, ci.web_width
            ${baseQuery}
            ORDER BY ${sortBy} ${sortDirection}
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2};
        `;
        const dataResult = await db.query(dataQuery, [...queryParams, limit, offset]);
        const tools = dataResult.rows;
        res.status(200).json({
            tools,
            totalPages,
            currentPage: page,
        });
    }
    catch (err) {
        console.error('Error fetching centralized inventory:', err.message);
        res.status(500).send('Server Error');
    }
};
/**
 * Get Inventory Summary Statistics
 *
 * Returns aggregate statistics about tool inventory
 */
// ========================================
// INVENTORY SUMMARY STATISTICS
// ========================================
/**
 * Get Inventory Summary Statistics
 *
 * Provides high-level aggregate statistics about tool inventory
 * Used for dashboard and overview displays
 *
 * Statistics Included:
 * - Tools per factory (COUNT grouped by factory)
 * - Tools by status (COUNT grouped by status)
 *
 * Use Cases:
 * - Dashboard widgets showing distribution
 * - Inventory health monitoring
 * - Resource allocation planning
 *
 * @route   GET /api/inventory/summary
 * @access  Private
 * @returns {object} Summary with byFactory and byStatus arrays
 */
exports.getInventorySummary = async (req, res) => {
    try {
        /**
         * Query 1: Tools Per Factory
         * Joins with factories table to get readable factory names
         * Grouped and sorted for easy visualization
         * Excludes deleted tools
         */
        const toolsPerFactoryQuery = `
            SELECT f.name AS factory_name, COUNT(ci.inventory_id) AS tool_count
            FROM centralized_inventory ci
            JOIN factories f ON ci.current_factory_id = f.factory_id
            WHERE ci.status != 'deleted'
            GROUP BY f.name ORDER BY f.name;
        `;
        const { rows: toolsPerFactory } = await db.query(toolsPerFactoryQuery);
        /**
         * Query 2: Tools By Status
         * Counts tools in each status category
         * Helps identify tools ready for use vs maintenance
         * Excludes deleted tools
         */
        const toolsByStatusQuery = `
            SELECT status, COUNT(inventory_id) AS tool_count
            FROM centralized_inventory
            WHERE status != 'deleted'
            GROUP BY status ORDER BY status;
        `;
        const { rows: toolsByStatus } = await db.query(toolsByStatusQuery);
        res.status(200).json({
            byFactory: toolsPerFactory,
            byStatus: toolsByStatus,
        });
    }
    catch (err) {
        console.error('Error fetching inventory summary:', err.message);
        res.status(500).send('Server Error');
    }
};
// ========================================
// GET SINGLE TOOL BY INVENTORY ID
// ========================================
/**
 * Get Single Tool Details
 *
 * Retrieves complete information for a specific tool
 * Includes factory name through JOIN
 *
 * @route   GET /api/inventory/:inventoryId
 * @access  Private
 * @param   {number} inventoryId - Inventory ID
 * @returns {object} Complete tool data with factory name
 */
exports.getInventoryToolById = async (req, res) => {
    const { inventoryId } = req.params;
    try {
        /**
         * Get full tool details with factory name
         * LEFT JOIN ensures tool is returned even if factory missing
         */
        const query = `
            SELECT
                ci.inventory_id, ci.tool_id, ci.tool_name, ci.material_id,
                ci.batch_id, ci.current_factory_id, f.name AS factory_name,
                ci.status, ci.type, ci.format, ci.current_tool_life, ci.total_hlp,
                ci.number_of_regrinding, ci.number_of_resegmentation, ci.updated_at
            FROM centralized_inventory ci
            LEFT JOIN factories f ON ci.current_factory_id = f.factory_id
            WHERE ci.inventory_id = $1;
        `;
        const { rows } = await db.query(query, [inventoryId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Tool not found in inventory.' });
        }
        res.status(200).json(rows[0]);
    }
    catch (err) {
        console.error(`Error fetching inventory tool ${inventoryId}:`, err.message);
        res.status(500).send('Server Error');
    }
};
// --- NEW FUNCTION TO CREATE A NEW TOOL IN CENTRALIZED INVENTORY ---
exports.createInventoryTool = async (req, res) => {
    const { material_id, batch_id, tool_name, current_factory_id, type, format, ups_value, status, number_of_regrinding, number_of_resegmentation } = req.body;
    const employeeId = req.user.employee_id;
    const userRole = req.user.role;
    const userFactoryId = req.user.factory_id;
    try {
        // Validation
        if (!material_id || !batch_id || !tool_name || !type) {
            return res.status(400).json({
                message: 'Missing required fields: material_id, batch_id, tool_name, and type are required.'
            });
        }
        if (material_id <= 0) {
            return res.status(400).json({ message: 'Material ID must be a positive number.' });
        }
        if (!['cutting', 'creasing', 'embossing'].includes(type)) {
            return res.status(400).json({
                message: 'Invalid type. Must be one of: cutting, creasing, embossing.'
            });
        }
        // Determine the factory_id to use
        let factoryId = current_factory_id;
        if (userRole !== 'BusinessAdmin') {
            // Non-BusinessAdmin users can only create tools in their own factory
            factoryId = userFactoryId;
        }
        else if (!factoryId) {
            return res.status(400).json({
                message: 'BusinessAdmin must specify current_factory_id.'
            });
        }
        // Verify factory exists
        const factoryCheck = await db.query('SELECT factory_id FROM factories WHERE factory_id = $1', [factoryId]);
        if (factoryCheck.rows.length === 0) {
            return res.status(400).json({ message: 'Invalid factory_id. Factory does not exist.' });
        }
        // Start transaction
        await db.query('BEGIN');
        try {
            // Set session variable for audit trail
            await db.query(`SET app.current_employee_id = '${employeeId}'`);
            // Normalize format to uppercase for case-insensitive storage
            const normalizedFormat = format ? format.trim().toUpperCase() : null;
            // Parse ups_value as a numeric value
            const upsValue = ups_value ? parseFloat(ups_value) : null;
            // Insert into centralized_inventory
            // The trigger will auto-register in tools table and calculate metrics
            const insertQuery = `
                INSERT INTO centralized_inventory (
                    material_id,
                    batch_id,
                    tool_name,
                    current_factory_id,
                    type,
                    format,
                    status,
                    number_of_regrinding,
                    number_of_resegmentation
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *;
            `;
            const insertValues = [
                material_id,
                batch_id,
                tool_name,
                factoryId,
                type,
                normalizedFormat,
                status || 'not in use',
                number_of_regrinding || 0,
                number_of_resegmentation || 0
            ];
            const { rows } = await db.query(insertQuery, insertValues);
            const newTool = rows[0];
            // Insert UPS value into UPS table if provided
            if (upsValue !== null && newTool.tool_id) {
                const upsInsertQuery = `
                    INSERT INTO ups (tool_id, ups_value)
                    VALUES ($1, $2)
                    ON CONFLICT (tool_id) DO UPDATE SET ups_value = EXCLUDED.ups_value;
                `;
                await db.query(upsInsertQuery, [newTool.tool_id, upsValue]);
            }
            // Commit transaction
            await db.query('COMMIT');
            res.status(201).json({
                message: 'Tool created successfully',
                tool: newTool
            });
        }
        catch (transactionError) {
            await db.query('ROLLBACK');
            throw transactionError;
        }
    }
    catch (err) {
        console.error('Error creating inventory tool:', err.message);
        res.status(500).json({
            message: 'Server Error',
            error: err.message
        });
    }
};
// --- CREATE HISTORICAL TOOLS WITH LIFECYCLE DATA ---
exports.createHistoricalTools = async (req, res) => {
    const { tools } = req.body; // Array of tools with lifecycle_events
    const employeeId = req.user.employee_id;
    const userRole = req.user.role;
    const userFactoryId = req.user.factory_id;
    console.log('=== IMPORT HISTORICAL TOOLS ===');
    console.log('User:', { employeeId, userRole, userFactoryId });
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    try {
        // Validation
        if (!Array.isArray(tools) || tools.length === 0) {
            return res.status(400).json({
                message: 'Request must include an array of tools with at least one tool.'
            });
        }
        const results = {
            success: [],
            errors: []
        };
        // Process each tool in a transaction
        for (let i = 0; i < tools.length; i++) {
            const tool = tools[i];
            console.log(`Processing tool ${i + 1}:`, tool);
            const { material_id, batch_id, tool_name, current_factory_id, type, format, ups_value, status, current_tool_life, lifecycle_events // Array of: { event_type, life_value, date, sequence }
             } = tool;
            try {
                // Validation for each tool
                if (!material_id || !batch_id || !tool_name || !type) {
                    const error = 'Missing required fields: material_id, batch_id, tool_name, and type are required.';
                    console.log(`Validation failed for tool ${i + 1}:`, error);
                    results.errors.push({
                        row: i + 1,
                        tool: `${material_id}-${batch_id}-${tool_name}`,
                        error
                    });
                    continue;
                }
                if (material_id <= 0) {
                    results.errors.push({
                        row: i + 1,
                        tool: `${material_id}-${batch_id}-${tool_name}`,
                        error: 'Material ID must be a positive number.'
                    });
                    continue;
                }
                if (!['cutting', 'creasing', 'embossing'].includes(type)) {
                    results.errors.push({
                        row: i + 1,
                        tool: `${material_id}-${batch_id}-${tool_name}`,
                        error: 'Invalid type. Must be one of: cutting, creasing, embossing.'
                    });
                    continue;
                }
                // Determine the factory_id to use
                let factoryId = current_factory_id;
                if (userRole !== 'BusinessAdmin') {
                    factoryId = userFactoryId;
                }
                else if (!factoryId) {
                    const error = 'BusinessAdmin must specify current_factory_id.';
                    console.log(`Factory validation failed for tool ${i + 1}:`, error);
                    results.errors.push({
                        row: i + 1,
                        tool: `${material_id}-${batch_id}-${tool_name}`,
                        error
                    });
                    continue;
                }
                console.log(`Using factory_id: ${factoryId}`);
                // Verify factory exists
                const factoryCheck = await db.query('SELECT factory_id FROM factories WHERE factory_id = $1', [factoryId]);
                if (factoryCheck.rows.length === 0) {
                    const error = `Invalid factory_id (${factoryId}). Factory does not exist.`;
                    console.log(`Factory check failed for tool ${i + 1}:`, error);
                    results.errors.push({
                        row: i + 1,
                        tool: `${material_id}-${batch_id}-${tool_name}`,
                        error
                    });
                    continue;
                }
                console.log(`Factory ${factoryId} validated successfully`);
                // Start transaction for this tool
                await db.query('BEGIN');
                try {
                    // Set session variable for audit trail
                    await db.query(`SET app.current_employee_id = '${employeeId}'`);
                    // Normalize format to uppercase for case-insensitive storage
                    const normalizedFormat = format ? format.trim().toUpperCase() : null;
                    // Parse ups_value as a numeric value
                    const upsValue = ups_value ? parseFloat(ups_value) : null;
                    // Calculate regrinding and resegmentation counts from lifecycle events
                    let regrindCount = 0;
                    let resegCount = 0;
                    if (Array.isArray(lifecycle_events)) {
                        regrindCount = lifecycle_events.filter(e => e.event_type === 'regrinding').length;
                        resegCount = lifecycle_events.filter(e => e.event_type === 'resegmentation').length;
                    }
                    // Use current_tool_life as provided (already calculated from all events)
                    const toolLife = current_tool_life ? parseFloat(current_tool_life) : 0;
                    console.log(`Inserting tool with values:`, {
                        material_id,
                        batch_id,
                        tool_name,
                        factoryId,
                        type,
                        normalizedFormat,
                        status: status || 'not in use',
                        toolLife,
                        regrindCount,
                        resegCount
                    });
                    // Insert into centralized_inventory (removed life_since_last_maintenance)
                    // Set both current_tool_life AND baseline_tool_life for historical imports
                    const insertQuery = `
                        INSERT INTO centralized_inventory (
                            material_id,
                            batch_id,
                            tool_name,
                            current_factory_id,
                            type,
                            format,
                            status,
                            current_tool_life,
                            baseline_tool_life,
                            number_of_regrinding,
                            number_of_resegmentation
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        RETURNING *;
                    `;
                    const insertValues = [
                        material_id,
                        batch_id,
                        tool_name,
                        factoryId,
                        type,
                        normalizedFormat,
                        status || 'not in use',
                        toolLife,
                        toolLife, // baseline_tool_life = same as current_tool_life for historical import
                        regrindCount,
                        resegCount
                    ];
                    const { rows } = await db.query(insertQuery, insertValues);
                    const newTool = rows[0];
                    // Insert UPS value into UPS table if provided
                    if (upsValue !== null && newTool.tool_id) {
                        const upsInsertQuery = `
                            INSERT INTO ups (tool_id, ups_value)
                            VALUES ($1, $2)
                            ON CONFLICT (tool_id) DO UPDATE SET ups_value = EXCLUDED.ups_value;
                        `;
                        await db.query(upsInsertQuery, [newTool.tool_id, upsValue]);
                    }
                    // Insert lifecycle events into tool_maintenance_history
                    let eventsInserted = 0;
                    if (Array.isArray(lifecycle_events) && lifecycle_events.length > 0) {
                        let previousLifeValue = 0;
                        for (const event of lifecycle_events) {
                            const { event_type, life_value, date, sequence } = event;
                            // Skip initial event (it's implicit in tool creation)
                            if (event_type === 'initial') {
                                continue;
                            }
                            const eventDate = date ? new Date(date) : new Date();
                            const currentLifeValue = parseFloat(life_value || 0);
                            // Calculate life consumed in this event (not cumulative)
                            const lifeConsumed = currentLifeValue - previousLifeValue;
                            // Insert maintenance event
                            const maintenanceInsertQuery = `
                                INSERT INTO tool_maintenance_history (
                                    tool_id,
                                    event_type,
                                    tool_life_at_event,
                                    life_consumed,
                                    hlp_count_at_event,
                                    event_sequence,
                                    timestamp
                                )
                                VALUES ($1, $2, $3, $4, $5, $6, $7);
                            `;
                            await db.query(maintenanceInsertQuery, [
                                newTool.tool_id,
                                event_type,
                                currentLifeValue,
                                lifeConsumed,
                                0, // hlp_count_at_event - set to 0 for historical data
                                sequence || 1,
                                eventDate
                            ]);
                            // Also insert into daily_tool_summary for chart visualization
                            // Life gained = current life - previous life
                            const lifeGained = currentLifeValue - previousLifeValue;
                            const dailySummaryInsertQuery = `
                                INSERT INTO daily_tool_summary (
                                    tool_id,
                                    machine_id,
                                    summary_date,
                                    total_ts_revolutions,
                                    total_hlp_run
                                )
                                VALUES ($1, $2, $3, $4, $5)
                                ON CONFLICT (tool_id, machine_id, summary_date) 
                                DO UPDATE SET 
                                    total_ts_revolutions = daily_tool_summary.total_ts_revolutions + EXCLUDED.total_ts_revolutions,
                                    total_hlp_run = daily_tool_summary.total_hlp_run + EXCLUDED.total_hlp_run;
                            `;
                            // Format date without timezone conversion
                            const year = eventDate.getFullYear();
                            const month = String(eventDate.getMonth() + 1).padStart(2, '0');
                            const day = String(eventDate.getDate()).padStart(2, '0');
                            const dateString = `${year}-${month}-${day}`;
                            await db.query(dailySummaryInsertQuery, [
                                newTool.tool_id,
                                1, // machine_id placeholder for historical data
                                dateString, // Date only without timezone conversion
                                lifeGained, // Use life gained for this event
                                0 // HLP is 0 for historical data
                            ]);
                            previousLifeValue = currentLifeValue;
                            eventsInserted++;
                        }
                    }
                    // Commit transaction
                    await db.query('COMMIT');
                    console.log(`Tool ${i + 1} imported successfully:`, newTool.tool_id);
                    results.success.push({
                        row: i + 1,
                        tool: `${material_id}-${batch_id}-${tool_name}`,
                        tool_id: newTool.tool_id,
                        events_imported: eventsInserted
                    });
                }
                catch (transactionError) {
                    await db.query('ROLLBACK');
                    console.error(`Transaction error for tool ${i + 1}:`, transactionError.message);
                    throw transactionError;
                }
            }
            catch (toolError) {
                console.error(`Error processing tool ${i + 1}:`, toolError.message);
                results.errors.push({
                    row: i + 1,
                    tool: `${material_id || 'N/A'}-${batch_id || 'N/A'}-${tool_name || 'N/A'}`,
                    error: toolError.message
                });
            }
        }
        console.log('Import results:', results);
        // Send response
        const responseCode = results.errors.length > 0 ? (results.success.length > 0 ? 207 : 400) : 201;
        res.status(responseCode).json({
            message: `Import completed: ${results.success.length} tools imported successfully, ${results.errors.length} errors.`,
            summary: {
                total_tools: tools.length,
                successful: results.success.length,
                failed: results.errors.length
            },
            results
        });
    }
    catch (err) {
        console.error('Error importing historical tools:', err.message);
        res.status(500).json({
            message: 'Server Error',
            error: err.message
        });
    }
};
// --- ENHANCED FUNCTION WITH AUTOMATIC MAINTENANCE TRACKING ---
exports.updateInventoryTool = async (req, res) => {
    const { inventoryId } = req.params;
    const { status, current_factory_id, format, life_consumed, tool_name, material_id, batch_id, type, manufacturer, web_width } = req.body; // Added additional fields
    const employeeId = req.user.employee_id;
    const userFactoryId = req.user.factory_id;
    try {
        // Step 1: Get current tool data for authorization and change detection
        const toolResult = await db.query('SELECT * FROM centralized_inventory WHERE inventory_id = $1', [inventoryId]);
        if (toolResult.rows.length === 0) {
            return res.status(404).json({ message: 'Tool not found in inventory.' });
        }
        const currentTool = toolResult.rows[0];
        const toolFactoryId = currentTool.current_factory_id;
        // Authorization check: UnitAdmin can only edit tools in their assigned factory
        if (req.user.role === 'UnitAdmin' && userFactoryId !== toolFactoryId) {
            return res.status(403).json({ message: 'Forbidden: You can only edit tools in your assigned factory.' });
        }
        // Step 2: Compare current values with new values to detect actual changes
        const fieldsToUpdate = {};
        let hasChanges = false;
        let maintenanceEvent = null;
        // Check each field for changes (only if the field is provided in request)
        if (status !== undefined && status !== currentTool.status) {
            fieldsToUpdate.status = status;
            hasChanges = true;
            // Check if this is a maintenance status change
            if (status === 'sent to madern for regrinding') {
                maintenanceEvent = {
                    type: 'regrinding',
                    countField: 'number_of_regrinding',
                    newCount: currentTool.number_of_regrinding + 1,
                    lifeConsumed: life_consumed ? parseFloat(life_consumed) : 0 // Store consumption value
                };
                fieldsToUpdate.number_of_regrinding = maintenanceEvent.newCount;
                // Update cumulative current_tool_life in centralized_inventory
                if (life_consumed) {
                    fieldsToUpdate.current_tool_life = currentTool.current_tool_life + parseFloat(life_consumed);
                }
            }
            else if (status === 'sent to madern for resegmentation') {
                maintenanceEvent = {
                    type: 'resegmentation',
                    countField: 'number_of_resegmentation',
                    newCount: currentTool.number_of_resegmentation + 1,
                    lifeConsumed: life_consumed ? parseFloat(life_consumed) : 0 // Store consumption value
                };
                fieldsToUpdate.number_of_resegmentation = maintenanceEvent.newCount;
                // Update cumulative current_tool_life in centralized_inventory
                if (life_consumed) {
                    fieldsToUpdate.current_tool_life = currentTool.current_tool_life + parseFloat(life_consumed);
                }
            }
        }
        if (current_factory_id !== undefined && current_factory_id !== currentTool.current_factory_id) {
            fieldsToUpdate.current_factory_id = current_factory_id;
            hasChanges = true;
        }
        // Check format field - normalize to uppercase for case-insensitive comparison
        if (format !== undefined) {
            const normalizedFormat = format ? format.trim().toUpperCase() : null;
            const currentFormat = currentTool.format ? currentTool.format.toUpperCase() : null;
            if (normalizedFormat !== currentFormat) {
                fieldsToUpdate.format = normalizedFormat;
                hasChanges = true;
            }
        }
        // Check tool_name field
        if (tool_name !== undefined && tool_name !== currentTool.tool_name) {
            fieldsToUpdate.tool_name = tool_name.trim();
            hasChanges = true;
        }
        // Check material_id field
        if (material_id !== undefined && material_id !== currentTool.material_id) {
            fieldsToUpdate.material_id = material_id.trim();
            hasChanges = true;
        }
        // Check batch_id field
        if (batch_id !== undefined && batch_id !== currentTool.batch_id) {
            fieldsToUpdate.batch_id = batch_id.trim();
            hasChanges = true;
        }
        // Check type field
        if (type !== undefined && type !== currentTool.type) {
            fieldsToUpdate.type = type.trim();
            hasChanges = true;
        }
        // Check manufacturer field
        if (manufacturer !== undefined && manufacturer !== currentTool.manufacturer) {
            fieldsToUpdate.manufacturer = manufacturer.trim();
            hasChanges = true;
        }
        // Check web_width field - normalize to uppercase
        if (web_width !== undefined) {
            const normalizedWebWidth = web_width ? web_width.trim().toUpperCase() : null;
            const currentWebWidth = currentTool.web_width ? currentTool.web_width.toUpperCase() : null;
            if (normalizedWebWidth !== currentWebWidth) {
                fieldsToUpdate.web_width = normalizedWebWidth;
                hasChanges = true;
            }
        }
        // If no changes detected, return early without updating
        if (!hasChanges) {
            return res.status(200).json({
                message: 'No changes detected',
                tool: currentTool,
                changed: false
            });
        }
        // Step 3: Start database transaction for consistency
        await db.query('BEGIN');
        try {
            // Step 4: Set the session variable for the database trigger
            await db.query(`SET app.current_employee_id = '${employeeId}'`);
            // Step 5: Build dynamic update query only for changed fields
            const updateFields = [];
            const updateValues = [];
            let paramIndex = 1;
            Object.keys(fieldsToUpdate).forEach(field => {
                updateFields.push(`${field} = $${paramIndex}`);
                updateValues.push(fieldsToUpdate[field]);
                paramIndex++;
            });
            updateValues.push(inventoryId); // Add inventoryId as the last parameter
            const updateQuery = `
                UPDATE centralized_inventory
                SET ${updateFields.join(', ')}
                WHERE inventory_id = $${paramIndex}
                RETURNING *;
            `;
            // Step 6: Perform the update - only changed fields will be updated
            const { rows } = await db.query(updateQuery, updateValues);
            const updatedTool = rows[0];
            // Step 7: If this was a maintenance event, record it in maintenance history
            if (maintenanceEvent) {
                // Get the current sequence number for this event type
                const sequenceQuery = `
                    SELECT COALESCE(MAX(event_sequence), 0) + 1 as next_sequence
                    FROM tool_maintenance_history 
                    WHERE tool_id = $1 AND event_type = $2
                `;
                const sequenceResult = await db.query(sequenceQuery, [updatedTool.tool_id, maintenanceEvent.type]);
                const eventSequence = sequenceResult.rows[0].next_sequence;
                // Calculate life_consumed from the previous maintenance record
                // Order by tool_life_at_event DESC to get the highest life value (most recent cycle)
                // This handles historical imports where multiple events may have same timestamp
                const lastMaintenanceQuery = `
                    SELECT tool_life_at_event
                    FROM tool_maintenance_history
                    WHERE tool_id = $1 AND is_deleted = FALSE
                    ORDER BY tool_life_at_event DESC
                    LIMIT 1
                `;
                const lastMaintenanceResult = await db.query(lastMaintenanceQuery, [updatedTool.tool_id]);
                // Calculate life consumed: current life - previous life at last event
                const previousLifeAtEvent = lastMaintenanceResult.rows.length > 0
                    ? parseFloat(lastMaintenanceResult.rows[0].tool_life_at_event)
                    : 0;
                const calculatedLifeConsumed = updatedTool.current_tool_life - previousLifeAtEvent;
                // Insert maintenance history record
                const historyQuery = `
                    INSERT INTO tool_maintenance_history (
                        tool_id, event_type, tool_life_at_event, life_consumed, hlp_count_at_event, 
                        event_sequence, timestamp
                    ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
                    RETURNING *;
                `;
                const historyResult = await db.query(historyQuery, [
                    updatedTool.tool_id,
                    maintenanceEvent.type,
                    updatedTool.current_tool_life,
                    calculatedLifeConsumed,
                    updatedTool.total_hlp,
                    eventSequence
                ]);
                // Commit transaction
                await db.query('COMMIT');
                res.status(200).json({
                    message: `Tool updated successfully with automatic ${maintenanceEvent.type} tracking`,
                    tool: updatedTool,
                    changed: true,
                    fieldsUpdated: Object.keys(fieldsToUpdate),
                    maintenanceEvent: {
                        type: maintenanceEvent.type,
                        sequence: eventSequence,
                        toolLifeAtEvent: updatedTool.current_tool_life,
                        hlpCountAtEvent: updatedTool.total_hlp,
                        historyRecord: historyResult.rows[0]
                    }
                });
            }
            else {
                // Commit transaction for regular updates
                await db.query('COMMIT');
                res.status(200).json({
                    message: 'Tool updated successfully',
                    tool: updatedTool,
                    changed: true,
                    fieldsUpdated: Object.keys(fieldsToUpdate)
                });
            }
        }
        catch (transactionError) {
            // Rollback transaction on error
            await db.query('ROLLBACK');
            throw transactionError;
        }
    }
    catch (err) {
        console.error(`Error updating inventory tool ${inventoryId}:`, err.message);
        res.status(500).json({
            message: 'Server Error',
            error: err.message
        });
    }
};
/**
 * Delete Tool from Inventory
 *
 * DELETE /api/inventory/tools/:inventoryId
 * - Soft delete: marks tool as deleted instead of removing from database
 * - Authorization: BusinessAdmin and UnitAdmin can delete tools in their factory
 * - Also soft-deletes related maintenance history and tool logs
 */
exports.deleteInventoryTool = async (req, res) => {
    const { inventoryId } = req.params;
    const employeeId = req.user.employee_id;
    const userFactoryId = req.user.factory_id;
    const userRole = req.user.role;
    try {
        // Get tool data for authorization
        const toolResult = await db.query('SELECT * FROM centralized_inventory WHERE inventory_id = $1', [inventoryId]);
        if (toolResult.rows.length === 0) {
            return res.status(404).json({ message: 'Tool not found in inventory.' });
        }
        const tool = toolResult.rows[0];
        const toolFactoryId = tool.current_factory_id;
        // Authorization: UnitAdmin can only delete in their factory
        if (userRole === 'UnitAdmin' && userFactoryId !== toolFactoryId) {
            return res.status(403).json({
                message: 'Forbidden: You can only delete tools in your assigned factory.'
            });
        }
        await db.query('BEGIN');
        try {
            // Set session variable for audit trail
            await db.query(`SET app.current_employee_id = '${employeeId}'`);
            // Soft delete: update status to 'deleted' instead of hard delete
            const deleteQuery = `
                UPDATE centralized_inventory
                SET 
                    status = 'deleted',
                    updated_at = CURRENT_TIMESTAMP
                WHERE inventory_id = $1
                RETURNING *;
            `;
            const result = await db.query(deleteQuery, [inventoryId]);
            // Mark related maintenance history as deleted
            // Note: tool_id exists in centralized_inventory
            if (tool.tool_id) {
                await db.query(`UPDATE tool_maintenance_history 
                     SET is_deleted = true 
                     WHERE tool_id = $1`, [tool.tool_id]);
            }
            await db.query('COMMIT');
            res.status(200).json({
                message: 'Tool deleted successfully',
                tool: result.rows[0]
            });
        }
        catch (transactionError) {
            await db.query('ROLLBACK');
            throw transactionError;
        }
    }
    catch (err) {
        console.error(`Error deleting inventory tool ${inventoryId}:`, err.message);
        res.status(500).json({
            message: 'Server Error',
            error: err.message
        });
    }
};
// --- NEW FUNCTION TO GET A TOOL'S HISTORY ---
exports.getInventoryHistory = async (req, res) => {
    const { inventoryId } = req.params;
    try {
        // Get the tool_id for the given inventory_id first.
        const toolIdResult = await db.query('SELECT tool_id FROM centralized_inventory WHERE inventory_id = $1', [inventoryId]);
        if (toolIdResult.rows.length === 0) {
            return res.status(404).json({ message: 'Tool not found.' });
        }
        const toolId = toolIdResult.rows[0].tool_id;
        // Now, use the tool_id in the join condition.
        const query = `
            SELECT 
                cl.log_id,
                cl.change_type,
                cl.change_timestamp,
                cl.field_changed,
                cl.old_value,
                cl.new_value,
                cl.changed_by,
                tmh.history_id AS maintenance_history_id -- This is the crucial ID for the revert button
            FROM get_inventory_change_history($1) cl
            LEFT JOIN tool_maintenance_history tmh 
                ON cl.field_changed = 'status' AND tmh.tool_id = $2
                AND tmh.timestamp::timestamptz(3) = cl.change_timestamp::timestamptz(3);
        `;
        const { rows } = await db.query(query, [inventoryId, toolId]);
        // Create a map of factory IDs to names for efficient lookup
        const factoriesResult = await db.query('SELECT factory_id, name FROM factories');
        const factoryMap = new Map(factoriesResult.rows.map(f => [String(f.factory_id), f.name]));
        // Process the history to replace factory IDs with names
        const processedRows = rows.map(row => {
            if (row.field_changed === 'current_factory_id') {
                return {
                    ...row,
                    // Look up the name from the map, with a fallback if not found
                    old_value: factoryMap.get(row.old_value) || `ID: ${row.old_value}`,
                    new_value: factoryMap.get(row.new_value) || `ID: ${row.new_value}`
                };
            }
            return row;
        });
        res.status(200).json(processedRows);
    }
    catch (err) {
        console.error(`Error fetching history for inventory tool ${inventoryId}:`, err.message);
        res.status(500).send('Server Error');
    }
};
// --- NEW FUNCTION TO GET TOOL MAINTENANCE HISTORY ---
exports.getToolMaintenanceHistory = async (req, res) => {
    const { toolId } = req.params;
    try {
        const query = `
            SELECT 
                history_id,
                tool_id,
                event_type,
                tool_life_at_event,
                life_consumed,
                hlp_count_at_event,
                event_sequence,
                is_deleted,
                timestamp,
                CASE 
                    WHEN event_type = 'regrinding' THEN 'Regrinding ' || event_sequence
                    WHEN event_type = 'resegmentation' THEN 'Resegmentation ' || event_sequence
                    ELSE event_type
                END as display_label
            FROM tool_maintenance_history 
            WHERE tool_id = $1 
            ORDER BY timestamp ASC, event_sequence ASC
        `;
        const { rows } = await db.query(query, [toolId]);
        res.status(200).json(rows);
    }
    catch (err) {
        console.error(`Error fetching maintenance history for tool ${toolId}:`, err.message);
        res.status(500).json({
            message: 'Server Error',
            error: err.message
        });
    }
};
// --- UPDATED FUNCTION TO HARD DELETE A MAINTENANCE HISTORY RECORD ---
exports.deleteMaintenanceHistory = async (req, res) => {
    const { historyId } = req.params;
    try {
        // Start transaction
        await db.query('BEGIN');
        // Get the maintenance record details before deleting
        const getRecordQuery = `
            SELECT tool_id, event_type
            FROM tool_maintenance_history 
            WHERE history_id = $1
        `;
        const recordResult = await db.query(getRecordQuery, [historyId]);
        if (recordResult.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ message: 'Maintenance history record not found' });
        }
        const record = recordResult.rows[0];
        // Hard delete the maintenance record (completely remove it)
        const deleteQuery = `
            DELETE FROM tool_maintenance_history 
            WHERE history_id = $1 
            RETURNING *
        `;
        const deleteResult = await db.query(deleteQuery, [historyId]);
        // First get current inventory data
        const getCurrentQuery = `
            SELECT * FROM centralized_inventory WHERE tool_id = $1
        `;
        const currentResult = await db.query(getCurrentQuery, [record.tool_id]);
        const currentData = currentResult.rows[0];
        if (!currentData) {
            await db.query('ROLLBACK');
            return res.status(404).json({ message: 'Tool not found in inventory' });
        }
        // Decrement the corresponding count in centralized_inventory
        const countField = record.event_type === 'regrinding' ? 'number_of_regrinding' : 'number_of_resegmentation';
        // Calculate new count after decrement
        const newCount = record.event_type === 'regrinding'
            ? Math.max(0, currentData.number_of_regrinding - 1)
            : Math.max(0, currentData.number_of_resegmentation - 1);
        // Determine if status should be reverted
        let statusUpdate = '';
        let shouldRevertStatus = false;
        // If current status matches the maintenance type and count will become 0, revert to 'running'
        if ((record.event_type === 'regrinding' && currentData.status === 'sent to madern for regrinding' && newCount === 0) ||
            (record.event_type === 'resegmentation' && currentData.status === 'sent to madern for resegmentation' && newCount === 0)) {
            statusUpdate = ', status = $2';
            shouldRevertStatus = true;
        }
        const decrementQuery = `
            UPDATE centralized_inventory 
            SET ${countField} = ${countField} - 1 ${statusUpdate}
            WHERE tool_id = $1 
            RETURNING *
        `;
        const queryParams = shouldRevertStatus
            ? [record.tool_id, 'running'] // tool_id and new status
            : [record.tool_id]; // just tool_id
        const inventoryResult = await db.query(decrementQuery, queryParams);
        // Commit transaction
        await db.query('COMMIT');
        const responseMessage = shouldRevertStatus
            ? `${record.event_type} maintenance record deleted completely and tool status reverted to 'running'`
            : `${record.event_type} maintenance record deleted completely`;
        res.status(200).json({
            message: responseMessage,
            statusReverted: shouldRevertStatus,
            deletedRecord: deleteResult.rows[0],
            updatedInventory: inventoryResult.rows[0]
        });
    }
    catch (err) {
        // Rollback on error
        await db.query('ROLLBACK');
        console.error(`Error deleting maintenance history ${historyId}:`, err.message);
        res.status(500).json({
            message: 'Server Error',
            error: err.message
        });
    }
};
// --- NEW FUNCTION TO GET DISTINCT FORMATS ---
exports.getDistinctFormats = async (req, res) => {
    try {
        const query = `
            SELECT DISTINCT format 
            FROM centralized_inventory 
            WHERE format IS NOT NULL AND format <> '' 
            ORDER BY format ASC;
        `;
        const { rows } = await db.query(query);
        // The query returns an array of objects like [{format: 'RSFT'}], we want ['RSFT']
        const formats = rows.map(row => row.format);
        res.status(200).json(formats);
    }
    catch (err) {
        console.error('Error fetching distinct formats:', err.message);
        res.status(500).send('Server Error');
    }
};
// --- NEW FUNCTION TO GET TOOL HEALTH DATA BY FORMAT ---
exports.getToolsByFormat = async (req, res) => {
    const { format } = req.query;
    if (!format) {
        return res.status(400).json({ message: "Format parameter is required." });
    }
    try {
        // Normalize format to uppercase for case-insensitive comparison
        const normalizedFormat = format.trim().toUpperCase();
        // This new query fetches all tools of a given format and aggregates their
        // entire maintenance history into a single JSON array for each tool.
        // This gives the frontend all the data it needs to perform the sequential calculations.
        const query = `
      SELECT
        ci.inventory_id,
        ci.tool_id,
        ci.material_id,
        ci.batch_id,
        ci.tool_name,
        ci.type,
        ci.format,
        ci.status,
        ci.manufacturer,
        ci.web_width,
        f.name as plant,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'eventType', tmh.event_type,
                'lifeConsumed', tmh.life_consumed,
                'timestamp', tmh.timestamp
              ) ORDER BY tmh.timestamp ASC
            )
            FROM tool_maintenance_history tmh
            WHERE tmh.tool_id = ci.tool_id AND tmh.is_deleted = FALSE
          ),
          '[]'::json
        ) AS maintenance_history
      FROM centralized_inventory AS ci
      LEFT JOIN factories f ON ci.current_factory_id = f.factory_id
      WHERE UPPER(ci.format) = $1
      ORDER BY ci.tool_id;
    `;
        const { rows } = await db.query(query, [normalizedFormat]);
        res.status(200).json(rows);
    }
    catch (err) {
        console.error("Error fetching tools by format:", err.message);
        res.status(500).json({ message: "Server Error", error: err.message });
    }
};
// --- NEW FUNCTION TO GET THE LAST MAINTENANCE EVENT FOR A TOOL ---
exports.getLastMaintenanceEvent = async (req, res) => {
    const { toolId } = req.params;
    const { eventType } = req.query;
    if (!eventType) {
        return res.status(400).json({ message: 'eventType query parameter is required.' });
    }
    try {
        const query = `
            SELECT 
                history_id,
                tool_id,
                event_type,
                tool_life_at_event,
                hlp_count_at_event,
                event_sequence,
                timestamp
            FROM tool_maintenance_history 
            WHERE tool_id = $1 
              AND event_type = $2
              AND is_deleted = FALSE
            ORDER BY timestamp DESC
            LIMIT 1;
        `;
        const { rows } = await db.query(query, [toolId, eventType]);
        res.status(200).json(rows[0] || null); // Return the event or null if not found
    }
    catch (err) {
        console.error(`Error fetching last maintenance event for tool ${toolId}:`, err.message);
        res.status(500).json({ message: 'Server Error', error: err.message });
    }
};
// --- NEW: Create a tool log entry ---
exports.createToolLog = async (req, res) => {
    try {
        const authorEmployeeId = req.user?.employee_id;
        const factoryId = req.user?.factory_id;
        if (!authorEmployeeId || !factoryId) {
            return res.status(400).json({ message: 'Missing user context for author or factory.' });
        }
        const { tool_name, tool_material_id, tool_batch_id, description, status, shift, time_taken, date_time_of_event, work_order_no, work_order_description, attended_by, other_members_present, machine_stoppage, popular_issue_id } = req.body;
        if (!tool_name) {
            return res.status(400).json({ message: 'tool_name is required.' });
        }
        if (!date_time_of_event) {
            return res.status(400).json({ message: 'date_time_of_event is required.' });
        }
        // Build attachments JSON array from uploaded files
        let attachments = null;
        if (req.files && req.files.length > 0) {
            attachments = req.files.map(f => ({
                file_name: f.originalname,
                file_path: f.path,
                mime_type: f.mimetype,
                file_size: f.size,
                uploaded_at: new Date().toISOString()
            }));
        }
        // Build dynamic insert to avoid referencing attachments column if it doesn't exist yet
        const columns = [
            'factory_id',
            'author_employee_id',
            'tool_name',
            'tool_material_id',
            'tool_batch_id',
            'description',
            'status',
            'shift',
            'time_taken',
            'date_time_of_event',
            'work_order_no',
            'work_order_description',
            'attended_by',
            'other_members_present'
        ];
        const values = [
            factoryId,
            authorEmployeeId,
            tool_name,
            tool_material_id || null,
            tool_batch_id || null,
            description || null,
            status || null,
            shift || null,
            time_taken || null,
            new Date(date_time_of_event),
            work_order_no || null,
            work_order_description || null,
            attended_by || null,
            other_members_present || null
        ];
        // Add popular_issue_id if provided
        if (popular_issue_id !== undefined && popular_issue_id !== null && popular_issue_id !== '') {
            columns.push('popular_issue_id');
            values.push(parseInt(popular_issue_id));
        }
        // Add machine_stoppage if provided
        if (machine_stoppage !== undefined && machine_stoppage !== null && machine_stoppage !== '') {
            columns.push('machine_stoppage');
            values.push(parseInt(machine_stoppage));
        }
        if (attachments) {
            columns.push('attachments');
            values.push(JSON.stringify(attachments));
        }
        const paramPlaceholders = values.map((_, idx) => `$${idx + 1}`).join(',');
        const insertQuery = `
            INSERT INTO tool_logs (${columns.join(',')})
            VALUES (${paramPlaceholders})
            RETURNING *;
        `;
        const { rows } = await db.query(insertQuery, values);
        const log = rows[0];
        return res.status(201).json(log);
    }
    catch (err) {
        console.error('Error creating tool log:', err.message);
        return res.status(500).json({ message: 'Server Error', error: err.message });
    }
};
// --- NEW: Get tool logs, optionally filtered by factory and tool identifiers ---
exports.getToolLogs = async (req, res) => {
    try {
        console.log('getToolLogs called with query:', req.query);
        const page = parseInt(req.query.page || '1', 10);
        const limit = parseInt(req.query.limit || '20', 10);
        const offset = (page - 1) * limit;
        const factory = req.query.factory || null; // can be id or name
        const toolName = req.query.tool_name || null;
        const materialId = req.query.material_id || null;
        const batchId = req.query.batch_id || null;
        const searchCategory = req.query.searchCategory || null;
        const searchTerm = req.query.searchTerm || null;
        const where = [];
        const params = [];
        if (factory) {
            const maybeId = Number(factory);
            if (!Number.isNaN(maybeId)) {
                params.push(maybeId);
                where.push(`tl.factory_id = $${params.length}`);
            }
            else {
                // Map name->id via factories table
                const { rows: frows } = await db.query('SELECT factory_id FROM factories WHERE name = $1', [factory]);
                if (frows.length > 0) {
                    params.push(frows[0].factory_id);
                    where.push(`tl.factory_id = $${params.length}`);
                }
            }
        }
        if (toolName) {
            params.push(toolName);
            where.push(`tl.tool_name = $${params.length}`);
        }
        if (materialId) {
            params.push(materialId);
            where.push(`tl.tool_material_id = $${params.length}`);
        }
        if (batchId) {
            params.push(batchId);
            where.push(`tl.tool_batch_id = $${params.length}`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        // Optional search across whitelisted columns
        if (searchCategory && searchTerm) {
            const valid = {
                tool_name: 'tool_name',
                material_id: 'tool_material_id',
                batch_id: 'tool_batch_id',
                status: 'status',
                author_employee_id: 'author_employee_id'
            };
            if (valid[searchCategory]) {
                params.push(`%${searchTerm}%`);
                where.push(`${valid[searchCategory]}::text ILIKE $${params.length}`);
            }
        }
        const countSql = `
            SELECT COUNT(*) 
            FROM tool_logs tl
            LEFT JOIN users u ON u.employee_id = tl.author_employee_id
            LEFT JOIN factories f ON f.factory_id = tl.factory_id
            LEFT JOIN popular_issues pi ON pi.issue_id = tl.popular_issue_id
            ${whereSql}
        `;
        const countRes = await db.query(countSql, params);
        const total = parseInt(countRes.rows[0].count, 10);
        console.log('Query results - total:', total, 'params:', params);
        const dataSql = `
            SELECT tl.id, tl.factory_id, tl.author_employee_id, tl.tool_name, tl.tool_material_id, tl.tool_batch_id,
                   tl.description, tl.status, tl.shift, tl.time_taken, tl.date_time_of_event, tl.created_at, tl.attachments,
                   tl.work_order_no, tl.work_order_description, tl.attended_by, tl.other_members_present, tl.machine_stoppage,
                   tl.popular_issue_id, pi.issue_text AS popular_issue_text,
                   u.name AS author_name, f.name AS factory_name
            FROM tool_logs tl
            LEFT JOIN users u ON u.employee_id = tl.author_employee_id
            LEFT JOIN factories f ON f.factory_id = tl.factory_id
            LEFT JOIN popular_issues pi ON pi.issue_id = tl.popular_issue_id
            ${whereSql}
            ORDER BY tl.date_time_of_event DESC, tl.id DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;
        const dataRes = await db.query(dataSql, [...params, limit, offset]);
        console.log('Data query results:', dataRes.rows.length, 'rows returned');
        return res.status(200).json({
            logs: dataRes.rows,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    }
    catch (err) {
        console.error('Error fetching tool logs:', err.message);
        return res.status(500).json({ message: 'Server Error', error: err.message });
    }
};
// --- NEW: Get popular issues ---
exports.getPopularIssues = async (req, res) => {
    const { tool_name, material_id, batch_id } = req.query;
    const params = [];
    const whereClauses = [];
    // Dynamically build the WHERE clause based on provided query parameters
    if (tool_name) {
        params.push(tool_name);
        whereClauses.push(`tl.tool_name = $${params.length}`);
    }
    if (material_id) {
        params.push(material_id);
        whereClauses.push(`tl.tool_material_id = $${params.length}`);
    }
    if (batch_id) {
        params.push(batch_id);
        whereClauses.push(`tl.tool_batch_id = $${params.length}`);
    }
    try {
        let query;
        if (whereClauses.length > 0) {
            // When filtering by specific tool, only show issues for that tool
            const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
            query = `
                SELECT 
                    pi.issue_id,
                    pi.issue_text,
                    COUNT(tl.id) as count
                FROM popular_issues pi
                LEFT JOIN tool_logs tl ON pi.issue_id = tl.popular_issue_id
                ${whereSql}
                GROUP BY pi.issue_id, pi.issue_text
                HAVING COUNT(tl.id) > 0
                ORDER BY count DESC;
            `;
        }
        else {
            // When no tool filter, show all popular issues with their total counts
            query = `
                SELECT 
                    pi.issue_id,
                    pi.issue_text,
                    COUNT(tl.id) as count
                FROM popular_issues pi
                LEFT JOIN tool_logs tl ON pi.issue_id = tl.popular_issue_id
                GROUP BY pi.issue_id, pi.issue_text
                ORDER BY count DESC;
            `;
        }
        const { rows } = await db.query(query, params);
        console.log('Popular issues query result:', rows);
        return res.status(200).json(rows);
    }
    catch (err) {
        console.error('Error fetching popular issues:', err.message);
        return res.status(500).json({ message: 'Server Error', error: err.message });
    }
};
// --- NEW: Add a popular issue ---
exports.addPopularIssue = async (req, res) => {
    try {
        const { issue_text } = req.body;
        if (!issue_text || issue_text.trim() === '') {
            return res.status(400).json({ message: 'Issue text is required and cannot be empty.' });
        }
        const insertQuery = `
            INSERT INTO popular_issues (issue_text)
            VALUES ($1)
            RETURNING *;
        `;
        // Ensure issue_text is trimmed to avoid whitespace-only entries
        const { rows } = await db.query(insertQuery, [issue_text.trim()]);
        return res.status(201).json(rows[0]);
    }
    catch (err) {
        console.error('Error adding popular issue:', err.message);
        // Respond with a 409 Conflict error if the unique constraint is violated
        if (err.constraint === 'popular_issues_issue_text_key')
            return res.status(409).json({ message: 'Issue already exists.' });
        return res.status(500).json({ message: 'Server Error', error: err.message });
    }
};
// --- NEW: Get machine stoppage analytics ---
exports.getMachineStoppageAnalytics = async (req, res) => {
    try {
        const factoryId = req.user?.factory_id;
        if (!factoryId) {
            return res.status(400).json({ message: 'Missing factory context.' });
        }
        // Get total machine stoppage count and aggregated statistics
        const stoppageQuery = `
            SELECT 
                COUNT(*) as total_records_with_stoppage,
                SUM(machine_stoppage) as total_stoppage_count,
                AVG(machine_stoppage) as average_stoppage_per_record,
                MAX(machine_stoppage) as max_stoppage_single_record,
                tool_name,
                SUM(machine_stoppage) as tool_total_stoppage,
                COUNT(*) as tool_record_count
            FROM tool_logs 
            WHERE factory_id = $1 
                AND machine_stoppage IS NOT NULL 
                AND machine_stoppage > 0
            GROUP BY tool_name
            ORDER BY tool_total_stoppage DESC
            LIMIT 10;
        `;
        const { rows } = await db.query(stoppageQuery, [factoryId]);
        // Get overall statistics
        const overallQuery = `
            SELECT 
                COUNT(*) as total_records_with_stoppage,
                SUM(machine_stoppage) as total_stoppage_count,
                AVG(machine_stoppage) as average_stoppage_per_record,
                MAX(machine_stoppage) as max_stoppage_single_record
            FROM tool_logs 
            WHERE factory_id = $1 
                AND machine_stoppage IS NOT NULL 
                AND machine_stoppage > 0;
        `;
        const overallResult = await db.query(overallQuery, [factoryId]);
        const overallStats = overallResult.rows[0];
        return res.json({
            overall_statistics: overallStats,
            tool_breakdown: rows
        });
    }
    catch (err) {
        console.error('Error fetching machine stoppage analytics:', err.message);
        return res.status(500).json({ message: 'Server Error', error: err.message });
    }
};
// --- NEW: Get tool-specific machine stoppage analytics ---
exports.getToolMachineStoppageAnalytics = async (req, res) => {
    const { tool_name, material_id, batch_id } = req.query;
    const params = [];
    const whereClauses = ['machine_stoppage IS NOT NULL', 'machine_stoppage > 0'];
    // Build WHERE clause for tool identification
    if (tool_name) {
        params.push(tool_name);
        whereClauses.push(`tool_name = $${params.length}`);
    }
    if (material_id) {
        params.push(material_id);
        whereClauses.push(`tool_material_id = $${params.length}`);
    }
    if (batch_id) {
        params.push(batch_id);
        whereClauses.push(`tool_batch_id = $${params.length}`);
    }
    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
    try {
        // Get machine stoppage statistics for the specific tool
        const statsQuery = `
            SELECT 
                COUNT(*) as total_records_with_stoppage,
                SUM(machine_stoppage) as total_stoppage_count,
                AVG(machine_stoppage) as average_stoppage_per_record,
                MAX(machine_stoppage) as max_stoppage_single_record,
                MIN(machine_stoppage) as min_stoppage_single_record
            FROM tool_logs 
            ${whereSql};
        `;
        const statsResult = await db.query(statsQuery, params);
        const stats = statsResult.rows[0];
        // Get machine stoppage breakdown by date/shift for trend analysis
        const trendQuery = `
            SELECT 
                DATE(date_time_of_event) as log_date,
                shift,
                SUM(machine_stoppage) as daily_stoppage_count,
                COUNT(*) as record_count
            FROM tool_logs 
            ${whereSql}
            GROUP BY DATE(date_time_of_event), shift
            ORDER BY log_date DESC, shift
            LIMIT 30;
        `;
        const trendResult = await db.query(trendQuery, params);
        return res.status(200).json({
            statistics: stats,
            trend_data: trendResult.rows
        });
    }
    catch (err) {
        console.error('Error fetching tool machine stoppage analytics:', err.message);
        return res.status(500).json({ message: 'Server Error', error: err.message });
    }
};
// --- NEW FUNCTION TO GET DISTINCT MANUFACTURERS ---
exports.getDistinctManufacturers = async (req, res) => {
    try {
        const query = `
            SELECT DISTINCT manufacturer
            FROM centralized_inventory
            WHERE manufacturer IS NOT NULL AND manufacturer <> ''
            ORDER BY manufacturer ASC;
        `;
        const { rows } = await db.query(query);
        const manufacturers = rows.map(row => row.manufacturer);
        res.status(200).json(manufacturers);
    }
    catch (err) {
        console.error('Error fetching distinct manufacturers:', err.message);
        res.status(500).send('Server Error');
    }
};
