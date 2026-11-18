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
async function saveNote(a,note,step){
 const u=state.identity||await offlineIdentity();
 const previous=await draft(u,a.id);
 if(previous?.queued)throw Error('ACTION_ALREADY_QUEUED');
 await putEncrypted(u,'draft',a.id,{actionId:a.id,step,note,savedAt:Date.now(),files:previous?.files||[]});
 return true;
}
async function addPhoto(a,file){
 const u=state.identity||await offlineIdentity();
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
}
async function stage(a,step,note){
 const u=state.identity||await offlineIdentity();
 if(!KINDS[step])throw Error('OFFLINE_OPERATION_NOT_SUPPORTED');
 const n=String(note||'').trim();
 if((step!=='verification'&&!n)||n.length>5000)throw Error('NOTE_REQUIRED_UP_TO_5000_CHARACTERS');
 if(step==='action_completion'&&!a.canSubmit||step!=='action_completion'&&!a.canVerify)throw Error('ACTION_NOT_AUTHORIZED_FOR_OFFLINE');
 const entries=await listEncrypted(u,'queue');
 if(entries.some(x=>x.actionId===a.id&&['waiting','syncing','needs_review'].includes(x.status)))throw Error('ACTION_HAS_PENDING_SUBMISSION');
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
  if(auth.error||auth.data?.user?.id!==u.userId)return;
  const gate=await state.client.rpc('rbh_staff_offline_status');
  if(gate.error||gate.data?.enabled!==true||gate.data?.protocolVersion!==1)return;
  const entries=(await listEncrypted(u,'queue')).filter(x=>x.status==='waiting'||x.status==='retry');
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
    item={...item,status:'synced',syncedAt:Date.now(),receipt:res.data};
    await putEncrypted(u,'queue',item.operationId,item);
    root.dispatchEvent?.(new CustomEvent('rbh-offline-action-synced',{detail:{actionId:item.actionId,reportId:item.reportId,kind:item.kind}}));
    await putEncrypted(u,'draft',item.actionId,{actionId:item.actionId,step:item.step,note:item.note,
      queued:false,files:[],synced:true,savedAt:Date.now()});
   }catch(e){
    const message=String(e.message||e);
    item={...item,status:conflictError(message)?'needs_review':'retry',lastError:message};
    await putEncrypted(u,'queue',item.operationId,item);
    if(navigator.onLine===false)break;
   }
   renderCounters();
  }
 }catch(e){console.warn('RBH automatic offline synchronization delayed',e);}
 finally{state.busy=false;renderCounters();}
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
 try{const c=await counts();p.textContent=c.pending+' waiting to sync · '+c.review+' need review · '+c.synced+' synced on this device';}
 catch(_){p.textContent='Device status unavailable. Check local storage before leaving.';}
}
function renderPanel(){
 if(document.getElementById('rbhSeamlessPanel'))return;
 const anchor=document.getElementById('rbhPushStatus')?.closest('.profile-card-section');
 if(!anchor)return;
 const panel=document.createElement('div');panel.className='profile-card-section';panel.id='rbhSeamlessPanel';
 panel.innerHTML='<h4>Offline sync (automatic)</h4><p class="field-help">Assigned corrective actions are prepared securely on this device when you sign in online. Enter work normally, even without reception; submissions made offline sync when the app is open and connectivity returns. No separate passphrase.</p><p id="rbhSeamlessStatus" role="status" class="field-help">Preparing your device…</p><a class="profile-secondary" style="display:inline-flex;text-decoration:none" href="./staff-offline-seamless.html">View saved work and sync status</a>';
 anchor.insertAdjacentElement('afterend',panel);
 renderCounters();
}
async function init(identity,reports,actions,client){
 if(!identity||!client)return;
 if(state.identity&&!same(state.identity,identity))await eraseDevice(state.identity);
 state.identity={...identity};state.client=client;state.enabled=false;
 const gate=await client.rpc('rbh_staff_offline_status').catch(()=>({error:true}));
 if(!same(state.identity,identity))return;
 state.enabled=!gate.error&&gate.data?.enabled===true&&gate.data?.protocolVersion===1;
 const panel=document.getElementById('rbhSeamlessPanel');
 if(!state.enabled){if(panel)panel.hidden=true;return;}
 try{
  await deviceKey(identity,true);
  await saveSnapshot(identity,reports,actions);
  if(root.caches){const c=await caches.open('rbh-staff-offline-device-v1');await c.put(new URL('./staff-offline-device-enabled',location.href).href,new Response('1'));}
  if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
  renderPanel();if(panel)panel.hidden=false;renderCounters();flush();
 }catch(e){console.error('RBH offline-first initialization failed',e);root.alert?.('Offline device storage could not be prepared. Do not rely on offline saving until resolved.');}
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
  if(!textarea.isConnected||changed||!old||old.queued)return;
  if(old.note&&!textarea.value.trim())textarea.value=old.note;
 }).catch(()=>{hint.textContent='Local draft could not be restored.';});
 textarea.addEventListener('input',()=>{
  changed=true;clearTimeout(timer);hint.textContent='Saving on device…';
  timer=setTimeout(async()=>{try{await saveNote(entry,textarea.value,step);hint.textContent='Saved on device.';}
   catch(e){hint.textContent='Device save failed: '+e.message;}},350);
 });
 // Capture before the legacy online handler. Offline submission NEVER calls
 // the online RPC directly; one tap stores one durable, retryable intent.
 button.addEventListener('click',async event=>{
  if(navigator.onLine!==false)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!textarea.value.trim()&&step!=='verification'){hint.textContent='Enter a note before submitting.';return;}
  button.disabled=true;
  try{await stage(entry,step,textarea.value);hint.textContent='Saved on device — waiting to sync. You may move to another action.';button.textContent='Saved — waiting to sync';}
  catch(e){hint.textContent='Could not queue: '+e.message;}
  finally{button.disabled=false;}
 },true);
 if(step==='action_completion'){
  const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;
  input.setAttribute('aria-label','Add offline corrective-action photos');
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
async function hasPending(){return state.identity&&(await counts()).pending>0;}
if(root.addEventListener){
 root.addEventListener('online',()=>{setTimeout(flush,500);});
 root.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')flush();});
 root.addEventListener('focus',()=>flush());
}
root.TeamWorktSeamlessOffline=Object.freeze({init,refresh,wireAction,stage,saveNote,addPhoto,flush,counts,snapshot,
 offlineIdentity,draft,listEncrypted,signOut,hasPending,isEnabled:()=>state.enabled});
})(window);
