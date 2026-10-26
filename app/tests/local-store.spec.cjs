const {test,expect}=require('@playwright/test');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {LocalProfileStore}=require('../dist/household/local-store');
function temporaryStore(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dxbi-local-store-')),file=path.join(dir,'profiles.bin'),key=crypto.randomBytes(32);
  const cipher={isEncryptionAvailable:()=>true,encryptString:value=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);},
    decryptString:value=>{const c=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(0,12));c.setAuthTag(value.subarray(12,28));return Buffer.concat([c.update(value.subarray(28)),c.final()]).toString('utf8');}};
  return {dir,file,cipher,store:new LocalProfileStore(file,cipher)};}
test('local profiles and one-to-one bindings survive restart without a service',async()=>{const t=temporaryStore();try{
  const token=await t.store.setup('314159');const a=t.store.create(token,'Synthetic A','teal'),b=t.store.create(token,'Synthetic B','blue');
  t.store.bind(a.id,'synthetic-account-one');expect(()=>t.store.bind(b.id,'synthetic-account-one')).toThrow('already linked');expect(()=>t.store.bind(a.id,'synthetic-account-two')).toThrow('original');
  const restored=new LocalProfileStore(t.file,t.cipher);expect(restored.publicState().profiles.map(p=>p.id)).toEqual([a.id,b.id]);expect(restored.publicState().profiles[0].linked).toBe(true);
  expect(()=>restored.create(token,'Bypass','teal')).toThrow('Unlock');
  expect(fs.readFileSync(t.file).toString()).not.toContain('Synthetic A');expect(JSON.stringify(restored.publicState())).not.toContain('314159');
  const next=await restored.unlock('314159');restored.resetAccount(next,a.id);restored.bind(b.id,'synthetic-account-one');
}finally{fs.rmSync(t.dir,{recursive:true,force:true});}});
test('PIN lockout persists across a process restart',async()=>{const t=temporaryStore();try{
  await t.store.setup('314159');for(let i=0;i<5;i++)await expect(t.store.unlock('000000')).rejects.toThrow('Incorrect');
  await expect(new LocalProfileStore(t.file,t.cipher).unlock('314159')).rejects.toThrow('Too many');
}finally{fs.rmSync(t.dir,{recursive:true,force:true});}});
test('unreadable encrypted data fails closed',async()=>{const t=temporaryStore();try{
  await t.store.setup('314159');fs.writeFileSync(t.file,Buffer.from('damaged fixture'));
  expect(()=>new LocalProfileStore(t.file,t.cipher)).toThrow();
}finally{fs.rmSync(t.dir,{recursive:true,force:true});}});
