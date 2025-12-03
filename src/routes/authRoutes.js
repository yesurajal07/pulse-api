/**
 * ========================================
 * AUTHENTICATION ROUTES
 * ========================================
 *
 * Handles user authentication and session management
 *
 * Routes:
 * - POST /api/auth/login - User login (public)
 * - POST /api/auth/logout - User logout (protected)
 * - GET /api/auth/status - Check authentication status (protected)
 *
 * Security:
 * - Login creates JWT token in HTTP-only cookie
 * - Logout requires valid token to prevent unauthorized session termination
 * - Status check validates current token and returns user info
 */
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
// ========================================
// PUBLIC ROUTES
// ========================================
/**
 * User Login
 * Accepts credentials and returns JWT token in HTTP-only cookie
 * No authentication required (public endpoint)
 */
router.post('/login', authController.login);
// ========================================
// PROTECTED ROUTES
// ========================================
/**
 * User Logout
 * Terminates user session and clears JWT cookie
 * Requires valid authentication token
 *
 * Why authMiddleware is needed:
 * - Prevents malicious logout of other users
 * - Tracks session duration for analytics
 * - Validates user existence before logout
 */
router.post('/logout', authMiddleware, authController.logout);
/**
 * Check Authentication Status
 * Returns current user info if token is valid
 * Used for frontend route protection and user context
 */
router.get('/status', authMiddleware, authController.checkAuthStatus);
// ========================================
// AD/IIS AUTHENTICATION ROUTES
// ========================================
/* ========================================
 * COMMENTED OUT - UNCOMMENT WHEN DEPLOYING TO IIS
 * ========================================
 *
 * Active Directory Authentication Routes
 * Only active when application is hosted on IIS with Windows Authentication
 *
 * Usage:
 * 1. Ensure IIS has Windows Authentication enabled
 * 2. Install node-sspi package: npm install node-sspi
 * 3. Uncomment the code below
 * 4. Update environment variables with AD configuration
 * 5. Map users in database with ad_username column

// Import AD middleware
// const adAuthMiddleware = require('../middleware/adAuthMiddleware');

// AD Login Route
// Triggered when user is authenticated by IIS Windows Authentication
// Similar to C# controller: if (User.Identity.IsAuthenticated)
// router.post('/ad-login', authController.loginWithAD);

// Alternative: Automatic AD authentication for all routes
// Apply AD middleware globally to auto-authenticate via Windows
// router.use(adAuthMiddleware);

========================================
END COMMENTED SECTION - AD ROUTES
======================================== */
module.exports = router;
