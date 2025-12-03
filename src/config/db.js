/**
 * ========================================
 * DATABASE CONNECTION CONFIGURATION
 * ========================================
 *
 * PostgreSQL Database Connection Pool
 *
 * Purpose:
 * - Manages persistent connections to PostgreSQL database
 * - Provides connection pooling for efficient resource usage
 * - Handles connection errors and logging
 * - Exports query interface for database operations
 *
 * Connection Pool Benefits:
 * - Reuses existing connections instead of creating new ones
 * - Improves performance for concurrent requests
 * - Automatically handles connection lifecycle
 * - Prevents connection exhaustion
 *
 * Environment Variables Used:
 * - DB_USER: PostgreSQL username
 * - DB_HOST: Database server address
 * - DB_DATABASE: Database name (whitebox_db)
 * - DB_PASSWORD: Database password
 * - DB_PORT: Database port (default: 5432)
 */
const { Pool } = require('pg');
const dotenv = require('dotenv');
// Load environment variables
dotenv.config();
// ========================================
// CONNECTION POOL INITIALIZATION
/**
 * Contract:
 * - Inputs: process.env DB_HOST, DB_PORT, DB_DATABASE, DB_USER, DB_PASSWORD
 * - Outputs: exported `query` and `client` helpers for running SQL
 * - Side-effects: creates a pool and logs connection status
 * - Error modes: throws on connection failure; callers should catch errors
 */
// ========================================
/**
 * Create PostgreSQL connection pool
 * Pool maintains multiple persistent connections for concurrent queries
 */
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});
// ========================================
// ERROR HANDLING & MONITORING
// ========================================
/**
 * Connection Error Handler
 * Logs any connection errors that occur during pool operations
 * Helps diagnose connection issues without crashing server
 */
pool.on('error', (err) => {
    console.error('Database connection error:', err);
});
/**
 * Connection Details Logging
 * Displays connection configuration (without password) for debugging
 * Helps verify environment variables are loaded correctly
 */
console.log('Attempting to connect with:', {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER
});
// ========================================
// STARTUP CONNECTION TEST
// ========================================
/**
 * Test Database Connection on Server Startup
 * Attempts to acquire a client from the pool to verify:
 * - Credentials are correct
 * - Database is accessible
 * - Network connection is working
 *
 * This early check prevents runtime errors from bad configuration
 */
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error acquiring client:', err.stack);
        console.error('Connection details:', {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: process.env.DB_DATABASE,
            user: process.env.DB_USER
        });
    }
    else {
        console.log('Database connected successfully');
        release(); // Return client to pool
    }
});
// ========================================
// EXPORT DATABASE INTERFACE
// ========================================
/**
 * Export query method for use throughout application
 *
 * Usage:
 * const db = require('./config/db');
 * const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
 *
 * Parameters:
 * - text: SQL query string (use $1, $2 for parameterized queries)
 * - params: Array of parameter values to prevent SQL injection
 *
 * Returns:
 * - Promise resolving to query result object
 * - Result object contains: rows[], rowCount, fields[], etc.
 */
module.exports = {
    query: (text, params) => pool.query(text, params),
};
