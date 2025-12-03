/**
 * ========================================
 * AUTHORIZATION MIDDLEWARE
 * ========================================
 *
 * Role-Based Access Control (RBAC) Middleware
 *
 * Purpose:
 * - Enforces role-based access control for routes
 * - Checks if user's role is allowed to access endpoint
 * - Works in conjunction with authMiddleware
 * - Provides flexible role permissions per route
 *
 * System Roles:
 * - User: Basic access, view own factory tools
 * - UnitAdmin: Factory-level management, edit tools in assigned factory
 * - BusinessAdmin: Business operations, manage all tools and factories
 * - ApplicationAdmin: Full system admin, user management, system configuration
 *
 * Usage Examples:
 * // Single role
 * router.get('/admin-only', authMiddleware, authorise('ApplicationAdmin'), controller);
 *
 * // Multiple roles
 * router.post('/tool/create', authMiddleware, authorise('UnitAdmin', 'BusinessAdmin'), controller);
 *
 * // All authenticated users (use only authMiddleware)
 * router.get('/profile', authMiddleware, controller);
 *
 * Middleware Order:
 * 1. authMiddleware (validates token, attaches req.user)
 * 2. authorise(...roles) (checks req.user.role)
 * 3. Controller (executes business logic)
 *
 * Security Note:
 * - Always apply authMiddleware BEFORE authorise
 * - authorise depends on req.user being set by authMiddleware
 * - Returns 403 Forbidden if role not authorized
 * - Returns 403 Forbidden if req.user missing (authMiddleware failed)
 */
/**
 * Create Authorization Middleware with Allowed Roles
 *
 * This is a middleware factory function that returns configured middleware.
 * It accepts a variable number of role strings as arguments and returns an
 * Express middleware function that checks `req.user.role` against the list.
 *
 * Process:
 * 1. Accept list of allowed roles
 * 2. Return middleware function that checks user's role
 * 3. Allow access if user's role matches any allowed role
 * 4. Deny access (403) if role doesn't match
 *
 * Contract:
 * - Inputs: `req.user` (populated by authMiddleware) and a list of allowed roles
 * - Outputs: calls next() when authorized, or responds 403 when forbidden
 * - Side-effects: none (pure check), but logs may be emitted for denied access
 * - Error modes: missing `req.user` => 401; unauthorized role => 403
 *
 * @param {...string} allowedRoles - Variable number of role strings allowed for route
 * @returns {function} Express middleware function
 *
 * @example
 * // Allow only BusinessAdmin
 * authorise('BusinessAdmin')
 *
 * @example
 * // Allow UnitAdmin or BusinessAdmin
 * authorise('UnitAdmin', 'BusinessAdmin')
 *
 * @example
 * // Allow all roles (User, UnitAdmin, BusinessAdmin)
 * authorise('User', 'UnitAdmin', 'BusinessAdmin')
 */
const authorise = (...allowedRoles) => {
    /**
     * Returned middleware function
     * This is the actual middleware that executes during request
     *
     * @param {object} req - Express request object (must have req.user from authMiddleware)
     * @param {object} res - Express response object
     * @param {function} next - Express next middleware function
     */
    return (req, res, next) => {
        // ========================================
        // STEP 1: VERIFY USER INFO EXISTS
        // ========================================
        /**
         * Check if req.user and req.user.role exist
         * req.user is attached by authMiddleware
         *
         * If missing, authMiddleware wasn't applied or failed silently
         */
        if (!req.user || !req.user.role) {
            return res.status(403).json({
                message: 'Forbidden: Role not found in token.'
            });
        }
        const { role } = req.user;
        // ========================================
        // STEP 2: CHECK ROLE AUTHORIZATION
        // ========================================
        /**
         * Compare user's role against list of allowed roles
         * Uses includes() for simple array membership check
         *
         * Role check is case-sensitive:
         * - 'UnitAdmin' !== 'admin'
         * - Roles must match exactly as stored in database
         */
        if (allowedRoles.includes(role)) {
            // ========================================
            // AUTHORIZATION SUCCESSFUL
            // ========================================
            /**
             * User's role is in allowed list
             * Proceed to next middleware or controller
             */
            next();
        }
        else {
            // ========================================
            // AUTHORIZATION FAILED
            // ========================================
            /**
             * User's role not in allowed list
             * Return 403 Forbidden with descriptive message
             *
             * Difference from 401:
             * - 401 Unauthorized: No valid token (not authenticated)
             * - 403 Forbidden: Valid token but insufficient permissions (authenticated but not authorized)
             */
            res.status(403).json({
                message: `Forbidden: Your role ('${role}') is not authorized to access this resource.`
            });
        }
    };
};
module.exports = authorise;
