"""Headless Chromium acceptance tests for RBH's staged offline-only workspace.
These tests use fictional local records, never production Supabase accounts.
Run: python -m unittest discover -s tests -p 'test_staff_offline_browser.py'
"""
import base64
import functools
import http.server
import socketserver
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
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

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
        self.context.set_offline(True)
        self.page.goto(BASE+"/dashboard.html",wait_until="domcontentloaded")
        self.assertTrue(self.page.locator("#unlockForm").count(),
          "Offline navigation returned: "+self.page.url+" HTML="+self.page.content()[:1200])
        self.unlock()
        self.page.get_by_text("Report #77").first.click()
        self.page.locator("#draftStep").select_option("action_completion")
        self.assertEqual(self.page.locator("#draftNote").input_value(),"Fictional corrective work complete")
        self.page.evaluate("""async()=>{
          const names=(await caches.keys()).join(' ');
          const keys=await Promise.all((await caches.keys()).map(async name=>(await caches.open(name)).keys()));
          const urls=keys.flat().map(r=>r.url);
          if(urls.some(url=>url.includes('dashboard.html')))throw Error('CONFIDENTIAL_DASHBOARD_CACHED');
          if(urls.some(url=>url.includes('report-123')))throw Error('REPORT_IDENTIFIER_IN_CACHE');
        }""")

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
