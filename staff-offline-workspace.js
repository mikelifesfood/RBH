/* RBH staff offline workspace. Never sends, assigns, verifies or closes.
 * Assumes encrypted authorized snapshot was staged during a live authenticated session.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const store=()=>window.TeamWorktStaffOfflineFoundation;
const WORKSPACE_STEP='workspace_index';
const STEPS=[
  ['review','Review / classification'],['investigation','Investigation / root cause'],
  ['action_plan','Corrective-action planning'],['action_completion','Action completion'],
  ['verification','Verification notes'],['changes_requested','Changes requested'],
  ['closure','Report closure preparation']
];
let context=null,record=null;
function message(text,error){$('status').textContent=text;$('status').className=error?'err':'';}
function workspaceScope(){return {organizationId:context.organizationId,userId:context.userId,
 reportId:'workspace',generation:0,step:WORKSPACE_STEP};}
function makeScope(){
  if(!context||!record)throw Error('WORKSPACE_LOCKED');
  const step=$('draftStep').value;
  const actionId=['action_completion','verification','changes_requested'].includes(step)?$('draftAction').value:null;
  if(['action_completion','verification','changes_requested'].includes(step)&&!actionId)throw Error('SELECT_AN_ACTION');
  return {organizationId:context.organizationId,userId:context.userId,reportId:record.id,
    actionId:actionId||null,generation:Number(record.generation||0),step};
}
function clearEditor(){
  $('editorPanel').hidden=true;$('draftNote').value='';$('draftPhotos').value='';
  $('draftStep').replaceChildren();$('draftAction').replaceChildren();
  $('evidenceCount').textContent='';record=null;
}
function lock(){
  store()?.lock();context=null;clearEditor();$('workspacePanel').hidden=true;
  $('unlockPanel').hidden=false;$('offlinePassphrase').value='';
  $('records').replaceChildren();message('Offline workspace locked.');
}
function selectOption(label,value){
  const el=document.createElement('option');el.value=value;el.textContent=label;return el;
}
function canPrepare(step,item){
  if(item.readOnly)return false;
  if(['verification','changes_requested'].includes(step))return item.role==='admin'||item.role==='safety_manager';
  if(step==='action_completion')return item.actions.some(a=>a.canComplete);
  return item.canEditReport;
}
function renderRecordList(){
  $('records').replaceChildren();
  if(!context.records.length){$('records').textContent='No previously synchronized assignments are available offline.';return;}
  for(const item of context.records){
    const btn=document.createElement('button');btn.type='button';btn.className='record';
    const heading=document.createElement('strong');heading.textContent='Report #'+item.number+' — '+(item.site||'Safety incident');
    const secondary=document.createElement('div');secondary.className='muted';
    secondary.textContent='Status: '+item.status+' · '+item.actions.length+' corrective action(s)';
    btn.append(heading,secondary);
    btn.addEventListener('click',()=>openRecord(item));$('records').appendChild(btn);
  }
}
async function updateEvidenceCount(){
  const scope=makeScope();
  const evidence=await store().listEvidence(scope);
  $('evidenceCount').textContent=evidence.length+' photo(s) saved locally for this step.';
}
async function restoreDraft(){
  const scope=makeScope();
  try{
    const data=await store().readDraft(scope);
    $('draftNote').value=data&&data.data&&typeof data.data.note==='string'?data.data.note:'';
    await updateEvidenceCount();
    message(data?'Previously saved on this device — not submitted.':'New local draft — not submitted.');
  }catch(e){message(e.message==='OFFLINE_DRAFT_CANNOT_DECRYPT'?'Incorrect offline passphrase or damaged draft.':e.message,true);}
}
async function openRecord(item){
  record=item;$('editorTitle').textContent='Report #'+item.number+' — offline draft';
  $('draftStep').replaceChildren();
  for(const [value,label] of STEPS){if(canPrepare(value,item))$('draftStep').appendChild(selectOption(label,value));}
  $('draftAction').replaceChildren();
  for(const action of item.actions){$('draftAction').appendChild(selectOption('Action #'+action.number+' — '+action.status,action.id));}
  $('editorPanel').hidden=false;
  $('draftStep').onchange=async()=>{const step=$('draftStep').value;
    $('draftAction').disabled=!['action_completion','verification','changes_requested'].includes(step);
    if(step==='action_completion'){
      const allowed=item.actions.filter(a=>a.canComplete).map(a=>a.id);
      for(const opt of $('draftAction').options)opt.disabled=!allowed.includes(opt.value);
      if(!allowed.includes($('draftAction').value))$('draftAction').value=allowed[0]||'';
    }else for(const opt of $('draftAction').options)opt.disabled=false;
    await restoreDraft();};
  $('draftAction').onchange=restoreDraft;
  if(!$('draftStep').options.length){message('This report has no editable offline stages for your synchronized permissions.',true);clearEditor();return;}
  $('draftStep').dispatchEvent(new Event('change'));
  $('editorPanel').scrollIntoView({behavior:'smooth'});
}
$('unlockForm').addEventListener('submit',async event=>{
  event.preventDefault();const email=$('accountEmail').value.trim().toLowerCase();
  const passphrase=$('offlinePassphrase').value;
  try{
    const locator=await store().resolveAccountLocator(email);
    if(!locator)throw Error('No offline work was enrolled for this account on this device.');
    store().unlock(passphrase);
    const scope={...locator,reportId:'workspace',generation:0,step:WORKSPACE_STEP};
    const snapshot=await store().readDraft(scope);
    const data=snapshot&&snapshot.data;
    if(!data||data.userId!==locator.userId||data.organizationId!==locator.organizationId)throw Error('OFFLINE_SNAPSHOT_NOT_FOUND');
    if(!Number.isFinite(Date.parse(data.expiresAt))||Date.now()>=Date.parse(data.expiresAt))throw Error('OFFLINE_ACCESS_EXPIRED');
    context=data;
    $('unlockPanel').hidden=true;$('workspacePanel').hidden=false;$('offlinePassphrase').value='';
    $('syncLabel').textContent='Last synchronized: '+new Date(data.syncedAt).toLocaleString()+
      ' · Expires: '+new Date(data.expiresAt).toLocaleString();
    renderRecordList();message('Offline access unlocked. Work remains on this device until you submit it online.');
  }catch(err){
    store()?.lock();
    message(err.message==='OFFLINE_DRAFT_CANNOT_DECRYPT'?'Incorrect passphrase or unavailable offline records.':err.message,true);
  }
});
$('saveDraft').addEventListener('click',async()=>{
  try{
    const scope=makeScope(), note=$('draftNote').value;
    if(!note.trim()&&!$('draftPhotos').files.length)throw Error('Enter notes or attach a photo before saving.');
    const item=record,action=item.actions.find(a=>a.id===scope.actionId);
    const revision=scope.actionId?action?.revision:item.revision;
    if(!revision)throw Error('MISSING_SYNC_REVISION');
    const saveButton=$('saveDraft');saveButton.disabled=true;
    try {
      await store().saveDraft(scope,{note,offlineOnly:true},revision);
      const files=Array.from($('draftPhotos').files);
      for(const file of files){
        const attachmentId=crypto.randomUUID().replace(/-/g,'');
        await store().saveEvidence(scope,attachmentId,file);
      }
      $('draftPhotos').value='';
      await updateEvidenceCount();
      message('Saved on this device — NOT submitted to RBH.');
    } finally {saveButton.disabled=false;}
  }catch(e){message('Local save failed: '+e.message+'. Do not close this page until you have copied your unsaved work.',true);}
});
$('closeDraft').addEventListener('click',()=>{clearEditor();message('Return online to review drafts before officially submitting.');});
$('lockButton').addEventListener('click',lock);
$('eraseButton').addEventListener('click',async()=>{
  if(!context)return;
  if(!confirm('Erase ALL saved offline drafts, photos and snapshots for this RBH account on this device? This cannot be undone.'))return;
  try{await store().deleteAccountWorkspace(context.organizationId,context.userId);lock();message('Offline account records erased from this device.');}
  catch(e){message('Could not erase all local records: '+e.message,true);}
});
})();
