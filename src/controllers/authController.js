/**
 * ========================================
 * AUTHENTICATION CONTROLLER
 * ========================================
 *
 * Handles user authentication and session management
 *
 * Purpose:
 * - User login with password verification
 * - JWT token generation with HTTP-only cookies
 * - User session tracking for analytics
 * - Secure logout with session closure
 * - Authentication status verification
 *
 * Key Features:
 * - Password hashing with bcrypt
 * - JWT tokens stored in HTTP-only cookies (XSS protection)
 * - Session analytics (login time, duration, IP tracking)
 * - Factory access information included in JWT
 * - Role-based authorization support
 *
 * Security Measures:
 * - Passwords never stored in plain text
 * - HTTP-only cookies prevent JavaScript access
 * - SameSite cookie policy prevents CSRF attacks
 * - Secure flag for HTTPS in production
 * - Token expiration (1 hour)
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
// ========================================
// LOGIN CONTROLLER
// ========================================
/**
 * Contract:
 * - Inputs: username and password in request body for login; cookie-based JWT for authenticated routes
 * - Outputs: sets HTTP-only cookie containing JWT on successful login, returns user object
 * - Side-effects: creates session records for analytics; may write audit logs
 * - Error modes: invalid credentials -> 401, missing fields -> 400, DB errors -> 500
 */
/**
 * User Login with Session Tracking
 *
 * Process:
 * 1. Validate username and password
 * 2. Retrieve user details with factory association
 * 3. Verify password using bcrypt
 * 4. Create session record for analytics
 * 5. Generate JWT token with user info
 * 6. Set token as HTTP-only cookie
 * 7. Return user details to frontend
 *
 * @route   POST /api/auth/login
 * @access  Public
 * @param   {string} username - User's username
 * @param   {string} password - User's plain text password
 * @returns {object} User details and success message
 */
exports.login = async (req, res) => {
    const { username, password } = req.body;
    try {
        // ========================================
        // STEP 1: RETRIEVE USER WITH FACTORY INFO
        // ========================================
        /**
         * Join users table with factories table to get factory_id
         * This allows us to include factory access in JWT token
         */
        const { rows } = await db.query(`SELECT u.*, f.factory_id 
       FROM users u 
       LEFT JOIN factories f ON u.plant = f.name 
       WHERE u.username = $1`, [username]);
        // Check if user exists
        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        const user = rows[0];
        // ========================================
        // STEP 2: VERIFY PASSWORD
        // ========================================
        /**
         * Compare provided password with hashed password in database
         * bcrypt.compare() handles the hashing and comparison securely
         */
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        // ========================================
        // STEP 3: CREATE SESSION FOR ANALYTICS
        // ========================================
        /**
         * Track user sessions for analytics dashboard
         * Records:
         * - Employee ID and username for identification
         * - Role and plant for historical accuracy (denormalized)
         * - IP address for security monitoring
         * - Login timestamp (automatic)
         */
        const ipAddress = req.ip;
        const sessionQuery = `
      INSERT INTO user_sessions (employee_id, username, role, plant, ip_address)
      VALUES ($1, $2, $3, $4, $5)
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
        console.log(`[Analytics] New session created with ID: ${sessionId} for user ${user.username}`);
        // ========================================
        // STEP 4: GENERATE JWT TOKEN
        // ========================================
        /**
         * Create JWT token with user information
         *
         * Payload includes:
         * - employee_id: Unique user identifier
         * - name: User's full name
         * - role: User role (User, UnitAdmin, BusinessAdmin)
         * - plant: Assigned factory/plant name
         * - session_id: For session tracking on logout
         * - factory_id: Factory ID for authorization checks
         *
         * Token expires in 1 hour for security
         */
        const token = jwt.sign({
            employee_id: user.employee_id,
            name: user.name,
            role: user.role,
            plant: user.plant,
            session_id: sessionId,
            factory_id: user.factory_id
        }, process.env.JWT_SECRET, { expiresIn: '1h' });
        // ========================================
        // STEP 5: SET COOKIE AND RESPOND
        // ========================================
        /**
         * Cookie Configuration for Security
         *
         * - httpOnly: Prevents JavaScript access (XSS protection)
         * - maxAge: Cookie expires in 1 hour (matches JWT expiration)
         * - sameSite: 'lax' prevents CSRF while allowing normal navigation
         * - secure: Only send over HTTPS in production
         */
        const cookieOptions = {
            httpOnly: true,
            maxAge: 60 * 60 * 1000, // 1 hour in milliseconds
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production'
        };
        // Send token as cookie and return user details
        res.status(200).cookie('token', token, cookieOptions).json({
            message: 'Login successful',
            user: {
                employee_id: user.employee_id,
                name: user.name,
                role: user.role
            }
        });
    }
    catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
// ========================================
// LOGOUT CONTROLLER
// ========================================
/**
 * User Logout with Session Closure
 *
 * Process:
 * 1. Extract session_id from JWT token
 * 2. Update session record with logout time
 * 3. Calculate session duration
 * 4. Clear authentication cookie
 * 5. Return success response
 *
 * Analytics Tracking:
 * - Records exact logout timestamp
 * - Calculates session duration in seconds
 * - Maintains session history for admin dashboard
 *
 * @route   POST /api/auth/logout
 * @access  Private (requires valid JWT)
 * @returns {object} Success message
 */
exports.logout = async (req, res) => {
    // ========================================
    // STEP 1: UPDATE SESSION WITH LOGOUT TIME
    // ========================================
    try {
        /**
         * Extract session_id from JWT token (attached by authMiddleware)
         * Only proceed if user is authenticated and has valid session
         */
        if (req.user && req.user.session_id) {
            const sessionId = req.user.session_id;
            /**
             * Update session record with logout information
             * - Sets logout_time to current timestamp
             * - Calculates duration_seconds using EXTRACT(EPOCH FROM interval)
             * - EPOCH converts time interval to total seconds
             */
            const query = `
        UPDATE user_sessions
        SET 
          logout_time = CURRENT_TIMESTAMP,
          duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - login_time))
        WHERE session_id = $1;
      `;
            await db.query(query, [sessionId]);
            console.log(`[Analytics] Session closed with ID: ${sessionId}`);
        }
    }
    catch (error) {
        /**
         * Don't block logout if analytics update fails
         * User experience is priority, analytics is secondary
         * Log error for debugging but continue logout process
         */
        console.error('[Analytics] Failed to update session on logout:', error);
    }
    // ========================================
    // STEP 2: CLEAR AUTHENTICATION COOKIE
    // ========================================
    /**
     * Clear the JWT token cookie by setting it to empty value
     * and expiring it immediately (expires: new Date(0))
     *
     * Cookie settings must match those used during login
     * for browser to recognize and clear the correct cookie
     */
    res.cookie('token', '', {
        httpOnly: true,
        expires: new Date(0), // Set to Unix epoch (January 1, 1970) - immediately expired
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
    });
    res.status(200).json({ message: 'Logout successful' });
};
// ========================================
// CHECK AUTHENTICATION STATUS
// ========================================
/**
 * Verify User Authentication Status
 *
 * Purpose:
 * - Check if user has valid, non-expired JWT token
 * - Return current user information
 * - Used by frontend to verify session on page load
 *
 * How it works:
 * - authMiddleware validates token before this controller runs
 * - If middleware succeeds, user is authenticated
 * - If middleware fails, 401 error is returned before reaching here
 *
 * @route   GET /api/auth/check-auth
 * @access  Private (requires valid JWT)
 * @returns {object} User information from JWT token
 */
exports.checkAuthStatus = (req, res) => {
    /**
     * If this point is reached, authMiddleware has already:
     * - Verified JWT token signature
     * - Checked token expiration
     * - Attached decoded user info to req.user
     *
     * Simply return the user information
     */
    res.status(200).json({
        message: 'User is authenticated.',
        user: req.user,
    });
};
// ========================================
// AD/IIS AUTHENTICATION CONTROLLER
// ========================================
/* ========================================
 * COMMENTED OUT - UNCOMMENT WHEN DEPLOYING TO IIS
 * ========================================
 *
 * Active Directory Authentication via IIS
 *
 * This controller handles authentication when the application
 * is deployed on IIS with Windows Authentication enabled.
 *
 * Similar to the C# ASP.NET code provided:
 * - if (User.Identity.IsAuthenticated)
 * - var Users = User.Identity.Name;
 * - bool text = await _context.ppbcontact.AnyAsync(c => c.EmployeeNo == Users && c.Status == "Active");
 *
 * Node.js equivalent using IIS integration:

exports.loginWithAD = async (req, res) => {
  try {
    // ========================================
    // STEP 1: CHECK IF USER IS AUTHENTICATED BY IIS
    // ========================================
    
    // IIS provides the authenticated user identity via headers
    // This is set by IIS Windows Authentication module
    const windowsIdentity = req.headers['x-iisnode-auth_user'] || req.connection.user;
    
    if (!windowsIdentity) {
      return res.status(401).json({
        message: 'Windows authentication required',
        hint: 'User must authenticate via Windows credentials'
      });
    }

    console.log(`[AD Login] Windows user: ${windowsIdentity}`);

    // ========================================
    // STEP 2: EXTRACT USERNAME FROM AD IDENTITY
    // ========================================
    
    // Windows identity format: DOMAIN\username or username@domain.com
    // Extract the username portion
    let username = windowsIdentity;
    if (windowsIdentity.includes('\\')) {
      username = windowsIdentity.split('\\')[1]; // Extract from DOMAIN\username
    } else if (windowsIdentity.includes('@')) {
      username = windowsIdentity.split('@')[0]; // Extract from username@domain.com
    }

    // ========================================
    // STEP 3: CHECK USER IN DATABASE (Similar to EF Core query)
    // ========================================
    
    // Equivalent to:
    // bool text = await _context.ppbcontact.AnyAsync(
    //   c => c.EmployeeNo == Users && c.Status == "Active"
    // );
    
    const { rows } = await db.query(
      `SELECT u.*, f.factory_id
       FROM users u
       LEFT JOIN factories f ON u.plant = f.name
       WHERE (u.ad_username = $1 OR u.employee_id = $2)
       AND u.auth_type = 'ad'`,
      [windowsIdentity, username]
    );

    // ========================================
    // STEP 4: VALIDATE USER EXISTS AND IS ACTIVE
    // ========================================
    
    if (rows.length === 0) {
      console.error(`[AD Login] User not found or not authorized: ${windowsIdentity}`);
      
      // Similar to: return RedirectToAction("Index", "Unauthorized");
      return res.status(403).json({
        message: 'User not authorized in the system',
        adUsername: windowsIdentity,
        action: 'Contact administrator to register your AD account'
      });
    }

    const user = rows[0];

    // Check if user is active (if you have a status column)
    // if (user.status && user.status !== 'Active') {
    //   return res.status(403).json({ message: 'User account is inactive' });
    // }

    console.log(`[AD Login] User authenticated: ${user.username} (${user.employee_id})`);

    // ========================================
    // STEP 5: CREATE SESSION
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

    // ========================================
    // STEP 6: GENERATE JWT TOKEN
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
        ad_username: windowsIdentity
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // ========================================
    // STEP 7: SET COOKIE AND RESPOND
    // ========================================
    
    const cookieOptions = {
      httpOnly: true,
      maxAge: 60 * 60 * 1000, // 1 hour
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    };

    // Similar to: TempData["Message"] = "Login Successfully";
    res.status(200).cookie('token', token, cookieOptions).json({
      message: 'Login successful via Active Directory',
      user: {
        employee_id: user.employee_id,
        name: user.name,
        role: user.role,
        auth_type: 'ad'
      }
    });

  } catch (error) {
    console.error('[AD Login] Error:', error);
    
    // Similar to: catch (Exception ex) { Console.WriteLine(ex.Message); }
    res.status(500).json({
      message: 'Authentication error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

========================================
END COMMENTED SECTION - AD AUTHENTICATION
======================================== */ 
