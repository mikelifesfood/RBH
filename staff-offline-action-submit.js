/* RBH manual offline corrective action submission.
 * Only official RPC commit, after a human confirms online.
 * Stable durable operation keys survive a server-success/lost-response retry.
 * Organization feature gate and server-side permissions are authoritative.
 */
(function(root){
'use strict';
const KINDS=Object.freeze({
  action_completion:'submit_action_completion',
  verification:'verify_action',
  changes_requested:'request_action_changes'
});
function requireValue(ok,message){if(!ok)throw Error(message);}
async function freshCurrent(client,scope,expected){
  const [a,r]=await Promise.all([
    client.from('report_corrective_actions')
      .select('id,report_id,organization_id,workflow_generation,updated_at,status,retired_at')
      .eq('id',scope.actionId).maybeSingle(),
    client.from('reports')
      .select('id,organization_id,workflow_restart_count,reopen_count,updated_at,status')
      .eq('id',scope.reportId).maybeSingle()
  ]);
  if(a.error||r.error||!a.data||!r.data)return {authenticated:true,active:true,
    canPerform:false,current:false};
  const action=a.data,report=r.data;
  const valid=action.report_id===scope.reportId&&action.organization_id===scope.organizationId&&
    report.organization_id===scope.organizationId&&!action.retired_at&&
    !['closed','duplicate','no_action'].includes(report.status)&&
    action.updated_at===expected.actionRevision&&report.updated_at===expected.reportRevision&&
    action.status===expected.actionStatus&&
    Number(action.workflow_generation||0)===scope.generation&&
    Number(report.workflow_restart_count||0)===scope.generation&&
    Number(report.reopen_count||0)===expected.reopenCount;
  return {authenticated:true,active:true,canPerform:valid,current:valid,
    userId:scope.userId,organizationId:scope.organizationId,reportId:scope.reportId,
    actionId:scope.actionId,generation:scope.generation,
    revision:expected.actionRevision};
}
async function submitOne(options){
  const {client,scope,identity,confirm}=options||{};
  const local=root.TeamWorktStaffOfflineFoundation;
  const protocol=root.TeamWorktStaffOfflineProtocol;
  requireValue(local?.isUnlocked()&&client&&protocol,'OFFLINE_WORKSPACE_LOCKED');
  requireValue(scope&&scope.actionId&&KINDS[scope.step],'OFFLINE_ACTION_STEP_NOT_SUPPORTED');
  requireValue(confirm===true,'EXPLICIT_USER_CONFIRMATION_REQUIRED');
  requireValue(identity&&identity.organizationId===scope.organizationId&&identity.userId===scope.userId,
    'OFFLINE_ACCOUNT_MISMATCH');
  requireValue(root.navigator.onLine!==false,'WAITING_FOR_CONNECTION');
  const session=await client.auth.getSession();
  requireValue(session?.data?.session?.access_token,'AUTH_SESSION_REQUIRED');
  const user=await client.auth.getUser();
  requireValue(!user.error&&user.data?.user?.id===scope.userId,'AUTH_SESSION_MISMATCH');
  const gate=await client.rpc('rbh_staff_offline_status');
  requireValue(!gate.error&&gate.data?.enabled===true&&gate.data?.protocolVersion===1,'STAFF_OFFLINE_DISABLED');
  const saved=await local.readDraft(scope);
  requireValue(saved&&saved.data&&saved.serverRevision,'LOCAL_DRAFT_NOT_FOUND');
  const data=saved.data,note=typeof data.note==='string'?data.note.trim():'';
  requireValue(note.length>0,'COMPLETION_OR_VERIFICATION_NOTE_REQUIRED');
  requireValue(data.reportRevision&&data.actionStatus&&Number.isSafeInteger(Number(data.reopenCount)),
    'OFFLINE_DRAFT_REVISION_REQUIRED');
  const evidence=await local.listEvidence(scope);
  requireValue(evidence.length===0,'UPLOAD_SAVED_EVIDENCE_BEFORE_SUBMITTING');
  const expected={actionRevision:saved.serverRevision,reportRevision:data.reportRevision,
    actionStatus:data.actionStatus,reopenCount:Number(data.reopenCount)};
  const kind=KINDS[scope.step];
  let storedOperation=data.submission||null,operationId;
  if(storedOperation){
    requireValue(storedOperation.kind===kind&&storedOperation.note===note&&
      storedOperation.actionRevision===expected.actionRevision&&
      storedOperation.reportRevision===expected.reportRevision&&
      storedOperation.reopenCount===expected.reopenCount&&
      storedOperation.actionStatus===expected.actionStatus,
      'PENDING_OPERATION_CHANGED_NEEDS_REVIEW');
    operationId=storedOperation.operationId;
  }else{
    const current=await freshCurrent(client,scope,expected);
    const intent=protocol.buildIntent({
      scope,kind,observedRevision:expected.actionRevision,payload:{note}
    });
    const ready=protocol.markReady(intent,current);
    requireValue(ready.status===protocol.STATES.READY,'OFFLINE_CONFLICT_NEEDS_REVIEW');
    const confirmed=protocol.explicitConfirm(ready,current,true);
    operationId=confirmed.operationId;
    // Persist an immutable retry key BEFORE the first network mutation.
    // Never silently repeat a different payload under this key.
    storedOperation={operationId,kind,note,...expected,attemptedAt:new Date().toISOString()};
    await local.saveDraft(scope,{...data,submission:storedOperation},saved.serverRevision);
    const persisted=await local.readDraft(scope);
    requireValue(persisted?.data?.submission?.operationId===operationId,
      'DURABLE_OPERATION_KEY_NOT_VERIFIED');
  }
  // This is the ONLY official workflow mutation, performed after the user's
  // separate explicit confirmation; never triggered by browser online event.
  const response=await client.rpc('rbh_commit_offline_corrective_action',{
    p_operation_id:operationId,p_action_id:scope.actionId,p_kind:kind,p_note:note,
    p_expected_action_updated_at:expected.actionRevision,
    p_expected_report_updated_at:expected.reportRevision,
    p_expected_generation:scope.generation,
    p_expected_reopen_count:expected.reopenCount,
    p_expected_action_status:expected.actionStatus
  });
  if(response.error)throw Error('OFFLINE_SUBMISSION_NEEDS_REVIEW: '+response.error.message);
  const receipt=response.data;
  if(!receipt||receipt.ok!==true||receipt.committed!==true||
    receipt.operationId!==operationId||receipt.actionId!==scope.actionId||
    receipt.reportId!==scope.reportId||receipt.kind!==kind)
    throw Error('OFFLINE_SERVER_RECEIPT_UNVERIFIED');
  await local.deleteDraft(scope);
  return {status:protocol.STATES.SYNCED,receipt};
}
root.TeamWorktStaffActionSubmit=Object.freeze({submitOne});
})(window);
