/**
 * ========================================
 * AUTHENTICATION MIDDLEWARE
 * ========================================
 *
 * JWT Token Verification Middleware
 *
 * Purpose:
 * - Verifies JWT token from HTTP-only cookie
 * - Decodes token and attaches user info to request
 * - Protects routes from unauthorized access
 * - Validates token signature and expiration
 *
 * Usage:
 * Apply to any route that requires authentication:
 * router.get('/protected', authMiddleware, controller);
 *
 * Token Storage:
 * - Token stored in HTTP-only cookie (name: 'token')
 * - Set during login by authController
 * - Automatically sent by browser with each request
 *
 * Security Features:
 * - Validates JWT signature using secret key
 * - Checks token expiration (1 hour)
 * - Prevents access without valid token
 * - Catches tampered or malformed tokens
 *
 * Token Payload Structure:
 * {
 *   employee_id: string,
 *   name: string,
 *   role: string (User, UnitAdmin, BusinessAdmin),
 *   plant: string,
 *   session_id: number,
 *   factory_id: number
 * }
 */
/**
 * Contract:
 * - Inputs: HTTP request with cookies containing JWT token
 * - Outputs: attaches `req.user` (user object) on success, or sends 401 on failure
 * - Side-effects: reads and verifies JWT using JWT_SECRET; may log audit events
 * - Error modes: invalid/missing token => 401 Unauthorized; other errors forwarded
 */
const jwt = require('jsonwebtoken');
const db = require('../config/db');
/**
 * Authentication Middleware Function
 *
 * Process:
 * 1. Extract token from cookies
 * 2. Verify token exists
 * 3. Verify token signature and expiration with JWT_SECRET
 * 4. Decode token payload
 * 5. Attach user info to request object (req.user)
 * 6. Pass control to next middleware/controller
 *
 * Error Handling:
 * - Missing token: 401 Unauthorized
 * - Expired token: 401 Unauthorized
 * - Invalid signature: 401 Unauthorized
 * - Malformed token: 401 Unauthorized
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next middleware function
 */
const authMiddleware = async (req, res, next) => {
    try {
        // ========================================
        // STEP 1: EXTRACT TOKEN FROM COOKIE
        // ========================================
        /**
         * Cookie parser middleware (configured in server.js)
         * automatically parses cookies into req.cookies object
         */
        const token = req.cookies.token;
        if (!token) {
            return res.status(401).json({
                message: 'Access denied. No token provided.'
            });
        }
        // ========================================
        // STEP 2: VERIFY AND DECODE TOKEN
        // ========================================
        /**
         * jwt.verify() performs:
         * - Signature verification (using JWT_SECRET)
         * - Expiration check
         * - Decoding payload
         *
         * Throws error if any validation fails
         */
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // ========================================
        // STEP 3: ATTACH USER INFO TO REQUEST
        // ========================================
        /**
         * Attach decoded payload to req.user
         * Makes user information available to all subsequent middleware and controllers
         *
         * Available in controllers as: req.user.employee_id, req.user.role, etc.
         */
        req.user = decoded;
        // ========================================
        // STEP 4: PASS CONTROL TO NEXT HANDLER
        // ========================================
        /**
         * Authentication successful - proceed to next middleware or controller
         * User is now authenticated and their info is available in req.user
         */
        next();
    }
    catch (error) {
        // ========================================
        // ERROR HANDLING
        // ========================================
        /**
         * Catches various JWT errors:
         * - JsonWebTokenError: Invalid signature or malformed token
         * - TokenExpiredError: Token has expired (> 1 hour old)
         * - NotBeforeError: Token used before valid date
         */
        console.error('Auth middleware error:', error.message);
        return res.status(401).json({
            message: 'Not authorized, token failed'
        });
    }
};
module.exports = authMiddleware;
