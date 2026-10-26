(() => {
  const pending=new Map();
  LocalBridge.onmessage=event=>{const result=JSON.parse(event.data),request=pending.get(result.id);if(!request)return;pending.delete(result.id);clearTimeout(request.timer);if(result.error)request.reject(new Error(result.error));else request.resolve(result.value);};
  window.LocalHousehold=Object.freeze({call:(method,value={})=>new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('Device request timed out'));},15000);pending.set(id,{resolve,reject,timer});LocalBridge.postMessage(JSON.stringify({id,method,value}));})});
})();
