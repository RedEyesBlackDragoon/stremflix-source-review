import { FocusManager } from './focus.js';
const main = document.querySelector('#main'), status = document.querySelector('#status');
const nav = document.querySelector('#nav'), dialog = document.querySelector('#dialog');
const native = window.HouseholdNative;
let credentials = JSON.parse(sessionStorage.getItem('household-session') || 'null');
let identity = null, profile = null, page = 'Home', previousFocus = null;
let searchFilters = { q: '', kind: '', genre: '' }, searchResults = [];
let requestGeneration = 0;
class APIError extends Error { constructor(message,status){super(message);this.status=status;} }

function node(tag, text, cls) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (cls) element.className = cls;
  return element;
}
function button(text, action, cls='') {
  const b = node('button', text, cls); b.type = 'button';
  b.addEventListener('click', () => Promise.resolve().then(action).catch(showError)); return b;
}
function showError(error) { status.textContent = error.message || 'Please try again.'; status.setAttribute('role','alert'); }
async function saveSession(value) {
  credentials = value;
  sessionStorage.setItem('household-session', JSON.stringify(value));
  if (native?.rememberSession) await native.rememberSession(value?.admin ? null : value);
}
async function api(path, options = {}, retry = true) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  const headers = { ...(credentials ? { Authorization: `Bearer ${credentials.access_token}` } : {}), ...options.headers };
  if (options.body && !(options.body instanceof FormData)) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(options.body); }
  try {
    const response = await fetch('/v1' + path, { ...options, headers, signal: controller.signal });
    if (response.status === 401 && retry && credentials?.refresh_token) {
      const refreshResponse = await fetch('/v1/auth/refresh', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({refresh_token:credentials.refresh_token}) });
      if (refreshResponse.ok) { await saveSession(await refreshResponse.json()); return api(path, { ...options, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body }, false); }
    }
    const payload = await response.json();
    if (!response.ok) throw new APIError(typeof payload.detail === 'string' ? payload.detail.replaceAll('_',' ') : 'Check the entered values and try again.',response.status);
    status.textContent = ''; return payload;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Household service is unavailable. Your Stremio session can still be used.');
    throw error;
  } finally { clearTimeout(timer); }
}
function form(fields, submitLabel, submit) {
  const f = node('form'), inputs = {};
  for (const field of fields) {
    const label = node('label',field.label), input = node('input');
    input.name = field.name; input.type = field.type || 'text'; input.required = field.required !== false;
    if (field.value) input.value = field.value;
    if (field.minLength) input.minLength = field.minLength;
    if (field.accept) input.accept = field.accept;
    input.autocomplete = field.type === 'password' ? 'current-password' : 'off';
    label.append(input); f.append(label); inputs[field.name] = input;
  }
  const submitButton = node('button',submitLabel,'primary'); submitButton.type='submit'; f.append(submitButton);
  f.addEventListener('submit', async event => { event.preventDefault(); submitButton.disabled=true;
    try { await submit(Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.type === 'checkbox' ? v.checked : v.type === 'file' ? v.files[0] : v.value]))); }
    catch(error){showError(error);}finally{submitButton.disabled=false;}
  }); return f;
}
function welcome() {
  main.replaceChildren(); nav.hidden=true;
  const section = node('section',undefined,'welcome');
  section.append(node('p','Your people. Your stories.','eyebrow'),node('h1','Welcome to your household'),
    node('p','Create a private space for your household. Each viewer keeps a separate Stremio account, library, and viewing history.'),
    button('Set Up Household', setup,'primary'), button('Administrator sign in', login), button('Pair this device', pairing));
  main.append(section);
}
function setup(){
  main.replaceChildren(node('h1','Set up household'),node('p','Use the enrollment token generated on your server. Set an administrator password to protect profiles, imports, and devices.'));
  const enrollment=new URLSearchParams(location.hash.slice(1)).get('enrollment') || '';
  window.history.replaceState(null,'',location.pathname);
  main.append(form([{name:'enrollment_token',label:'Server enrollment token',type:'password',value:enrollment}, {name:'name',label:'Household name'},
    {name:'password',label:'Administrator password (12+ characters)',type:'password',minLength:12}], 'Create household', async body=>{
      const value=await api('/admin/bootstrap',{method:'POST',body}); localStorage.setItem('household-id',value.household_id);
      await saveSession(value); await boot();
    }));
}
function login(){
  main.replaceChildren(node('h1','Administrator sign in'));
  main.append(form([{name:'household_id',label:'Household ID',value:localStorage.getItem('household-id') || '00000000-0000-4000-8000-000000000001'},
    {name:'password',label:'Administrator password',type:'password'}], 'Unlock', async body=>{await saveSession(await api('/admin/login',{method:'POST',body}));profile=null;await boot();}));
}
async function pairing(){
  const start=await api('/auth/pair/start',{method:'POST',body:{name:native ? 'Household device':'Web browser',platform:'web'}});
  main.replaceChildren(node('h1','Pair this device'),node('p','Open Admin Settings on an authorized device, choose this viewer, and approve this code within five minutes.'),node('p',start.code,'code'));
  main.append(button('Check approval',async()=>{await saveSession(await api('/auth/pair/complete',{method:'POST',body:{secret:start.secret}}));await boot();},'primary'));
}
async function boot(){
  if(!credentials && native?.restoreSession) { const saved=await native.restoreSession(); if(saved) await saveSession(saved); }
  if(!credentials){welcome();return;}
  try{identity=await api('/session');await picker();}catch(error){
    if(!(error instanceof APIError) && offlinePicker())showError(error);
    else {welcome();showError(error);}
  }
}
function offlinePicker(){
  if(!credentials?.profile_id || credentials.admin)return false;
  let saved=null;try{saved=JSON.parse(localStorage.getItem(`household-viewer:${credentials.profile_id}`)||'null');}catch{return false;}
  if(!saved || saved.profile.id!==credentials.profile_id || saved.expiresAt<Date.now())return false;
  identity=saved.identity;nav.hidden=true;
  main.replaceChildren(node('h1',"Who's watching?"),node('p','Household is offline. This previously authorized profile can use its cached Home and existing Stremio session.','notice'),
    button(saved.profile.name,()=>selectProfile(saved.profile),'profile'),button('Administrator sign in',login));
  return true;
}
async function picker(){
  requestGeneration++; page='Profiles';nav.hidden=true; profile=null;
  const profiles=await api('/profiles');main.replaceChildren(node('p','STREMFLIX HOUSEHOLD','eyebrow'),node('h1',"Who's watching?"));
  const choices=node('div',undefined,'profiles');
  for(const p of profiles){const b=button('',async()=>{
    if(p.has_pin) { modal('Profile PIN',form([{name:'pin',label:`PIN for ${p.name}`,type:'password'}],'Continue',async value=>{await api(`/profiles/${p.id}/pin/verify`,{method:'POST',body:value});dialog.close();await selectProfile(p,value.pin);})); }
    else await selectProfile(p);
  },'profile');b.setAttribute('aria-label',p.name);const avatar=node('span',p.name.slice(0,1).toUpperCase(),`avatar ${p.avatar}`);avatar.setAttribute('aria-hidden','true');b.append(avatar,node('span',p.name),node('small',p.kid?'Kids':''));choices.append(b);}
  main.append(choices);
  if(identity.admin) {
    main.append(button('Add Profile',addProfile),button('Admin Settings',adminSettings));
    for(const p of profiles) main.append(button('Manage '+p.name,async()=>{profile=p;await adminSettings();}));
  }
  main.append(button('Administrator sign in',login),button('Sign out',async()=>{await api('/auth/revoke',{method:'POST'});await saveSession(null);identity=null;welcome();}));
  choices.querySelector('button')?.focus();
}
async function selectProfile(p,pin=''){
  if(identity.admin){
    // Normal viewing drops administrator authority. Settings require a fresh admin sign-in.
    await saveSession(await api(`/profiles/${p.id}/activate`,{method:'POST',body:{pin}}));
    identity=await api('/session');
  }
  profile=p;
  if(!identity.admin && credentials.profile_id===p.id)localStorage.setItem(`household-viewer:${p.id}`,JSON.stringify({profile:p,identity,expiresAt:Date.now()+86400000}));
  nav.hidden=false;nav.replaceChildren();
  for(const name of ['Home','Search','Community','My List','History'])nav.append(button(name,()=>navigate(name)));
  nav.append(button('Admin',adminSettings));await navigate('Home');
}
function addProfile(){
  main.replaceChildren(node('h1','Add a viewer'));
  main.append(form([{name:'name',label:'Display name'},{name:'kid',label:'Kids profile',type:'checkbox',required:false},
    {name:'pin',label:'Optional PIN (4–8 digits)',type:'password',required:false}], 'Create profile',async values=>{
      await api('/profiles',{method:'POST',body:{name:values.name,kid:values.kid,pin:values.pin || null}});await picker();
    }));
}
function modal(title,body){previousFocus=document.activeElement;document.querySelector('#dialog-content').replaceChildren(node('h2',title),body);dialog.showModal();dialog.querySelector('button,input')?.focus();}
dialog.addEventListener('close',()=>previousFocus?.focus());document.querySelector('#close-dialog').addEventListener('click',()=>dialog.close());
document.querySelector('#account').addEventListener('click',()=>picker().catch(showError));
function card(work){
  const b=button('',()=>details(work),'card');b.setAttribute('aria-label',`${work.title}, ${work.year || ''}, ${work.age === null ? 'Unrated':`Age ${work.age}+`}`);
  if(work.poster){const image=node('img');image.src=work.poster;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';b.append(image);}
  else b.append(node('span',work.title,'poster-placeholder'));
  b.append(node('strong',work.title),node('small',`${work.year || ''} · ${work.age === null ? 'Unrated':`${work.age}+`} · ${(work.genres||[]).slice(0,2).join(' / ')}`));
  if(work.position && work.duration){const progress=node('progress');progress.value=work.position;progress.max=work.duration;progress.setAttribute('aria-label','Playback progress');b.append(progress);}
  return b;
}
function rail(items,grid=false){const container=node('div',undefined,grid?'grid':'rail');for(const work of items)container.append(card(work));return container;}
function details(work){
  const body=node('div');body.append(node('p',`${work.year || ''} · ${work.type} · ${work.age === null?'Unrated':`Age ${work.age}+`}`,'muted'),node('p',work.description || 'No synopsis available.'));
  if(work.cast?.length)body.append(node('p','Cast: '+work.cast.join(', ')));
  for(const reason of work.rationale || [])body.append(node('p',reason,'notice'));
  const actions=node('div',undefined,'actions');
  actions.append(button(work.position?'Resume in Stremio':'Play in Stremio',()=>openStremio(work),'primary'),
    button('Episodes / More Info',()=>openStremio(work)),button('Add to My List',async()=>{await api(`/profiles/${profile.id}/watchlist/${work.id}`,{method:'PUT'});status.textContent='Saved to your Household list. Stremio library edits remain in Stremio.';}),
    button('Remove from My List',()=>api(`/profiles/${profile.id}/watchlist/${work.id}`,{method:'DELETE'})));
  for(const [label,action] of [['Like','like'],['Not Interested','dislike'],['Hide','hide']])actions.append(button(label,async()=>{
    const id=crypto.randomUUID();await api(`/profiles/${profile.id}/feedback`,{method:'POST',body:{id,work_id:work.id,action}});
    body.append(button('Undo '+label,async()=>{await api(`/profiles/${profile.id}/feedback/${id}`,{method:'DELETE'});dialog.close();await navigate(page);}));status.textContent='Preference saved.';
  }));body.append(actions,node('p','Metadata: '+work.provenance,'muted'));modal(work.title,body);
}
async function openStremio(work){
  if(!native?.openProfile){throw new Error('Playback is available in the Household Android or Windows application. Install the client and link your own Stremio account.');}
  if(profile.kid)throw new Error('Kids playback is locked until the Stremio content-policy adapter is verified. Age-filtered discovery remains available.');
  await native.openProfile({profileId:profile.id,token:credentials.access_token,externalId:work?.external_id || null,type:work?.type || null});
}
async function navigate(name){
  page=name;const generation=++requestGeneration;
  for(const b of nav.querySelectorAll('button'))b.setAttribute('aria-current',b.textContent===name?'page':'false');
  main.replaceChildren(node('h1',name),node('p','Loading…','muted'));
  if(name==='Home'){
    const key=`household-home:${identity.household_id}:${profile.id}:${profile.version}`;
    function render(data,cached=false){if(generation!==requestGeneration)return;main.replaceChildren(node('p',`FOR ${profile.name.toUpperCase()}`,'eyebrow'),node('h1','Make tonight yours.'));
      if(cached)main.append(node('p','Showing saved Home. Household sync is unavailable; Stremio playback may still work.','notice'));
      const actions=node('div',undefined,'actions');actions.append(button('Open / Reconnect Stremio',()=>openStremio(null)),button('Refresh picks',async()=>{await api(`/profiles/${profile.id}/recommendations?refresh=true`);await navigate('Home');}));main.append(actions);
      for(const row of data.rows){main.append(node('h2',row.name),rail(row.items));}
      if(!data.rows.length)main.append(node('p',data.empty_message,'notice'));
    }
    const cached=localStorage.getItem(key);if(cached){try{const data=JSON.parse(cached);if(data.computed_at>Date.now()/1000-86400)render(data,true);}catch{localStorage.removeItem(key);}}
    try{const data=await api(`/profiles/${profile.id}/home`);localStorage.setItem(key,JSON.stringify(data));render(data);}catch(error){
      showError(error);
      if(error instanceof APIError && [401,403,404].includes(error.status)){localStorage.removeItem(key);main.replaceChildren(node('h1','Reconnect your household'),node('p','This profile is no longer authorized. Sign in again to continue.','notice'),button('Sign in',login));}
      else if(!cached)main.replaceChildren(node('h1','Home is unavailable'),node('p',error.message,'notice'),button('Open your Stremio session',()=>openStremio(null)));
    }
  }else if(name==='Search'){await searchPage();}
  else if(name==='My List'){const works=await api(`/profiles/${profile.id}/watchlist`);if(generation===requestGeneration)main.replaceChildren(node('h1','Your List'),works.length?rail(works,true):node('p','Save a title from its details to find it here.'));}
  else if(name==='Community'){await community();}
  else if(name==='History'){await historyPage();}
  main.querySelector('button,input')?.focus();
}
async function searchPage(){
  main.replaceChildren(node('h1','Find your next story'));
  const filters=node('form',undefined,'filters');
  for(const [key,label] of [['q','Search titles'],['genre','Genre'],['kind','Type (movie or series)']]){const l=node('label',label),input=node('input');input.value=searchFilters[key];input.addEventListener('input',()=>searchFilters[key]=input.value);l.append(input);filters.append(l);}
  const go=node('button','Search','primary');go.type='submit';filters.append(go);main.append(filters);
  const results=node('div');main.append(results);
  function show(){results.replaceChildren(searchResults.length?rail(searchResults,true):node('p','No matches. Try a shorter title or change your filters.','notice'));}
  filters.addEventListener('submit',async e=>{e.preventDefault();try{const query=new URLSearchParams(Object.entries(searchFilters).filter(([,v])=>v));searchResults=(await api(`/profiles/${profile.id}/search?${query}`)).items;show();}catch(error){showError(error);}});show();
}
async function community(){
  const lists=await api(`/community/lists?profile_id=${profile.id}`);main.replaceChildren(node('h1','Community'),node('p','Real collections, with their source and original order preserved.'));
  for(const list of lists){const box=node('section',undefined,'collection');box.append(node('h2',list.name),node('p',`${list.attribution} · ${list.fetched?new Date(list.fetched*1000).toLocaleDateString():'Awaiting refresh'}${list.stale?' · Cached / stale':''}`,'muted'));
    const content=node('div');const load=async mode=>{const data=await api(`/community/lists/${list.id}?profile_id=${profile.id}&mode=${mode}`);content.replaceChildren(rail(data.items));};
    box.append(button('Original Order',()=>load('original')),button('Ranked for Me',()=>load('personalized')),
      button('Save Collection',async()=>{const p=await api(`/profiles/${profile.id}/preferences`);await api(`/profiles/${profile.id}/preferences`,{method:'PUT',body:{...p,saved_lists:[...new Set([...(p.saved_lists||[]),list.id])]}});status.textContent='Collection saved.';}),
      button('Hide Source',async()=>{const p=await api(`/profiles/${profile.id}/preferences`);await api(`/profiles/${profile.id}/preferences`,{method:'PUT',body:{...p,hidden_sources:[...new Set([...(p.hidden_sources||[]),list.source_id])]}});await community();}),
      button('Report Broken List',()=>api(`/community/lists/${list.id}/report?profile_id=${profile.id}`,{method:'POST'})),content);main.append(box);
  }
  if(!lists.length)main.append(node('p','No collections have been configured. An administrator can add permitted Stremio catalogs in Admin Settings.','notice'));
}
async function historyPage(){
  const data=await api(`/profiles/${profile.id}/history`);main.replaceChildren(node('h1','Watched history'));
  for(const e of data.items)main.append(node('p',`${e.work.title} · ${new Date(e.occurred*1000).toLocaleDateString()} · ${e.source==='netflix_import'?'Netflix CSV import (interest signal)':e.event_type}`));
  if(!data.items.length)main.append(node('p','No viewing events yet. Netflix CSV imports add interest signals here without creating Stremio playback positions.'));
}
async function adminSettings(){
  if(!identity?.admin){login();return;}page='Admin';main.replaceChildren(node('h1','Admin Settings'));
  main.append(button('Create profile',addProfile));
  if(profile){main.append(button('Import Netflix history',importUI),button('Export profile data',async()=>{const data=await api(`/profiles/${profile.id}/export`);const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const link=node('a','Download profile export');link.href=URL.createObjectURL(blob);link.download='household-profile-export.json';main.append(link);}),
    button('Delete selected profile',()=>modal('Delete profile permanently?',button('Delete profile and private data',async()=>{await api(`/profiles/${profile.id}`,{method:'DELETE'});dialog.close();await picker();},'danger'))));
    main.append(node('h2','Approve device pairing'),form([{name:'code',label:'Eight-character code on the new device'}],'Approve for '+profile.name,async body=>{await api('/auth/pair/approve',{method:'POST',body:{code:body.code.toUpperCase(),profile_id:profile.id}});status.textContent='Device approved. Complete pairing on the new device.';}));
    main.append(button('Preferences and cold-start genres',async()=>{const p=await api(`/profiles/${profile.id}/preferences`);main.append(form([{name:'genres',label:'Favorite genres (comma separated)',value:(p.genres||[]).join(', ')},{name:'blocked',label:'Blocked genres (comma separated)',required:false,value:(p.blocked_genres||[]).join(', ')}],'Save preferences',async values=>{await api(`/profiles/${profile.id}/preferences`,{method:'PUT',body:{...p,genres:values.genres.split(',').map(s=>s.trim()).filter(Boolean),blocked_genres:values.blocked.split(',').map(s=>s.trim()).filter(Boolean)}});status.textContent='Preferences saved.';}));}));
  }else main.append(node('p','Choose a profile to manage its imports, data, preferences, and device pairing.','notice'));
  main.append(node('h2','Metadata and curated catalogs'),node('p','Only credential-free HTTPS manifests on the server operator allowlist are accepted. Collections retain their attribution.'));
  main.append(form([{name:'name',label:'Source name'},{name:'manifest_url',label:'Permitted manifest URL',type:'url'}],'Add catalog',async body=>{await api('/community/sources',{method:'POST',body});await adminSettings();}));
  for(const source of await api('/community/sources'))main.append(node('p',`${source.name} · ${source.status}`),button('Remove '+source.name,async()=>{await api(`/community/sources/${source.id}`,{method:'DELETE'});await adminSettings();}));
  main.append(node('h2','Devices'));
  for(const device of await api('/devices'))main.append(node('p',`${device.name} · ${device.platform}${device.revoked?' · Revoked':''}`),button('Revoke '+device.name,async()=>{await api(`/devices/${device.id}`,{method:'DELETE'});await adminSettings();}));
}
async function importUI(){
  main.replaceChildren(node('h1',`Import Netflix history for ${profile.name}`),node('p','Download Viewing Activity from this person’s Netflix profile, then select the Title / Date CSV. No Netflix login is required. Date-only watches are stored at UTC midnight; they never create playback positions.'));
  main.append(form([{name:'file',label:'Netflix CSV',type:'file',accept:'.csv,text/csv'},{name:'date_order',label:'Date order (MDY or DMY)',value:'MDY'}],'Import CSV',async values=>{const body=new FormData();body.append('file',values.file);const result=await api(`/profiles/${profile.id}/imports/netflix?date_order=${encodeURIComponent(values.date_order.toUpperCase())}`,{method:'POST',body});await reviewImport(result.id);}));
  for(const batch of await api(`/profiles/${profile.id}/imports`))main.append(button(`${new Date(batch.created_at*1000).toLocaleDateString()} · ${batch.status}`,()=>reviewImport(batch.id)));
}
async function reviewImport(id){
  const data=await api(`/imports/${id}`);main.replaceChildren(node('h1','Review Netflix import'),node('p',`${data.status} · ${Object.entries(data.counts).map(([k,v])=>`${k.replaceAll('_',' ')}: ${v}`).join(' · ')}`));
  main.append(button('Refresh review',()=>reviewImport(id)),button('Remove this import batch',async()=>{await api(`/imports/${id}`,{method:'DELETE'});await importUI();},'danger'));
  for(const row of data.items){const box=node('section',undefined,'review');box.append(node('h2',row.title),node('p',`${row.status.replaceAll('_',' ')}${row.probable_episode?' · Probable episode; no season completion inferred':''}`));
    for(const candidate of row.candidates)box.append(button(`Confirm ${candidate.title} (${candidate.year||'year unknown'}) · ${Math.round(candidate.confidence*100)}%`,async()=>{await api(`/imports/${id}/resolve`,{method:'POST',body:{row_id:row.id,action:'confirm',work_id:candidate.id}});await reviewImport(id);}));
    box.append(button('Search for a match',()=>{const f=form([{name:'q',label:'Title to search',value:row.title}],'Search',async values=>{const results=await api(`/profiles/${profile.id}/search?q=${encodeURIComponent(values.q)}`);for(const work of results.items)box.append(button(`Use ${work.title} (${work.year||''})`,async()=>{await api(`/imports/${id}/resolve`,{method:'POST',body:{row_id:row.id,work_id:work.id,action:'confirm'}});await reviewImport(id);}));});box.append(f);}),
      button('Skip',async()=>{await api(`/imports/${id}/resolve`,{method:'POST',body:{row_id:row.id,action:'skip'}});await reviewImport(id);}),
      button('Undo mapping',async()=>{await api(`/imports/${id}/resolve`,{method:'POST',body:{row_id:row.id,action:'reset'}});await reviewImport(id);}));main.append(box);
  }
}
new FocusManager(document,()=>{if(dialog.open)dialog.close();else if(profile && page!=='Home')navigate('Home').catch(showError);else picker().catch(showError);});
window.addEventListener('unhandledrejection',e=>{e.preventDefault();showError(e.reason);});
boot();
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
