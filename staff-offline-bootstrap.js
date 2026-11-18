/* RBH staff offline enrollment and safe local draft restoration.
 * This file requires an active authenticated dashboard to call init().
 * Device-local drafts are NEVER treated as official workflow submissions.
 */
(function(root){
'use strict';
const STEP_INDEX='workspace_index';
const TTL=24*60*60*1000;
const state={identity:null,reports:[],actions:[],panel:null,initialized:false,saving:false};
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
  const current=state.reports.filter(r=>{
    if(!r||!r.id||r.organization_id!==u.organizationId)return false;
    if(['closed','no_action','duplicate'].includes(String(r.status)))return false;
    const assignments=state.actions.filter(a=>a.report_id===r.id&&!a.retired_at&&
      Number(a.workflow_generation||0)===Number(r.workflow_restart_count||0));
    const mine=String(r.report_owner_user_id||'')===uid||String(r.investigator_user_id||'')===uid||
      String(r.assigned_user_id||'')===uid||assignments.some(a=>String(a.owner_user_id||'')===uid||
        String(a.verifier_user_id||'')===uid);
    return mine||(isManager&&r.status==='new');
  }).slice(0,25);
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
      revision:r.updated_at,generation:Number(r.workflow_restart_count||0),
      role,readOnly:role==='read_only',
      canEditReport:isManager||String(r.report_owner_user_id||'')===uid&&role==='supervisor',
      actions
    };
  });
  const now=Date.now();
  return {organizationId:u.organizationId,userId:u.userId,role,
    syncedAt:new Date(now).toISOString(),expiresAt:new Date(now+TTL).toISOString(),records};
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
    '</div>';
  section.insertAdjacentElement('afterend',wrap);
  state.panel=wrap;
  $('rbhOfflinePrepare').addEventListener('click',prepare);
  $('rbhOfflineLock').addEventListener('click',()=>{api()?.lock();setStatus('Offline drafts locked. Enter your passphrase to unlock them again.');});
}
async function prepare(){
  const f=api(),u=state.identity;if(!f||!u){setStatus('Sign in online before preparing offline work.',true);return;}
  const pass=$('rbhOfflinePassphrase').value;
  const again=$('rbhOfflinePassphraseAgain').value;
  if(!pass||pass.length<12||pass!==again){setStatus('Enter and confirm the same offline passphrase (at least 12 characters).',true);return;}
  const button=$('rbhOfflinePrepare');button.disabled=true;
  try{
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
    $('rbhOfflinePassphrase').value='';$('rbhOfflinePassphraseAgain').value='';
    setStatus('Assigned work is encrypted on this device. Drafts and evidence remain local until officially submitted online.');
  }catch(e){
    f.lock();setStatus(e.message==='OFFLINE_DRAFT_CANNOT_DECRYPT'?'Your offline passphrase does not match this device’s existing drafts. Nothing was overwritten.':e.message,true);
  }finally{button.disabled=false;}
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
  const scope=scopeFor(report,action,step);
  const revision=action.updated_at;
  const hint=document.createElement('p');
  hint.className='field-help';hint.setAttribute('role','status');
  hint.textContent='Offline draft saving enabled on this device.';
  textarea.insertAdjacentElement('afterend',hint);
  try{
    const saved=await api().readDraft(scope);
    if(!textarea.isConnected)return;
    if(saved&&saved.data&&saved.data.note){
      if(saved.serverRevision===revision){
        if(!textarea.value.trim())textarea.value=saved.data.note;
        hint.textContent='Saved local draft restored. Review before submitting officially.';
      }else{
        hint.textContent='A local draft exists, but this action changed on the server. Review the differences before copying it.';
        hint.style.color='#9b5712';
        const reveal=document.createElement('button');reveal.type='button';
        reveal.className='wizard-save';reveal.textContent='Show older draft';
        reveal.addEventListener('click',()=>{
          const output=document.createElement('textarea');
          output.readOnly=true;output.value=saved.data.note;
          output.setAttribute('aria-label','Older offline draft (read only)');
          hint.insertAdjacentElement('afterend',output);reveal.disabled=true;
        });hint.insertAdjacentElement('afterend',reveal);
      }
    }
  }catch(e){hint.textContent='Could not restore your local draft. It has not been deleted.';}
  let timer=null;
  textarea.addEventListener('input',()=>{
    clearTimeout(timer);
    hint.textContent='Saving on this device…';
    timer=setTimeout(async()=>{
      if(!textarea.isConnected||!api()?.isUnlocked())return;
      try{
        await api().saveDraft(scope,{note:textarea.value,offlineOnly:true},revision);
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
root.TeamWorktStaffOfflineUI=Object.freeze({
  init(identity,reports,actions){
    if(!identity||!identity.userId||!identity.organizationId||!identity.email)return;
    if(state.identity&&!sameIdentity(state.identity,identity)){
      const previous=state.identity;
      api()?.lock();
      api()?.deleteAccountWorkspace(previous.organizationId,previous.userId).catch(e=>console.warn('Old offline workspace cleanup failed',e));
    }
    state.identity={...identity};
    state.reports=Array.isArray(reports)?reports:[];
    state.actions=Array.isArray(actions)?actions:[];
    createPanel();
    if(api()?.isUnlocked())refresh();
  },
  refresh(reports,actions){
    state.reports=Array.isArray(reports)?reports:[];
    state.actions=Array.isArray(actions)?actions:[];
    refresh();
  },
  wireFocusedDraft,clearSubmittedDraft,
  async clearOnSignOut(){
    const old=state.identity;
    api()?.lock();state.identity=null;state.reports=[];state.actions=[];
    if(old) await api().deleteAccountWorkspace(old.organizationId,old.userId);
  },
  lock(){api()?.lock();state.identity=null;state.reports=[];state.actions=[];}
});
})(window);
