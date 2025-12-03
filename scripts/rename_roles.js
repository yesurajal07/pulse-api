/**
 * rename_roles.js
 *
 * Utility script to replace legacy role names across the codebase.
 * Usage: Run locally to update source files (it performs in-place text replacements).
 * Purpose:
 *  - Replace occurrences of old role names (e.g., 'Admin', 'MasterAdmin')
 *    with the new naming convention used by the application.
 * Notes:
 *  - This script edits source files under backend/src; commit and review changes
 *    after running. It also prints SQL statements at the end to migrate database
 *    user roles if required.
 */
const fs = require('fs');
const path = require('path');
// Files to update
const filesToUpdate = [
    'src/controllers/inventoryController.js',
    'src/controllers/adminController.js',
    'src/controllers/factoryController.js',
    'src/routes/inventoryRoutes.js',
    'src/routes/toolHistoryRoutes.js',
    'src/routes/factoryRoutes.js',
    'src/routes/admin.js',
    'src/middleware/authorise.js'
];
console.log('='.repeat(60));
console.log('RENAMING ROLES');
console.log('Admin → UnitAdmin');
console.log('MasterAdmin → BusinessAdmin');
console.log('='.repeat(60));
let totalReplacements = 0;
let filesChanged = 0;
filesToUpdate.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        const before = content;
        // Replace role names (order matters!)
        // First replace MasterAdmin to avoid partial matches
        content = content.replace(/MasterAdmin/g, 'BusinessAdmin');
        // Then replace Admin (but not BusinessAdmin which we just created)
        content = content.replace(/\bAdmin\b/g, 'UnitAdmin');
        // Fix any accidental replacements of BusinessAdmin to BusinessUnitAdmin
        content = content.replace(/BusinessUnitAdmin/g, 'BusinessAdmin');
        // Also handle FactoryAdmin if it exists
        content = content.replace(/FactoryAdmin/g, 'UnitAdmin');
        const changes = (before !== content);
        if (changes) {
            fs.writeFileSync(filePath, content, 'utf8');
            const masterAdminCount = (before.match(/MasterAdmin/g) || []).length;
            const adminCount = (before.match(/\bAdmin\b/g) || []).length;
            const factoryAdminCount = (before.match(/FactoryAdmin/g) || []).length;
            const count = masterAdminCount + adminCount + factoryAdminCount;
            totalReplacements += count;
            filesChanged++;
            console.log(`✓ ${file}: ${count} replacements (MasterAdmin: ${masterAdminCount}, Admin: ${adminCount}, FactoryAdmin: ${factoryAdminCount})`);
        }
        else {
            console.log(`- ${file}: No changes needed`);
        }
    }
    else {
        console.log(`✗ ${file}: File not found`);
    }
});
console.log('='.repeat(60));
console.log(`Total: ${totalReplacements} replacements in ${filesChanged} files`);
console.log('='.repeat(60));
// Generate SQL to update database
console.log('\nSQL to update database roles:');
console.log('-- Update role names in users table');
console.log("UPDATE users SET role = 'BusinessAdmin' WHERE role = 'MasterAdmin';");
console.log("UPDATE users SET role = 'UnitAdmin' WHERE role = 'Admin';");
console.log("\n-- Verify changes");
console.log("SELECT username, employee_id, role, plant FROM users ORDER BY role, username;");
