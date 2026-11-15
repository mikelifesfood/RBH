/* TeamWorkt Safety — Build 5 offline outbox.
 * All draft and queued content, including photos, is stored in IndexedDB
 * on THIS device only. Never send through the service worker or to analytics.
 */
(function(){
'use strict';
var DB_NAME='rbh-safety-offline-v1',DB_VERSION=1;
var DB_DRAFT='drafts',DB_OUTBOX='outbox';
var listeners=[],activeFlush=null,clientFactory=null;
var SUPA_URL='https://owhkxguiavgxzwvbxevj.supabase.co';
var SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93aGt4Z3VpYXZneHp3dmJ4ZXZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1Nzk4ODcsImV4cCI6MjEwNTE1NTg4N30.rBwR7sKelzzyTd6XpFrMIjg5W42TpEO_QefnOxzftrc';
function openDB(){
  return new Promise(function(resolve,reject){
    if(!window.indexedDB){reject(new Error('DEVICE_STORAGE_UNAVAILABLE'));return;}
    var req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=function(){
      var db=req.result;
      if(!db.objectStoreNames.contains(DB_DRAFT))db.createObjectStore(DB_DRAFT,{keyPath:'id'});
      if(!db.objectStoreNames.contains(DB_OUTBOX))db.createObjectStore(DB_OUTBOX,{keyPath:'id'});
    };
    req.onsuccess=function(){resolve(req.result);};
    req.onerror=function(){reject(req.error||new Error('DEVICE_STORAGE_ERROR'));};
    req.onblocked=function(){reject(new Error('DEVICE_STORAGE_BUSY'));};
  });
}
async function storeRequest(store,method,value){
  var db=await openDB();
  return new Promise(function(resolve,reject){
    var result;
    var tx=db.transaction(store,method==='get'||method==='getAll'?'readonly':'readwrite');
    var os=tx.objectStore(store);
    var req=method==='getAll'?os.getAll():method==='get'?os.get(value):method==='delete'?os.delete(value):os.put(value);
    req.onsuccess=function(){result=req.result;};
    tx.oncomplete=function(){db.close();resolve(result);};
    tx.onerror=function(){db.close();reject(tx.error||new Error('DEVICE_STORAGE_WRITE_FAILED'));};
    tx.onabort=function(){db.close();reject(tx.error||new Error('DEVICE_STORAGE_WRITE_ABORTED'));};
  });
}
function emit(){listeners.forEach(function(fn){try{fn();}catch(e){console.warn('outbox update',e);}});}
function uuid(){
  if(!window.crypto||!crypto.randomUUID)throw new Error('SECURE_DEVICE_IDENTIFIER_UNAVAILABLE');
  return crypto.randomUUID();
}
function list(){
  return storeRequest(DB_OUTBOX,'getAll').then(function(rows){
    return (rows||[]).sort(function(a,b){return b.createdAt-a.createdAt;});
  });
}
function enqueue(payload,files,display){
  return list().then(function(items){
    if(items.filter(function(r){return r.status!=='sent';}).length>=30)throw new Error('TOO_MANY_UNSENT_REPORTS');
    var key=uuid();
    var record={id:key,uploadToken:uuid(),payload:payload,files:Array.prototype.slice.call(files||[]).map(function(file){return {blob:file,name:file.name||'photo',type:file.type||'',size:file.size||0};}),
      createdAt:Date.now(),updatedAt:Date.now(),status:'queued',
      reportId:null,refNo:null,done:[],error:null,display:display||{}};
    return storeRequest(DB_OUTBOX,'put',record).then(function(){emit();return record;});
  });
}
async function saveRecord(record){
  record.updatedAt=Date.now();
  await storeRequest(DB_OUTBOX,'put',record);emit();
}
async function getRecord(id){return storeRequest(DB_OUTBOX,'get',id);}
async function deleteRecord(id){
  var record=await getRecord(id);
  if(record&&(record.reportId||record.status==='sending'||record.status==='uploading'))throw new Error('ALREADY_RECEIVED_CANNOT_DELETE');
  await storeRequest(DB_OUTBOX,'delete',id);emit();
}
async function clearReceipt(id){
  var record=await getRecord(id);
  if(!record||record.status!=='sent')throw new Error('RECEIPT_NOT_COMPLETE');
  await storeRequest(DB_OUTBOX,'delete',id);emit();
}
var libraryPromise=null;
function loadSupabaseLibrary(){
  if(window.supabase&&window.supabase.createClient)return Promise.resolve();
  if(libraryPromise)return libraryPromise;
  libraryPromise=new Promise(function(resolve,reject){
    var script=document.createElement('script');
    script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2';
    script.onload=function(){if(window.supabase&&window.supabase.createClient)resolve();else reject(new Error('SUPABASE_LIBRARY_UNAVAILABLE'));};
    script.onerror=function(){reject(new Error('SUPABASE_LIBRARY_UNAVAILABLE'));};
    document.head.appendChild(script);
  }).catch(function(e){libraryPromise=null;throw e;});
  return libraryPromise;
}
async function service(){
  await loadSupabaseLibrary();
  if(clientFactory){
    var existing=clientFactory();
    if(existing)return existing;
  }
  return window.supabase.createClient(SUPA_URL,SUPA_KEY);
}
function knownDuplicate(error){
  var status=Number(error&&error.status)||0;
  var msg=String(error&&(error.message||error.error||error.error_description)||'').toLowerCase();
  return status===409 || /already exists|already registered|duplicate|the resource already exists|23505/.test(msg);
}
function safeFileName(file,index){
  var name=String(file.name||('file-'+index)).replace(/[^a-zA-Z0-9._-]/g,'_');
  return String(index)+'_'+name.slice(-115);
}
async function uploadAttachments(sb,record){
  var total=record.files.length;
  for(var i=0;i<total;i++){
    if(record.done.indexOf(i)>=0)continue;
    var file=record.files[i];
    var data=file.blob||file; // Blob and original filename stored separately for Safari IndexedDB
    var path='reports/'+record.reportId+'/offline/'+record.uploadToken+'/'+safeFileName(file,i);
    var args={p_report_id:record.reportId,p_storage_path:path,p_file_name:file.name,
      p_mime_type:file.type||null,p_size_bytes:file.size||null};
    // First ask whether the deterministic file path is already registered.
    // This makes retries safe even when the report already has 10 uploaded photos.
    var before=await sb.rpc('add_attachment',args);
    if(before.error){
      var beforeMessage=String(before.error.message||'');
      if(!/UPLOADED_FILE_NOT_FOUND/.test(beforeMessage))throw before.error;
      var upload=await sb.storage.from('report-attachments').upload(path,data,
        {contentType:file.type||undefined,upsert:false});
      if(upload.error&&!knownDuplicate(upload.error))throw upload.error;
      var meta=await sb.rpc('add_attachment',args);
      if(meta.error&&!knownDuplicate(meta.error))throw meta.error;
    }
    record.done.push(i);
    await saveRecord(record);
  }
}
async function sendOne(id){
  var record=await getRecord(id);
  if(!record||record.status==='sent'||record.status==='needs_review')return;
  if(navigator.onLine===false)return;
  try{
    var sb=await service();
    if(!record.reportId){
      record.status='sending';record.error=null;await saveRecord(record);
      var payload=Object.assign({},record.payload,{client_submission_key:record.id,offline_upload_token:record.uploadToken});
      var res=await sb.rpc('submit_report',{payload:payload});
      if(res.error)throw res.error;
      if(!res.data||!res.data.id||!res.data.ref_no)throw new Error('SERVER_RECEIPT_MISSING');
      record.reportId=res.data.id;record.refNo=res.data.ref_no;
      record.status='uploading';
      await saveRecord(record); // write server receipt before any upload
    }
    if(record.files.length)await uploadAttachments(sb,record);
    record.status='sent';record.error=null;record.receivedAt=Date.now();
    record.files=[];record.payload=null;record.done=[];
    record.display={reportType:(record.display&&record.display.reportType)||'Report'}; // discard sensitive local draft after receipt
    await saveRecord(record);
  }catch(error){
    record=await getRecord(id)||record;
    if(record.status==='sent')return;
    var message=String(error&&error.message||error||'Connection unavailable');
    record.status=/INVALID_OR_INACTIVE_SITE_CODE|INVALID_REPORT|REPORT_FIELD|INVALID_OBSERVED|SUBMISSION_KEY_PAYLOAD_MISMATCH|INVALID_CLIENT_SUBMISSION_KEY/.test(message)
      ?'needs_review':'queued';
    record.error=message.slice(0,350);
    try{await saveRecord(record);}catch(e){console.error('Could not preserve offline retry state',e);}
    console.warn('RBH offline report remains queued',message);
  }
}
function flush(){
  if(activeFlush)return activeFlush;
  if(navigator.onLine===false)return Promise.resolve();
  activeFlush=(async function(){
    var items=await list();
    for(var i=items.length-1;i>=0;i--){
      if(navigator.onLine===false)break;
      if(items[i].status==='sent'||items[i].status==='needs_review')continue;
      await sendOne(items[i].id);
    }
  })().finally(function(){activeFlush=null;emit();});
  return activeFlush;
}
async function saveDraft(draft){
  draft.id='current';draft.updatedAt=Date.now();
  await storeRequest(DB_DRAFT,'put',draft);
  emit();
}
async function getDraft(){return storeRequest(DB_DRAFT,'get','current');}
async function clearDraft(){await storeRequest(DB_DRAFT,'delete','current');emit();}
async function queueForEdit(id){
  var record=await getRecord(id);
  if(!record||record.reportId)throw new Error('REPORT_ALREADY_SUBMITTED');
  return record;
}
function subscribe(fn){listeners.push(fn);return function(){listeners=listeners.filter(function(x){return x!==fn;});};}
function configure(factory){clientFactory=factory;}
window.RBHQueue={enqueue:enqueue,list:list,flush:flush,saveDraft:saveDraft,getDraft:getDraft,
  clearDraft:clearDraft,deleteRecord:deleteRecord,clearReceipt:clearReceipt,
  queueForEdit:queueForEdit,subscribe:subscribe,configure:configure,createId:uuid};
window.addEventListener('online',function(){flush().catch(function(e){console.warn('Offline outbox retry postponed',e);});});
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible'&&navigator.onLine!==false)flush().catch(function(e){console.warn('Offline outbox retry postponed',e);});
});
})();