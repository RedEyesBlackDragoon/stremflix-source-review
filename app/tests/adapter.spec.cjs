const {test,expect}=require('@playwright/test');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Stremio runtime adapter emits only sanitized progress and stable identity',async()=>{
  const models={ctx:{profile:{auth:{key:'synthetic-fixture-not-a-real-token',user:{_id:'synthetic-user-A',email:'not-forwarded@example.invalid'}}}},
    player:{metaItem:{type:'Ready',content:{id:'tt9900001',name:'Synthetic fixture'}},seriesInfo:{season:1,episode:2},
      selected:{stream:{url:'https://example.invalid/private-stream?token=never-forward',behaviorHints:{proxyHeaders:{Authorization:'synthetic-private'}}}}},
    library:{catalog:[{_id:'tt9900001',type:'series',name:'Synthetic fixture',state:{timeOffset:1000,duration:5000}}]}};
  const actions=[];const context={window:{core:{getState:async name=>models[name],dispatch:action=>actions.push(action)},
    document:{querySelector:()=>({currentTime:35,duration:100,paused:false,readyState:4})}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../../shared/stremio-adapter.js'),'utf8'),context);
  const adapter=new context.window.DXBIStremioAdapter(context.window);
  expect(await adapter.identity()).toBe('synthetic-user-A');
  const sample=await adapter.sample();expect(JSON.parse(JSON.stringify(sample))).toEqual({external_id:'tt9900001',season:1,episode:2,position:35,duration:100,paused:false});
  expect(JSON.stringify(sample)).not.toContain('token');expect(JSON.stringify(sample)).not.toContain('url');
  expect((await adapter.library())[0].id).toBe('tt9900001');
  await adapter.signOut();expect(actions[0]).toEqual({action:'Ctx',args:{action:'Logout'}});
  models.player.metaItem.type='Loading';expect(await adapter.sample()).toBeNull();
});
