(() => {
  'use strict';
  const main=document.querySelector('#main'),status=document.querySelector('#status');
  let state=null,adminToken=null,page='picker',busy=false,opening=false,preferredProfileId=null;
  const showPage=value=>{page=value;document.body.dataset.page=value;};
  const api=(method,value={})=>window.LocalHousehold.call(method,value);
  function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function error(e){const message=(e?.message||'Please try again.').replace(/^Error invoking remote method '[^']+': Error: /,'');if(message.includes('Unlock Admin Settings first')){adminToken=null;unlock();}status.textContent=message;}
  function button(label,action,cls=''){const b=node('button',label,cls);b.type='button';b.addEventListener('click',()=>Promise.resolve().then(()=>{status.textContent='';return action();}).catch(error));return b;}
  function form(fields,label,action){const f=node('form'),inputs={};for(const field of fields){const l=node('label',field.label),i=node('input');i.type=field.type||'text';i.required=true;i.autocomplete='off';if(field.type==='password'){i.inputMode='numeric';i.maxLength=12;}else i.maxLength=60;l.append(i);f.append(l);inputs[field.name]=i;}
    const submit=node('button',label,'primary');submit.type='submit';f.append(submit);f.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;submit.disabled=true;status.textContent='';try{await action(Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,i.value])));}catch(e){error(e);}finally{busy=false;submit.disabled=false;}});return f;}
  function focus(){const preferred=preferredProfileId&&[...main.querySelectorAll('[data-profile-id]')].find(n=>n.dataset.profileId===preferredProfileId);(preferred||main.querySelector('input,button'))?.focus({preventScroll:true});}
  async function refresh(){preferredProfileId=document.activeElement?.dataset.profileId||preferredProfileId;state=await api('state');opening=false;status.textContent='';document.body.dataset.platform=state.platform;document.querySelector('#settings').textContent=state.managementUnlocked?'Manage Profiles':'Admin Settings';if(!state.configured)welcome();else picker();}
  function welcome(){showPage('welcome');document.querySelector('#settings').hidden=true;main.replaceChildren(node('p','Your people. Your stories.','eyebrow'),node('h1','Welcome home.'),node('p','Set up the viewers on this device. An admin PIN protects profile changes. You can start watching without a Household server.'),form([{name:'pin',label:'Create admin PIN (6–12 digits)',type:'password'},{name:'confirm',label:'Confirm admin PIN',type:'password'}],'Set Up This Device',async v=>{if(v.pin!==v.confirm)throw new Error('The PINs do not match.');adminToken=(await api('setup',{pin:v.pin})).adminToken;state=await api('state');addProfile();}));focus();}
  function picker(){showPage('picker');document.querySelector('#settings').hidden=false;main.replaceChildren(node('h1',"Who's watching?"));
    const choices=node('div',undefined,state.profiles.length>5?'profiles many':'profiles');for(const p of state.profiles){const b=button('',async()=>{if(opening)return;opening=true;preferredProfileId=p.id;adminToken=null;status.textContent=`Opening ${p.name}…`;b.setAttribute('aria-busy','true');try{await api('open',{id:p.id});}catch(e){opening=false;b.removeAttribute('aria-busy');throw e;}},'profile');b.dataset.profileId=p.id;b.setAttribute('aria-label',p.name);const color=['teal','plum','coral','blue','gold'].includes(p.avatar)?p.avatar:'teal';const avatar=node('span',undefined,`avatar ${color}`);avatar.setAttribute('aria-hidden','true');const face=node('span',undefined,'avatar-face');face.append(node('span',undefined,'avatar-eye'),node('span',undefined,'avatar-eye'));avatar.append(face,node('span',Array.from(p.name)[0].toUpperCase(),'avatar-initial'));b.append(avatar,node('strong',p.name));choices.append(b);}main.append(choices);
    if(!state.profiles.length){main.append(node('p','Make room for your next favorite.','picker-empty'));const add=button('',()=>state.managementUnlocked||adminToken?addProfile():unlock(addProfile),'profile profile-add'),avatar=node('span',undefined,'avatar');avatar.setAttribute('aria-hidden','true');avatar.append(node('span','+','profile-plus'));add.append(avatar,node('strong','Add Profile'));add.setAttribute('aria-label','Add Profile');choices.append(add);}
    main.append(button(state.managementUnlocked?'Manage Profiles':'Admin Settings',()=>state.managementUnlocked||adminToken?settings():unlock(),'picker-manage'));focus();}
  function unlock(next=settings){showPage('unlock');main.replaceChildren(node('h1','Unlock Admin Settings'),form([{name:'pin',label:'Admin PIN',type:'password'}],'Unlock',async v=>{adminToken=(await api('unlock',v)).adminToken;await next();}),button('Back',picker));focus();}
  function addProfile(){showPage('add');document.querySelector('#settings').hidden=false;const f=form([{name:'name',label:'Viewer name'}],'Create Profile',async v=>{await api('create',{adminToken,name:v.name,avatar:select.value});state=await api('state');picker();});const label=node('label','Avatar color'),select=node('select');for(const name of ['teal','plum','coral','blue','gold']){const option=node('option',name);option.value=name;select.append(option);}label.append(select);f.insertBefore(label,f.querySelector('button'));main.replaceChildren(node('h1','Add a viewer'),node('p','Use a different Stremio account for each person. Accounts and browsing data stay separated on this device.'),f,button('Back',()=>state.managementUnlocked||adminToken?settings():picker()));focus();}
  function confirmProfile(p,method){showPage('confirm');const deleting=method==='delete';main.replaceChildren(node('h1',deleting?`Delete ${p.name}?`:`Reconnect ${p.name}?`),node('p',deleting?'This removes the profile and its saved sign-in from this device. The Stremio account itself is not deleted.':'This clears the saved Stremio sign-in for this profile. You can then sign in again.'),button(deleting?'Delete profile':'Clear saved sign-in',async()=>{await api(method,{adminToken,id:p.id});state=await api('state');settings();},'danger'),button('Cancel',settings));focus();}
  function settings(){showPage('settings');main.replaceChildren(node('h1',state.managementUnlocked?'Manage Profiles':'Admin Settings'),button('Add Profile',addProfile,'primary'));
    for(const p of state.profiles){const row=node('section',undefined,'manage-row');row.append(node('h2',p.name),button('Reconnect account',()=>confirmProfile(p,'reset')),button('Delete profile',()=>confirmProfile(p,'delete'),'danger'));main.append(row);}
    if(state.platform==='windows')main.append(button('Streaming setup',()=>api('streaming',{adminToken})));
    main.append(button('Optional Household server',()=>api('server',{adminToken})),node('p','Local viewing does not require the optional server. Cross-device Household synchronization is outside this local build’s target.','notice'),button('Done',()=>{adminToken=null;picker();}));focus();}
  document.querySelector('#settings').addEventListener('click',()=>{status.textContent='';state.managementUnlocked||adminToken?settings():unlock();});
  document.querySelector('footer a').addEventListener('click',e=>{e.preventDefault();api('licenses').catch(error);});
  document.addEventListener('keydown',event=>{
    if(['Escape','BrowserBack'].includes(event.key)){event.preventDefault();adminToken=null;state?.configured?picker():welcome();return;}
    if(!event.key.startsWith('Arrow'))return;
    const active=document.activeElement;
    if(page==='picker'&&event.key==='ArrowUp'&&active?.classList.contains('picker-manage')){const prior=[...main.querySelectorAll('[data-profile-id]')].find(n=>n.dataset.profileId===preferredProfileId)||main.querySelector('.profile');if(prior){event.preventDefault();prior.focus();return;}}
    if(active?.tagName==='SELECT')return;
    if(active?.tagName==='INPUT'&&['ArrowLeft','ArrowRight'].includes(event.key))return;
    const items=[...document.querySelectorAll('button:not(:disabled),input,select,a[href]')].filter(e=>e.getClientRects().length);
    if(!items.includes(active)){items[0]?.focus();event.preventDefault();return;}
    const r=active.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;let target=null,best=Infinity;
    for(const item of items){if(item===active)continue;const b=item.getBoundingClientRect(),dx=b.left+b.width/2-cx,dy=b.top+b.height/2-cy;
      const forward=event.key==='ArrowRight'?dx:event.key==='ArrowLeft'?-dx:event.key==='ArrowDown'?dy:-dy;
      const across=['ArrowLeft','ArrowRight'].includes(event.key)?Math.abs(dy):Math.abs(dx);if(forward>1&&forward+across*3<best){best=forward+across*3;target=item;}}
    if(!target&&active.tagName==='INPUT')target=items[items.indexOf(active)+(event.key==='ArrowDown'?1:-1)];
    if(target){event.preventDefault();target.focus();target.scrollIntoView({block:'nearest',inline:'nearest'});}
  });
  main.addEventListener('focusin',e=>{if(e.target.dataset.profileId)preferredProfileId=e.target.dataset.profileId;});
  window.addEventListener('focus',()=>{if(page==='picker')refresh().catch(error);});
  refresh().catch(error);
})();
