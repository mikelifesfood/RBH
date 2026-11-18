/* RBH staff offline workspace. Never sends, assigns, verifies or closes.
 * Assumes encrypted authorized snapshot was staged during a live authenticated session.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const store=()=>window.TeamWorktStaffOfflineFoundation;
const WORKSPACE_STEP='workspace_index';
const STEPS=[
  ['review','Review / classification'],['assignment','Owner / investigator assignment'],['investigation','Investigation / root cause'],
  ['action_plan','Corrective-action planning'],['action_completion','Action completion'],
  ['verification','Verification notes'],['changes_requested','Changes requested'],
  ['add_action_before_close','Additional corrective action'],['closure','Report closure preparation']
];
const FIELD_IDS=['draftFindings','draftRootCause','draftCategory','draftSeverity',
  'draftReportOwner','draftInvestigator','draftPlanDescription','draftPlanOwner',
  'draftPlanDue','draftPlanPriority','draftDecision'];
let context=null,record=null,restoreGeneration=0,editGeneration=0;
let savedEditGeneration=0,saveRunning=false;
function hasUnsavedEdits(){return editGeneration!==savedEditGeneration || !!$('draftPhotos')?.files?.length;}
function confirmDiscard(){
  if(saveRunning){message('Device save is still finishing. Stay on this draft until confirmation.');return false;}
  return !hasUnsavedEdits() || confirm('Changes have NOT been saved on this device. Leave without saving?');
}
function markSavedIfUnchanged(startGeneration){if(editGeneration===startGeneration)savedEditGeneration=startGeneration;}
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
function appendPlannedAction(data={}){
  const container=$('additionalPlannedActions');
  if(container.children.length>=19)throw Error('MAX_DRAFT_ACTIONS_REACHED');
  const card=document.createElement('fieldset');
  card.className='record';
  const legend=document.createElement('legend');legend.textContent='Additional corrective-action proposal';card.appendChild(legend);
  const inputs=[
    ['description','Description','textarea'],['owner','Proposed owner','text'],
    ['dueDate','Proposed due date','date'],['priority','Proposed priority','priority']
  ];
  for(const [key,label,kind] of inputs){
    const heading=document.createElement('label');heading.textContent=label;
    const control=kind==='textarea'?document.createElement('textarea'):
      kind==='priority'?document.createElement('select'):document.createElement('input');
    if(kind==='text'||kind==='date')control.type=kind;
    if(kind==='priority'){
      for(const option of ['','low','medium','high','critical']){
        const item=document.createElement('option');item.value=option;
        item.textContent=option||'Not selected';control.appendChild(item);
      }
    }
    control.dataset.plannedActionField=key;
    control.setAttribute('aria-label',label);
    control.value=String(data[key]||'');
    heading.appendChild(control);card.appendChild(heading);
  }
  const remove=document.createElement('button');remove.type='button';remove.className='secondary';
  remove.textContent='Remove this draft action';
  remove.addEventListener('click',()=>{card.remove();editGeneration++;message('Draft action removed. Save on this device to keep this change.');});
  card.appendChild(remove);container.appendChild(card);
}
function clearEditor(){
  restoreGeneration++;
  savedEditGeneration=editGeneration;
  $('editorPanel').hidden=true;$('draftPhotos').value='';
  for(const name of ['draftNote',...FIELD_IDS])$(name).value='';
  $('additionalPlannedActions').replaceChildren();
  $('draftStep').replaceChildren();$('draftAction').replaceChildren();
  $('evidenceCount').textContent='';record=null;
}
function lock(){
  if(!confirmDiscard())return;
  lockWithoutPrompt();
}
function lockWithoutPrompt(){
  store()?.lock();context=null;clearEditor();$('workspacePanel').hidden=true;
  $('unlockPanel').hidden=false;$('offlinePassphrase').value='';
  $('records').replaceChildren();message('Offline workspace locked.');
}
function selectOption(label,value){
  const el=document.createElement('option');el.value=value;el.textContent=label;return el;
}
function canPrepare(step,item){
  if(item.readOnly)return false;
  if(['assignment','verification','changes_requested','closure','add_action_before_close'].includes(step))return item.role==='admin'||item.role==='safety_manager';
  if(step==='action_completion')return item.actions.some(a=>a.canComplete);
  if(step==='review'||step==='investigation'||step==='action_plan')return item.canEditReport;
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
    btn.addEventListener('click',()=>{if(confirmDiscard())openRecord(item);});$('records').appendChild(btn);
  }
}
async function updateEvidenceCount(){
  const scope=makeScope();
  const evidence=await store().listEvidence(scope);
  $('evidenceCount').textContent=evidence.length+' photo(s) saved locally for this step.';
}
function updateFieldsForStep(){
  const step=$('draftStep').value;
  $('reviewFields').hidden=step!=='review';
  $('assignmentFields').hidden=step!=='assignment';
  $('investigationFields').hidden=step!=='investigation';
  $('addPlannedAction').hidden=step!=='action_plan';
  $('actionPlanFields').hidden=!['action_plan','add_action_before_close'].includes(step);
  $('verificationFields').hidden=!['verification','changes_requested'].includes(step);
  $('draftPhotos').disabled=!(step==='investigation'||step==='action_completion'||step==='verification'||step==='changes_requested');
  $('draftPhotoHelp').textContent=step==='investigation'?
    'Investigation photos can be saved encrypted on this device, but they are NOT eligible for automatic reconnect upload yet. Keep them on this device and review their manual handling before pilot launch.':
    ['action_completion','verification','changes_requested'].includes(step)?
    'Corrective-action photos remain on this device until you approve their upload after reconnecting.':
    'Photo attachments are not offered for this workflow step; save notes here and attach documents in the official online workflow.';
}
function readForm(){
  const fields={};
  for(const name of FIELD_IDS)fields[name]=$(name).value;
  fields.plannedActions=[{
    description:fields.draftPlanDescription,owner:fields.draftPlanOwner,
    dueDate:fields.draftPlanDue,priority:fields.draftPlanPriority
  },...Array.from($('additionalPlannedActions').children).map(card=>{
    const result={};
    for(const input of card.querySelectorAll('[data-planned-action-field]'))
      result[input.dataset.plannedActionField]=input.value;
    return result;
  })];
  return {note:$('draftNote').value,fields,offlineOnly:true};
}
function applyForm(data){
  $('draftNote').value=data&&typeof data.note==='string'?data.note:'';
  const fields=data&&data.fields||{};
  for(const name of FIELD_IDS)$(name).value=typeof fields[name]==='string'?fields[name]:'';
  $('additionalPlannedActions').replaceChildren();
  if(Array.isArray(fields.plannedActions)){
    for(const action of fields.plannedActions.slice(1,20))appendPlannedAction(action);
  }
}
async function restoreDraft(){
  const generation=++restoreGeneration,scope=makeScope(),editAtStart=editGeneration;
  savedEditGeneration=editAtStart;
  const saveButton=$('saveDraft');saveButton.disabled=true;
  const stillCurrent=()=>generation===restoreGeneration &&
    context!==null&&record!==null&&JSON.stringify(makeScope())===JSON.stringify(scope);
  try{
    const data=await store().readDraft(scope);
    if(!stillCurrent())return; // older asynchronous step must never erase newer notes
    if(editGeneration===editAtStart){
      applyForm(data&&data.data);
    }
    updateFieldsForStep();
    const evidence=await store().listEvidence(scope);
    if(!stillCurrent())return;
    $('evidenceCount').textContent=evidence.length+' photo(s) saved locally for this step.';
    message(editGeneration!==editAtStart?'Your new edits were preserved while the saved draft loaded. Save to keep them; do not accidentally overwrite older notes.':
      (data?'Previously saved on this device — not submitted.':'New local draft — not submitted.'));
  }catch(e){
    if(stillCurrent())message(e.message==='OFFLINE_DRAFT_CANNOT_DECRYPT'?'Incorrect offline passphrase or damaged draft.':e.message,true);
  }finally{
    if(generation===restoreGeneration)saveButton.disabled=false;
  }
}
async function openRecord(item){
  record=item;$('editorTitle').textContent='Report #'+item.number+' — offline draft';
  $('reportSummary').textContent='Existing report: '+String(item.description||'').slice(0,350);
  $('draftStep').replaceChildren();
  for(const [value,label] of STEPS){if(canPrepare(value,item))$('draftStep').appendChild(selectOption(label,value));}
  $('draftAction').replaceChildren();
  for(const action of item.actions){$('draftAction').appendChild(selectOption('Action #'+action.number+' — '+action.status,action.id));}
  $('editorPanel').hidden=false;
  let lastStep=null;
  $('draftStep').onchange=async()=>{
    if(lastStep!==null&&lastStep!==$('draftStep').value&&!confirmDiscard()){$('draftStep').value=lastStep;return;}
    lastStep=$('draftStep').value;
    const step=lastStep;
    $('draftAction').disabled=!['action_completion','verification','changes_requested'].includes(step);
    if(step==='action_completion'){
      const allowed=item.actions.filter(a=>a.canComplete).map(a=>a.id);
      for(const opt of $('draftAction').options)opt.disabled=!allowed.includes(opt.value);
      if(!allowed.includes($('draftAction').value))$('draftAction').value=allowed[0]||'';
    }else for(const opt of $('draftAction').options)opt.disabled=false;
    updateFieldsForStep();await restoreDraft();};
  let lastAction=$('draftAction').value;
  $('draftAction').onchange=async()=>{
    if(!confirmDiscard()){$('draftAction').value=lastAction;return;}
    lastAction=$('draftAction').value;
    await restoreDraft();
  };
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
      ' · Expires: '+new Date(data.expiresAt).toLocaleString()+
      ' · Saved reports: '+data.records.length+
      (Number(data.eligibleCount||0)>data.records.length?
        ' of '+data.eligibleCount+' available assignments (device snapshot limited; unsaved assignments require internet)':'');
    renderRecordList();message('Offline access unlocked. Work remains on this device until you submit it online.');
  }catch(err){
    store()?.lock();
    message(err.message==='OFFLINE_DRAFT_CANNOT_DECRYPT'?'Incorrect passphrase or unavailable offline records.':err.message,true);
  }
});
$('addPlannedAction').addEventListener('click',()=>{
  appendPlannedAction();editGeneration++;
  message('New corrective-action proposal added. Save on this device before leaving.');
});
$('editorPanel').addEventListener('input',event=>{
  if(event.target&&event.target.id!=='draftStep'&&event.target.id!=='draftAction'){
    const wasSaved=!hasUnsavedEdits();editGeneration++;
    if(wasSaved)message('Unsaved changes — choose Save on this device before leaving.');
  }
});
$('editorPanel').addEventListener('change',event=>{
  if(event.target?.id==='draftPhotos'){
    editGeneration++;
    message('Photo selected but NOT yet saved. Choose Save on this device.');
  }
});
$('saveDraft').addEventListener('click',async()=>{
  if(saveRunning)return;
  saveRunning=true;
  const startingEdits=editGeneration;
  try{
    const scope=makeScope(), draft=readForm();
    draft.reportRevision=record.revision;
    draft.reopenCount=Number(record.reopenCount||0);
    draft.actionStatus=(record.actions.find(a=>a.id===scope.actionId)||{}).status||null;
    const hasFields=Object.values(draft.fields).some(v=>
      typeof v==='string'?!!v.trim():Array.isArray(v)&&v.some(a=>
        Object.values(a).some(x=>String(x||'').trim())));
    if(!draft.note.trim()&&!hasFields&&!$('draftPhotos').files.length)
      throw Error('Enter draft details or attach a photo before saving.');
    const item=record,action=item.actions.find(a=>a.id===scope.actionId);
    const revision=scope.actionId?action?.revision:item.revision;
    if(!revision)throw Error('MISSING_SYNC_REVISION');
    const saveButton=$('saveDraft');saveButton.disabled=true;
    try {
      const existing=await store().readDraft(scope);
      if(existing?.data?.submission)throw Error("PENDING_OFFICIAL_SUBMISSION_RECONCILE_FIRST");
      await store().saveDraft(scope,draft,revision);
      const files=Array.from($('draftPhotos').files);
      for(const file of files){
        const attachmentId=crypto.randomUUID();
        await store().saveEvidence(scope,attachmentId,file);
      }
      $('draftPhotos').value='';
      await updateEvidenceCount();
      markSavedIfUnchanged(startingEdits);
      message(hasUnsavedEdits()?'An earlier version saved, but newer edits remain unsaved. Save again.':'Saved on this device — NOT submitted to RBH.');
    } finally {saveButton.disabled=false;}
  }catch(e){message('Local save failed: '+e.message+'. Do not close this page until you have copied your unsaved work.',true);}
  finally{saveRunning=false;}
});
$('closeDraft').addEventListener('click',()=>{if(!confirmDiscard())return;clearEditor();message('Return online to review drafts before officially submitting.');});
$('lockButton').addEventListener('click',lock);
$('eraseButton').addEventListener('click',async()=>{
  if(!context)return;
  if(!confirm('Erase ALL saved offline drafts, photos and snapshots for this RBH account on this device? This cannot be undone.'))return;
  try{
    await store().deleteAccountWorkspace(context.organizationId,context.userId);
    if(window.caches){
      const cache=await window.caches.open('rbh-staff-offline-device-v1');
      await cache.delete(new URL('./staff-offline-device-enabled',location.href).href);
    }
    lockWithoutPrompt();message('Offline account records erased from this device.');
  }
  catch(e){message('Could not erase all local records: '+e.message,true);}
});
window.addEventListener('beforeunload',event=>{
  if((!hasUnsavedEdits()&&!saveRunning)||!record)return;
  event.preventDefault();event.returnValue='';
});
})();
