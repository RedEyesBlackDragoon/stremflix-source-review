const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const folders=['household/web','shared','shared/local','tv/app/src/main/assets','app/src/household'];
for(const folder of folders)for(const file of fs.readdirSync(path.join(root,folder))){
  if(!file.endsWith('.js'))continue;
  const result=spawnSync(process.execPath,['--check',path.join(root,folder,file)],{encoding:'utf8'});
  if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}
}
process.stdout.write('Client JavaScript syntax checks passed.\n');
