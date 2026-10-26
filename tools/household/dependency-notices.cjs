const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),app=path.join(root,'app');
const lock=JSON.parse(fs.readFileSync(path.join(app,'package-lock.json'),'utf8'));
const dependencies=[];
for(const [relative,value] of Object.entries(lock.packages||{})){
  if(!relative)continue;
  const file=path.join(app,relative,'package.json');
  if(!fs.existsSync(file))continue;
  const pkg=JSON.parse(fs.readFileSync(file,'utf8'));
  dependencies.push({name:pkg.name,version:pkg.version,license:pkg.license||'UNSPECIFIED',development:Boolean(value.dev)});
}
fs.writeFileSync(path.join(root,'docs/household/node-dependencies.json'),JSON.stringify(dependencies,null,2));
let notices='STREMFLIX Household Edition\nBased on DX.BI and Stremio Enhanced. Original notices follow.\n\n';
for(const file of ['LICENSE','app/LICENSE.md','LICENSE-ANIME4K'])notices+=`\n===== ${file} =====\n`+fs.readFileSync(path.join(root,file),'utf8');
notices+='\nMetadata providers retain rights in their catalog text and images. This app does not supply media.\n';
fs.writeFileSync(path.join(root,'household/web/licenses.txt'),notices);
console.log(`Recorded ${dependencies.length} Node dependency licenses and bundled upstream notices.`);
