/* RBH / TeamWorkt Safety: explicit, server-validated offline intent protocol.
 * This pure module NEVER sends a network request. Only callers may send after
 * fresh authentication, live revision checks and a separate explicit confirm.
 * Exported for Node tests; safe for browser packaging once implementation gates pass.
 */
(function(root,factory) {
  const api=factory();
  if(typeof module === 'object' && module.exports) module.exports=api;
  else root.TeamWorktStaffOfflineProtocol=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const STATES=Object.freeze({
    SAVED:'saved_on_this_device', WAITING:'waiting_for_connection',
    READY:'ready_to_submit', UPLOADING:'uploading', CONFIRMING:'pending_confirmation',
    SYNCED:'synced_to_rbh', REVIEW:'needs_review', FAILED:'failed'
  });
  const SENSITIVE=new Set(['assign_report_owner','assign_investigator','activate_action_plan','submit_action_completion','verify_action','request_action_changes','close_report','reopen_report','restart_workflow','add_action_before_close']);
  function invariant(ok,message){if(!ok)throw Error(message);}
  function canonicalScope(scope) {
    invariant(scope&&typeof scope==='object','SCOPE_REQUIRED');
    const keys=['organizationId','userId','reportId','step'];
    keys.forEach(k=>invariant(typeof scope[k]==='string'&&scope[k].length>0,'SCOPE_'+k+'_REQUIRED'));
    invariant(Number.isSafeInteger(scope.generation)&&scope.generation>=0,'GENERATION_REQUIRED');
    return Object.freeze({organizationId:scope.organizationId,userId:scope.userId,reportId:scope.reportId,
      actionId:scope.actionId||null,generation:scope.generation,step:scope.step});
  }
  function buildIntent({scope,kind,observedRevision,payload}) {
    invariant(SENSITIVE.has(kind),'OPERATION_NOT_ALLOWLISTED');
    invariant(typeof observedRevision==='string'&&observedRevision.length>0,'OBSERVED_REVISION_REQUIRED');
    invariant(payload&&typeof payload==='object'&&!Array.isArray(payload),'PAYLOAD_REQUIRED');
    invariant(typeof crypto!=='undefined'&&crypto.randomUUID,'SECURE_RANDOM_UUID_REQUIRED');
    return Object.freeze({
      operationId:crypto.randomUUID(),kind,scope:canonicalScope(scope),
      observedRevision,payload:structuredClone(payload),status:STATES.SAVED,
      createdAt:new Date().toISOString(),lastError:null,confirmedAt:null
    });
  }
  function stageForConnection(intent) {
    invariant(intent.status===STATES.SAVED||intent.status===STATES.FAILED,'INVALID_TRANSITION');
    return {...intent,status:STATES.WAITING,lastError:null};
  }
  function markReady(intent,server) {
    invariant([STATES.SAVED,STATES.WAITING,STATES.REVIEW,STATES.FAILED].includes(intent.status),'INVALID_TRANSITION');
    if(!server||server.authenticated!==true||server.active!==true||server.canPerform!==true||
      server.userId!==intent.scope.userId||server.organizationId!==intent.scope.organizationId||
      server.reportId!==intent.scope.reportId||server.generation!==intent.scope.generation||
      (intent.scope.actionId&&server.actionId!==intent.scope.actionId)||
      server.revision!==intent.observedRevision||server.current!==true) {
      return {...intent,status:STATES.REVIEW,lastError:'SERVER_STATE_CHANGED'};
    }
    return {...intent,status:STATES.READY,lastError:null};
  }
  function explicitConfirm(intent,server,consent) {
    invariant(intent.status===STATES.READY,'NOT_READY_FOR_CONFIRMATION');
    invariant(consent===true,'EXPLICIT_USER_CONFIRMATION_REQUIRED');
    // Confirmation must use a fresh server verdict, not the previous ready snapshot.
    const latest=markReady({...intent,status:STATES.REVIEW},server);
    invariant(latest.status===STATES.READY,'FRESH_SERVER_VALIDATION_FAILED');
    return {...intent,status:STATES.UPLOADING,confirmedAt:new Date().toISOString()};
  }
  function markPendingReceipt(intent) {
    invariant(intent.status===STATES.UPLOADING,'INVALID_TRANSITION');
    return {...intent,status:STATES.CONFIRMING};
  }
  function markSynced(intent,receipt) {
    invariant([STATES.UPLOADING,STATES.CONFIRMING].includes(intent.status),'INVALID_TRANSITION');
    invariant(receipt&&receipt.ok===true&&receipt.operationId===intent.operationId&&
      receipt.committed===true,'VERIFIED_SERVER_RECEIPT_REQUIRED');
    return {...intent,status:STATES.SYNCED,receipt};
  }
  function markFailed(intent,error) {
    invariant(intent.status!==STATES.SYNCED,'ALREADY_COMMITTED');
    return {...intent,status:STATES.FAILED,lastError:String(error||'UNKNOWN_FAILURE')};
  }
  return Object.freeze({STATES,buildIntent,stageForConnection,markReady,explicitConfirm,markPendingReceipt,markSynced,markFailed});
});
