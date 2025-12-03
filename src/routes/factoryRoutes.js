/**
 * ========================================
 * FACTORY ROUTES
 * ========================================
 *
 * Handles factory information and engineering logbook operations
 *
 * Route Categories:
 * - Factory Information (list, details)
 * - Engineering Logbook (CRUD operations)
 * - Cross-factory Views (BusinessAdmin only)
 *
 * Access Control:
 * - Users see only factories they have access to
 * - BusinessAdmin sees all factories
 * - Logbook entries editable by author, UnitAdmin, or BusinessAdmin
 *
 * Features:
 * - File attachments for logbook entries (multer middleware)
 * - Rich filtering (machine, status, author, date, search)
 * - Update tracking (update_count increments on edit)
 */
const express = require('express');
const router = express.Router();
// Controllers
const factoryController = require('../controllers/factoryController');
// Middleware
const authMiddleware = require('../middleware/authMiddleware');
const authorise = require('../middleware/authorise');
const upload = require('../middleware/uploadMiddleware');
// ========================================
// FACTORY INFORMATION ROUTES
// ========================================
/**
 * Get Eligible Factories
 *
 * GET /api/factories
 * - Returns factories accessible to current user
 * - BusinessAdmin sees all factories
 * - Regular users see only assigned factories
 */
router.get('/', authMiddleware, factoryController.getEligibleFactories);
// ========================================
// BUSINESS ADMIN GLOBAL ROUTES
// ========================================
// Must be ABOVE ":id" routes to avoid route conflicts
/**
 * All Factories Logbook (BusinessAdmin Only)
 *
 * GET /api/factories/all/logbook
 * - Cross-factory logbook view
 * - Includes factory names in results
 * - Supports "plant" filter parameter
 */
router.get('/all/logbook', authMiddleware, authorise('BusinessAdmin'), factoryController.getAllFactoriesLogbook);
/**
 * All Logbook Authors (BusinessAdmin Only)
 *
 * GET /api/factories/all/logbook/authors
 * - Returns distinct authors across all factories
 * - Used for cross-factory author filtering
 */
router.get('/all/logbook/authors', authMiddleware, authorise('BusinessAdmin'), factoryController.getAllLogbookAuthors);
// ========================================
// FACTORY-SPECIFIC ROUTES
// ========================================
/**
 * Get Single Factory Details
 *
 * GET /api/factories/:id
 * - Returns factory information if user has access
 * - 403 Forbidden if user lacks access
 * - BusinessAdmin bypasses access check
 */
router.get('/:id', authMiddleware, factoryController.getFactoryIfEligible);
// ========================================
// ENGINEERING LOGBOOK ROUTES
// ========================================
/**
 * Logbook Entries (List & Create)
 *
 * GET /api/factories/:id/logbook
 * - Returns filtered logbook entries
 * - Filters: machine, status, author, startDate, endDate, search
 * - Includes author names via JOIN
 *
 * POST /api/factories/:id/logbook
 * - Create new logbook entry
 * - Supports file attachment (single file)
 * - Validates factory access before creation
 * - File handled by multer middleware
 */
router.route('/:id/logbook')
    .get(authMiddleware, factoryController.getLogbookEntries)
    .post(authMiddleware, upload.single('attachment'), factoryController.addLogbookEntry);
/**
 * Single Logbook Entry Operations
 *
 * PUT /api/factories/:id/logbook/:logId
 * - Update existing entry
 * - Only author, UnitAdmin, or BusinessAdmin can edit
 * - Increments update_count on each edit
 *
 * DELETE /api/factories/:id/logbook/:logId
 * - Delete logbook entry
 * - Only author, UnitAdmin, or BusinessAdmin can delete
 * - Permanent deletion (no soft delete)
 * - Note: Attached file not auto-deleted from filesystem
 */
router.route('/:id/logbook/:logId')
    .put(authMiddleware, factoryController.updateLogbookEntry)
    .delete(authMiddleware, factoryController.deleteLogbookEntry);
/**
 * Logbook Authors for Factory
 *
 * GET /api/factories/:id/logbook/authors
 * - Returns distinct authors who wrote entries in this factory
 * - Used for author filter dropdown
 * - Sorted alphabetically by name
 */
router.get('/:id/logbook/authors', authMiddleware, factoryController.getLogbookAuthors);
module.exports = router;
