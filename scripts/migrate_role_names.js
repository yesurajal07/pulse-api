/**
 * migrate_role_names.js
 *
 * Migration utility to rename legacy role identifiers across source files.
 * Purpose:
 *  - Replace 'MasterAdmin' with 'BusinessAdmin'
 *  - Replace 'Admin' with 'UnitAdmin'
 *
 * Usage:
 *  - Run locally on a development machine. This performs textual replacements
 *    in the source files listed below and prints SQL statements to update
 *    the database user roles.
 *
 * Notes:
 *  - Always review changes before committing. Consider running in a git branch.
 */
const fs = require('fs');
const path = require('path');
console.log('=== Role Name Migration ===\n');
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
const replacements = [
    { old: /MasterAdmin/g, new: 'BusinessAdmin' },
    { old: /'Admin'/g, new: "'UnitAdmin'" },
    { old: /"Admin"/g, new: '"UnitAdmin"' },
    { old: /\('Admin'\)/g, new: "('UnitAdmin')" },
    { old: /\("Admin"\)/g, new: '("UnitAdmin")' }
];
let totalReplacements = 0;
filesToUpdate.forEach(file => {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  File not found: ${file}`);
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;
    let fileReplacements = 0;
    replacements.forEach(({ old, new: newStr }) => {
        const matches = (content.match(old) || []).length;
        if (matches > 0) {
            content = content.replace(old, newStr);
            fileReplacements += matches;
        }
    });
    if (fileReplacements > 0) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ ${file}: ${fileReplacements} replacements`);
        totalReplacements += fileReplacements;
    }
    else {
        console.log(`⏭️  ${file}: No changes needed`);
    }
});
console.log(`\n✅ Total: ${totalReplacements} replacements across ${filesToUpdate.length} files\n`);
// Generate SQL for database migration
console.log('=== DATABASE MIGRATION SQL ===\n');
console.log('-- Update existing user roles in the database');
console.log('-- Run this in your PostgreSQL database:\n');
console.log(`UPDATE users SET role = 'BusinessAdmin' WHERE role = 'MasterAdmin';`);
console.log(`UPDATE users SET role = 'UnitAdmin' WHERE role = 'Admin';`);
console.log('\n-- Verify the changes:');
console.log('SELECT employee_id, username, role, factory_id FROM users ORDER BY role, username;\n');
console.log('=== IMPORTANT ===');
console.log('1. Restart the backend server after running this script');
console.log('2. Update any frontend code that references these role names');
console.log('3. Update any documentation/README files\n');
