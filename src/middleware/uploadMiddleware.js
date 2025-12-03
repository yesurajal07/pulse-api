/**
 * uploadMiddleware.js
 *
 * Multer configuration for handling file uploads attached to tool logs.
 * Purpose:
 *  - Store incoming files in the `uploads/` directory
 *  - Preserve original filename with a timestamp prefix to avoid collisions
 * Notes:
 *  - Ensure the `uploads/` directory exists and is writable by the server.
 */
const multer = require('multer');
const path = require('path');
// Set up storage engine
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});
// Initialize upload middleware
const upload = multer({
    storage: storage,
    limits: { fileSize: 10000000 }, // 10MB
    fileFilter: function (req, file, cb) {
        cb(null, true); // You can add MIME type filtering here
    }
});
module.exports = upload;
