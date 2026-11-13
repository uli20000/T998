/* Current-center upload queue. Files stay in this browser until removed from the queue.
 * Routes to existing importers; selecting files never writes to the server. */
(function(){
  'use strict';
  const E=id=>document.getElementById(id),side=document.querySelector('.ui-side');
  if(!side||!window.UploadRouter)return;
  const center=String(window.CENTER_CONFIG?.center||window.CenterBusinessConfig?.center||'');
  const scope=[center,window.CENTER_CONFIG?.environment,window.CENTER_CONFIG?.schema,window.CENTER_CONFIG?.supabaseUrl].join('|');
  let tab;
  try{tab=sessionStorage.getItem('upload-tab');if(!tab){tab=crypto.randomUUID();sessionStorage.setItem('upload-tab',tab);}}
  catch(e){tab=crypto.randomUUID();}
  const key=scope+'|'+tab,activeKey='upload-active|'+scope;
  const isAdmin=!!E('adminApp'),labels={scores:'每日成績',staffing:'TC／工時',bi:'BI 週 SSSG',feedback:'GES／0800／4128'};
  let queue=[],busy=false,storage;
  const panel=document.createElement('section');panel.className='us-panel';panel.setAttribute('aria-label','自動分配上傳區');
  panel.innerHTML='<button type="button" class="us-mini" aria-label="展開上傳區" title="展開上傳區">📥</button><h2>上傳區</h2><label class="us-picker"><span>＋ 選檔或拖放</span><input type="file" multiple accept=".xlsx,.xls,.xlsm,.csv" aria-label="上傳並自動分配檔案"></label><p>成績・TC・工時・BI・GES／客訴</p><p class="us-message" role="status" aria-live="polite"></p><div class="us-list"></div><button type="button" class="us-clear" hidden>清空待辦檔案</button>';
  side.querySelector('.ui-nav').before(panel);
  const gate=E(isAdmin?'adminApp':'dashboard');
  const gateOpen=()=>!gate.hidden&&!gate.classList.contains('hidden')&&gate.style.display!=='none';
  const syncGate=()=>{panel.hidden=!gateOpen();};syncGate();
  new MutationObserver(syncGate).observe(gate,{attributes:true,attributeFilter:['class','style','hidden']});
  const picker=panel.querySelector('input'),drop=panel.querySelector('.us-picker'),message=panel.querySelector('.us-message'),list=panel.querySelector('.us-list'),clear=panel.querySelector('.us-clear');
  panel.querySelector('.us-mini').onclick=()=>{const frame=side.closest('.ui-frame');frame.classList.remove('ui-collapsed');frame.classList.add('ui-expanded');picker.focus();};
  function openStorage(){
    if(storage)return storage;
    storage=new Promise((resolve,reject)=>{
      const request=indexedDB.open('center-upload-queue',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('queues');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });return storage;
  }
  async function persist(value){
    const db=await openStorage();
    return new Promise((resolve,reject)=>{const tx=db.transaction('queues','readwrite');tx.objectStore('queues').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  }
  async function restore(){
    const db=await openStorage();
    return new Promise((resolve,reject)=>{const r=db.transaction('queues').objectStore('queues').get(key);r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});
  }
  function setBusy(value){busy=value;picker.disabled=value;clear.disabled=value;list.querySelectorAll('button').forEach(b=>b.disabled=value);}
  function render(){
    list.replaceChildren();clear.hidden=!queue.length;
    for(const group of queue){
      const card=document.createElement('div');card.className='us-item'+(group.error?' us-error':'');
      const title=document.createElement('strong');title.textContent=labels[group.route]||'未分配';card.append(title);
      for(const item of group.items){const name=document.createElement('span');name.textContent=item.file.name;card.append(name);}
      const status=document.createElement('span');status.textContent=group.error||group.status||('T'+center+'・已分配，待核對');card.append(status);
      if(!group.error){const button=document.createElement('button');button.type='button';button.className='us-open';button.textContent=group.route==='bi'?'開啟核對／確認匯入':'開啟核對';button.onclick=()=>activate(group).catch(fail);card.append(button);}
      const remove=document.createElement('button');remove.type='button';remove.textContent='移除待辦';remove.onclick=async()=>{
        if(importBusy()){message.textContent='匯入處理中，請等候結果後再移除。';return;}
        const next=queue.filter(x=>x.id!==group.id);try{await persist(next);queue=next;render();}catch(e){fail(e);}
      };card.append(remove);list.append(card);
    }
    setBusy(busy);
  }
  function fail(e){message.textContent='處理失敗：'+(e.message||e)+'；原檔保留，請重試。';}
  function importBusy(){return ['opsScoreFiles','biFiles'].some(id=>E(id)?.disabled)||E('staffingImportBtn')?.disabled===true||/^(讀取與篩選|匯入資料中|匯入中)/.test(E('opsFeedbackMessage')?.textContent||'');}
  async function selectFiles(files){
    if(busy)return;
    if(importBusy()){message.textContent='目前正在核對或匯入，請等候結果後再選檔。';return;}
    setBusy(true);message.textContent='辨識檔案內容中…';
    try{
      if(!window.XLSX)throw new Error('Excel 元件尚未載入，請重新整理');
      const items=queue.flatMap(g=>g.items),seen=new Set(items.map(x=>x.hash));
      for(const file of files){
        let item={file};
        try{
          if(!/\.(xlsx|xls|xlsm|csv)$/i.test(file.name))throw new Error('不支援這種檔案格式');
          const bytes=await file.arrayBuffer();
          item.hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
          if(seen.has(item.hash))continue;seen.add(item.hash);
          const book=XLSX.read(bytes,{type:'array',cellDates:true});
          const sheets=book.SheetNames.map(name=>({name,matrix:XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:true})}));
          Object.assign(item,UploadRouter.classify(sheets));
          if(item.centers.length&&item.centers.some(c=>c!==center))throw new Error('檔案標示中心 '+item.centers.join('／')+'，與目前 T'+center+' 不符');
          if(item.route!=='bi'&&/\.csv$/i.test(file.name))throw new Error('此匯入流程需要 Excel，請匯出為 .xlsx');
        }catch(e){item.error=e.message||'檔案無法讀取';}
        items.push(item);
      }
      const next=UploadRouter.groups(items).map(g=>({...g,id:crypto.randomUUID()}));
      await persist(next);queue=next;render();
      const errors=queue.filter(x=>x.error).length;
      message.textContent='T'+center+'｜已分配 '+queue.filter(x=>!x.error).length+' 批'+(errors?'，'+errors+' 批待處理':'')+'；請開啟核對。';
    }catch(e){fail(e);}finally{picker.value='';setBusy(false);}
  }
  picker.addEventListener('change',()=>selectFiles([...picker.files]));
  for(const name of ['dragenter','dragover'])drop.addEventListener(name,e=>{e.preventDefault();if(!busy)drop.classList.add('us-drag');});
  for(const name of ['dragleave','drop'])drop.addEventListener(name,e=>{e.preventDefault();drop.classList.remove('us-drag');});
  drop.addEventListener('drop',e=>selectFiles([...(e.dataTransfer?.files||[])]));
  clear.onclick=async()=>{if(importBusy()){message.textContent='匯入處理中，請等候結果。';return;}try{await persist([]);queue=[];render();message.textContent='待辦已清空。';}catch(e){fail(e);}};
  function sendFiles(input,items,dispatch=true){
    if(!input)throw new Error('找不到匯入入口');
    if(input.disabled)throw new Error('匯入入口正在處理，請稍後再試');
    const dt=new DataTransfer();for(const item of items){const f=item.file;dt.items.add(f instanceof File?f:new File([f],f.name,{type:f.type,lastModified:f.lastModified}));}
    input.files=dt.files;if(dispatch)input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function reveal(node){
    for(let p=node?.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
    node?.scrollIntoView({behavior:'smooth',block:'center'});
  }
  function getWorkspace(){
    let workspace=E('uploadWorkspace');
    if(!workspace){
      workspace=document.createElement('section');workspace.id='uploadWorkspace';workspace.className='us-workspace';
      workspace.innerHTML='<h2>檔案核對與匯入</h2><p id="uploadWorkspaceStatus" role="status"></p>';
      (isAdmin?document.querySelector('#adminApp .ui-content'):E('dashboard')).prepend(workspace);
    }
    return workspace;
  }
  async function activate(group){
    if(busy||importBusy())throw new Error('有檔案正在處理，請稍後再試');
    if(!gateOpen())throw new Error('請先登入後台');
    setBusy(true);
    try{await openGroup(group);}finally{setBusy(false);}
  }
  async function openGroup(group){
    const adminRoute=['scores','staffing'].includes(group.route);
    if(adminRoute!==isAdmin){
      await persist(queue);sessionStorage.setItem(activeKey,group.id);
      location.href=adminRoute?'admin.html':'analysis.html';return;
    }
    side.closest('.ui-frame').classList.remove('ui-more-open');
    document.querySelector('.ui-tabbar [data-tab="more"]')?.setAttribute('aria-expanded','false');
    if(isAdmin){
      if(group.route==='scores'){
        if(E('uploadWorkspace'))E('uploadWorkspace').hidden=true;
        window.UiShell.go('ops:scores');
      }else{
        const workspace=getWorkspace();workspace.hidden=false;
        workspace.append(E('staffingImportFile').closest('.staffing-panel'));
        E('uploadWorkspaceStatus').textContent='T'+center+'｜'+group.items.map(x=>x.file.name).join('、');
      }
      const input=E(group.route==='scores'?'opsScoreFiles':'staffingImportFile');
      sendFiles(input,group.items,group.route!=='scores');
      if(group.route==='scores')await window.UploadImportAdapters.prepareScores();
      reveal(group.route==='scores'?input:E('uploadWorkspace'));
    }else{
      // Reuse the real controls in a visible workspace, independent of report loading.
      const workspace=getWorkspace();
      const footer=E(group.route==='bi'?'biUploadFooter':'feedbackUploadFooter');
      for(const id of ['biUploadFooter','feedbackUploadFooter']){const other=E(id);if(other&&other!==footer&&workspace.contains(other))other.hidden=true;}
      workspace.append(footer);footer.hidden=false;footer.classList.remove('hidden');
      const input=E(group.route==='bi'?'biFiles':'opsFeedbackFiles');
      sendFiles(input,group.items,false);
      if(group.route==='feedback')await window.UploadImportAdapters.prepareFeedback();
      E('uploadWorkspaceStatus').textContent='T'+center+'｜'+group.items.map(x=>x.file.name).join('、');
      if(group.route==='bi'){
        let button=E('uploadBiConfirm');
        if(!button){button=document.createElement('button');button.id='uploadBiConfirm';button.type='button';button.className='bi-upload-button';button.textContent='確認匯入 BI 週檔';footer.prepend(button);
        button.onclick=async()=>{button.disabled=true;setBusy(true);try{await input.onchange();}finally{setBusy(false);button.disabled=false;}};}
        E('biStatus').textContent='已分配到 BI 週 SSSG；尚未匯入。請確認目前中心與來源檔案，再按確認匯入。';
        E('biPreview').replaceChildren();
      }
      reveal(workspace);
    }
    group.status='已開啟核對；匯入結果請看主畫面';await persist(queue);render();
  }
  // Resume a destination only after the existing sign-in gate has opened.
  async function start(){
    try{
      queue=await restore();
      // Recheck files rejected by the previous mixed-format classifier after this update.
      if(queue.some(g=>g.items.some(i=>i.error?.includes('同檔含多種匯入格式')))){
        const retryFiles=queue.flatMap(g=>g.items.map(i=>i.file));queue=[];await selectFiles(retryFiles);
      }
      render();message.textContent='T'+center+'｜自動分配至目前中心';
      const wanted=sessionStorage.getItem(activeKey);if(!wanted)return;
      const group=queue.find(x=>x.id===wanted);if(!group)return;
      const gate=E(isAdmin?'adminApp':'dashboard');
      const resume=()=>{if(gate.hidden||gate.classList.contains('hidden')||gate.style.display==='none')return false;
        sessionStorage.removeItem(activeKey);activate(group).catch(fail);return true;};
      if(!resume()){const observer=new MutationObserver(()=>{if(resume())observer.disconnect();});observer.observe(gate,{attributes:true,attributeFilter:['class','style','hidden']});}
    }catch(e){message.textContent='無法保存待辦檔案：'+(e.message||e)+'。請使用原本的匯入入口。';picker.disabled=true;}
  }
  start();
})();
