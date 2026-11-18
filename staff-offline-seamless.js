/* RBH offline-first corrective action queue: no second passphrase.
 * Encrypted at rest with a nonextractable device CryptoKey. Server identity,
 * tenant, workflow generation, revisions and permissions remain authoritative.
 * A queued submission is immutable and independently retryable by operation UUID.
 */
(function(root){
'use strict';
const DB='rbh-seamless-offline-v1',VERSION=1,TTL=24*60*60*1000;
const KINDS={action_completion:'submit_action_completion',verification:'verify_action',changes_requested:'request_action_changes'};
const KEY_PREFIX='rbh-seamless:';
const state={client:null,identity:null,enabled:false,busy:false,initialized:false};
const enc=new TextEncoder(),dec=new TextDecoder();
function open(){
 return new Promise((resolve,reject)=>{
  if(!root.indexedDB||!root.crypto?.subtle||!root.isSecureContext)return reject(Error('SECURE_OFFLINE_STORAGE_REQUIRED'));
  const req=indexedDB.open(DB,VERSION);
  req.onupgradeneeded=()=>{for(const n of ['data','keys','meta'])if(!req.result.objectStoreNames.contains(n))req.result.createObjectStore(n,{keyPath:'id'});};
  req.onerror=()=>reject(req.error||Error('OFFLINE_STORAGE_UNAVAILABLE'));
  req.onblocked=()=>reject(Error('OFFLINE_STORAGE_BUSY'));
  req.onsuccess=()=>resolve(req.result);
 });
}
async function dbOp(store,mode,cb){
 const db=await open();
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let val;tx.oncomplete=()=>resolve(val);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('OFFLINE_STORAGE_ABORTED'));try{val=cb(tx.objectStore(store));}catch(e){tx.abort();reject(e);}});}
 finally{db.close();}
}
async function get(store,id){
 const db=await open();
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).get(id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}
 finally{db.close();}
}
function identityKey(u){return KEY_PREFIX+u.organizationId+':'+u.userId;}
function own(u){return identityKey(u||state.identity);}
function rowId(u,kind,id){return identityKey(u)+':'+kind+':'+id;}
function same(a,b){return !!a&&!!b&&a.organizationId===b.organizationId&&a.userId===b.userId;}
async function deviceKey(u,create){
 const id=identityKey(u),existing=await get('keys',id);
 if(existing?.key)return existing.key;
 if(!create)throw Error('DEVICE_NOT_PREPARED');
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 await dbOp('keys','readwrite',store=>store.put({id,key,createdAt:Date.now()}));
 const stored=await get('keys',id);
 if(!stored?.key)throw Error('DEVICE_ENCRYPTION_KEY_NOT_SAVED');
 return stored.key;
}
async function putEncrypted(u,kind,id,value){
 const key=await deviceKey(u,true),recordId=rowId(u,kind,id),iv=crypto.getRandomValues(new Uint8Array(12));
 const payload=enc.encode(JSON.stringify(value));
 if(payload.byteLength>16*1024*1024)throw Error('OFFLINE_ITEM_TOO_LARGE');
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(recordId)},key,payload);
 const record={id:recordId,iv,ciphertext,savedAt:Date.now()};
 await dbOp('data','readwrite',store=>store.put(record));
 const check=await get('data',recordId);
 if(!check||check.savedAt!==record.savedAt)throw Error('LOCAL_WRITE_NOT_VERIFIED');
 return value;
}
async function readEncrypted(u,kind,id){
 const recordId=rowId(u,kind,id),r=await get('data',recordId);if(!r)return null;
 const key=await deviceKey(u,false);
 try{
 const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:r.iv,additionalData:enc.encode(recordId)},key,r.ciphertext);
 return JSON.parse(dec.decode(bytes));
 }catch(_){throw Error('OFFLINE_DATA_UNREADABLE');}
}
async function listEncrypted(u,kind){
 const prefix=rowId(u,kind,''),db=await open();
 let ids=[];
 try{ids=await new Promise((resolve,reject)=>{const out=[],tx=db.transaction('data','readonly'),req=tx.objectStore('data').openKeyCursor();req.onsuccess=()=>{const cur=req.result;if(!cur)return;const id=String(cur.key);if(id.startsWith(prefix))out.push(id.slice(prefix.length));cur.continue();};req.onerror=()=>reject(req.error);tx.oncomplete=()=>resolve(out);tx.onabort=()=>reject(tx.error);});}
 finally{db.close();}
 const result=[];for(const id of ids){const value=await readEncrypted(u,kind,id);if(value)result.push(value);}
 return result;
}
async function eraseDevice(u){
 const prefix=identityKey(u);
 for(const store of ['data','keys','meta']){
  const db=await open();
  try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(store,'readwrite'),req=tx.objectStore(store).openCursor();
   req.onsuccess=()=>{const cur=req.result;if(!cur)return;if(String(cur.key).startsWith(prefix))cur.delete();cur.continue();};
   req.onerror=()=>reject(req.error);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
 }
}
function eligibles(u,reports,actions){
 const manager=['admin','safety_manager'].includes(u.role);
 const results=[];
 for(const a of actions||[]){
  if(a.retired_at||!a.id||!a.report_id)continue;
  const r=(reports||[]).find(x=>x.id===a.report_id);
  if(!r||r.organization_id!==u.organizationId||['closed','duplicate','no_action'].includes(r.status))continue;
  if(Number(a.workflow_generation||0)!==Number(r.workflow_restart_count||0))continue;
  const ownAction=String(a.owner_user_id||'')===u.userId;
  if(!manager&&!ownAction)continue;
  const canSubmit=(manager||u.role==='supervisor'&&ownAction)&&['not_started','in_progress','changes_requested'].includes(a.status);
  const canVerify=manager&&a.status==='awaiting_verification';
  results.push({id:a.id,number:a.action_number,reportId:r.id,reportNumber:r.ref_no,reportSite:r.job_site||'',
   description:String(a.description||'').slice(0,2000),actionStatus:a.status,actionRevision:a.updated_at,
   reportRevision:r.updated_at,generation:Number(r.workflow_restart_count||0),
   reopenCount:Number(r.reopen_count||0),canSubmit,canVerify,role:u.role,organizationId:u.organizationId});
 }
 return results.slice(0,100);
}
async function saveSnapshot(u,reports,actions){
 const items=eligibles(u,reports,actions);
 await putEncrypted(u,'snapshot','current',{items,savedAt:Date.now(),expiresAt:Date.now()+TTL});
 await dbOp('meta','readwrite',store=>store.put({id:identityKey(u)+':current',userId:u.userId,organizationId:u.organizationId,role:u.role,savedAt:Date.now()}));
 return items;
}
async function offlineIdentity(){
 const db=await open();let vals=[];
 try{vals=await new Promise((resolve,reject)=>{const out=[],tx=db.transaction('meta','readonly'),req=tx.objectStore('meta').openCursor();req.onsuccess=()=>{const c=req.result;if(!c)return;if(String(c.key).endsWith(':current'))out.push(c.value);c.continue();};req.onerror=()=>reject(req.error);tx.oncomplete=()=>resolve(out);});}
 finally{db.close();}
 if(vals.length!==1)throw Error('SIGN_IN_ONLINE_TO_PREPARE_OFFLINE_WORK');
 return vals[0];
}
async function snapshot(u){
 const result=await readEncrypted(u,'snapshot','current');
 if(!result||Date.now()>result.expiresAt)throw Error('OFFLINE_ASSIGNMENTS_EXPIRED_RECONNECT');
 return result.items;
}
function actionScope(a,u){return {organizationId:u.organizationId,userId:u.userId,reportId:a.reportId,actionId:a.id,generation:a.generation};}
async function draft(u,actionId){return readEncrypted(u,'draft',actionId);}
const actionWrites=new Map();
function serializeAction(id,callback){
 const previous=actionWrites.get(id)||Promise.resolve();
 const next=previous.catch(()=>{}).then(callback);
 actionWrites.set(id,next);
 next.finally(()=>{if(actionWrites.get(id)===next)actionWrites.delete(id);}).catch(()=>{});
 return next;
}
async function saveNote(a,note,step){
 const u=state.identity||await offlineIdentity();
 return serializeAction(u.organizationId+':'+u.userId+':'+a.id,async()=>{

 const previous=await draft(u,a.id);
 if(previous?.queued)return {queued:true};
 await putEncrypted(u,'draft',a.id,{actionId:a.id,step,note,savedAt:Date.now(),files:previous?.files||[]});
 return {queued:false};

 });
}
async function addPhoto(a,file){
 const u=state.identity||await offlineIdentity();
 return serializeAction(u.organizationId+':'+u.userId+':'+a.id,async()=>{

 if(!file||!file.size||file.size>10*1024*1024||!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type))throw Error('PHOTO_MUST_BE_IMAGE_UNDER_10MB');
 const previous=await draft(u,a.id)||{actionId:a.id,step:'action_completion',note:'',files:[]};
 if(previous.queued)throw Error('ACTION_ALREADY_QUEUED');
 if(previous.files.length>=5)throw Error('MAX_FIVE_PHOTOS_PER_ACTION');
 const bytes=new Uint8Array(await file.arrayBuffer());
 let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 const entry={id:crypto.randomUUID(),name:file.name.slice(0,120),type:file.type,base64:btoa(binary),savedAt:Date.now()};
 await putEncrypted(u,'photo',entry.id,entry);
 previous.files.push(entry.id);
 await putEncrypted(u,'draft',a.id,previous);
 return previous.files.length;

 });
}
async function stage(a,step,note){
 const u=state.identity||await offlineIdentity();
 return serializeAction(u.organizationId+':'+u.userId+':'+a.id,async()=>{

 if(!KINDS[step])throw Error('OFFLINE_OPERATION_NOT_SUPPORTED');
 const n=String(note||'').trim();
 if((step!=='verification'&&!n)||n.length>5000)throw Error('NOTE_REQUIRED_UP_TO_5000_CHARACTERS');
 if(step==='action_completion'&&!a.canSubmit||step!=='action_completion'&&!a.canVerify)throw Error('ACTION_NOT_AUTHORIZED_FOR_OFFLINE');
 const entries=await listEncrypted(u,'queue');
 if(entries.some(x=>x.actionId===a.id&&['waiting','retry','syncing','needs_review'].includes(x.status)))throw Error('ACTION_HAS_PENDING_SUBMISSION');
 const prior=await draft(u,a.id);
 const item={operationId:crypto.randomUUID(),actionId:a.id,reportId:a.reportId,organizationId:u.organizationId,userId:u.userId,
  kind:KINDS[step],step,note:n,actionRevision:a.actionRevision,reportRevision:a.reportRevision,
  actionStatus:a.actionStatus,generation:a.generation,reopenCount:a.reopenCount,files:prior?.files||[],
  status:'waiting',createdAt:Date.now(),lastError:null};
 await putEncrypted(u,'queue',item.operationId,item);
 await putEncrypted(u,'draft',a.id,{...(prior||{}),note:n,step,files:item.files,queued:true,savedAt:Date.now()});
 renderCounters();
 if(state.client&&navigator.onLine!==false)flush();
 return item;

 });
}
async function uploadPhotos(item,u){
 for(const id of item.files){
  const file=await readEncrypted(u,'photo',id);if(!file)throw Error('LOCAL_EVIDENCE_NOT_FOUND');
  const cap=await state.client.functions.invoke('manage-offline-action-evidence',{body:{action:'capabilities',reportId:item.reportId,correctiveActionId:item.actionId}});
  if(cap.error||!cap.data?.ok||cap.data?.offlineProtocolVersion!==1)throw Error('EVIDENCE_UPLOAD_PROTOCOL_UNAVAILABLE');
  const fd=new FormData();
  for(const [k,v] of Object.entries({action:'upload',reportId:item.reportId,correctiveActionId:item.actionId,
   clientEvidenceId:id,expectedActionRevision:item.actionRevision,expectedReportRevision:item.reportRevision,
   expectedActionStatus:item.actionStatus,expectedGeneration:String(item.generation),expectedReopenCount:String(item.reopenCount)}))fd.append(k,v);
  fd.append('files',new File([Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0))],file.name,{type:file.type}));
  const res=await state.client.functions.invoke('manage-offline-action-evidence',{body:fd});
  if(res.error||res.data?.ok!==true||res.data?.clientEvidenceId!==id||res.data?.offlineProtocolVersion!==1||
   !Array.isArray(res.data.added)||res.data.added.length!==1)throw Error('EVIDENCE_RECEIPT_NOT_VERIFIED');
 }
}
function conflictError(msg){return /CONFLICT|REVOKED|DISABLED|MISMATCH|NOT_ACTIVE|NOT_FOUND|NOT_AUTHORIZED|EXPIRED|WORKFLOW|REUSED|INVALID|NOT_CURRENT|NOT_STARTED|RETIRED|ACCESS|PERMISSION|OFFLINE_SESSION|STALE/i.test(msg);}
async function flush(){
 if(state.busy||!state.client||!state.enabled||navigator.onLine===false)return;
 state.busy=true;
 const u=state.identity;
 try{
  const auth=await state.client.auth.getUser();
  if(auth.error||auth.data?.user?.id!==u.userId){state.lastSyncIssue=auth.error?.message||'SIGN_IN_REQUIRED';return;}
  const gate=await state.client.rpc('rbh_staff_offline_status');
  if(gate.error||gate.data?.enabled!==true||gate.data?.protocolVersion!==1){state.lastSyncIssue=gate.error?.message||'OFFLINE_ACCESS_CHECK_FAILED';return;}
  state.lastSyncIssue=null;
  // Reclaim interrupted attempts after a browser crash or PWA force-close.
  // Reuse the durable operationId so the server's idempotency ledger prevents duplicates.
  const entries=(await listEncrypted(u,'queue')).filter(x=>['waiting','retry','syncing'].includes(x.status));
  for(const original of entries){
   let item={...original,status:'syncing'};await putEncrypted(u,'queue',item.operationId,item);renderCounters();
   try{
    await uploadPhotos(item,u);
    const res=await state.client.rpc('rbh_commit_offline_corrective_action',{
     p_operation_id:item.operationId,p_action_id:item.actionId,p_kind:item.kind,p_note:item.note,
     p_expected_action_updated_at:item.actionRevision,p_expected_report_updated_at:item.reportRevision,
     p_expected_generation:item.generation,p_expected_reopen_count:item.reopenCount,p_expected_action_status:item.actionStatus
    });
    if(res.error)throw Error(res.error.message||'OFFLINE_COMMIT_FAILED');
    if(res.data?.ok!==true||res.data?.committed!==true||res.data.operationId!==item.operationId||
       res.data.actionId!==item.actionId||res.data.kind!==item.kind)throw Error('SERVER_RECEIPT_NOT_VERIFIED');
    state.lastSyncIssue=null;
    item={...item,status:'synced',syncedAt:Date.now(),receipt:res.data};
    await putEncrypted(u,'queue',item.operationId,item);
    root.dispatchEvent?.(new CustomEvent('rbh-offline-action-synced',{detail:{actionId:item.actionId,reportId:item.reportId,kind:item.kind}}));
    await putEncrypted(u,'draft',item.actionId,{actionId:item.actionId,step:item.step,note:item.note,
      queued:false,files:[],synced:true,savedAt:Date.now()});
   }catch(e){
    const message=String(e.message||e);
    state.lastSyncIssue=message;
    item={...item,status:conflictError(message)?'needs_review':'retry',lastError:message};
    await putEncrypted(u,'queue',item.operationId,item);
    root.dispatchEvent?.(new CustomEvent('rbh-offline-action-sync-delayed',{
     detail:{actionId:item.actionId,reportId:item.reportId,status:item.status,error:message}
    }));
    if(navigator.onLine===false)break;
   }
   renderCounters();
  }
 }catch(e){state.lastSyncIssue=String(e?.message||e);console.warn('RBH automatic offline synchronization delayed',e);}
 finally{state.busy=false;renderCounters();if(new URLSearchParams(location.search).has('offlineSync'))showSyncHandoff().catch(()=>{});}
}
async function counts(){
 if(!state.identity)return{pending:0,review:0,synced:0};
 const q=await listEncrypted(state.identity,'queue');
 return {pending:q.filter(x=>['waiting','retry','syncing'].includes(x.status)).length,
 review:q.filter(x=>x.status==='needs_review').length,synced:q.filter(x=>x.status==='synced').length};
}
async function renderCounters(){
 const p=document.getElementById('rbhSeamlessStatus');
 if(!p||!state.identity)return;
 try{const c=await counts();p.textContent=c.pending+' waiting to sync · '+c.review+' need review · '+c.synced+' synced on this device'+(state.lastSyncIssue?' · Last sync issue: '+state.lastSyncIssue:'');}
 catch(_){p.textContent='Device status unavailable. Check local storage before leaving.';}
}
async function showSyncHandoff(){
 if(!new URLSearchParams(location.search).has('offlineSync')||!state.identity)return;
 let banner=document.getElementById('rbhOfflineSyncHandoff');
 if(!banner){
  banner=document.createElement('section');banner.id='rbhOfflineSyncHandoff';
  banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
  banner.style.cssText='position:fixed;bottom:16px;left:16px;right:16px;z-index:1010;max-width:620px;margin:auto;padding:16px;border:2px solid #b5c7d9;border-radius:12px;background:#fff;color:#202733;box-shadow:0 10px 30px #0003;font:15px/1.45 system-ui,sans-serif';
  const title=document.createElement('strong');title.id='rbhOfflineSyncHeading';
  const detail=document.createElement('p');detail.id='rbhOfflineSyncDetail';detail.style.margin='7px 0 12px';
  const buttons=document.createElement('div');buttons.style.cssText='display:flex;gap:9px;flex-wrap:wrap';
  const retry=document.createElement('button');retry.type='button';retry.textContent='Check / retry sync';
  const review=document.createElement('a');review.href='./staff-offline-seamless.html';review.textContent='Review saved work';
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Dismiss';
  for(const item of [retry,review,dismiss])item.style.cssText='display:inline-block;border:1px solid #b6c1cc;border-radius:8px;background:#f2f4f7;color:#202733;text-decoration:none;padding:10px 12px;font:600 13px system-ui;cursor:pointer';
  retry.addEventListener('click',async()=>{retry.disabled=true;try{await flush();await showSyncHandoff();}finally{retry.disabled=false;}});
  dismiss.addEventListener('click',()=>banner.remove());
  buttons.append(retry,review,dismiss);banner.append(title,detail,buttons);document.body.appendChild(banner);
 }
 const c=await counts();
 const heading=banner.querySelector('#rbhOfflineSyncHeading'),detail=banner.querySelector('#rbhOfflineSyncDetail');
 if(c.review){
  heading.textContent='Offline work needs review';
  detail.textContent=c.review+' item(s) need attention. '+c.pending+' waiting; '+c.synced+' confirmed. '+(state.lastSyncIssue?'Last issue: '+state.lastSyncIssue+'. ':'')+'Review saved work for the stored note.';
 }else if(c.pending){
  heading.textContent='Offline work saved — not yet confirmed';
  detail.textContent=c.pending+' item(s) still need a server receipt. '+(state.lastSyncIssue?'Last issue: '+state.lastSyncIssue+'. ':'')+'Keep the dashboard open or tap Check / retry sync. '+c.synced+' confirmed.';
 }else{
  heading.textContent=c.synced?'Offline work synchronized':'No offline work awaiting sync';
  detail.textContent=c.synced?c.synced+' item(s) confirmed by RBH. You can continue working.':'No queued corrective-action updates on this device.';
 }
}
function renderPanel(){
 const panel=document.getElementById('rbhSeamlessPanel');
 if(!panel)throw Error('OFFLINE_PROFILE_PANEL_NOT_FOUND');
 panel.hidden=false;
 const retry=document.getElementById('rbhSeamlessRetry');
 if(retry&&!retry.dataset.wired){
  retry.dataset.wired='yes';
  retry.addEventListener('click',async()=>{
   retry.disabled=true;
   try{await init(state.identity,state.latestReports||[],state.latestActions||[],state.client);}
   finally{retry.disabled=false;}
  });
 }
 return panel;
}
function statusMessage(message,error){
 const node=document.getElementById('rbhSeamlessStatus');
 if(node){node.textContent=message;node.style.color=error?'#a1182c':'';}
}
async function init(identity,reports,actions,client){
 if(!identity||!client)return;
 const panel=renderPanel();
 statusMessage('Checking offline access…');
 const prior=state.identity;
 if(prior&&!same(prior,identity)){
  try{await eraseDevice(prior);}catch(e){console.warn('Prior offline cleanup failed',e);}
 }
 state.identity={...identity};state.client=client;state.enabled=false;
 state.latestReports=Array.isArray(reports)?reports:[];
 state.latestActions=Array.isArray(actions)?actions:[];
 let gate;
 try{gate=await client.rpc('rbh_staff_offline_status');}
 catch(e){gate={error:{message:e?.message||'NETWORK_UNAVAILABLE'}};}
 if(!same(state.identity,identity))return;
 if(gate.error){
  statusMessage('Offline access could not be checked ('+(gate.error.message||'connection or session error')+'). Your work is not offline-ready. Try Check offline access while connected.',true);
  return;
 }
 if(gate.data?.enabled!==true||gate.data?.protocolVersion!==1){
  statusMessage('Offline access is not available for this account. Check that your account is active and connected to an organization with offline work enabled, then tap Check offline access.',true);
  const openLink=document.getElementById('rbhSeamlessOpen');if(openLink)openLink.style.display='none';
  // Only an explicit authenticated revocation clears previously saved work.
  if(gate.data?.enabled===false){
   try{
    await eraseDevice(identity);
    if(root.caches){const c=await caches.open('rbh-staff-offline-device-v1');
     await c.delete(new URL('./staff-offline-device-enabled',location.href).href);}
   }catch(e){console.warn('Offline revocation cleanup failed',e);}
  }
  return;
 }
 try{
  if(!root.isSecureContext||!root.crypto?.subtle||!root.indexedDB)
   throw Error('SECURE_DEVICE_STORAGE_UNAVAILABLE');
  await deviceKey(identity,true);
  await saveSnapshot(identity,state.latestReports,state.latestActions);
  if(root.caches){const c=await caches.open('rbh-staff-offline-device-v1');
   await c.put(new URL('./staff-offline-device-enabled',location.href).href,new Response('1'));}
  state.enabled=true;
  const link=document.getElementById('rbhSeamlessOpen');if(link)link.style.display='inline-flex';
  statusMessage('Offline work prepared securely for this device. No separate passphrase is required.');
  if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
  await flush();
  await showSyncHandoff();
 }catch(e){
  state.enabled=false;
  const msg=String(e?.message||'DEVICE_PREPARATION_FAILED');
  console.error('RBH offline-first initialization failed',e);
  statusMessage('Offline work could not be prepared on this device ('+msg+'). Do not rely on offline work until this is resolved.',true);
 }
}
function refresh(reports,actions){if(state.enabled&&state.identity)saveSnapshot(state.identity,reports,actions).catch(e=>console.warn('offline snapshot refresh failed',e));}
function actionFromLive(r,a,step){
 const u=state.identity;
 return {id:a.id,number:a.action_number,reportId:r.id,reportNumber:r.ref_no,reportSite:r.job_site||'',
 description:a.description||'',actionStatus:a.status,actionRevision:a.updated_at,reportRevision:r.updated_at,
 generation:Number(r.workflow_restart_count||0),reopenCount:Number(r.reopen_count||0),
 canSubmit:['admin','safety_manager'].includes(u.role)||u.role==='supervisor'&&String(a.owner_user_id||'')===u.userId,
 canVerify:['admin','safety_manager'].includes(u.role)};
}
function wireAction(r,a,textarea,button,step){
 if(!state.enabled||!state.identity||!textarea||!button||textarea.dataset.seamlessWired)return;
 const u=state.identity,entry=actionFromLive(r,a,step);
 textarea.dataset.seamlessWired='yes';
 let changed=false,timer;
 const hint=document.createElement('p');hint.className='field-help';hint.setAttribute('role','status');
 hint.textContent='Changes save securely on this device.';textarea.insertAdjacentElement('afterend',hint);
 draft(u,a.id).then(old=>{
  if(!textarea.isConnected||!old)return;
  if(old.queued){
   button.dataset.rbhOfflineQueued='yes';
   hint.textContent='This action was saved on this device and is waiting to sync. Do not submit it again.';
   if(old.note&&!changed&&!textarea.value.trim())textarea.value=old.note;
   return;
  }
  if(!changed&&old.note&&!textarea.value.trim())textarea.value=old.note;
 }).catch(()=>{hint.textContent='Local draft could not be restored.';});
 textarea.addEventListener('input',()=>{
  changed=true;clearTimeout(timer);hint.textContent='Saving on device…';
  timer=setTimeout(async()=>{try{
   const saved=await saveNote(entry,textarea.value,step);
   hint.textContent=saved.queued?'Already queued for sync. New edits are not part of the queued submission; check saved work.':'Saved on device.';
  }catch(e){hint.textContent='Device save failed: '+e.message;}},350);
 });
 // Use the same durable idempotent operation path online and offline.
 // iOS may report navigator.onLine=true during airplane-mode transitions.
 button.addEventListener('click',async event=>{
  event.preventDefault();event.stopImmediatePropagation();
  if(button.dataset.rbhOfflineQueued==='yes'){
   hint.textContent='Already saved for sync. Checking for server confirmation…';
   if(navigator.onLine!==false)flush();
   return;
  }
  if(!textarea.value.trim()&&step!=='verification'){hint.textContent='Enter a note before submitting.';return;}
  clearTimeout(timer);
  button.disabled=true;
  try{
   await stage(entry,step,textarea.value);
   button.dataset.rbhOfflineQueued='yes';
   hint.textContent='Saved securely on this device — awaiting server confirmation.';
   button.textContent='Saved — awaiting sync';
   if(navigator.onLine!==false)flush();
  }catch(e){
   if(e.message==='ACTION_HAS_PENDING_SUBMISSION'){
    button.dataset.rbhOfflineQueued='yes';
    hint.textContent='Already queued on this device. Waiting to synchronize.';
    if(navigator.onLine!==false)flush();
   }else hint.textContent='Could not save this submission: '+e.message;
  }finally{button.disabled=false;}
 },true);
 // Show authoritative receipt/retry state on the action being edited.
 const onSynced=event=>{
  if(String(event.detail?.actionId)!==String(entry.id)||!hint.isConnected)return;
  hint.textContent='Synchronized with RBH. Your corrective action was submitted.';
  button.dataset.rbhOfflineQueued='synced';
  button.textContent='Submitted for review';
  button.disabled=true;
 };
 const onDelayed=event=>{
  if(String(event.detail?.actionId)!==String(entry.id)||!hint.isConnected)return;
  hint.textContent=event.detail?.status==='needs_review'?
   'Saved on this device — needs review before it can sync. Open View saved work and sync status in Profile.':
   'Saved on this device — retrying when the connection is available.';
 };
 root.addEventListener('rbh-offline-action-synced',onSynced);
 root.addEventListener('rbh-offline-action-sync-delayed',onDelayed);
 if(step==='action_completion'){
  const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;
  input.setAttribute('aria-label','Add offline corrective-action photos');
  const visibility=()=>{input.hidden=navigator.onLine!==false;};
  visibility();root.addEventListener('online',visibility);root.addEventListener('offline',visibility);
  textarea.insertAdjacentElement('afterend',input);
  input.addEventListener('change',async()=>{try{for(const file of input.files)await addPhoto(entry,file);
   hint.textContent='Photos encrypted on device; they will upload before submission.';}
   catch(e){hint.textContent='Photo save failed: '+e.message;}input.value='';});
 }
}
async function signOut(){
 const u=state.identity;state.enabled=false;state.client=null;state.identity=null;
 if(u)await eraseDevice(u);
 if(root.caches){const c=await caches.open('rbh-staff-offline-device-v1');await c.delete(new URL('./staff-offline-device-enabled',location.href).href);}
}
async function hasPending(){
  if(!state.identity)return false;
  const c=await counts();
  if(c.pending>0||c.review>0)return true;
  // A note or photo saved on this device but not yet submitted is also
  // irreplaceable work. Warn before logout wipes the encrypted local store.
  const drafts=await listEncrypted(state.identity,'draft');
  return drafts.some(d=>!d.synced&&(!!String(d.note||'').trim()||(d.files||[]).length>0));
}
let recoveryInProgress=false;
async function resumeSync(){
 if(navigator.onLine===false||!state.identity||!state.client)return;
 if(state.enabled){await flush();return;}
 if(recoveryInProgress)return;
 // When init was attempted during airplane mode, a temporary auth/gate
 // failure leaves state.enabled=false. Re-enable without deleting local work.
 recoveryInProgress=true;
 try{await init(state.identity,state.latestReports||[],state.latestActions||[],state.client);}
 catch(e){state.lastSyncIssue=String(e?.message||e);console.warn('RBH offline reconnection recheck delayed',e);}
 finally{recoveryInProgress=false;}
}
if(root.addEventListener){
 root.addEventListener('online',()=>{setTimeout(resumeSync,500);});
 root.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumeSync();});
 root.addEventListener('focus',()=>resumeSync());
 // Safari iOS may not emit online after leaving Airplane Mode. Recheck
 // both disabled initialization and pending queue while the PWA is visible.
 root.setInterval?.(()=>{
  if(!state.busy&&!recoveryInProgress&&document.visibilityState==='visible'&&navigator.onLine!==false)
   resumeSync();
 },15000);
}
root.TeamWorktSeamlessOffline=Object.freeze({init,refresh,wireAction,stage,saveNote,addPhoto,flush,counts,snapshot,
 offlineIdentity,draft,listEncrypted,signOut,hasPending,isEnabled:()=>state.enabled});
})(window);
