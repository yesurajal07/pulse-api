/**
 * ========================================
 * ADMIN ROUTES
 * ========================================
 *
 * Handles administrative operations for user and factory management
 * All routes require ApplicationAdmin privileges
 *
 * Route Categories:
 * - User Management (create, list, delete users)
 * - Permission Management (role updates, password resets)
 * - Factory Access Management (grant/revoke factory permissions)
 * - Analytics (system-wide statistics and metrics)
 *
 * Access Levels:
 * - ApplicationAdmin: Full system admin access (ONLY role with admin privileges)
 * - BusinessAdmin: Business operations (NO admin access)
 * - UnitAdmin: Factory-level operations (NO admin access)
 *
 * Security:
 * - All routes protected by authMiddleware (JWT validation)
 * - Additional authorise middleware for role-based access
 * - ApplicationAdmin-only routes for all administrative operations
 */
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorise = require('../middleware/authorise');
const adminController = require('../controllers/adminController');
// ========================================
// PERMISSION LEVEL DEFINITIONS
// ========================================
/**
 * ApplicationAdmin Only
 * Full system administrator privilege
 * ONLY role with admin access to user management and system configuration
 */
const requireApplicationAdmin = [authMiddleware, authorise('ApplicationAdmin')];
// Legacy aliases for backward compatibility (all point to ApplicationAdmin)
const requireBusinessAdmin = requireApplicationAdmin;
const requireAdmin = requireApplicationAdmin;
// ========================================
// USER MANAGEMENT ROUTES
// ========================================
/**
 * User List and Creation
 *
 * GET /api/admin/users
 * - List all users with optional search/filter
 * - Returns: Array of users with roles and factory access
 *
 * POST /api/admin/users
 * - Create new user account
 * - Requires: name, employee_id, password, factory_id
 * - Auto-grants access to specified factory
 */
router.route('/users')
    .get(requireAdmin, adminController.getAllUsers)
    .post(requireAdmin, adminController.createUser);
/**
 * User Deletion
 *
 * DELETE /api/admin/users/:employeeId
 * - Permanently removes user account
 * - Cascades to user_factory_access and login_sessions
 * - Irreversible operation
 */
router.route('/users/:employeeId')
    .delete(requireAdmin, adminController.deleteUser);
// ========================================
// PERMISSION MANAGEMENT ROUTES
// ========================================
/**
 * Update User Role (BusinessAdmin Only)
 *
 * PUT /api/admin/users/:employeeId/permissions
 * - Change user role (User, UnitAdmin, BusinessAdmin)
 * - Only BusinessAdmin can modify roles
 * - Critical security operation
 */
router.route('/users/:employeeId/permissions')
    .put(requireBusinessAdmin, adminController.updateUserPermissions);
/**
 * Reset User Password
 *
 * PUT /api/admin/users/:employeeId/reset-password
 * - UnitAdmin or BusinessAdmin can reset passwords
 * - Password hashed with bcrypt before storage
 * - User should change password on next login
 */
router.route('/users/:employeeId/reset-password')
    .put(requireAdmin, adminController.resetUserPassword);
// ========================================
// FACTORY & ACCESS MANAGEMENT ROUTES
// ========================================
/**
 * List All Factories
 *
 * GET /api/admin/factories
 * - Returns all factories in system
 * - Used for factory selection in admin panels
 */
router.route('/factories')
    .get(requireAdmin, adminController.getAllFactories);
/**
 * Get User's Factory Access
 *
 * GET /api/admin/users/:employeeId/factories
 * - Returns list of factories user can access
 * - Used for managing user permissions
 */
router.route('/users/:employeeId/factories')
    .get(requireAdmin, adminController.getUserFactoryAccess);
/**
 * Grant or Revoke Factory Access
 *
 * POST /api/admin/users/:employeeId/factories/:factoryId
 * - Grant user access to specific factory
 * - Allows user to view/edit factory data
 *
 * DELETE /api/admin/users/:employeeId/factories/:factoryId
 * - Revoke user access to specific factory
 * - User loses all permissions for that factory
 */
router.route('/users/:employeeId/factories/:factoryId')
    .post(requireAdmin, adminController.grantFactoryAccess)
    .delete(requireAdmin, adminController.revokeFactoryAccess);
// ========================================
// ANALYTICS ROUTES (BusinessAdmin Only)
// ========================================
/**
 * General Analytics Data
 *
 * GET /api/admin/analytics
 * - System-wide statistics and metrics
 * - May include custom date ranges or filters
 * - BusinessAdmin only for security
 */
router.route('/analytics')
    .get(requireBusinessAdmin, adminController.getAnalyticsData);
/**
 * Analytics Dashboard Data
 *
 * GET /api/admin/analytics/dashboard
 * - Pre-aggregated dashboard metrics
 * - Optimized for quick dashboard loading
 * - Includes user activity, factory stats, tool metrics
 */
router.route('/analytics/dashboard')
    .get(requireBusinessAdmin, adminController.getAnalyticsDashboardData);
module.exports = router;
