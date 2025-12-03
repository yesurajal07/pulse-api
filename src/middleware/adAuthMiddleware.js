/**
 * ========================================
 * ACTIVE DIRECTORY AUTHENTICATION MIDDLEWARE
 * ========================================
 *
 * Windows Integrated Authentication for IIS deployment
 *
 * Purpose:
 * - Authenticate users via Windows Active Directory credentials
 * - Extract user identity from IIS Windows Authentication
 * - Map AD users to application users in database
 * - Generate JWT tokens for AD-authenticated users
 *
 * Requirements:
 * - IIS with Windows Authentication enabled
 * - node-sspi package installed
 * - Users mapped in database with ad_username column
 *
 * NOTE: This middleware is only active when deployed on IIS
 * Local development uses standard username/password authentication
 *
 * Contract:
 * - Inputs: Windows credentials via IIS authentication context
 * - Outputs: JWT token in HTTP-only cookie, user object in req.user
 * - Side-effects: creates session records, queries AD for user info
 * - Error modes: AD unavailable -> fallback to local auth; user not mapped -> 403
 */
/* ========================================
 * COMMENTED OUT - UNCOMMENT WHEN DEPLOYING TO IIS
 * ========================================

const sspi = require('node-sspi');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// ========================================
// AD CONFIGURATION
// ========================================

const adConfig = {
  domain: process.env.AD_DOMAIN || 'YOURDOMAIN',
  ldapUrl: process.env.AD_LDAP_URL || 'ldap://dc.yourdomain.com',
  baseDN: process.env.AD_BASE_DN || 'DC=yourdomain,DC=com',
  enabled: process.env.AD_ENABLED === 'true',
  fallbackEnabled: process.env.AUTH_FALLBACK_ENABLED === 'true'
};

// ========================================
// AD AUTHENTICATION MIDDLEWARE
// ========================================

const adAuthMiddleware = async (req, res, next) => {
  try {
    // Check if AD authentication is enabled
    if (!adConfig.enabled) {
      console.log('[AD Auth] AD authentication is disabled, skipping');
      return next();
    }

    // ========================================
    // EXTRACT WINDOWS USER IDENTITY
    // ========================================
    
    // IIS provides authenticated user via User.Identity
    // This comes from Windows Authentication challenge
    const windowsUser = req.headers['x-iisnode-auth_user'] || req.connection.user;
    
    if (!windowsUser) {
      console.log('[AD Auth] No Windows user identity found');
      
      if (adConfig.fallbackEnabled) {
        // Allow fallback to local authentication
        return next();
      }
      
      return res.status(401).json({
        message: 'Windows authentication required',
        authType: 'ad'
      });
    }

    console.log(`[AD Auth] Windows user authenticated: ${windowsUser}`);

    // ========================================
    // LOOKUP USER IN DATABASE
    // ========================================
    
    // Match AD username to application user
    // Format: DOMAIN\username or username@domain.com
    const { rows } = await db.query(
      `SELECT u.*, f.factory_id
       FROM users u
       LEFT JOIN factories f ON u.plant = f.name
       WHERE u.ad_username = $1 AND u.auth_type = 'ad'`,
      [windowsUser]
    );

    if (rows.length === 0) {
      console.error(`[AD Auth] User not found in database: ${windowsUser}`);
      return res.status(403).json({
        message: 'User not authorized. Please contact administrator to map your AD account.',
        adUsername: windowsUser
      });
    }

    const user = rows[0];
    console.log(`[AD Auth] User found: ${user.username} (${user.employee_id})`);

    // ========================================
    // CREATE SESSION FOR ANALYTICS
    // ========================================
    
    const ipAddress = req.ip;
    const sessionQuery = `
      INSERT INTO user_sessions (employee_id, username, role, plant, ip_address, auth_type)
      VALUES ($1, $2, $3, $4, $5, 'ad')
      RETURNING session_id;
    `;
    
    const sessionResult = await db.query(sessionQuery, [
      user.employee_id,
      user.username,
      user.role,
      user.plant,
      ipAddress
    ]);
    
    const sessionId = sessionResult.rows[0].session_id;
    console.log(`[AD Auth] Session created: ${sessionId}`);

    // ========================================
    // GENERATE JWT TOKEN
    // ========================================
    
    const token = jwt.sign(
      {
        employee_id: user.employee_id,
        name: user.name,
        role: user.role,
        plant: user.plant,
        session_id: sessionId,
        factory_id: user.factory_id,
        auth_type: 'ad',
        ad_username: windowsUser
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // ========================================
    // SET COOKIE
    // ========================================
    
    const cookieOptions = {
      httpOnly: true,
      maxAge: 60 * 60 * 1000, // 1 hour
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    };

    res.cookie('token', token, cookieOptions);

    // Attach user to request for downstream middleware
    req.user = {
      employee_id: user.employee_id,
      name: user.name,
      role: user.role,
      plant: user.plant,
      factory_id: user.factory_id,
      auth_type: 'ad'
    };

    console.log(`[AD Auth] Authentication successful for ${user.username}`);
    next();

  } catch (error) {
    console.error('[AD Auth] Error:', error);
    
    if (adConfig.fallbackEnabled) {
      console.log('[AD Auth] Falling back to local authentication');
      return next();
    }
    
    res.status(500).json({
      message: 'Authentication error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = adAuthMiddleware;

========================================
END COMMENTED SECTION
======================================== */
// ========================================
// PLACEHOLDER FOR DEVELOPMENT
// ========================================
/**
 * Empty middleware for local development
 * This allows the application to run without IIS/AD configuration
 * Replace this with the commented code above when deploying to IIS
 */
const adAuthMiddleware = (req, res, next) => {
    // No-op in development - AD auth not available
    next();
};
module.exports = adAuthMiddleware;
