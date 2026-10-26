export function nextInDirection(current, candidates, key) {
  const cx=current.left+current.width/2, cy=current.top+current.height/2;
  let selected=null,best=Infinity;
  for(const candidate of candidates){const r=candidate.rect,x=r.left+r.width/2-cx,y=r.top+r.height/2-cy;
    const primary=key==='ArrowRight'?x:key==='ArrowLeft'?-x:key==='ArrowDown'?y:-y;
    if(primary<=1)continue;
    const secondary=key==='ArrowRight'||key==='ArrowLeft'?Math.abs(y):Math.abs(x);
    const score=primary+secondary*3;
    if(score<best){best=score;selected=candidate.element;}
  }return selected;
}
export class FocusManager {
  constructor(doc,back){doc.addEventListener('keydown',event=>{
    if(event.key==='Escape'||event.key==='BrowserBack'){event.preventDefault();back();return;}
    if(!event.key.startsWith('Arrow'))return;
    const activeInput=doc.activeElement;
    if(/TEXTAREA|SELECT/.test(activeInput?.tagName))return;
    if(activeInput?.tagName==='INPUT' && !['checkbox','radio','file','button'].includes(activeInput.type) &&
      ['ArrowLeft','ArrowRight'].includes(event.key))return;
    const scope=doc.querySelector('dialog[open]')||doc;
    const elements=[...scope.querySelectorAll('button:not(:disabled),a[href],input,select,[tabindex="0"]')].filter(e=>e.getClientRects().length);
    if(!elements.length)return;
    const active=doc.activeElement;
    if(!elements.includes(active)){elements[0].focus();event.preventDefault();return;}
    let target=nextInDirection(active.getBoundingClientRect(),elements.filter(e=>e!==active).map(element=>({element,rect:element.getBoundingClientRect()})),event.key);
    if(!target && active.tagName==='INPUT' && ['ArrowUp','ArrowDown'].includes(event.key)){
      target=elements[elements.indexOf(active)+(event.key==='ArrowDown'?1:-1)];
    }
    if(target){event.preventDefault();target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}
  });}
}
