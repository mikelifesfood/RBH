/* RBH staff offline enrollment and safe local draft restoration.
 * This file requires an active authenticated dashboard to call init().
 * Device-local drafts are NEVER treated as official workflow submissions.
 */
(function(root){
'use strict';
const STEP_INDEX='workspace_index';
const TTL=24*60*60*1000;
const STAFF_MARKER_CACHE='rbh-staff-offline-device-v1';
async function setDeviceOfflineEnrollment(enrolled){
  if(!root.caches)return false;
  const marker=new URL('./staff-offline-device-enabled',location.href).href;
  const cache=await root.caches.open(STAFF_MARKER_CACHE);
  if(enrolled)await cache.put(marker,new Response('1',{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}}));
  else await cache.delete(marker);
  return true;
}
const state={identity:null,reports:[],actions:[],client:null,panel:null,initialized:false,saving:false,enabled:false,initVersion:0};
const api=()=>root.TeamWorktStaffOfflineFoundation;
function $(id){return document.getElementById(id);}
function sameIdentity(a,b){return a&&b&&a.organizationId===b.organizationId&&a.userId===b.userId;}
function scopeFor(report,action,step){
  const u=state.identity;if(!u)throw Error('OFFLINE_CONTEXT_UNAVAILABLE');
  return {organizationId:u.organizationId,userId:u.userId,reportId:report.id,
    actionId:action?action.id:null,generation:Number(report.workflow_restart_count||0),step};
}
function indexScope(){
  const u=state.identity;
  return {organizationId:u.organizationId,userId:u.userId,reportId:'workspace',generation:0,step:STEP_INDEX};
}
function buildIndex(){
  const u=state.identity,uid=u.userId,role=u.role;
  const isManager=role==='admin'||role==='safety_manager';
  const eligible=state.reports.filter(r=>{
    if(!r||!r.id||r.organization_id!==u.organizationId)return false;
    if(['closed','no_action','duplicate'].includes(String(r.status)))return false;
    const assignments=state.actions.filter(a=>a.report_id===r.id&&!a.retired_at&&
      Number(a.workflow_generation||0)===Number(r.workflow_restart_count||0));
    const mine=String(r.report_owner_user_id||'')===uid||String(r.investigator_user_id||'')===uid||
      String(r.assigned_user_id||'')===uid||assignments.some(a=>String(a.owner_user_id||'')===uid||
        String(a.verifier_user_id||'')===uid);
    return mine||(isManager&&r.status==='new');
  });
  // Only synchronize a minimal assigned subset, not the entire tenant database.
  // Expose truncation so an offline staff member cannot assume all tasks are present.
  const current=eligible.slice(0,25);
  const records=current.map(r=>{
    const actions=state.actions.filter(a=>a.report_id===r.id&&!a.retired_at&&
      Number(a.workflow_generation||0)===Number(r.workflow_restart_count||0))
      .slice(0,25).map(a=>({
        id:a.id,number:a.action_number||'',status:a.status||'not_started',
        description:String(a.description||'').slice(0,1000),
        priority:a.priority||'',dueDate:a.due_date||null,
        revision:a.updated_at,
        canComplete:['not_started','in_progress','changes_requested'].includes(a.status)&&
          (isManager||role==='supervisor'&&String(a.owner_user_id||'')===uid)
      }));
    return {
      id:r.id,number:r.ref_no||'',site:String(r.job_site||'').slice(0,150),
      status:r.status||'new',priority:r.priority||'',description:String(r.description||'').slice(0,3000),
      findings:String(r.investigation_findings||'').slice(0,2500),
      rootCause:String(r.root_cause||'').slice(0,1500),
      revision:r.updated_at,generation:Number(r.workflow_restart_count||0),reopenCount:Number(r.reopen_count||0),
      role,readOnly:role==='read_only',
      canEditReport:isManager||String(r.report_owner_user_id||'')===uid&&role==='supervisor',
      actions
    };
  });
  const now=Date.now();
  return {organizationId:u.organizationId,userId:u.userId,role,
    syncedAt:new Date(now).toISOString(),expiresAt:new Date(now+TTL).toISOString(),
    eligibleCount:eligible.length,snapshotLimit:25,records};
}
function setStatus(message,isError){
  const el=$('rbhOfflineStatus');if(!el)return;el.textContent=message;el.style.color=isError?'#a62c36':'';
}
function createPanel(){
  if(state.panel)return;
  const anchor=$('rbhPushStatus');
  if(!anchor)return;
  const section=anchor.closest('.profile-card-section');
  if(!section)return;
  const wrap=document.createElement('div');
  wrap.className='profile-card-section';wrap.id='rbhOfflineWorkspaceControls';
  wrap.innerHTML='<h4>Offline work (this device)</h4>'+
    '<p class="field-help">Save your assigned reports for use where reception is poor. Local drafts and photos are encrypted and never sent automatically. Signing out or switching accounts erases this account’s offline data on this device; submit important work first.</p>'+
    '<div id="rbhOfflineEnrollment">'+
    '<label for="rbhOfflinePassphrase">Offline passphrase (12+ characters, separate from your sign-in password)</label>'+
    '<input type="password" id="rbhOfflinePassphrase" minlength="12" autocomplete="new-password" placeholder="Choose or enter your offline passphrase">'+
    '<label for="rbhOfflinePassphraseAgain">Confirm offline passphrase</label>'+
    '<input type="password" id="rbhOfflinePassphraseAgain" minlength="12" autocomplete="new-password">'+
    '</div><p id="rbhOfflineStatus" class="field-help" role="status" aria-live="polite">Offline work is not yet enabled on this device.</p>'+
    '<div class="profile-action-row">'+
    '<button class="profile-primary" id="rbhOfflinePrepare" type="button">Prepare offline work</button>'+
    '<a class="profile-secondary" style="display:inline-flex;align-items:center;text-decoration:none" href="./staff-offline-workspace.html">Open offline workspace</a>'+
    '<button class="profile-secondary" id="rbhOfflineLock" type="button">Lock offline drafts</button>'+
    '<button class="profile-secondary" id="rbhOfflineReview" type="button">Review saved drafts</button>'+
    '</div><div id="rbhOfflineDrafts" class="field-help" hidden></div>';
  section.insertAdjacentElement('afterend',wrap);
  state.panel=wrap;
  $('rbhOfflinePrepare').addEventListener('click',prepare);
  $('rbhOfflineReview').addEventListener('click',reviewSavedDrafts);
  $('rbhOfflineLock').addEventListener('click',()=>{api()?.lock();setStatus('Offline drafts locked. Enter your passphrase to unlock them again.');});
}
async function prepare(){
  const f=api(),u=state.identity;if(!f||!u){setStatus('Sign in online before preparing offline work.',true);return;}
  const pass=$('rbhOfflinePassphrase').value;
  const again=$('rbhOfflinePassphraseAgain').value;
  if(!pass||pass.length<12||pass!==again){setStatus('Enter and confirm the same offline passphrase (at least 12 characters).',true);return;}
  const button=$('rbhOfflinePrepare');button.disabled=true;
  try{
    // Request more durable browser storage only during this explicit opt-in.
    // A denial never prevents saving; the UI must warn about possible eviction.
    let persistent=false;
    try {
      if(navigator.storage?.persist)
        persistent=await navigator.storage.persist();
      else if(navigator.storage?.persisted)
        persistent=await navigator.storage.persisted();
    } catch(_) {}
    f.unlock(pass);
    const locator=await f.resolveAccountLocator(u.email);
    if(locator&&(!sameIdentity(locator,u)))throw Error('ACCOUNT_CONTEXT_CHANGED');
    if(locator){
      // Do not overwrite existing encrypted drafts with a different passphrase.
      const index=await f.readDraft(indexScope());
      if(!index)throw Error('OFFLINE_INDEX_MISSING');
    }
    await f.saveDraft(indexScope(),buildIndex(),new Date().toISOString());
    if(!locator)await f.registerAccountLocator(u.email,u.organizationId,u.userId);
    let launchPrepared=false;
    try{launchPrepared=await setDeviceOfflineEnrollment(true);}
    catch(e){console.warn('RBH offline launch marker not available',e);}
    $('rbhOfflinePassphrase').value='';$('rbhOfflinePassphraseAgain').value='';
    setStatus('Assigned work is encrypted on this device. Drafts and evidence remain local until officially submitted online.'+
      (persistent?' Persistent device storage is enabled.':' Storage persistence is not guaranteed by this browser; keep the app installed and confirm drafts are saved before leaving the worksite.')+
      (launchPrepared?'':' Direct offline dashboard launch could not be prepared. Use the saved Offline Workspace link until this device supports it.'));
  }catch(e){
    f.lock();setStatus(e.message==='OFFLINE_DRAFT_CANNOT_DECRYPT'?'Your offline passphrase does not match this device’s existing drafts. Nothing was overwritten.':e.message,true);
  }finally{button.disabled=false;}
}

function formatLocalDraft(data){
  if(!data||typeof data!=='object')return 'No draft text was saved.';
  const lines=[];
  if(typeof data.note==='string'&&data.note.trim())lines.push('Additional notes:\n'+data.note);
  const fields=data.fields&&typeof data.fields==='object'?data.fields:{};
  const labels=[
    ['draftCategory','Proposed classification'],['draftSeverity','Proposed severity / priority'],
    ['draftReportOwner','Proposed report owner'],['draftInvestigator','Proposed investigator'],
    ['draftFindings','Investigation findings'],['draftRootCause','Root cause'],
    ['draftDecision','Proposed verification decision']
  ];
  for(const [id,title] of labels){
    if(typeof fields[id]==='string'&&fields[id].trim())
      lines.push(title+':\n'+fields[id]);
  }
  if(Array.isArray(fields.plannedActions)){
    fields.plannedActions.forEach((action,index)=>{
      if(!action||!Object.values(action).some(v=>String(v||'').trim()))return;
      lines.push('Proposed corrective action #'+(index+1)+'\n'+[
        ['Description',action.description],['Proposed owner',action.owner],
        ['Proposed due date',action.dueDate],['Proposed priority',action.priority]
      ].filter(x=>String(x[1]||'').trim()).map(x=>x[0]+': '+x[1]).join('\n'));
    });
  }else if(String(fields.draftPlanDescription||'').trim()){
    lines.push('Proposed corrective action:\n'+fields.draftPlanDescription);
  }
  return lines.join('\n\n') || 'Draft has no text. Review locally stored evidence attachments separately.';
}
async function reviewSavedDrafts(){
  const f=api(),u=state.identity,out=$('rbhOfflineDrafts');
  if(!out||!f||!u)return;
  out.hidden=false;out.replaceChildren();
  if(!f.isUnlocked()){
    out.textContent='Enter your offline passphrase above and choose Prepare offline work before reviewing drafts.';
    return;
  }
  try{
    const entries=(await f.listDrafts(u.organizationId,u.userId)).filter(e=>e.scope.reportId!=='workspace'&&!e.scope.step.startsWith('evidence_attempt_'));
    if(!entries.length){out.textContent='No locally saved staff drafts were found.';return;}
    const title=document.createElement('h4');title.textContent='Saved only on this device';out.appendChild(title);
    const note=document.createElement('p');
    note.textContent='Nothing below has been submitted or verified. Check each record and use the existing online RBH workflow to officially submit it.';
    out.appendChild(note);
    for(const entry of entries){
      const scope=entry.scope;
      const report=state.reports.find(r=>String(r.id)===String(scope.reportId));
      const action=scope.actionId?state.actions.find(a=>String(a.id)===String(scope.actionId)):null;
      const stale=!report||String(report.organization_id)!==String(u.organizationId)||
        Number(report.workflow_restart_count||0)!==scope.generation||
        ['closed','no_action','duplicate'].includes(report.status)||
        (scope.actionId&&(!action||action.retired_at||String(action.report_id)!==String(report.id)))||
        (!!action&&Number(action.workflow_generation||0)!==scope.generation);
      const wrap=document.createElement('div');wrap.style.borderTop='1px solid #ccd9e2';wrap.style.padding='12px 0';
      const summary=document.createElement('strong');
      summary.textContent='Report '+(report?'#'+report.ref_no:'unavailable')+
        ' · '+scope.step.replaceAll('_',' ')+(action?' · Action #'+action.action_number:'');
      const stateLabel=document.createElement('p');
      stateLabel.textContent=stale?'Needs review — server record changed or access was removed.':'Saved on device; compare before submitting.';
      if(stale)stateLabel.style.color='#965115';
      const preview=document.createElement('pre');preview.hidden=true;
      preview.style.whiteSpace='pre-wrap';preview.style.wordBreak='break-word';preview.style.maxHeight='220px';
      preview.style.overflow='auto';
      const btn=document.createElement('button');btn.type='button';btn.className='profile-secondary';
      btn.textContent='Show saved draft';
      btn.addEventListener('click',async()=>{
        if(!preview.hidden){preview.hidden=true;btn.textContent='Show saved draft';return;}
        try{
          const saved=await f.readDraft(scope);
          const serverRevision=action?action.updated_at:report?.updated_at;
          const conflict=stale||!saved||saved.serverRevision!==serverRevision;
          preview.textContent=(conflict?'NEEDS REVIEW: The server revision differs or access is unavailable. Do not overwrite newer work.\n\n':'')+
            formatLocalDraft(saved?.data);
          preview.hidden=false;btn.textContent='Hide saved draft';
        }catch(e){preview.textContent='Could not decrypt draft.';preview.hidden=false;}
      });
      wrap.append(summary,stateLabel,btn,preview);
      if(!stale&&!scope.actionId){
        const localPhotos=await f.listEvidence(scope);
        if(localPhotos.length){
          const advisory=document.createElement('p');
          advisory.textContent=localPhotos.length+' encrypted investigation/photo attachment(s) remain only on this device. They cannot yet use the corrective-action upload endpoint. Download them individually and attach through the authorized online RBH workflow; do not treat this as official submission.';
          wrap.appendChild(advisory);
          for(const photo of localPhotos){
            const exportButton=document.createElement('button');
            exportButton.type='button';exportButton.className='profile-secondary';
            exportButton.style.marginRight='8px';
            exportButton.textContent='Download local photo';
            exportButton.addEventListener('click',async()=>{
              exportButton.disabled=true;
              try{
                const restored=await f.readEvidence(scope,photo.attachmentId);
                if(!restored)throw Error('OFFLINE_PHOTO_MISSING');
                const download=URL.createObjectURL(restored.file);
                try{
                  const anchor=document.createElement('a');
                  anchor.href=download;anchor.download=restored.file.name||'rbh-evidence';
                  anchor.style.display='none';document.body.appendChild(anchor);anchor.click();anchor.remove();
                }finally{
                  setTimeout(()=>URL.revokeObjectURL(download),60000);
                }
              }catch(e){alert('Could not export this encrypted local photo: '+e.message);}
              finally{exportButton.disabled=false;}
            });
            wrap.appendChild(exportButton);
          }
        }
      }
      if(!stale&&scope.actionId&&state.client&&root.TeamWorktStaffEvidenceReplay){
        const evidence=await f.listEvidence(scope);
        if(evidence.length){
          const upload=document.createElement('button');
          upload.type='button';upload.className='profile-secondary';
          upload.textContent='Upload '+evidence.length+' saved evidence photo(s)';
          upload.style.marginLeft='8px';
          upload.addEventListener('click',async()=>{
            if(!confirm('Upload these encrypted local photos to the official RBH report now? This does not complete or verify the corrective action.'))return;
            upload.disabled=true;
            const results=document.createElement('p');results.setAttribute('role','status');
            results.textContent='Checking current permissions and evidence protocol…';wrap.appendChild(results);
            try{
              const enabled=await root.TeamWorktStaffEvidenceReplay.capability(state.client,scope.reportId,scope.actionId);
              if(!enabled)throw Error('Offline evidence upload is not yet activated by RBH. Photos remain safely on this device.');
              let synced=0;
              for(const file of evidence){
                results.textContent='Uploading photo '+(synced+1)+' of '+evidence.length+'…';
                await root.TeamWorktStaffEvidenceReplay.uploadOne({
                  client:state.client,scope,evidenceId:file.attachmentId,
                  identity:state.identity,confirm:true
                });
                synced++;
              }
              results.textContent=synced+' photo(s) uploaded and confirmed by RBH. Your corrective-action notes still require official submission.';
              upload.disabled=true;upload.textContent='Evidence synchronized';
            }catch(e){
              results.textContent='Evidence was not confirmed: '+e.message+' Your remaining photos stay on this device for safe retry.';
              upload.disabled=false;
            }
          });
          wrap.appendChild(upload);
        }
      }
      if(!stale&&scope.actionId&&state.client&&state.enabled&&root.TeamWorktStaffActionSubmit&&
        ['action_completion','verification','changes_requested'].includes(scope.step)){
        const official=document.createElement('button');
        official.type='button';official.className='profile-secondary';
        official.style.marginLeft='8px';
        official.textContent='Review and submit saved '+scope.step.replaceAll('_',' ');
        official.addEventListener('click',async()=>{
          const retained=await f.listEvidence(scope);
          if(retained.length){
            alert('Upload the saved evidence photos and confirm receipt before submitting this workflow step.');
            return;
          }
          const saved=await f.readDraft(scope);
          if(!saved||!saved.data?.note){
            alert('No saved completion or verification note was found for official submission.');
            return;
          }
          const kind=scope.step==='action_completion'?'completion':
            scope.step==='verification'?'verification':'changes request';
          const agreed=confirm('Submit your saved '+kind+' to RBH now? This is an OFFICIAL online workflow action that can notify other employees. Please confirm you reviewed the current report and saved note.');
          if(!agreed)return;
          official.disabled=true;
          const outcome=document.createElement('p');outcome.setAttribute('role','status');
          outcome.textContent='Verifying current access and sending only after your approval…';
          wrap.appendChild(outcome);
          try{
            const done=await root.TeamWorktStaffActionSubmit.submitOne({
              client:state.client,scope,identity:state.identity,confirm:true
            });
            if(done.status!=='synced_to_rbh')throw Error('UNVERIFIED_SUBMISSION');
            outcome.textContent='Synced to RBH with a verified server receipt. Your official workflow stage is complete; refresh the dashboard to see the latest state.';
            official.disabled=true;official.textContent='Officially submitted';
          }catch(e){
            outcome.textContent='Not confirmed: '+e.message+'. The encrypted local draft and operation ID were preserved for review or safe retry.';
            official.disabled=false;
          }
        });
        wrap.appendChild(official);
      }
      if(!stale){
        const link=document.createElement('a');
        link.className='profile-secondary';link.style.cssText='display:inline-flex;margin-left:8px;text-decoration:none';
        link.href='./dashboard.html?'+(action?'action='+encodeURIComponent(action.id):'report='+encodeURIComponent(report.id));
        link.textContent='Open official work';
        wrap.appendChild(link);
      }
      out.appendChild(wrap);
    }
  }catch(e){out.textContent='Offline draft review failed: '+e.message;}
}

async function refresh(){
  if(!state.identity||!api()?.isUnlocked()||state.saving)return;
  state.saving=true;
  try{await api().saveDraft(indexScope(),buildIndex(),new Date().toISOString());}
  catch(e){console.warn('RBH offline snapshot refresh skipped',e);}
  finally{state.saving=false;}
}
async function wireFocusedDraft(report,action,textarea,step){
  if(!report||!action||!textarea||!api()?.isUnlocked()||!state.identity)return;
  if(!['action_completion','verification','changes_requested'].includes(step))return;
  if(textarea.dataset.rbhOfflineWired==='yes')return;
  textarea.dataset.rbhOfflineWired='yes';
  const scope=scopeFor(report,action,step),revision=action.updated_at;
  const hint=document.createElement('p');
  hint.className='field-help';hint.setAttribute('role','status');
  hint.textContent='Offline draft saving enabled on this device.';
  textarea.insertAdjacentElement('afterend',hint);
  let conflicted=false,dirty=false;
  textarea.addEventListener('input',()=>{dirty=true;});
  try{
    const saved=await api().readDraft(scope);
    if(!textarea.isConnected)return;
    if(saved&&saved.data){
      conflicted=saved.serverRevision!==revision ||
        (saved.data.reportRevision&&saved.data.reportRevision!==report.updated_at) ||
        (Number(saved.data.reopenCount||0)!==Number(report.reopen_count||0));
      if(!conflicted){
        if(saved.data.note && !dirty && !textarea.value.trim())textarea.value=saved.data.note;
        hint.textContent=dirty?'Newly entered text retained; older local draft not overwritten.':
          'Saved local draft restored. Review before submitting officially.';
      }else{
        hint.textContent='Needs review: the report or action changed while the draft was offline. Local draft remains unchanged.';
        hint.style.color='#9b5712';
        const reveal=document.createElement('button');reveal.type='button';
        reveal.className='wizard-save';reveal.textContent='Show older draft';
        reveal.addEventListener('click',()=>{
          const output=document.createElement('textarea');
          output.readOnly=true;output.value=saved.data.note||'';
          output.setAttribute('aria-label','Older offline draft (read only)');
          hint.insertAdjacentElement('afterend',output);reveal.disabled=true;
        });hint.insertAdjacentElement('afterend',reveal);
      }
    }
  }catch(e){hint.textContent='Could not restore your local draft. It has not been deleted.';conflicted=true;}
  let timer=null;
  textarea.addEventListener('input',()=>{
    clearTimeout(timer);
    if(conflicted){
      hint.textContent='Existing local draft needs manual review. Copy your new notes before navigating; autosave is paused.';
      return;
    }
    hint.textContent='Saving on this device…';
    timer=setTimeout(async()=>{
      if(!textarea.isConnected||!api()?.isUnlocked())return;
      try{
        const existing=await api().readDraft(scope);
        if(existing?.data?.submission)throw Error("PENDING_OFFICIAL_SUBMISSION_RECONCILE_FIRST");
        await api().saveDraft(scope,{note:textarea.value,offlineOnly:true,
          reportRevision:report.updated_at,reopenCount:Number(report.reopen_count||0),
          actionStatus:action.status},revision);
        hint.textContent='Saved on this device — not submitted.';
      }catch(e){hint.textContent='Device save failed. Do not close this page until you copy your note.';hint.style.color='#a62c36';}
    },450);
  });
}
async function clearSubmittedDraft(report,action,step){
  if(!api()?.isUnlocked()||!state.identity)return;
  try{await api().deleteDraft(scopeFor(report,action,step));}
  catch(e){console.warn('RBH local draft cleanup not verified',e);}
}

async function wireInvestigationDraft(report,findings,rootCause){
  if(!report||!findings||!rootCause||!state.identity||!api()?.isUnlocked())return;
  if(findings.disabled||rootCause.disabled||findings.dataset.rbhOfflineWired==='yes')return;
  findings.dataset.rbhOfflineWired='yes';
  const scope=scopeFor(report,null,'investigation'),revision=report.updated_at;
  const hint=document.createElement('p');hint.className='field-help';hint.setAttribute('role','status');
  hint.textContent='Investigation notes can be saved on this device.';
  rootCause.insertAdjacentElement('afterend',hint);
  try{
    const saved=await api().readDraft(scope);
    if(!findings.isConnected||!saved||!saved.data)return;
    const fields=saved.data.fields||{};
    if(saved.serverRevision===revision){
      if(fields.draftFindings && !findings.value.trim())findings.value=fields.draftFindings;
      if(fields.draftRootCause && !rootCause.value.trim())rootCause.value=fields.draftRootCause;
      hint.textContent='Offline investigation draft available. Review before officially saving.';
    }else{
      hint.textContent='A local investigation draft exists, but the report changed. Review before re-entering notes.';
      hint.style.color='#9b5712';
      const btn=document.createElement('button');btn.className='wizard-save';btn.type='button';btn.textContent='Show older investigation draft';
      btn.addEventListener('click',()=>{
        const el=document.createElement('textarea');el.readOnly=true;
        el.value='Findings:\\n'+(fields.draftFindings||'')+'\\n\\nRoot cause:\\n'+(fields.draftRootCause||'');
        btn.insertAdjacentElement('afterend',el);btn.disabled=true;
      });hint.insertAdjacentElement('afterend',btn);
    }
  }catch(e){hint.textContent='Local investigation draft could not be restored.';}
  let timer=null;
  const save=()=>{clearTimeout(timer);hint.textContent='Saving local draft…';timer=setTimeout(async()=>{
    if(!findings.isConnected||!api()?.isUnlocked())return;
    try{await api().saveDraft(scope,{note:'',fields:{draftFindings:findings.value,draftRootCause:rootCause.value},offlineOnly:true},revision);
      hint.textContent='Saved on this device — not submitted.';}
    catch(e){hint.textContent='Could not save investigation locally. Copy your work before leaving.';hint.style.color='#a62c36';}
  },450);};
  findings.addEventListener('input',save);rootCause.addEventListener('input',save);
}
function wireWizardActionDrafts(detail,report,actionsProvider){
  if(!detail||!state.identity||!api()?.isUnlocked())return;
  const scan=()=>{
    if(!detail.isConnected)return;
    const actions=actionsProvider()||[];
    for(const field of detail.querySelectorAll('textarea[data-child-completion-note],textarea[data-child-verification-note],textarea[data-child-return-note]')){
      if(field.dataset.rbhOfflineWired==='yes'||field.disabled)continue;
      const completion=field.hasAttribute('data-child-completion-note');
      const verification=field.hasAttribute('data-child-verification-note');
      const card=field.closest('[data-child-completion-card],[data-child-verification-card]');
      const id=completion?field.getAttribute('data-child-completion-note'):
        (verification?field.getAttribute('data-child-verification-note'):card?.getAttribute('data-child-verification-card'));
      const action=actions.find(a=>String(a.id)===String(id));
      if(action)wireFocusedDraft(report,action,field,completion?'action_completion':(verification?'verification':'changes_requested'));
    }
  };
  const observer=new MutationObserver(scan);
  observer.observe(detail,{childList:true,subtree:true});
  scan();
  // When the incident view is detached, release its observer and DOM references.
  const closeObserver=new MutationObserver(()=>{if(!detail.isConnected){observer.disconnect();closeObserver.disconnect();}});
  closeObserver.observe(document.body,{childList:true,subtree:true});
}

root.TeamWorktStaffOfflineUI=Object.freeze({
  async init(identity,reports,actions,client){
    if(!identity||!identity.userId||!identity.organizationId||!identity.email||!client)return;
    const serial=++state.initVersion;
    if(state.identity&&!sameIdentity(state.identity,identity)){
      const previous=state.identity;
      api()?.lock();
      await api()?.deleteAccountWorkspace(previous.organizationId,previous.userId).catch(
        e=>console.warn('Previous offline workspace cleanup failed',e));
      try{await setDeviceOfflineEnrollment(false);}catch(e){console.warn('Previous offline launch marker cleanup failed',e);}
    }
    state.identity={...identity};state.client=client;
    state.reports=Array.isArray(reports)?reports:[];
    state.actions=Array.isArray(actions)?actions:[];
    let enabled=false;
    try {
      const response=await client.rpc('rbh_staff_offline_status');
      enabled=!response.error&&response.data?.enabled===true&&response.data?.protocolVersion===1;
    }catch(_){}
    if(serial!==state.initVersion||!sameIdentity(state.identity,identity))return;
    state.enabled=enabled;
    if(!enabled){
      api()?.lock();
      if(state.panel)state.panel.hidden=true;
      // An online company disable or revoked permission must invalidate any
      // account workspace stored on this browser. Ignore missing local DB.
      try {await api()?.deleteAccountWorkspace(identity.organizationId,identity.userId);}
      catch(e){console.warn('Disabled RBH offline workspace cleanup failed',e);}
      try{await setDeviceOfflineEnrollment(false);}catch(e){console.warn('Offline launch marker cleanup failed',e);}
      return;
    }
    createPanel();
    if(state.panel)state.panel.hidden=false;
    if(api()?.isUnlocked())refresh();
  },
  refresh(reports,actions){
    state.reports=Array.isArray(reports)?reports:[];
    state.actions=Array.isArray(actions)?actions:[];
    refresh();
  },
  wireFocusedDraft,wireInvestigationDraft,wireWizardActionDrafts,clearSubmittedDraft,
  async hasOfflineWorkspace(){
    if(!state.identity||!api())return false;
    const locator=await api().resolveAccountLocator(state.identity.email);
    return !!sameIdentity(locator,state.identity);
  },
  async clearOnSignOut(){
    const old=state.identity;
    ++state.initVersion;state.enabled=false;
    api()?.lock();state.identity=null;state.reports=[];state.actions=[];state.client=null;
    if(old) await api().deleteAccountWorkspace(old.organizationId,old.userId);
    try{await setDeviceOfflineEnrollment(false);}catch(e){console.warn('Offline launch marker cleanup failed',e);}
  },
  lock(){++state.initVersion;state.enabled=false;api()?.lock();state.identity=null;state.reports=[];state.actions=[];state.client=null;}
});
})(window);
