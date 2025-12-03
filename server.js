/**
 * ========================================
 * WHITEBOX FACTORY TOOL MANAGEMENT SYSTEM
 * ========================================
 *
 * Main Express Server Entry Point
 *
 * Purpose:
 * - Configures Express server with middleware
 * - Sets up API routes for authentication, inventory, admin, and analytics
 * - Handles CORS for frontend communication
 * - Manages database connections
 * - Provides error handling and diagnostic endpoints
 *
 * Key Features:
 * - JWT-based authentication with HTTP-only cookies
 * - Role-based access control (User, Admin, MasterAdmin)
 * - Real-time tool tracking and maintenance history
 * - Daily analytics with automatic triggers
 * - Multi-factory inventory management
 *
 * Environment Variables Required:
 * - PORT: Server port (default: 3000)
 * - DB_HOST, DB_PORT, DB_DATABASE, DB_USER, DB_PASSWORD: PostgreSQL connection
 * - JWT_SECRET: Secret key for JWT token signing
 * - NODE_ENV: Environment mode (development/production)
 */
// ========================================
// CORE DEPENDENCIES
// ========================================
/**
 * Contract:
 * - Inputs: environment variables (PORT, DB_*, JWT_SECRET)
 * - Outputs: starts Express server listening on configured PORT
 * - Side-effects: registers API routes, middleware, and scheduled tasks
 * - Error modes: logs and continues on recoverable errors; uncaught exceptions are logged
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const dotenv = require('dotenv');
// Load environment variables from .env file
dotenv.config();
// ========================================
// ROUTE HANDLERS
// ========================================
// Authentication routes (login, logout, check auth)
const authRoutes = require('./src/routes/authRoutes');
// Factory management routes (get factories, factory access)
const factoryRoutes = require('./src/routes/factoryRoutes');
// Admin routes (user management, permissions, analytics)
const adminRoutes = require('./src/routes/admin');
// Centralized inventory routes (CRUD operations, filtering, export)
const inventoryRoutes = require('./src/routes/inventoryRoutes');
// Tool history routes (lifecycle data, charts, machine usage)
const toolHistoryRoutes = require('./src/routes/toolHistoryRoutes');
// New tool routes (Health Page and Logbook functionalities)
const toolRoutesNew = require('./src/routes/toolRoutesNew');
// ========================================
// CUSTOM MIDDLEWARE
// ========================================
// Error handling middleware for 404 and general errors
const { notFound, errorHandler } = require('./src/middleware/errorMiddleware');
// Database connection pool
const db = require('./src/config/db');
// ========================================
// EXPRESS APP INITIALIZATION
// ========================================
const app = express();
// ========================================
// MIDDLEWARE CONFIGURATION
// ========================================
// Note: Order of middleware is crucial for proper request handling
/**
 * CORS (Cross-Origin Resource Sharing) Configuration
 * Allows frontend application to communicate with backend API
 *
 * Configuration:
 * - origin: Allowed frontend URLs (localhost ports for development)
 * - credentials: Enable cookies to be sent with requests
 * - methods: HTTP methods permitted for cross-origin requests
 * - allowedHeaders: Headers that can be sent from frontend
 * - exposedHeaders: Headers that frontend can access in response
 */
app.use(cors({
    origin: ['http://localhost:5174', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Set-Cookie']
}));
/**
 * Body Parsing Middleware
 * - express.json(): Parse incoming JSON payloads
 * - express.urlencoded(): Parse URL-encoded form data
 */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
/**
 * Cookie Parser Middleware
 * Parses cookies attached to client requests
 * Required for JWT authentication stored in HTTP-only cookies
 */
app.use(cookieParser());
// ========================================
// API ROUTE REGISTRATION
// ========================================
/**
 * Authentication Routes
 * Base Path: /api/auth
 * Endpoints: login, logout, check-auth
 */
app.use('/api/auth', authRoutes);
/**
 * Factory Routes
 * Base Path: /api/factories
 * Endpoints: Get factories by user access, factory details
 */
app.use('/api/factories', factoryRoutes);
/**
 * Admin Routes
 * Base Path: /api/admin
 * Endpoints: User management, permissions, factory access, analytics
 * Access: Admin and MasterAdmin only
 */
app.use('/api/admin', adminRoutes);
/**
 * Centralized Inventory Routes
 * Base Path: /api/inventory
 * Endpoints: CRUD operations, filtering, search, Excel export, summary
 * Features: Multi-factory inventory, pagination, format management
 */
app.use('/api/inventory', inventoryRoutes);
/**
 * Tool History Routes
 * Base Path: /api/tool-history
 * Endpoints: Lifecycle data, chart analytics, machine usage, factory usage
 * Features: Material/batch search, cumulative tracking, maintenance history
 */
app.use('/api/tool-history', toolHistoryRoutes);
/**
 * Tool Health & Logbook Routes
 * Base Path: /api/new-tools
 * Endpoints: Health monitoring, logbook entries, issue tracking
 * Features: HLP data, TS revolutions, popular issues, raw data logs
 */
app.use('/api/new-tools', toolRoutesNew);
// ========================================
// DIAGNOSTIC & TEST ENDPOINTS
// ========================================
/**
 * Root endpoint - API health check
 * Returns simple message to verify server is running
 */
app.get('/', (req, res) => {
    res.send('API is running successfully.');
});
/**
 * Database connection test endpoint
 * Queries current timestamp from PostgreSQL to verify:
 * - Database connection is active
 * - Credentials are correct
 * - Query execution works
 *
 * Returns:
 * - Success: Current database timestamp
 * - Error: Connection error details
 */
app.get('/test-db', async (req, res) => {
    try {
        const { rows } = await db.query('SELECT NOW() as current_time');
        res.json({
            message: 'Database connected successfully!',
            timestamp: rows[0].current_time
        });
    }
    catch (error) {
        res.status(500).json({
            message: 'Database connection failed.',
            error: error.message
        });
    }
});
// ========================================
// ERROR HANDLING MIDDLEWARE
// ========================================
/**
 * 404 Not Found Handler
 * Catches all requests to undefined routes
 * Must be placed after all valid route definitions
 */
app.use(notFound);
/**
 * Global Error Handler
 * Catches all errors thrown in route handlers or middleware
 * Sends formatted error response to client
 * Logs errors for debugging
 */
app.use(errorHandler);
// ========================================
// SERVER STARTUP
// ========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    console.log('✅ Automatic daily summary triggers are active - no manual intervention required!');
});
// ========================================
// PROCESS-LEVEL ERROR HANDLERS
// ========================================
/**
 * Unhandled Promise Rejection Handler
 * Catches async errors that weren't caught in try-catch blocks
 * Prevents server crash from unhandled rejections
 */
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
/**
 * Uncaught Exception Handler
 * Catches synchronous errors not caught elsewhere
 * Last line of defense before server crash
 */
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
});
