/**
 * ========================================
 * FACTORY CONTROLLER
 * ========================================
 *
 * Manages factory operations and engineering logbook
 *
 * Purpose:
 * - Retrieve factories based on user access permissions
 * - Manage engineering logbook entries (CRUD operations)
 * - Filter and search logbook entries
 * - Handle file attachments for logbook entries
 *
 * Key Features:
 * - Role-based factory access (BusinessAdmin sees all, others see assigned)
 * - Engineering logbook with status tracking
 * - Rich filtering (machine, status, author, date range, search)
 * - File upload support for logbook entries
 * - Ownership validation for edit/delete operations
 *
 * Access Control:
 * - BusinessAdmin: Access to all factories and all logbook entries
 * - UnitAdmin: Can edit any entry in accessible factories
 * - User: Can only edit their own entries in accessible factories
 *
 * Database Tables Used:
 * - factories: Factory information (id, name, location)
 * - user_factory_access: User-factory permission mapping
 * - engineering_logs: Logbook entries with file attachments
 * - users: User information for author names
 */
const db = require('../config/db');
// ========================================
// HELPER FUNCTIONS
// ========================================
/**
 * Contract:
 * - Inputs: request params/query for factory retrieval and logbook operations (factoryId, filters, pagination)
 * - Outputs: JSON payloads for factories, logbook entries, and CRUD results
 * - Side-effects: May write engineering log entries and save file attachments via upload middleware
 * - Error modes: permission denied -> 403, missing factory -> 404, DB errors -> 500
 */
/**
 * Check if User Has Access to Factory
 *
 * Reusable helper for factory access validation
 * Queries user_factory_access table for permission
 *
 * Note: BusinessAdmin should bypass this check in controllers
 *
 * @param {string} employeeId - Employee ID to check
 * @param {number} factoryId - Factory ID to check access for
 * @returns {Promise<boolean>} True if user has access, false otherwise
 */
const checkFactoryAccess = async (employeeId, factoryId) => {
    const accessQuery = 'SELECT 1 FROM user_factory_access WHERE employee_id = $1 AND factory_id = $2';
    const { rowCount } = await db.query(accessQuery, [employeeId, factoryId]);
    return rowCount > 0;
};
// ========================================
// FACTORY RETRIEVAL
// ========================================
/**
 * Get Eligible Factories for Logged-In User
 *
 * Returns list of factories user can access based on role:
 * - BusinessAdmin: All factories in system
 * - Other roles: Only factories in user_factory_access table
 *
 * Used for:
 * - Factory selector dropdown
 * - Determining which factories to show in inventory
 * - Limiting logbook access
 *
 * @route   GET /api/factories
 * @access  Private (requires authentication)
 * @returns {array} List of factory objects with id, name, location
 */
exports.getEligibleFactories = async (req, res, next) => {
    try {
        const { role, employee_id } = req.user;
        let query;
        let queryParams = [];
        // ========================================
        // BUILD QUERY BASED ON ROLE
        // ========================================
        if (role === 'BusinessAdmin') {
            /**
             * BusinessAdmin sees ALL factories
             * No access control filtering needed
             */
            query = 'SELECT factory_id, name, location FROM factories ORDER BY name ASC';
        }
        else {
            /**
             * Non-BusinessAdmin sees only assigned factories
             * Join with user_factory_access to filter
             */
            query = `
        SELECT f.factory_id, f.name, f.location 
        FROM factories f
        JOIN user_factory_access ufa ON f.factory_id = ufa.factory_id
        WHERE ufa.employee_id = $1 ORDER BY f.name ASC;
      `;
            queryParams.push(employee_id);
        }
        const { rows } = await db.query(query, queryParams);
        res.json(rows);
    }
    catch (error) {
        next(error);
    }
};
/**
 * Get Single Factory Details if User Has Access
 *
 * Returns factory information only if user has permission
 * Enforces access control before revealing factory data
 *
 * @route   GET /api/factories/:id
 * @access  Private
 * @param   {number} id - Factory ID
 * @returns {object} Factory details (id, name, location)
 */
exports.getFactoryIfEligible = async (req, res, next) => {
    try {
        const factoryId = req.params.id;
        const { employee_id, role } = req.user;
        // ========================================
        // VALIDATE FACTORY ACCESS
        // ========================================
        /**
         * Non-BusinessAdmin must have explicit access
         * Prevents users from accessing factory details via direct API call
         */
        if (role !== 'BusinessAdmin') {
            const hasAccess = await checkFactoryAccess(employee_id, factoryId);
            if (!hasAccess) {
                return res.status(403).json({
                    message: 'Forbidden: You do not have access to this factory.'
                });
            }
        }
        // ========================================
        // FETCH FACTORY DETAILS
        // ========================================
        const { rows } = await db.query('SELECT factory_id, name, location FROM factories WHERE factory_id = $1', [factoryId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Factory not found.' });
        }
        res.json(rows[0]);
    }
    catch (error) {
        next(error);
    }
};
// ========================================
// ENGINEERING LOGBOOK - READ OPERATIONS
// ========================================
/**
 * Get Logbook Entries for Specific Factory
 *
 * Returns all logbook entries for a factory with advanced filtering
 * Validates user has access to factory before returning data
 *
 * Filtering Options:
 * - machine: Filter by machine name
 * - status: Filter by entry status (Open, In Progress, Closed)
 * - author: Filter by author employee ID
 * - startDate: Filter entries on or after date
 * - endDate: Filter entries on or before date
 * - search: Full-text search in entry text, machine name, attended_by, author name
 *
 * @route   GET /api/factories/:id/logbook
 * @access  Private
 * @param   {number} id - Factory ID
 * @query   Various filter parameters
 * @returns {array} Filtered logbook entries with author names
 */
exports.getLogbookEntries = async (req, res, next) => {
    try {
        const factoryId = req.params.id;
        const { employee_id, role } = req.user;
        // ========================================
        // VALIDATE FACTORY ACCESS
        // ========================================
        if (role !== 'BusinessAdmin') {
            const hasAccess = await checkFactoryAccess(employee_id, factoryId);
            if (!hasAccess) {
                return res.status(403).json({
                    message: 'Forbidden: You do not have access to this logbook.'
                });
            }
        }
        // ========================================
        // BUILD DYNAMIC QUERY WITH FILTERS
        // ========================================
        const { machine, status, author, startDate, endDate, search } = req.query;
        /**
         * Base query joins with users table to get author names
         * Additional filters added dynamically based on query parameters
         */
        let logbookQuery = `
      SELECT log.*, usr.name AS author_name 
      FROM engineering_logs AS log
      LEFT JOIN users AS usr ON log.author_employee_id = usr.employee_id
      WHERE log.factory_id = $1
    `;
        const queryParams = [factoryId];
        // Add machine filter (exact match)
        if (machine && machine !== 'All Machines') {
            queryParams.push(machine);
            logbookQuery += ` AND log.machine_name = $${queryParams.length}`;
        }
        // Add status filter (exact match)
        if (status && status !== 'All') {
            queryParams.push(status);
            logbookQuery += ` AND log.status = $${queryParams.length}`;
        }
        // Add author filter (exact match on employee_id)
        if (author && author !== 'All') {
            queryParams.push(author);
            logbookQuery += ` AND log.author_employee_id = $${queryParams.length}`;
        }
        // Add start date filter (inclusive)
        if (startDate) {
            queryParams.push(startDate);
            logbookQuery += ` AND log.event_timestamp >= $${queryParams.length}`;
        }
        // Add end date filter (inclusive - adds 1 day to include entire end date)
        if (endDate) {
            queryParams.push(endDate);
            logbookQuery += ` AND log.event_timestamp < ($${queryParams.length}::date + 1)`;
        }
        // Add search filter (case-insensitive ILIKE across multiple fields)
        if (search) {
            queryParams.push(`%${search}%`);
            logbookQuery += ` AND (log.entry_text ILIKE $${queryParams.length} OR log.machine_name ILIKE $${queryParams.length} OR log.attended_by ILIKE $${queryParams.length} OR usr.name ILIKE $${queryParams.length})`;
        }
        // Sort by newest first
        logbookQuery += ' ORDER BY log.event_timestamp DESC;';
        const { rows } = await db.query(logbookQuery, queryParams);
        res.json(rows);
    }
    catch (error) {
        next(error);
    }
};
/**
 * Get Logbook Entries from ALL Factories
 *
 * Returns logbook entries across all factories with filtering
 * Includes factory name in results for identification
 * Typically used by BusinessAdmin for system-wide view
 *
 * Additional Filter vs. Single Factory:
 * - plant: Filter by factory/plant name
 *
 * @route   GET /api/factories/all/logbook
 * @access  Private (typically BusinessAdmin)
 * @query   Various filter parameters including plant
 * @returns {array} Filtered logbook entries with factory and author names
 */
exports.getAllFactoriesLogbook = async (req, res, next) => {
    try {
        const { plant, machine, status, author, startDate, endDate, search } = req.query;
        /**
         * Base query includes factory name
         * WHERE 1=1 allows easy addition of conditional filters
         */
        let logbookQuery = `
      SELECT log.*, usr.name AS author_name, fact.name AS factory_name 
      FROM engineering_logs AS log
      LEFT JOIN users AS usr ON log.author_employee_id = usr.employee_id
      LEFT JOIN factories AS fact ON log.factory_id = fact.factory_id
      WHERE 1=1
    `;
        const queryParams = [];
        // Add plant/factory filter
        if (plant && plant !== 'All Plants') {
            queryParams.push(plant);
            logbookQuery += ` AND fact.name = $${queryParams.length}`;
        }
        // Add machine filter
        if (machine && machine !== 'All Machines') {
            queryParams.push(machine);
            logbookQuery += ` AND log.machine_name = $${queryParams.length}`;
        }
        // Add status filter
        if (status && status !== 'All') {
            queryParams.push(status);
            logbookQuery += ` AND log.status = $${queryParams.length}`;
        }
        // Add author filter
        if (author && author !== 'All') {
            queryParams.push(author);
            logbookQuery += ` AND log.author_employee_id = $${queryParams.length}`;
        }
        // Add date filters
        if (startDate) {
            queryParams.push(startDate);
            logbookQuery += ` AND log.event_timestamp >= $${queryParams.length}`;
        }
        if (endDate) {
            queryParams.push(endDate);
            logbookQuery += ` AND log.event_timestamp < ($${queryParams.length}::date + 1)`;
        }
        // Add search filter
        if (search) {
            queryParams.push(`%${search}%`);
            logbookQuery += ` AND (log.entry_text ILIKE $${queryParams.length} OR log.machine_name ILIKE $${queryParams.length} OR log.attended_by ILIKE $${queryParams.length} OR usr.name ILIKE $${queryParams.length})`;
        }
        logbookQuery += ' ORDER BY log.event_timestamp DESC;';
        const { rows } = await db.query(logbookQuery, queryParams);
        res.json(rows);
    }
    catch (error) {
        next(error);
    }
};
// ========================================
// CREATE LOGBOOK ENTRY
// ========================================
/**
 * Add New Logbook Entry
 *
 * Creates new engineering logbook entry with optional file attachment
 * Validates factory access before allowing entry creation
 *
 * Access Control:
 * - BusinessAdmin: Can create entries in any factory logbook
 * - Regular users: Can only create entries in factories they have access to
 *
 * Required Data:
 * - entryText: Main log entry content (cannot be empty)
 * - employee_id: Auto-attached from req.user (JWT token)
 *
 * Optional Data:
 * - machine_name: Which machine this entry relates to
 * - work_order_problem: Problem code or reference
 * - shift: Which shift (e.g., A, B, C, Day, Night)
 * - membersPresent: Who attended/was present
 * - timeTaken: How long work took (format flexible)
 * - attended_by: Person who handled the issue
 * - status: Entry status (e.g., "Open", "Closed", "In Progress")
 * - file: Optional file attachment (handled by multer middleware)
 *
 * File Upload Handling:
 * - Middleware: Uses multer for file processing
 * - File path stored in database (file_path column)
 * - File type (MIME type) stored for validation on retrieval
 *
 * @route   POST /api/factories/:id/logbook
 * @access  Private (factory access required)
 * @param   {number} id - Factory ID
 * @body    {object} Entry data with required entryText
 * @returns {object} Newly created logbook entry with ID
 */
exports.addLogbookEntry = async (req, res, next) => {
    try {
        const factoryId = req.params.id;
        const { employee_id, role } = req.user;
        // ========================================
        // STEP 1: VALIDATE FACTORY ACCESS
        // ========================================
        /**
         * Check if user can add entries to this factory's logbook
         * BusinessAdmin bypasses this check (full access)
         */
        if (role !== 'BusinessAdmin') {
            const hasAccess = await checkFactoryAccess(employee_id, factoryId);
            if (!hasAccess) {
                return res.status(403).json({
                    message: 'Forbidden: You cannot add entries to this logbook.'
                });
            }
        }
        // ========================================
        // STEP 2: EXTRACT AND VALIDATE ENTRY DATA
        // ========================================
        const { entryText, machine_name, work_order_problem, shift, membersPresent, timeTaken, attended_by, status } = req.body;
        /**
         * Validate required field
         * Entry text cannot be empty or whitespace-only
         */
        if (!entryText || entryText.trim() === '') {
            return res.status(400).json({
                message: 'Log entry text is required.'
            });
        }
        // ========================================
        // STEP 3: HANDLE FILE ATTACHMENT
        // ========================================
        /**
         * Extract file information if uploaded
         * Multer middleware populates req.file if present
         * Store both file path and MIME type for later retrieval
         */
        const filePath = req.file ? req.file.path : null;
        const fileType = req.file ? req.file.mimetype : null;
        // ========================================
        // STEP 4: INSERT ENTRY INTO DATABASE
        // ========================================
        /**
         * Create new logbook entry
         * RETURNING * sends back the full created entry (including auto-generated ID)
         * Timestamp auto-set by database default (CURRENT_TIMESTAMP)
         */
        const query = `
      INSERT INTO engineering_logs (
        factory_id, author_employee_id, entry_text, machine_name, work_order_problem,
        shift, members_present, time_taken, attended_by, status, file_path, file_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *; 
    `;
        const { rows } = await db.query(query, [
            factoryId,
            employee_id, // Author is current user
            entryText,
            machine_name,
            work_order_problem,
            shift,
            membersPresent,
            timeTaken,
            attended_by,
            status,
            filePath, // File path (null if no file)
            fileType // MIME type (null if no file)
        ]);
        // Return newly created entry with HTTP 201 (Created)
        res.status(201).json(rows[0]);
    }
    catch (error) {
        next(error);
    }
};
// ========================================
// UPDATE LOGBOOK ENTRY
// ========================================
/**
 * Update Existing Logbook Entry
 *
 * Allows editing of existing logbook entries with ownership validation
 * Increments update counter to track modification history
 *
 * Authorization Rules:
 * - BusinessAdmin: Can edit ANY entry
 * - UnitAdmin: Can edit ANY entry in their accessible factories
 * - Regular User: Can ONLY edit their OWN entries
 *
 * Update Tracking:
 * - update_count column incremented on each edit
 * - Helps track how many times entry has been modified
 * - Original timestamp preserved (event_timestamp not changed)
 *
 * Note: File updates not currently supported
 * To change attached file, user would need to delete and recreate entry
 *
 * @route   PUT /api/factories/:id/logbook/:logId
 * @access  Private (ownership or UnitAdmin/BusinessAdmin required)
 * @param   {number} id - Factory ID
 * @param   {number} logId - Log entry ID to update
 * @body    {object} Updated entry data
 * @returns {object} Updated logbook entry
 */
exports.updateLogbookEntry = async (req, res, next) => {
    try {
        const { id: factoryId, logId } = req.params;
        const { employee_id, role } = req.user;
        const { entry_text, machine_name, work_order_problem, shift, members_present, time_taken, attended_by, status } = req.body;
        // ========================================
        // STEP 1: VERIFY ENTRY EXISTS AND GET OWNER
        // ========================================
        /**
         * Check entry exists in specified factory
         * Retrieve author_employee_id for ownership check
         */
        const ownerCheck = await db.query('SELECT author_employee_id FROM engineering_logs WHERE id = $1 AND factory_id = $2', [logId, factoryId]);
        if (ownerCheck.rows.length === 0) {
            return res.status(404).json({
                message: 'Log entry not found in this factory.'
            });
        }
        const authorId = ownerCheck.rows[0].author_employee_id;
        // ========================================
        // STEP 2: VALIDATE EDIT PERMISSION
        // ========================================
        /**
         * Check if user is allowed to edit this entry
         *
         * Allowed if:
         * 1. User is the original author (authorId === employee_id)
         * 2. User has UnitAdmin role (can edit any entry in factory)
         * 3. User has BusinessAdmin role (can edit any entry anywhere)
         */
        if (authorId !== employee_id && role !== 'BusinessAdmin' && role !== 'UnitAdmin') {
            return res.status(403).json({
                message: 'Forbidden: You can only edit your own log entries.'
            });
        }
        // ========================================
        // STEP 3: UPDATE ENTRY
        // ========================================
        /**
         * Update all editable fields
         * Increment update_count to track modification history
         * RETURNING * sends back updated entry
         */
        const query = `
      UPDATE engineering_logs 
      SET 
        entry_text = $1, 
        machine_name = $2, 
        work_order_problem = $3, 
        shift = $4,
        members_present = $5, 
        time_taken = $6, 
        attended_by = $7, 
        status = $8,
        update_count = update_count + 1
      WHERE id = $9
      RETURNING *;
    `;
        const { rows } = await db.query(query, [
            entry_text,
            machine_name,
            work_order_problem,
            shift,
            members_present,
            time_taken,
            attended_by,
            status,
            logId
        ]);
        res.json(rows[0]);
    }
    catch (error) {
        next(error);
    }
};
// ========================================
// DELETE LOGBOOK ENTRY
// ========================================
/**
 * Delete Logbook Entry
 *
 * Permanently removes logbook entry from database
 * Same authorization rules as update (owner or UnitAdmin/BusinessAdmin)
 *
 * Authorization:
 * - BusinessAdmin: Can delete ANY entry
 * - UnitAdmin: Can delete ANY entry in accessible factories
 * - Regular User: Can ONLY delete their OWN entries
 *
 * Data Cleanup:
 * - Entry permanently deleted from engineering_logs table
 * - Associated file NOT deleted from filesystem (manual cleanup needed)
 * - No soft delete or archive implemented
 *
 * Security Consideration:
 * - Deletion is irreversible
 * - No audit trail maintained (consider adding if compliance needed)
 * - File cleanup should be implemented separately
 *
 * @route   DELETE /api/factories/:id/logbook/:logId
 * @access  Private (ownership or UnitAdmin/BusinessAdmin required)
 * @param   {number} id - Factory ID
 * @param   {number} logId - Log entry ID to delete
 * @returns {object} Success message
 */
exports.deleteLogbookEntry = async (req, res, next) => {
    try {
        const { id: factoryId, logId } = req.params;
        const { employee_id, role } = req.user;
        // ========================================
        // STEP 1: VERIFY ENTRY EXISTS AND GET OWNER
        // ========================================
        /**
         * Check entry exists and retrieve author for ownership check
         * Same pattern as update operation
         */
        const ownerCheck = await db.query('SELECT author_employee_id FROM engineering_logs WHERE id = $1 AND factory_id = $2', [logId, factoryId]);
        if (ownerCheck.rows.length === 0) {
            return res.status(404).json({
                message: 'Log entry not found.'
            });
        }
        const authorId = ownerCheck.rows[0].author_employee_id;
        // ========================================
        // STEP 2: VALIDATE DELETE PERMISSION
        // ========================================
        /**
         * Same authorization rules as update
         * Must be owner, UnitAdmin, or BusinessAdmin
         */
        if (authorId !== employee_id && role !== 'BusinessAdmin' && role !== 'UnitAdmin') {
            return res.status(403).json({
                message: 'Forbidden: You can only delete your own log entries.'
            });
        }
        // ========================================
        // STEP 3: DELETE ENTRY
        // ========================================
        /**
         * Permanently remove entry from database
         * No RETURNING clause needed (just confirmation)
         *
         * TODO: Consider implementing file cleanup
         * - Check if entry has file_path
         * - Delete physical file from uploads directory
         * - Handle errors if file already deleted
         */
        await db.query('DELETE FROM engineering_logs WHERE id = $1', [logId]);
        res.status(200).json({
            message: 'Log entry deleted successfully.'
        });
    }
    catch (error) {
        next(error);
    }
};
// ========================================
// GET LOGBOOK AUTHORS (SINGLE FACTORY)
// ========================================
/**
 * Get Unique Authors for Factory Logbook
 *
 * Returns list of users who have written entries in this factory's logbook
 * Used to populate author filter dropdown in frontend
 *
 * Query Logic:
 * - DISTINCT ensures each author appears only once
 * - JOIN with users table to get employee_id and name
 * - Only includes authors who have actually written entries
 * - Sorted alphabetically by name for better UX
 *
 * Use Cases:
 * - Author filter dropdown population
 * - Finding who has contributed to logbook
 * - Logbook statistics and reporting
 *
 * @route   GET /api/factories/:id/logbook/authors
 * @access  Private
 * @param   {number} id - Factory ID
 * @returns {array} List of authors (employee_id, name)
 */
exports.getLogbookAuthors = async (req, res, next) => {
    try {
        const factoryId = req.params.id;
        /**
         * Get distinct authors from this factory's logbook
         * JOIN ensures we get user names, not just IDs
         * ORDER BY name provides alphabetical dropdown
         */
        const query = `
      SELECT DISTINCT usr.employee_id, usr.name
      FROM users AS usr
      JOIN engineering_logs AS log ON usr.employee_id = log.author_employee_id
      WHERE log.factory_id = $1
      ORDER BY usr.name ASC;
    `;
        const { rows } = await db.query(query, [factoryId]);
        res.json(rows);
    }
    catch (error) {
        next(error);
    }
};
// ========================================
// GET ALL LOGBOOK AUTHORS (ALL FACTORIES)
// ========================================
/**
 * Get Unique Authors Across ALL Factories
 *
 * Returns complete list of users who have written logbook entries anywhere
 * Used for cross-factory reporting and BusinessAdmin views
 *
 * Difference from getLogbookAuthors:
 * - No factory_id filter (searches all factories)
 * - Used in "All Factories" logbook view
 * - Typically accessed by BusinessAdmin only
 *
 * @route   GET /api/factories/all/logbook/authors
 * @access  Private (typically BusinessAdmin)
 * @returns {array} List of all authors (employee_id, name)
 */
exports.getAllLogbookAuthors = async (req, res, next) => {
    try {
        /**
         * Same query as getLogbookAuthors but without factory filter
         * Returns every user who has written at least one logbook entry
         */
        const query = `
      SELECT DISTINCT usr.employee_id, usr.name
      FROM users AS usr
      JOIN engineering_logs AS log ON usr.employee_id = log.author_employee_id
      ORDER BY usr.name ASC;
    `;
        const { rows } = await db.query(query);
        res.json(rows);
    }
    catch (error) {
        next(error);
    }
};
