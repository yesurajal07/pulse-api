/**
 * revert_role_names.js
 *
 * Utility to revert role name replacements previously applied by the
 * migration scripts. Use this script to roll back textual role-name changes
 * across the codebase. It performs in-place edits so review changes after
 * running and commit if the reversion is intended.
 */
const fs = require('fs');
const path = require('path');
// Files to revert
const filesToRevert = [
    'src/controllers/inventoryController.js',
    'src/controllers/adminController.js',
    'src/controllers/factoryController.js',
    'src/routes/inventoryRoutes.js',
    'src/routes/toolHistoryRoutes.js',
    'src/routes/factoryRoutes.js',
    'src/middleware/admin.js',
    'src/middleware/authorise.js'
];
console.log('='.repeat(60));
console.log('REVERTING ROLE NAMES');
console.log('BusinessAdmin → MasterAdmin');
console.log('UnitAdmin → Admin');
console.log('='.repeat(60));
let totalReplacements = 0;
let filesChanged = 0;
filesToRevert.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        const before = content;
        // Revert the role names
        content = content.replace(/BusinessAdmin/g, 'MasterAdmin');
        content = content.replace(/UnitAdmin/g, 'Admin');
        const changes = (before !== content);
        if (changes) {
            fs.writeFileSync(filePath, content, 'utf8');
            const count = (before.match(/BusinessAdmin/g) || []).length +
                (before.match(/UnitAdmin/g) || []).length;
            totalReplacements += count;
            filesChanged++;
            console.log(`✓ ${file}: ${count} replacements`);
        }
    }
    else {
        console.log(`✗ ${file}: File not found`);
    }
});
console.log('='.repeat(60));
console.log(`Total: ${totalReplacements} replacements in ${filesChanged} files`);
console.log('='.repeat(60));
// Generate SQL to revert database
console.log('\nSQL to revert database roles:');
console.log('-- Revert role names in users table');
console.log("UPDATE users SET role = 'MasterAdmin' WHERE role = 'BusinessAdmin';");
console.log("UPDATE users SET role = 'Admin' WHERE role = 'UnitAdmin';");
console.log("\n-- Verify changes");
console.log("SELECT username, employee_id, role, plant FROM users ORDER BY role, username;");
