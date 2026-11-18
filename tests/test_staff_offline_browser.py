"""Headless Chromium acceptance tests for RBH's staged offline-only workspace.
These tests use fictional local records, never production Supabase accounts.
Run: python -m unittest discover -s tests -p 'test_staff_offline_browser.py'
"""
import base64
import functools
import http.server
import socketserver
import socket
import threading
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
PASS = "long-demo-passphrase-2026"
EMAIL = "offline-tester@example.invalid"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
DASHBOARD_NETWORK_BLOCKED = threading.Event()
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if DASHBOARD_NETWORK_BLOCKED.is_set() and self.path.startswith('/dashboard.html'):
            # Simulate a real network failure rather than a 503 response.
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        super().do_GET()

class OfflineBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler=functools.partial(QuietHandler,directory=str(ROOT))
        cls.server=socketserver.TCPServer(("127.0.0.1",PORT),handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.playwright=sync_playwright().start()
        cls.browser=cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context=self.browser.new_context(service_workers="allow")
        self.page=self.context.new_page()
        self.page.goto(BASE+"/staff-offline-workspace.html")
        self.page.wait_for_function("!!window.TeamWorktStaffOfflineFoundation")

    def tearDown(self):
        DASHBOARD_NETWORK_BLOCKED.clear()
        self.context.close()

    def enroll(self):
        self.page.evaluate("""async ({email,passphrase})=>{
          const f=window.TeamWorktStaffOfflineFoundation;
          f.unlock(passphrase);
          const records=[{
            id:'report-123',number:77,site:'Fictional site',status:'investigation',
            description:'Fictional test report',revision:'2026-11-18T12:00:00Z',
            generation:0,role:'supervisor',readOnly:false,canEditReport:true,
            actions:[{id:'action-456',number:1,status:'in_progress',revision:'2026-11-18T12:00:00Z',canComplete:true}]
          }];
          await f.saveDraft({organizationId:'org-1',userId:'user-1',reportId:'workspace',generation:0,step:'workspace_index'},
            {organizationId:'org-1',userId:'user-1',syncedAt:new Date().toISOString(),
             expiresAt:new Date(Date.now()+3600000).toISOString(),role:'supervisor',records},'v1');
          await f.registerAccountLocator(email,'org-1','user-1');
          const marker=new URL('./staff-offline-device-enabled',location.href).href;
          await (await caches.open('rbh-staff-offline-device-v1')).put(marker,new Response('1'));
          f.lock();
        }""",{"email":EMAIL,"passphrase":PASS})

    def unlock(self,password=PASS,email=EMAIL):
        self.page.locator("#accountEmail").fill(email)
        self.page.locator("#offlinePassphrase").fill(password)
        self.page.locator("#unlockForm button[type=submit]").click()

    def test_draft_photo_persist_and_offline_pwa_dashboard_fallback(self):
        self.enroll()
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.page.locator("#draftStep").select_option("action_completion")
        self.page.locator("#draftNote").fill("Fictional corrective work complete")
        self.page.locator("#draftPhotos").set_input_files([{
          "name":"evidence.png","mimeType":"image/png","buffer":PNG
        }])
        self.page.locator("#saveDraft").click()
        self.page.get_by_text("Saved on this device — NOT submitted to RBH.").wait_for()
        self.assertIn("1 photo(s)",self.page.locator("#evidenceCount").inner_text())
        self.page.evaluate("""async()=>{
          await navigator.serviceWorker.register('./sw.js',{scope:'./'});
          await navigator.serviceWorker.ready;
        }""")
        self.page.reload()
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.page.locator("#draftStep").select_option("action_completion")
        try:
            self.page.wait_for_function("document.querySelector('#draftNote').value === 'Fictional corrective work complete'",timeout=5000)
        except Exception:
            details=self.page.evaluate("""async()=>{
              const scope={organizationId:'org-1',userId:'user-1',reportId:'report-123',
                actionId:'action-456',generation:0,step:'action_completion'};
              const s=window.TeamWorktStaffOfflineFoundation;
              let draft=null,error=null;
              try{draft=await s.readDraft(scope);}catch(e){error=String(e);}
              return {status:document.getElementById('status').textContent,
                step:document.getElementById('draftStep').value,
                action:document.getElementById('draftAction').value,
                note:document.getElementById('draftNote').value,
                draft,error,unlocked:s.isUnlocked()};
            }""")
            self.fail("RESTORE_DIAGNOSTIC: "+repr(details))
        self.assertIn("1 photo(s)",self.page.locator("#evidenceCount").inner_text())
        self.page.evaluate("""async()=>{
          const f=window.TeamWorktStaffOfflineFoundation;
          const scope={organizationId:'org-1',userId:'user-1',reportId:'report-123',
            actionId:'action-456',generation:0,step:'action_completion'};
          const matches=await f.listEvidence(scope);
          if(matches.length!==1)throw Error('EVIDENCE_MISSING');
          const restored=await f.readEvidence(scope,matches[0].attachmentId);
          if(restored.file.size===0||restored.file.name!=='evidence.png')throw Error('EVIDENCE_NOT_RECOVERED');
        }""")
        self.page.reload()  # Ensure the new SW controls this client before going offline
        self.page.wait_for_function("navigator.serviceWorker.controller !== null")
        # Loopback interfaces can be exempted from Chromium's offline emulation.
        # Abort the exact dashboard network request too so SW fallback is tested.
        DASHBOARD_NETWORK_BLOCKED.set()
        self.context.set_offline(True)
        self.page.goto(BASE+"/dashboard.html",wait_until="domcontentloaded")
        self.assertTrue(self.page.locator("#summary").count(),
          "Offline fallback did not reach the password-free staff action shell: "+self.page.url)
        self.assertEqual(self.page.locator("#offlinePassphrase").count(),0)
        self.assertIn("Not prepared for offline work",self.page.locator("#summary").inner_text())

        self.page.evaluate("""async()=>{
          const names=(await caches.keys()).join(' ');
          const keys=await Promise.all((await caches.keys()).map(async name=>(await caches.open(name)).keys()));
          const urls=keys.flat().map(r=>r.url);
          if(urls.some(url=>url.includes('dashboard.html')))throw Error('CONFIDENTIAL_DASHBOARD_CACHED');
          if(urls.some(url=>url.includes('report-123')))throw Error('REPORT_IDENTIFIER_IN_CACHE');
        }""")

    def test_old_server_protocol_cannot_upload_photos_automatically(self):
        self.enroll()
        self.unlock()
        self.page.add_script_tag(url=BASE+"/staff-offline-evidence-replay.js")
        result=self.page.evaluate("""async()=>{
          let calls=0;
          const oldServer={functions:{invoke:async()=>{calls++;return {data:null,error:{message:'INVALID_ACTION'}};}}};
          const sync=window.TeamWorktStaffEvidenceReplay;
          const allowed=await sync.capability(oldServer,'report-123','action-456');
          let blocked=false;
          try {
            await sync.uploadOne({client:oldServer,scope:{
              organizationId:'org-1',userId:'user-1',reportId:'report-123',
              actionId:'action-456',generation:0,step:'action_completion'
            },evidenceId:'demo-evidence',identity:{
              organizationId:'org-1',userId:'user-1'
            },confirm:false});
          }catch(e){blocked=String(e).includes('EXPLICIT_USER_CONFIRMATION_REQUIRED');}
          return {allowed,blocked,calls};
        }""")
        self.assertEqual(result,{'allowed':False,'blocked':True,'calls':1})

    def test_manual_official_action_submission_lost_response_replay(self):
        self.enroll()
        self.unlock()
        self.page.add_script_tag(url=BASE+"/staff-offline-protocol.js")
        self.page.add_script_tag(url=BASE+"/staff-offline-action-submit.js")
        result=self.page.evaluate("""async()=>{
          const f=window.TeamWorktStaffOfflineFoundation;
          const scope={organizationId:'org-1',userId:'user-1',reportId:'report-123',
            actionId:'action-456',generation:0,step:'action_completion'};
          const identity={organizationId:'org-1',userId:'user-1'};
          const timestamp='2026-11-18T12:00:00Z';
          await f.saveDraft(scope,{note:'Fictional action completed',reportRevision:timestamp,
            reopenCount:0,actionStatus:'in_progress'},timestamp);
          let mutations=0,ids=[],lost=true,stale=false;
          const client={
            auth:{
              getSession:async()=>({data:{session:{access_token:'fictional-only'}}}),
              getUser:async()=>({data:{user:{id:'user-1'}}})
            },
            from(table){
              return {select(){return this;},eq(){return this;},async maybeSingle(){
                if(table==='reports')return {data:{id:'report-123',organization_id:'org-1',
                  workflow_restart_count:0,reopen_count:0,updated_at:stale?'changed':timestamp,status:'investigation'}};
                return {data:{id:'action-456',report_id:'report-123',organization_id:'org-1',
                  workflow_generation:0,status:'in_progress',updated_at:timestamp,retired_at:null}};
              }};
            },
            async rpc(name,args){
              if(name==='rbh_staff_offline_status')return {data:{enabled:true,protocolVersion:1}};
              if(name!=='rbh_commit_offline_corrective_action')throw Error('UNKNOWN_RPC');
              mutations++;ids.push(args.p_operation_id);
              if(lost){lost=false;throw Error('SIMULATED_LOST_HTTP_RESPONSE_AFTER_COMMIT');}
              return {data:{ok:true,committed:true,operationId:args.p_operation_id,
                actionId:scope.actionId,reportId:scope.reportId,kind:'submit_action_completion'}};
            }
          };
          const submit=window.TeamWorktStaffActionSubmit.submitOne;
          let denied=false;
          try{await submit({client,scope,identity,confirm:false});}
          catch(e){denied=String(e).includes('EXPLICIT_USER_CONFIRMATION_REQUIRED');}
          stale=true;
          let rejected=false;
          try{await submit({client,scope,identity,confirm:true});}
          catch(e){rejected=String(e).includes('OFFLINE_CONFLICT_NEEDS_REVIEW');}
          stale=false;
          let transient=false;
          try{await submit({client,scope,identity,confirm:true});}
          catch(e){transient=String(e).includes('SIMULATED_LOST_HTTP_RESPONSE');}
          const pending=await f.readDraft(scope);
          const operation=pending?.data?.submission?.operationId;
          const completed=await submit({client,scope,identity,confirm:true});
          const remaining=await f.readDraft(scope);
          return {denied,rejected,transient,mutations,stable:ids.length===2&&ids[0]===ids[1]&&ids[0]===operation,
            committed:completed.status==='synced_to_rbh',purged:remaining===null};
        }""")
        self.assertEqual(result,{'denied':True,'rejected':True,'transient':True,
          'mutations':2,'stable':True,'committed':True,'purged':True})

    def test_manual_action_submission_rejects_tenant_session_and_feature_flag_mismatches(self):
        self.enroll()
        self.unlock()
        self.page.add_script_tag(url=BASE+"/staff-offline-protocol.js")
        self.page.add_script_tag(url=BASE+"/staff-offline-action-submit.js")
        result=self.page.evaluate("""async()=>{
          const f=window.TeamWorktStaffOfflineFoundation;
          const scope={organizationId:'org-1',userId:'user-1',reportId:'report-123',
            actionId:'action-456',generation:0,step:'action_completion'};
          await f.saveDraft(scope,{note:'Fictional completion',reportRevision:'rev-1',
            reopenCount:0,actionStatus:'in_progress'},'rev-1');
          let mutations=0,gateEnabled=true,sessionValid=true,tenant='org-1',reportRevision='rev-1';
          const client={
            auth:{
              getSession:async()=>({data:{session:sessionValid?{access_token:'test-only'}:null}}),
              getUser:async()=>({data:{user:{id:'user-1'}}})
            },
            from(table){return {select(){return this;},eq(){return this;},async maybeSingle(){
              return {data:table==='reports'?{id:'report-123',organization_id:tenant,
                workflow_restart_count:0,reopen_count:0,updated_at:reportRevision,status:'investigation'}:
                {id:'action-456',report_id:'report-123',organization_id:'org-1',
                workflow_generation:0,status:'in_progress',updated_at:'rev-1',retired_at:null}};
            }}},
            async rpc(name,args){
              if(name==='rbh_staff_offline_status')return {data:{enabled:gateEnabled,protocolVersion:1}};
              mutations++;
              return {data:{ok:true,committed:true,operationId:args.p_operation_id,
                actionId:scope.actionId,reportId:scope.reportId,kind:'submit_action_completion'}};
            }
          };
          const submit=window.TeamWorktStaffActionSubmit.submitOne;
          const identity={organizationId:'org-1',userId:'user-1'};
          async function denied(options){
            try{await submit({client,scope,identity,confirm:true,...options});return false;}
            catch{return true;}
          }
          const wrongTenant=await denied({identity:{organizationId:'org-other',userId:'user-1'}});
          sessionValid=false;const revokedSession=await denied({});sessionValid=true;
          gateEnabled=false;const featureOff=await denied({});gateEnabled=true;
          tenant='org-other';const crossTenant=await denied({});tenant='org-1';
          reportRevision='rev-2';const changedReport=await denied({});reportRevision='rev-1';
          const unmodified=await f.readDraft(scope);
          return {wrongTenant,revokedSession,featureOff,crossTenant,changedReport,
            mutations,unchanged:unmodified?.data?.submission==null};
        }""")
        self.assertEqual(result,{'wrongTenant':True,'revokedSession':True,'featureOff':True,
          'crossTenant':True,'changedReport':True,'mutations':0,'unchanged':True})

    def test_authenticated_dashboard_offline_panel_requires_server_rollout_gate(self):
        self.page.set_content(
            '<main><section class="profile-card-section"><span id="rbhPushStatus"></span></section></main>'
        )
        self.page.add_script_tag(url=BASE+"/staff-offline-bootstrap.js")
        result=self.page.evaluate("""async()=>{
          const ui=window.TeamWorktStaffOfflineUI;
          const identity={organizationId:'org-1',userId:'user-1',
            email:'offline-tester@example.invalid',role:'supervisor'};
          const client=enabled=>({rpc:async()=>({
            data:{enabled,protocolVersion:1,maxSnapshotAgeHours:24}})});
          await ui.init(identity,[],[],client(false));
          const disabled=document.getElementById('rbhOfflineWorkspaceControls');
          await ui.init(identity,[],[],client(true));
          const enabled=document.getElementById('rbhOfflineWorkspaceControls');
          await ui.init(identity,[],[],client(false));
          const hiddenAgain=enabled?.hidden===true;
          return {notShownInitially:!disabled||disabled.hidden===true,
            shownWhenEnabled:!!enabled,hiddenAgain};
        }""")
        self.assertEqual(result,{'notShownInitially':True,
            'shownWhenEnabled':True,'hiddenAgain':True})

    def test_offline_snapshot_expiry_blocks_access_without_destroying_draft(self):
        self.enroll()
        self.page.evaluate("""async()=>{
          const store=window.TeamWorktStaffOfflineFoundation;
          store.unlock('long-demo-passphrase-2026');
          const scope={organizationId:'org-1',userId:'user-1',reportId:'workspace',
            generation:0,step:'workspace_index'};
          const snap=await store.readDraft(scope);
          await store.saveDraft(scope,{...snap.data,expiresAt:'2026-01-01T00:00:00.000Z'},'v1');
          store.lock();
        }""")
        self.unlock()
        self.page.get_by_text("OFFLINE_ACCESS_EXPIRED",exact=False).wait_for()
        self.assertTrue(self.page.locator("#workspacePanel").is_hidden())
        remaining=self.page.evaluate("""async()=>{
          const f=window.TeamWorktStaffOfflineFoundation;
          const locator=await f.resolveAccountLocator('offline-tester@example.invalid');
          return locator && locator.organizationId==='org-1' && locator.userId==='user-1';
        }""")
        self.assertTrue(remaining)

    def test_encrypted_local_drafts_and_photos_isolate_accounts(self):
        self.enroll()
        self.unlock()
        self.page.locator("#workspacePanel").wait_for(state="visible")
        result=self.page.evaluate("""async()=>{
          const f=window.TeamWorktStaffOfflineFoundation;
          const a={organizationId:'org-1',userId:'user-1',reportId:'report-123',
            actionId:'action-456',generation:0,step:'action_completion'};
          const b={...a,organizationId:'other-company'};
          const userB={...a,userId:'other-user'};
          await f.saveDraft(a,{note:'Fictional sensitive notes'},'rev1');
          const file=new File([new Uint8Array([137,80,78,71])],'demo.png',{type:'image/png'});
          const evidence='b7fd5a14-f238-435b-b39f-9bd1c4cc6a9e';
          await f.saveEvidence(a,evidence,file);
          const cross=await f.readDraft(b),user=await f.readDraft(userB);
          const crossFile=await f.readEvidence(b,evidence);
          const before=(await f.listEvidence(a)).length;
          await f.deleteAccountWorkspace(b.organizationId,b.userId);
          const after=(await f.listEvidence(a)).length;
          const intact=await f.readDraft(a);
          return {noTenantLeak:cross===null,noUserLeak:user===null,
            noPhotoLeak:crossFile===null,
            before,after,protected:intact?.data?.note==='Fictional sensitive notes'};
        }""")
        self.assertEqual(result,{'noTenantLeak':True,'noUserLeak':True,
          'noPhotoLeak':True,'before':1,'after':1,'protected':True})

    def test_wrong_identity_passphrase_and_local_erase(self):
        self.enroll()
        self.unlock(email="wrong@example.invalid")
        self.page.get_by_text("No offline work",exact=False).wait_for()
        self.unlock(password="incorrect-passphrase-2026")
        self.page.get_by_text("Incorrect passphrase",exact=False).wait_for()
        self.unlock()
        self.page.get_by_text("Report #77").first.wait_for()
        self.page.on("dialog",lambda dialog: dialog.accept())
        self.page.locator("#eraseButton").click()
        self.page.get_by_text("erased",exact=False).wait_for()
        self.unlock()
        self.page.get_by_text("No offline work",exact=False).wait_for()


    def test_unsaved_draft_is_protected_when_switching_step_or_locking(self):
        self.enroll()
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.page.locator("#draftStep").select_option("action_completion")
        self.page.locator("#draftNote").fill("Unsaved fictional work")
        prompts=[]
        def deny(dialog):
            prompts.append(dialog.message)
            dialog.dismiss()
        self.page.on("dialog", deny)
        self.page.locator("#draftStep").select_option("investigation")
        self.assertEqual(self.page.locator("#draftStep").input_value(),"action_completion")
        self.assertEqual(self.page.locator("#draftNote").input_value(),"Unsaved fictional work")
        self.page.locator("#lockButton").click()
        self.assertTrue(self.page.locator("#workspacePanel").is_visible())
        self.assertGreaterEqual(len(prompts),2)
        self.page.locator("#saveDraft").click()
        self.page.get_by_text("Saved on this device — NOT submitted to RBH.").wait_for()
        self.page.locator("#draftStep").select_option("investigation")
        self.assertEqual(self.page.locator("#draftStep").input_value(),"investigation")
        # Successfully saved notes survive navigation and can be reopened.
        self.page.locator("#draftStep").select_option("action_completion")
        self.page.wait_for_function(
            "document.querySelector('#draftNote').value === 'Unsaved fictional work'"
        )



    def test_evidence_upload_lost_response_keeps_photo_then_deduplicates_retry(self):
        self.enroll()
        self.unlock()
        self.page.add_script_tag(url=BASE+"/staff-offline-evidence-replay.js")
        result=self.page.evaluate("""async()=>{
          const store=window.TeamWorktStaffOfflineFoundation;
          const scope={organizationId:'org-1',userId:'user-1',reportId:'report-123',
            actionId:'action-456',generation:0,step:'action_completion'};
          const id='b7fd5a14-f238-435b-b39f-9bd1c4cc6a9e';
          const revision='2026-11-18T12:00:00Z';
          await store.saveDraft(scope,{note:'Complete fictional action',reportRevision:revision,
            reopenCount:0,actionStatus:'in_progress'},revision);
          await store.saveEvidence(scope,id,new File([new Uint8Array([137,80,78,71])],
            'evidence.png',{type:'image/png'}));
          let uploads=0,firstLost=true,operationIds=[];
          const client={
            auth:{
              getSession:async()=>({data:{session:{access_token:'fictional'}}}),
              getUser:async()=>({data:{user:{id:'user-1'}}})
            },
            from(table){
              return {select(){return this;},eq(){return this;},async maybeSingle(){
                return {data:table==='reports'?
                  {id:'report-123',organization_id:'org-1',workflow_restart_count:0,
                   reopen_count:0,status:'investigation',updated_at:revision}:
                  {id:'action-456',report_id:'report-123',organization_id:'org-1',
                   workflow_generation:0,status:'in_progress',updated_at:revision,
                   retired_at:null,activated_at:'2026-11-18T10:00:00Z'}};
              }};
            },
            functions:{invoke:async(_name,{body})=>{
              if(body.action==='capabilities')return {data:{ok:true,offlineProtocolVersion:1,
                reportId:scope.reportId,correctiveActionId:scope.actionId}};
              uploads++;operationIds.push(body.get('clientEvidenceId'));
              if(firstLost){firstLost=false;return {error:{message:'simulated-lost-response'}};}
              return {data:{ok:true,offlineProtocolVersion:1,clientEvidenceId:id,
                correctiveActionId:scope.actionId,
                added:[{id:'remote-attachment-123',correctiveActionId:scope.actionId}]}};
            }}
          };
          const identity={organizationId:'org-1',userId:'user-1'};
          let pending=false;
          try{await window.TeamWorktStaffEvidenceReplay.uploadOne({
              client,scope,evidenceId:id,identity,confirm:true
            });}
          catch(e){pending=String(e).includes('EVIDENCE_UPLOAD_PENDING_RETRY');}
          const retained=(await store.listEvidence(scope)).length===1;
          const savedAttempt=await store.readDraft({...scope,step:'evidence_attempt_'+id});
          const done=await window.TeamWorktStaffEvidenceReplay.uploadOne({
            client,scope,evidenceId:id,identity,confirm:true
          });
          const evidenceLeft=(await store.listEvidence(scope)).length;
          const attemptLeft=await store.readDraft({...scope,step:'evidence_attempt_'+id});
          return {pending,retained,durable:!!savedAttempt,uploads,
            sameId:operationIds[0]===id&&operationIds[1]===id,
            synced:done.status==='synced_to_rbh',evidenceLeft,attemptGone:attemptLeft===null};
        }""")
        self.assertEqual(result,{"pending":True,"retained":True,"durable":True,
          "uploads":2,"sameId":True,"synced":True,"evidenceLeft":0,
          "attemptGone":True})



    def test_multi_action_offline_plan_and_classification_survive_restart(self):
        self.enroll()
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.page.locator("#draftStep").select_option("action_plan")
        self.page.locator("#draftPlanDescription").fill("Fictional guarding update")
        self.page.locator("#draftPlanOwner").fill("Test owner A")
        self.page.locator("#addPlannedAction").click()
        self.page.locator("[data-planned-action-field=description]").fill("Fictional training")
        self.page.locator("[data-planned-action-field=owner]").fill("Test owner B")
        self.page.locator("#saveDraft").click()
        self.page.get_by_text("Saved on this device — NOT submitted to RBH.").wait_for()
        self.page.reload()
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.page.locator("#draftStep").select_option("action_plan")
        self.page.wait_for_function(
            "document.querySelectorAll('[data-planned-action-field=description]').length === 1"
        )
        self.assertEqual(self.page.locator("#draftPlanDescription").input_value(),
                         "Fictional guarding update")
        self.assertEqual(self.page.locator("[data-planned-action-field=description]").input_value(),
                         "Fictional training")
        planned=self.page.evaluate("""async()=>{
          const f=window.TeamWorktStaffOfflineFoundation;
          const d=await f.readDraft({organizationId:'org-1',userId:'user-1',
            reportId:'report-123',generation:0,step:'action_plan'});
          return d.data.fields.plannedActions;
        }""")
        self.assertEqual(len(planned),2)
        self.assertEqual(planned[1]["owner"],"Test owner B")
        self.page.locator("#draftStep").select_option("review")
        self.page.locator("#draftCategory").fill("Fictional near miss")
        self.page.locator("#draftSeverity").fill("Fictional medium")
        self.page.locator("#saveDraft").click()
        self.page.get_by_text("Saved on this device — NOT submitted to RBH.").wait_for()
        self.page.reload()
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.page.locator("#draftStep").select_option("review")
        self.page.wait_for_function(
            "document.querySelector('#draftCategory').value === 'Fictional near miss'"
        )
        self.assertEqual(self.page.locator("#draftSeverity").input_value(),
                         "Fictional medium")



    def test_assignment_draft_is_manager_only_and_survives_reload(self):
        self.enroll()
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.assertEqual(self.page.locator("#draftStep option[value=assignment]").count(),0)
        self.page.reload()
        self.page.evaluate("""async()=>{
          const f=window.TeamWorktStaffOfflineFoundation;
          f.unlock('long-demo-passphrase-2026');
          const scope={organizationId:'org-1',userId:'user-1',
            reportId:'workspace',generation:0,step:'workspace_index'};
          const item=await f.readDraft(scope);
          const data=item.data;data.role='safety_manager';
          data.records[0].role='safety_manager';data.records[0].canEditReport=true;
          await f.saveDraft(scope,data,item.serverRevision);
          f.lock();
        }""")
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.page.locator("#draftStep").select_option("assignment")
        self.page.locator("#draftReportOwner").fill("Fictional lead A")
        self.page.locator("#draftInvestigator").fill("Fictional investigator B")
        self.page.locator("#saveDraft").click()
        self.page.get_by_text("Saved on this device — NOT submitted to RBH.").wait_for()
        self.page.reload()
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.page.locator("#draftStep").select_option("assignment")
        self.page.wait_for_function(
            "document.querySelector('#draftReportOwner').value === 'Fictional lead A'"
        )
        self.assertEqual(self.page.locator("#draftInvestigator").input_value(),
                         "Fictional investigator B")



    def test_unenrolled_dashboard_uses_legacy_offline_page(self):
        self.page.evaluate("""async()=>{
          await navigator.serviceWorker.register('./sw.js',{scope:'./'});
          await navigator.serviceWorker.ready;
        }""")
        self.page.reload()
        self.page.wait_for_function("navigator.serviceWorker.controller !== null")
        DASHBOARD_NETWORK_BLOCKED.set()
        self.context.set_offline(True)
        self.page.goto(BASE+"/dashboard.html",wait_until="domcontentloaded")
        self.assertEqual(self.page.locator("#unlockForm").count(),0)
        self.assertNotIn("staff-offline-workspace.html",self.page.url)



    def test_offline_recovered_draft_copy_preserves_fields_for_online_handoff(self):
        self.enroll()
        self.unlock()
        self.page.locator("#workspacePanel").wait_for(state="visible")
        self.page.evaluate("""async()=>{
          const store=window.TeamWorktStaffOfflineFoundation;
          const scope={organizationId:'org-1',userId:'user-1',reportId:'report-123',
            generation:0,step:'investigation'};
          await store.saveDraft(scope,{
            note:'Human-review handoff required',
            fields:{draftFindings:'Fictional inspection findings',draftRootCause:'Fictional cause'}
          },'2026-11-18T12:00:00Z');
        }""")
        self.page.set_content(
            '<main><section class="profile-card-section"><span id="rbhPushStatus"></span>'
            '</section></main>'
        )
        self.page.add_script_tag(url=BASE+"/staff-offline-bootstrap.js")
        self.page.evaluate("""async()=>{
          Object.defineProperty(navigator,'clipboard',{configurable:true,
            value:{writeText:async text=>window.__copied=text}});
          const client={rpc:async()=>({data:{enabled:true,protocolVersion:1}})};
          await window.TeamWorktStaffOfflineUI.init({
            userId:'user-1',organizationId:'org-1',
            email:'offline-tester@example.invalid',role:'supervisor'
          },[{
            id:'report-123',organization_id:'org-1',ref_no:77,
            status:'investigation',updated_at:'2026-11-18T12:00:00Z',
            workflow_restart_count:0
          }],[],client);
        }""")
        self.page.locator("#rbhOfflineReview").click()
        self.page.get_by_text("Copy draft for online form").click()
        self.page.wait_for_function("typeof window.__copied === 'string'")
        copied=self.page.evaluate("window.__copied")
        self.assertIn("Fictional inspection findings",copied)
        self.assertIn("Fictional cause",copied)
        self.assertIn("Human-review handoff required",copied)


    def test_seamless_two_corrective_actions_save_without_password_and_retry(self):
        self.page.goto(BASE+"/staff-offline-seamless.html")
        self.page.evaluate("""async()=>{
          // init() normally runs in the authenticated dashboard, which owns this panel.
          // In this synthetic setup seed the dashboard host without altering the
          // actual offline-only shell's markup.
          document.body.insertAdjacentHTML('beforeend',
            '<div id="rbhSeamlessPanel" hidden><p id="rbhSeamlessStatus"></p></div>');
          const api=window.TeamWorktSeamlessOffline;
          const u={organizationId:'org-1',userId:'user-1',role:'supervisor'};
          const reports=[{id:'report-123',organization_id:'org-1',ref_no:77,
            job_site:'Fictional basement',status:'investigation',updated_at:'2026-11-18T12:00:00Z',
            workflow_restart_count:0,reopen_count:0}];
          const actions=[1,2].map(n=>({id:'action-'+n,report_id:'report-123',organization_id:'org-1',
            action_number:n,owner_user_id:'user-1',workflow_generation:0,
            status:'in_progress',description:'Fictional corrective action '+n,
            updated_at:'2026-11-18T12:00:00Z'}));
          Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
          const fake={rpc:async()=>({data:{enabled:true,protocolVersion:1}})};
          await api.init(u,reports,actions,fake);
        }""")
        self.page.reload()
        self.page.get_by_text("Corrective Action #1").wait_for()
        self.assertEqual(self.page.locator("#offlinePassphrase").count(),0)
        self.assertEqual(self.page.locator("article.card").count(),2)
        self.page.locator("article.card textarea").nth(0).fill("First basement repair completed")
        self.page.locator("article.card button.primary").nth(0).click()
        self.page.get_by_text("1 saved on device").wait_for()
        self.page.locator("article.card textarea").nth(1).fill("Second basement repair completed")
        self.page.locator("article.card button.primary").nth(1).click()
        self.page.get_by_text("2 saved on device").wait_for()
        prepared=self.page.evaluate("""async()=>{
          const api=window.TeamWorktSeamlessOffline,u=await api.offlineIdentity();
          const queued=await api.listEncrypted(u,'queue');
          const db=await new Promise((resolve,reject)=>{
            const r=indexedDB.open('rbh-seamless-offline-v1');
            r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
          });
          const key=await new Promise((resolve,reject)=>{
            const r=db.transaction('keys','readonly').objectStore('keys').get('rbh-seamless:org-1:user-1');
            r.onsuccess=()=>resolve(r.result?.key);r.onerror=()=>reject(r.error);
          });
          db.close();
          return {count:queued.length,distinct:new Set(queued.map(x=>x.operationId)).size,
            waiting:queued.every(x=>x.status==='waiting'),
            keyExtractable:key?.extractable};
        }""")
        self.assertEqual(prepared,{'count':2,'distinct':2,'waiting':True,'keyExtractable':False})
        # A reload must not lose either queue entry, and a lost HTTP reply
        # must retry the same UUID without a second logical database mutation.
        self.page.reload()
        self.page.get_by_text("2 saved on device").wait_for()
        results=self.page.evaluate("""async()=>{
          const api=window.TeamWorktSeamlessOffline,u=await api.offlineIdentity();
          const ss=await api.snapshot(u);
          Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});
          const seen=new Set(),rpcIds=[];let firstLost=false;
          const client={
            auth:{getUser:async()=>({data:{user:{id:u.userId}}})},
            async rpc(name,p){
              if(name==='rbh_staff_offline_status')return {data:{enabled:true,protocolVersion:1}};
              if(name!=='rbh_commit_offline_corrective_action')throw Error('UNEXPECTED_RPC');
              rpcIds.push(p.p_operation_id);
              const wasSeen=seen.has(p.p_operation_id);seen.add(p.p_operation_id);
              if(!firstLost){firstLost=true;return {error:{message:'SIMULATED_NETWORK_TIMEOUT'}};}
              return {data:{ok:true,committed:true,operationId:p.p_operation_id,
                actionId:p.p_action_id,kind:p.p_kind,reportId:'report-123'}};
            }
          };
          const reports=[{id:'report-123',organization_id:'org-1',ref_no:77,
            job_site:'Fictional basement',status:'investigation',updated_at:'2026-11-18T12:00:00Z',
            workflow_restart_count:0,reopen_count:0}];
          const actions=ss.map(a=>({id:a.id,report_id:a.reportId,organization_id:'org-1',
            action_number:a.number,owner_user_id:'user-1',workflow_generation:0,
            status:'in_progress',description:a.description,updated_at:a.actionRevision}));
          await api.init(u,reports,actions,client);
          for(let i=0;i<12;i++){
            await new Promise(resolve=>setTimeout(resolve,70));
            await api.flush();
            const states=await api.listEncrypted(u,'queue');
            if(states.every(x=>x.status==='synced'))break;
          }
          const states=await api.listEncrypted(u,'queue');
          return {count:states.length,synced:states.every(x=>x.status==='synced'),
            serverMutations:seen.size,retrySameId:rpcIds.length>=3&&rpcIds[0]===rpcIds[2]||
              rpcIds.length>=3&&rpcIds[0]===rpcIds[1]};
        }""")
        self.assertEqual(results['count'],2)
        self.assertTrue(results['synced'],results)
        self.assertEqual(results['serverMutations'],2)
        self.assertTrue(results['retrySameId'],results)


if __name__=='__main__':
    unittest.main()
