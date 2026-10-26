const fs = require('fs');
const path = require('path');

// The built-in dx.bi plugin is the one at the repository root
const pluginSrc = path.join(__dirname, '..', 'dxbi.plugin.js');
fs.mkdirSync(path.join(__dirname, 'static'), { recursive: true });
fs.copyFileSync(pluginSrc, path.join(__dirname, 'static', 'dxbi.plugin.js'));
console.log(`Copied: ${pluginSrc} to static/dxbi.plugin.js`);
if (process.argv.includes('--plugin-only')) process.exit(0);

// Copy .html and .js files from src/components/** to dist/components/**
function copyFiles(srcDir, destDir) {
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    
    const items = fs.readdirSync(srcDir);
    
    items.forEach(item => {
        const srcPath = path.join(srcDir, item);
        const destPath = path.join(destDir, item);
        
        const stat = fs.statSync(srcPath);
        
        if (stat.isDirectory()) {
            copyFiles(srcPath, destPath);
        } else if (stat.isFile() && !srcPath.endsWith('.ts')) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Copied: ${srcPath} to ${destPath}`);
        }
    });
}

// Copy the 'version' file from the root directory
const versionFileSrc = path.join(__dirname, 'version');
const versionFileDest = path.join(__dirname, 'dist', 'version');

if (fs.existsSync(versionFileSrc)) {
    fs.copyFileSync(versionFileSrc, versionFileDest);
    console.log(`Copied: ${versionFileSrc} to ${versionFileDest}`);
} else {
    console.log('No version file found in the root directory.');
}

const srcDir = 'src/components';
const destDir = 'dist/components';

copyFiles(srcDir, destDir);
copyFiles('src/household', 'dist/household');
fs.copyFileSync(path.join(__dirname,'..','shared','stremio-adapter.js'),path.join(__dirname,'dist','household','stremio-adapter.js'));
fs.copyFileSync(path.join(__dirname,'..','household','web','licenses.txt'),path.join(__dirname,'static','THIRD_PARTY_NOTICES.txt'));
copyFiles(path.join(__dirname,'..','shared','local'),path.join(__dirname,'dist','household','local'));
fs.copyFileSync(path.join(__dirname,'..','household','web','licenses.txt'),path.join(__dirname,'dist','household','licenses.txt'));
