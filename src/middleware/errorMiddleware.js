/**
 * ========================================
 * ERROR HANDLING MIDDLEWARE
 * ========================================
 *
 * Centralized Error Handling for Express Application
 *
 * Purpose:
 * - Catch 404 Not Found errors for undefined routes
 * - Handle all application errors in consistent format
 * - Provide detailed error info in development
 * - Hide sensitive error details in production
 *
 * Middleware Order (CRITICAL):
 * 1. All valid route definitions
 * 2. notFound middleware (catches undefined routes)
 * 3. errorHandler middleware (catches all other errors)
 *
 * Usage in server.js:
 * app.use('/api/auth', authRoutes);
 * app.use('/api/inventory', inventoryRoutes);
 * // ... all other routes ...
 * app.use(notFound);        // Must be AFTER all route definitions
 * app.use(errorHandler);    // Must be last middleware
 *
 * Error Flow:
 * - Route not found → notFound → errorHandler → JSON response
 * - Controller error → errorHandler → JSON response
 * - Database error → errorHandler → JSON response
 */
// ========================================
// 404 NOT FOUND HANDLER
// ========================================
/**
 * Handle 404 Not Found Errors
 *
 * Catches all requests that don't match any defined routes
 * Creates custom error object and passes to global error handler
 *
 * Common Causes:
 * - Typo in frontend API URL
 * - Route not defined in backend
 * - Missing route prefix (e.g., forgot /api/)
 * - Route defined after this middleware
 *
 * Placement:
 * - Must be placed AFTER all valid route definitions
 * - Must be placed BEFORE errorHandler middleware
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next middleware function
 */
const notFound = (req, res, next) => {
    /**
     * Create error object with descriptive message
     * Include the attempted URL for debugging
     */
    const error = new Error(`Not Found - ${req.originalUrl}`);
    /**
     * Set status code to 404
     * This ensures errorHandler knows this is a 404
     */
    res.status(404);
    /**
     * Pass error to next middleware (errorHandler)
     * next(error) triggers error handling middleware
     */
    next(error);
};
// ========================================
// GLOBAL ERROR HANDLER
// ========================================
/**
 * Global Error Handler
 *
 * Catches all errors thrown in application:
 * - Route handler errors (thrown or passed to next())
 * - Database query errors
 * - Validation errors
 * - Authentication errors
 * - 404 errors from notFound middleware
 *
 * Error Handling Strategy:
 * - Development: Show full error stack for debugging
 * - Production: Hide stack trace for security
 *
 * Response Format:
 * {
 *   message: "Error description",
 *   stack: "Stack trace (development only)"
 * }
 *
 * Note: 4 parameters required for error middleware
 * Express recognizes this as error handler by parameter count
 *
 * @param {Error} err - Error object (message, stack, etc.)
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next middleware function
 */
const errorHandler = (err, req, res, next) => {
    // ========================================
    // DETERMINE STATUS CODE
    // ========================================
    /**
     * Use existing status code if set (e.g., 404 from notFound)
     * Default to 500 Internal Server Error if not set
     *
     * res.statusCode === 200 means error occurred but status wasn't set
     * This happens when next(error) is called without setting status
     */
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode);
    // ========================================
    // SEND ERROR RESPONSE
    // ========================================
    /**
     * Send JSON error response
     *
     * message: Always included - describes what went wrong
     * stack: Only in development - full error stack trace
     *
     * Security:
     * - Production: stack is null (prevents exposing internal details)
     * - Development: stack included (helps debugging)
     */
    res.json({
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
};
// ========================================
// EXPORTS
// ========================================
/**
 * Export both middleware functions
 * Import in server.js as: const { notFound, errorHandler } = require('./middleware/errorMiddleware');
 */
module.exports = { notFound, errorHandler };
