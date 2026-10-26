(() => {
  const pending = new Map();
  HouseholdBridge.onmessage = event => {
    const data=JSON.parse(event.data), entry=pending.get(data.id);
    if(!entry)return;pending.delete(data.id);clearTimeout(entry.timer);
    if(data.error)entry.reject(new Error(data.error));else entry.resolve(data.value);
  };
  function call(method,value){return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('Device request timed out'));},12000);
    pending.set(id,{resolve,reject,timer});HouseholdBridge.postMessage(JSON.stringify({id,method,value}));
  });}
  window.HouseholdNative=Object.freeze({openProfile:value=>call('openProfile',value),rememberSession:value=>call('rememberSession',value),restoreSession:()=>call('restoreSession',null)});
})();
