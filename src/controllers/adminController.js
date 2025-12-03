/**
 * ========================================
 * ADMIN CONTROLLER
 * ========================================
 *
 * Manages administrative operations and user management
 *
 * Purpose:
 * - User account management (CRUD operations)
 * - Role and permission management
 * - Factory access control
 * - System analytics and dashboard data
 *
 * Access Control:
 * - Most endpoints require UnitAdmin or BusinessAdmin role
 * - Analytics endpoints restricted to BusinessAdmin only
 * - Factory access management by factory assignments
 *
 * Database Tables Used:
 * - users: User accounts and credentials
 * - factories: Factory/plant information
 * - user_factory_access: Many-to-many relationship for access control
 * - user_sessions: Session tracking for analytics
 */
const db = require('../config/db');
const bcrypt = require('bcryptjs');
// ========================================
// USER MANAGEMENT CONTROLLERS
// ========================================
/**
 * Contract:
 * - Inputs: request body/params for user CRUD and role assignments
 * - Outputs: JSON responses for user lists, created/updated user objects, and admin analytics
 * - Side-effects: Creates/updates users and user_factory_access rows
 * - Error modes: validation -> 400, conflict (duplicate) -> 409, DB errors -> 500
 */
/**
 * Get All Users with Optional Search
 *
 * Features:
 * - Returns all users without password field
 * - Optional search across name, username, employee_id, plant
 * - Results sorted alphabetically by name
 *
 * @route   GET /api/admin/users
 * @access  UnitAdmin, BusinessAdmin
 * @query   {string} search - Optional search term for filtering
 * @returns {array} List of user objects
 */
exports.getAllUsers = async (req, res, next) => {
    const { search = '' } = req.query;
    // Build dynamic query with optional search filter
    let query = 'SELECT id, name, username, employee_id, role, plant FROM users';
    const queryParams = [];
    if (search) {
        // ILIKE for case-insensitive search across multiple fields
        query += ' WHERE name ILIKE $1 OR username ILIKE $1 OR employee_id ILIKE $1 OR plant ILIKE $1';
        queryParams.push(`%${search}%`);
    }
    query += ' ORDER BY name ASC';
    try {
        const { rows } = await db.query(query, queryParams);
        res.json(rows);
    }
    catch (error) {
        next(error);
    }
};
/**
 * Create New User with Factory Access
 *
 * Process:
 * 1. Validate required fields (name, username, employee_id, password, plant)
 * 2. Verify factory exists by plant name
 * 3. Hash password using bcrypt
 * 4. Insert user record
 * 5. Automatically grant access to assigned factory
 *
 * Security:
 * - Password hashed with bcrypt (10 salt rounds)
 * - Duplicate username/employee_id prevented by unique constraints
 *
 * @route   POST /api/admin/users
 * @access  UnitAdmin, BusinessAdmin
 * @body    {string} name - Full name
 * @body    {string} username - Login username (unique)
 * @body    {string} employee_id - Employee ID (unique)
 * @body    {string} password - Plain text password (will be hashed)
 * @body    {string} role - User role (default: 'User')
 * @body    {string} plant - Factory/plant name
 * @returns {object} Created user object (without password)
 */
exports.createUser = async (req, res, next) => {
    const { name, username, employee_id, password, role = 'User', plant } = req.body;
    // Validate required fields
    if (!name || !username || !employee_id || !password || !plant) {
        return res.status(400).json({
            message: 'All required fields must be provided, including plant.'
        });
    }
    try {
        // ========================================
        // STEP 1: VERIFY FACTORY EXISTS
        // ========================================
        const factoryQuery = 'SELECT factory_id FROM factories WHERE name = $1';
        const factoryResult = await db.query(factoryQuery, [plant]);
        if (factoryResult.rows.length === 0) {
            return res.status(404).json({
                message: `Invalid plant. No factory found with name '${plant}'.`
            });
        }
        const factoryId = factoryResult.rows[0].factory_id;
        // ========================================
        // STEP 2: HASH PASSWORD
        // ========================================
        /**
         * Generate salt and hash password
         * - Salt rounds: 10 (balance between security and performance)
         * - Bcrypt automatically handles salt generation and storage
         */
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        // ========================================
        // STEP 3: CREATE USER RECORD
        // ========================================
        const userQuery = `
      INSERT INTO users (name, username, employee_id, password, role, plant)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
    `;
        const userResult = await db.query(userQuery, [
            name,
            username,
            employee_id,
            hashedPassword,
            role,
            plant
        ]);
        const newUser = userResult.rows[0];
        // ========================================
        // STEP 4: GRANT FACTORY ACCESS
        // ========================================
        /**
         * Automatically grant user access to their assigned factory
         * This allows them to view/edit tools in their plant
         */
        const accessQuery = `INSERT INTO user_factory_access (employee_id, factory_id) VALUES ($1, $2)`;
        await db.query(accessQuery, [employee_id, factoryId]);
        // ========================================
        // STEP 5: RETURN USER (WITHOUT PASSWORD)
        // ========================================
        // Remove password from response for security
        const { password: _, ...userToReturn } = newUser;
        res.status(201).json(userToReturn);
    }
    catch (error) {
        // Handle duplicate username/employee_id constraint violation
        if (error.code === '23505') {
            return res.status(409).json({
                message: 'Username or Employee ID already exists.'
            });
        }
        next(error);
    }
};
/**
 * Delete User Account
 *
 * Cascade Behavior:
 * - Removes user record from users table
 * - Automatically removes user_factory_access records (FK constraint)
 * - May affect user_sessions if FK is set to cascade
 *
 * @route   DELETE /api/admin/users/:employeeId
 * @access  UnitAdmin, BusinessAdmin
 * @param   {string} employeeId - Employee ID of user to delete
 * @returns {object} Success message
 */
exports.deleteUser = async (req, res, next) => {
    const { employeeId } = req.params;
    try {
        const { rowCount } = await db.query('DELETE FROM users WHERE employee_id = $1', [employeeId]);
        if (rowCount === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.status(200).json({ message: `User deleted successfully.` });
    }
    catch (error) {
        next(error);
    }
};
/**
 * Update User Role/Permissions
 *
 * Available Roles:
 * - User: Basic access, can view tools in assigned factory
 * - UnitAdmin: Can manage users, edit tools across factories
 * - BusinessAdmin: Full system access, analytics, all factories
 *
 * @route   PUT /api/admin/users/:employeeId/permissions
 * @access  BusinessAdmin
 * @param   {string} employeeId - Employee ID of user to update
 * @body    {string} role - New role (User, UnitAdmin, or BusinessAdmin)
 * @returns {object} Updated user object
 */
exports.updateUserPermissions = async (req, res, next) => {
    const { employeeId } = req.params;
    const { role } = req.body;
    // Validate role value
    if (!['User', 'UnitAdmin', 'BusinessAdmin'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role specified.' });
    }
    try {
        const query = 'UPDATE users SET role = $1 WHERE employee_id = $2 RETURNING id, name, username, employee_id, role, plant';
        const { rows, rowCount } = await db.query(query, [role, employeeId]);
        if (rowCount === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.json(rows[0]);
    }
    catch (error) {
        next(error);
    }
};
/**
 * Reset User Password
 *
 * Use Cases:
 * - User forgot password
 * - UnitAdmin needs to reset compromised account
 * - Initial password setup
 *
 * Security:
 * - New password is hashed before storage
 * - Old password is not required (admin action)
 *
 * @route   PUT /api/admin/users/:employeeId/reset-password
 * @access  UnitAdmin, BusinessAdmin
 * @param   {string} employeeId - Employee ID of user
 * @body    {string} password - New plain text password
 * @returns {object} Success message
 */
exports.resetUserPassword = async (req, res, next) => {
    const { employeeId } = req.params;
    const { password } = req.body;
    if (!password || password.trim() === '') {
        return res.status(400).json({ message: 'A new password is required.' });
    }
    try {
        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const { rowCount } = await db.query('UPDATE users SET password = $1 WHERE employee_id = $2', [hashedPassword, employeeId]);
        if (rowCount === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.status(200).json({
            message: `Password for user ${employeeId} has been reset successfully.`
        });
    }
    catch (error) {
        next(error);
    }
};
// ========================================
// FACTORY & ACCESS MANAGEMENT
// ========================================
/**
 * Get All Factories
 *
 * Returns complete list of all factories in the system
 * Used for:
 * - UnitAdmin dashboard factory selector
 * - User factory access management
 * - Factory selection dropdowns
 *
 * @route   GET /api/admin/factories
 * @access  UnitAdmin, BusinessAdmin
 * @returns {array} List of factory objects
 */
exports.getAllFactories = async (req, res, next) => {
    try {
        const { rows } = await db.query('SELECT factory_id, name, location FROM factories ORDER BY name ASC');
        res.json(rows);
    }
    catch (error) {
        next(error);
    }
};
/**
 * Get User's Factory Access List
 *
 * Returns factory IDs that a user has permission to access
 * Used to determine which factories' tools user can view/edit
 *
 * @route   GET /api/admin/users/:employeeId/factories
 * @access  UnitAdmin, BusinessAdmin
 * @param   {string} employeeId - Employee ID
 * @returns {array} Array of factory IDs
 */
exports.getUserFactoryAccess = async (req, res, next) => {
    const { employeeId } = req.params;
    try {
        const query = 'SELECT factory_id FROM user_factory_access WHERE employee_id = $1';
        const { rows } = await db.query(query, [employeeId]);
        // Return just array of factory IDs for easy frontend consumption
        res.json(rows.map(row => row.factory_id));
    }
    catch (error) {
        next(error);
    }
};
/**
 * Grant Factory Access to User
 *
 * Allows admin to give user permission to access a specific factory
 * Uses ON CONFLICT DO NOTHING to prevent duplicate entries
 *
 * @route   POST /api/admin/users/:employeeId/factories/:factoryId
 * @access  UnitAdmin, BusinessAdmin
 * @param   {string} employeeId - Employee ID
 * @param   {number} factoryId - Factory ID
 * @returns {object} Success message
 */
exports.grantFactoryAccess = async (req, res, next) => {
    const { employeeId, factoryId } = req.params;
    try {
        const query = `
      INSERT INTO user_factory_access (employee_id, factory_id) 
      VALUES ($1, $2) 
      ON CONFLICT DO NOTHING
    `;
        await db.query(query, [employeeId, factoryId]);
        res.status(201).json({
            message: `Access granted for user ${employeeId} to factory ${factoryId}.`
        });
    }
    catch (error) {
        res.status(400).json({
            message: 'Error granting access. Ensure user and factory exist.'
        });
    }
};
/**
 * Revoke Factory Access from User
 *
 * Removes user's permission to access a specific factory
 * User will no longer see tools from that factory
 *
 * @route   DELETE /api/admin/users/:employeeId/factories/:factoryId
 * @access  UnitAdmin, BusinessAdmin
 * @param   {string} employeeId - Employee ID
 * @param   {number} factoryId - Factory ID
 * @returns {object} Success message
 */
exports.revokeFactoryAccess = async (req, res, next) => {
    const { employeeId, factoryId } = req.params;
    try {
        const { rowCount } = await db.query('DELETE FROM user_factory_access WHERE employee_id = $1 AND factory_id = $2', [employeeId, factoryId]);
        if (rowCount === 0) {
            return res.status(404).json({ message: 'Access record not found.' });
        }
        res.status(200).json({
            message: `Access revoked for user ${employeeId} from factory ${factoryId}.`
        });
    }
    catch (error) {
        next(error);
    }
};
// ========================================
// ANALYTICS CONTROLLERS
// ========================================
/**
 * Get Aggregated Analytics Data
 *
 * Provides summary statistics and recent activity for admin dashboard
 *
 * Data Included:
 * - Total users count (all or filtered by plant)
 * - Total logins in last 24 hours
 * - Average session duration in seconds
 * - 10 most recent user sessions with details
 *
 * Plant Filtering:
 * - If plant query parameter provided, filters all data by that plant
 * - Allows factory managers to see analytics for their plant only
 *
 * @route   GET /api/admin/analytics
 * @access  BusinessAdmin
 * @query   {string} plant - Optional factory/plant name filter
 * @returns {object} Analytics summary object
 */
exports.getAnalyticsData = async (req, res, next) => {
    try {
        const { plant } = req.query;
        let queryParams = [];
        // ========================================
        // BUILD DYNAMIC WHERE CLAUSES
        // ========================================
        /**
         * Build WHERE clauses conditionally based on plant filter
         * Separate clauses for users and sessions tables
         */
        let userFilterClause = '';
        if (plant) {
            queryParams.push(plant);
            userFilterClause = `WHERE plant = $${queryParams.length}`;
        }
        let sessionFilterClause = '';
        if (plant) {
            sessionFilterClause = `WHERE plant = $${queryParams.length}`;
        }
        // ========================================
        // EXECUTE PARALLEL QUERIES
        // ========================================
        /**
         * Run multiple queries in parallel for better performance
         * Promise.all ensures all queries complete before processing results
         */
        const [totalUsersRes, totalLoginsTodayRes, avgSessionDurationRes, recentSessionsRes] = await Promise.all([
            // Total users (optionally filtered by plant)
            db.query(`SELECT COUNT(*) FROM users ${userFilterClause}`, queryParams.filter(p => p === plant)),
            // Logins in last 24 hours
            db.query(`SELECT COUNT(*) FROM user_sessions ${sessionFilterClause} 
         ${plant ? 'AND' : 'WHERE'} login_time >= NOW() - INTERVAL '24 hours'`, queryParams.filter(p => p === plant)),
            // Average session duration (excluding active sessions)
            db.query(`SELECT AVG(duration_seconds) FROM user_sessions ${sessionFilterClause} 
         ${plant ? 'AND' : 'WHERE'} duration_seconds IS NOT NULL`, queryParams.filter(p => p === plant)),
            // 10 most recent sessions
            db.query(`SELECT * FROM user_sessions ${sessionFilterClause} 
         ORDER BY login_time DESC LIMIT 10`, queryParams.filter(p => p === plant))
        ]);
        // ========================================
        // FORMAT RESPONSE DATA
        // ========================================
        const analyticsData = {
            totalUsers: parseInt(totalUsersRes.rows[0].count, 10),
            totalLoginsToday: parseInt(totalLoginsTodayRes.rows[0].count, 10),
            avgSessionDuration: avgSessionDurationRes.rows[0].avg
                ? Math.round(avgSessionDurationRes.rows[0].avg)
                : 0,
            recentSessions: recentSessionsRes.rows
        };
        res.json(analyticsData);
    }
    catch (error) {
        next(error);
    }
};
/**
 * Get Dashboard Chart Data
 *
 * Provides time-series and distribution data for admin dashboard charts
 *
 * Data Included:
 * - Active users currently online (last 15 minutes, not logged out)
 * - User distribution by plant/factory
 * - Login counts for last 7 days (daily breakdown)
 *
 * Plant Filtering:
 * - If plant parameter provided, filters chart data accordingly
 * - Useful for factory-specific analytics
 *
 * @route   GET /api/admin/analytics/dashboard
 * @access  BusinessAdmin
 * @query   {string} plant - Optional factory/plant name filter
 * @returns {object} Dashboard chart data
 */
exports.getAnalyticsDashboardData = async (req, res, next) => {
    try {
        const { plant } = req.query;
        let queryParams = [];
        // ========================================
        // BUILD FILTER CLAUSE FOR SESSIONS
        // ========================================
        /**
         * Join sessions with users table for plant filtering
         * Only applies when plant filter is specified
         */
        let sessionJoinFilterClause = '';
        if (plant) {
            queryParams.push(plant);
            sessionJoinFilterClause = `LEFT JOIN users u ON s.employee_id = u.employee_id WHERE u.plant = $${queryParams.length}`;
        }
        // ========================================
        // EXECUTE PARALLEL QUERIES
        // ========================================
        const [activeUsersRes, usersByPlantRes, loginsLast7DaysRes] = await Promise.all([
            // Currently active users (logged in within 15 minutes, not logged out)
            db.query(`SELECT COUNT(DISTINCT s.employee_id) FROM user_sessions s 
         JOIN users u ON s.employee_id = u.employee_id 
         ${plant ? 'WHERE u.plant = $1' : ''} 
         ${plant ? 'AND' : 'WHERE'} s.login_time >= NOW() - INTERVAL '15 minutes' 
         AND s.logout_time IS NULL`, queryParams),
            // User count grouped by plant (for pie/bar chart)
            db.query(`SELECT plant, COUNT(*) FROM users GROUP BY plant ORDER BY plant`),
            // Login counts for last 7 days (for line chart)
            db.query(`SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date, COUNT(s.session_id) AS login_count
         FROM (SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day')::date AS day) d
         LEFT JOIN user_sessions s ON DATE(s.login_time) = d.day
         ${sessionJoinFilterClause}
         GROUP BY d.day ORDER BY d.day;`, queryParams)
        ]);
        // ========================================
        // FORMAT RESPONSE DATA
        // ========================================
        const dashboardData = {
            activeUsersNow: parseInt(activeUsersRes.rows[0].count, 10),
            usersByPlant: usersByPlantRes.rows,
            loginsLast7Days: loginsLast7DaysRes.rows
        };
        res.json(dashboardData);
    }
    catch (error) {
        next(error);
    }
};
