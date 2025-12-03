/**
 * update_frontend_roles.js
 *
 * Small maintenance helper that updates role names in frontend JSX/JS files.
 * Usage: Run on a development machine to scan and replace role name strings
 * within the frontend source tree. Review and commit changes after running.
 */
const fs = require('fs');
const path = require('path');
const glob = require('glob');
// Find all JSX files in frontend
const srcPath = path.join(__dirname, '..', '..', 'frontend', 'my-factory-app', 'src');
const files = glob.sync('**/*.{jsx,js}', { cwd: srcPath });
console.log('='.repeat(60));
console.log('UPDATING FRONTEND ROLE NAMES');
console.log('MasterAdmin → BusinessAdmin');
console.log('Admin → UnitAdmin');
console.log('='.repeat(60));
let totalReplacements = 0;
let filesChanged = 0;
files.forEach(file => {
    const filePath = path.join(srcPath, file);
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        const before = content;
        // Replace role names (order matters!)
        // First replace MasterAdmin to avoid partial matches
        content = content.replace(/MasterAdmin/g, 'BusinessAdmin');
        // Then replace Admin carefully - need to avoid replacing BusinessAdmin
        // Use word boundaries to match standalone Admin
        content = content.replace(/(['"`])Admin\1/g, '$1UnitAdmin$1');
        content = content.replace(/role\s*===\s*(['"`])Admin\1/g, 'role === $1UnitAdmin$1');
        content = content.replace(/role\s*!==\s*(['"`])Admin\1/g, 'role !== $1UnitAdmin$1');
        content = content.replace(/\['Admin'\]/g, "['UnitAdmin']");
        content = content.replace(/includes\s*\(\s*(['"`])Admin\1\s*\)/g, 'includes($1UnitAdmin$1)');
        content = content.replace(/case\s*(['"`])Admin\1:/g, 'case $1UnitAdmin$1:');
        // Fix display names in comments
        content = content.replace(/Unit Admin/g, 'Unit Admin'); // Already correct
        content = content.replace(/Business Admin/g, 'Business Admin'); // Already correct
        const changes = (before !== content);
        if (changes) {
            fs.writeFileSync(filePath, content, 'utf8');
            const masterAdminCount = (before.match(/MasterAdmin/g) || []).length;
            const adminCount = (before.match(/(['"`])Admin\1/g) || []).length;
            const count = masterAdminCount + adminCount;
            totalReplacements += count;
            filesChanged++;
            console.log(`✓ ${file}: ${count} replacements`);
        }
    }
});
console.log('='.repeat(60));
console.log(`Total: ${totalReplacements} replacements in ${filesChanged} files`);
console.log('='.repeat(60));
