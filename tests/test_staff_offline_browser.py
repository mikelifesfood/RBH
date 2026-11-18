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
        self.assertTrue(self.page.locator("#unlockForm").count(),
          "Offline navigation returned: "+self.page.url+" HTML="+self.page.content()[:1200])
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.page.locator("#draftStep").select_option("action_completion")
        self.page.wait_for_function("document.querySelector('#draftNote').value === 'Fictional corrective work complete'")
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

if __name__=='__main__':
    unittest.main()
