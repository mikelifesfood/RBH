/* RBH staff offline evidence replay — manual-only.
 * No background sync, no automatic upload and no report/status changes.
 * Requires server-side protocol-v1 handshake, stable UUID and SHA-256 receipt.
 */
(function(root){
'use strict';
const ERRORS=new Set(['OFFLINE_CONFLICT_NEEDS_REVIEW','OFFLINE_EVIDENCE_ID_REUSED','OFFLINE_EVIDENCE_STORAGE_CONFLICT']);
function requireValue(ok,message){if(!ok)throw Error(message);}
function attemptsScope(scope,evidenceId) {
  return {...scope,step:'evidence_attempt_'+evidenceId};
}
async function call(client,body){
  const {data,error}=await client.functions.invoke('manage-action-evidence',{body});
  if(error)throw Error(error.message||'UPLOAD_SERVER_UNAVAILABLE');
  return data||{};
}
async function capability(client,reportId,actionId){
  if(!client)return false;
  try{
    const data=await call(client,{action:'capabilities',reportId,correctiveActionId:actionId});
    return data.ok===true&&data.offlineProtocolVersion===1&&data.reportId===reportId&&data.correctiveActionId===actionId;
  }catch(_){return false;}
}
async function verifyFresh(client,scope,draft){
  const [a,r]=await Promise.all([
    client.from('report_corrective_actions').select(
      'id,report_id,organization_id,workflow_generation,status,updated_at,retired_at,activated_at'
    ).eq('id',scope.actionId).maybeSingle(),
    client.from('reports').select(
      'id,organization_id,workflow_restart_count,reopen_count,status,updated_at'
    ).eq('id',scope.reportId).maybeSingle()
  ]);
  if(a.error||r.error||!a.data||!r.data)throw Error('OFFLINE_RECORD_UNAVAILABLE');
  const action=a.data,report=r.data;
  if(action.report_id!==scope.reportId||action.organization_id!==scope.organizationId||
     report.organization_id!==scope.organizationId||
     Number(action.workflow_generation)!==scope.generation||
     Number(report.workflow_restart_count||0)!==scope.generation||
     Number(report.reopen_count||0)!==Number(draft.reopenCount||0)||
     action.retired_at||!action.activated_at||
     action.updated_at!==draft.actionRevision||
     report.updated_at!==draft.reportRevision||
     action.status!==draft.actionStatus ||
     ['closed','no_action','duplicate'].includes(String(report.status)))
    throw Error('OFFLINE_CONFLICT_NEEDS_REVIEW');
  return {action,report};
}
async function uploadOne(options){
  const {client,scope,evidenceId,identity,confirm}=options||{};
  const f=root.TeamWorktStaffOfflineFoundation;
  requireValue(f?.isUnlocked()&&client&&scope&&evidenceId,'OFFLINE_WORKSPACE_LOCKED');
  requireValue(confirm===true,'EXPLICIT_USER_CONFIRMATION_REQUIRED');
  requireValue(identity&&identity.userId===scope.userId&&identity.organizationId===scope.organizationId,'OFFLINE_ACCOUNT_MISMATCH');
  requireValue(!!scope.actionId,'ACTION_SPECIFIC_EVIDENCE_REQUIRED');
  requireValue(root.navigator.onLine!==false,'WAITING_FOR_CONNECTION');
  const session=await client.auth.getSession();
  if(!session?.data?.session?.access_token)throw Error('AUTH_SESSION_REQUIRED');
  const user=await client.auth.getUser();
  if(user.error||user.data?.user?.id!==scope.userId)throw Error('AUTH_SESSION_MISMATCH');
  const supported=await capability(client,scope.reportId,scope.actionId);
  if(!supported)throw Error('OFFLINE_UPLOAD_NOT_ACTIVATED');
  const file=await f.readEvidence(scope,evidenceId);
  if(!file)throw Error('LOCAL_EVIDENCE_MISSING');
  const saved=await f.readDraft(scope);
  if(!saved||!saved.serverRevision||!saved.data?.reportRevision)throw Error('OFFLINE_DRAFT_REVISION_REQUIRED');
  const expected={
    actionRevision:saved.serverRevision,
    reportRevision:saved.data.reportRevision,
    reopenCount:Number(saved.data.reopenCount||0),
    actionStatus:saved.data.actionStatus
  };
  requireValue(typeof expected.actionStatus==='string'&&expected.actionStatus,'OFFLINE_ACTION_STATUS_REQUIRED');
  const attemptScope=attemptsScope(scope,evidenceId);
  let prior=await f.readDraft(attemptScope);
  if(prior && (prior.data?.sha256!==file.sha256 ||
      prior.data?.actionRevision!==expected.actionRevision||
      prior.data?.reportRevision!==expected.reportRevision))throw Error('OFFLINE_ATTEMPT_CONFLICT');
  // New uploads get a fresh server revision check; a previously attempted
  // upload is replayed with its original immutable request for lost receipts.
  if(!prior){
    await verifyFresh(client,scope,expected);
    await f.saveDraft(attemptScope,{sha256:file.sha256,...expected,attemptedAt:new Date().toISOString()},saved.serverRevision);
    prior=await f.readDraft(attemptScope);
    if(!prior)throw Error('UPLOAD_ATTEMPT_NOT_DURABLE');
  }
  const data=new FormData();
  data.append('action','upload');
  data.append('reportId',scope.reportId);
  data.append('correctiveActionId',scope.actionId);
  data.append('clientEvidenceId',evidenceId);
  data.append('expectedActionRevision',expected.actionRevision);
  data.append('expectedReportRevision',expected.reportRevision);
  data.append('expectedActionStatus',expected.actionStatus);
  data.append('expectedGeneration',String(scope.generation));
  data.append('expectedReopenCount',String(expected.reopenCount));
  data.append('files',file.file,file.file.name);
  let receipt;
  try{receipt=await call(client,data);}
  catch(error){throw Error(ERRORS.has(error.message)?error.message:'EVIDENCE_UPLOAD_PENDING_RETRY');}
  if(receipt.ok!==true||receipt.offlineProtocolVersion!==1||receipt.clientEvidenceId!==evidenceId||
    receipt.correctiveActionId!==scope.actionId||!Array.isArray(receipt.added)||
    receipt.added.length!==1||receipt.added[0].correctiveActionId!==scope.actionId||
    typeof receipt.added[0].id!=='string')
    throw Error('EVIDENCE_SERVER_RECEIPT_UNVERIFIED');
  // No local purge until server receipt is verified. Failed local cleanup must
  // not cause a second logical upload: server deduplicates by operation ID.
  await f.deleteEvidence(scope,evidenceId);
  await f.deleteDraft(attemptScope);
  return {status:'synced_to_rbh',receipt};
}
root.TeamWorktStaffEvidenceReplay=Object.freeze({capability,uploadOne});
})(window);
