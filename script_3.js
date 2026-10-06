
(function(){
  "use strict";

  var SUPA_URL="https://owhkxguiavgxzwvbxevj.supabase.co";
  var SUPA_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93aGt4Z3VpYXZneHp3dmJ4ZXZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1Nzk4ODcsImV4cCI6MjEwNTE1NTg4N30.rBwR7sKelzzyTd6XpFrMIjg5W42TpEO_QefnOxzftrc";
  var sb=window.supabase.createClient(SUPA_URL, SUPA_KEY);

  var STATUS={ new:{l:"New",c:"st-new"}, under_review:{l:"Under review",c:"st-review"},
    assigned:{l:"Assigned",c:"st-assigned"}, corrective_action:{l:"Corrective action",c:"st-corrective"},
    closed:{l:"Closed",c:"st-closed"}, duplicate:{l:"Duplicate",c:"st-muted"}, no_action:{l:"Closed — no action",c:"st-muted"} };
  var STATUS_KEYS=["new","under_review","assigned","corrective_action","closed","duplicate","no_action"];

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function sevClass(s){ s=(s||"").toLowerCase();
    if(s.indexOf("critical")===0)return"sv-critical"; if(s.indexOf("serious")===0)return"sv-serious";
    if(s.indexOf("moderate")===0)return"sv-moderate"; return"sv-minor"; }
  function sevShort(s){ return (s||"").split(/[\s\u2014-]/)[0]; }
  function fmtDate(v){ if(!v)return""; try{return new Date(v).toLocaleString();}catch(e){return v;} }
  function statusOptions(sel){ return STATUS_KEYS.map(function(k){ return '<option value="'+k+'"'+(k===sel?" selected":"")+'>'+STATUS[k].l+'</option>'; }).join(""); }

  /* ---------- Viewer language + translation ---------- */
  var SUPPORTED_READING_LANGUAGES={en:"English",es:"Español"};
  var REPORT_REVIEW_LABELS={
    en:{description:"Description",hazard_category:"Hazard",potential_severity:"Potential severity",involves_injury:"Involves injury",people_involved:"Involved / witnesses",immediate_action:"Immediate action",suggested_fix:"Suggested fix",job_site:"Incident address",site_location:"Specific location",observed_at:"Observed at",reporter_name:"Reported by",reporter_role:"Role",reporter_contact:"Contact",language:"Form language",created_at:"Submitted"},
    es:{description:"Descripción",hazard_category:"Peligro",potential_severity:"Gravedad potencial",involves_injury:"Incluye lesión",people_involved:"Personas involucradas / testigos",immediate_action:"Acción inmediata",suggested_fix:"Solución sugerida",job_site:"Dirección del incidente",site_location:"Ubicación específica",observed_at:"Observado el",reporter_name:"Reportado por",reporter_role:"Función",reporter_contact:"Contacto",language:"Idioma del formulario",created_at:"Enviado"}
  };
  function normalizeLanguageCode(v){ return String(v||"").trim().toLowerCase().split("-")[0]||"en"; }
  function browserReadingLanguage(){ var v=normalizeLanguageCode((navigator.language||navigator.userLanguage||"en")); return SUPPORTED_READING_LANGUAGES[v]?v:"en"; }
  function preferredReadingLanguage(){ var p=String((currentProfile&&currentProfile.preferred_language)||"auto"); if(p==="auto"||!p) return browserReadingLanguage(); p=normalizeLanguageCode(p); return SUPPORTED_READING_LANGUAGES[p]?p:"en"; }
  function languageName(code,uiLang){ code=normalizeLanguageCode(code); uiLang=normalizeLanguageCode(uiLang||"en"); if(uiLang==="es") return code==="es"?"Español":code==="en"?"Inglés":code.toUpperCase(); return code==="es"?"Spanish":code==="en"?"English":code.toUpperCase(); }
  function reportLabel(field,lang){ var d=REPORT_REVIEW_LABELS[normalizeLanguageCode(lang)]||REPORT_REVIEW_LABELS.en; return d[field]||field; }
  function reportTranslationFields(r){
    var keys=["report_type","description","hazard_category","potential_severity","people_involved","immediate_action","suggested_fix","reporter_role","site_location","investigation_findings","root_cause","corrective_action","action_completion_note","action_verification_note"];
    var out={}; keys.forEach(function(k){ if(r&&r[k]!=null&&String(r[k]).trim()!=="") out[k]=String(r[k]); }); return out;
  }
  function translationFingerprint(fields){ return Object.keys(fields||{}).sort().map(function(k){return k+":"+String(fields[k]);}).join("\u241e"); }
  async function translateTextMap(fields,targetLanguage,cacheKey){
    targetLanguage=normalizeLanguageCode(targetLanguage); fields=fields||{};
    if(!Object.keys(fields).length) return {};
    var fp=translationFingerprint(fields), key=String(cacheKey||"generic")+"|"+targetLanguage;
    if(translationCache[key]&&translationCache[key].fingerprint===fp) return translationCache[key].data;
    if(!currentSession||!currentSession.access_token) return null;
    try{
      var resp=await fetch(SUPA_URL+"/functions/v1/translate-report",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},body:JSON.stringify({targetLanguage:targetLanguage,fields:fields})});
      if(!resp.ok) throw new Error("Translation service returned "+resp.status);
      var json=await resp.json(), data=json&&json.translations;
      if(!data||typeof data!=="object") throw new Error("Translation response was incomplete");
      translationCache[key]={fingerprint:fp,data:data}; return data;
    }catch(ex){ console.error("translation",ex); return null; }
  }
  async function translateReportForLanguage(r,targetLanguage){ targetLanguage=normalizeLanguageCode(targetLanguage); var fields=reportTranslationFields(r); if(targetLanguage==="en"&&normalizeLanguageCode(r&&r.language||"en")==="en") return fields; return translateTextMap(fields,targetLanguage,"report:"+String(r&&r.id||"")); }
  async function sendActionAssignmentEmail(r){
    if(!r||!r.assigned_user_id) return {ok:true,sent:false,skipped:true,reason:"NO_DASHBOARD_ASSIGNEE"};
    if(!currentSession||!currentSession.access_token) return {ok:false,sent:false,error:"AUTH_REQUIRED"};
    try{
      var resp=await fetch(SUPA_URL+"/functions/v1/send-action-assignment-email",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:JSON.stringify({reportId:String(r.id)})
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok) return {ok:false,sent:false,error:data.error||("HTTP_"+resp.status),detail:data.detail||""};
      return data||{ok:true,sent:false};
    }catch(ex){
      console.error("assignment email",ex);
      return {ok:false,sent:false,error:"NETWORK_ERROR",detail:(ex&&ex.message)||""};
    }
  }
  async function sendCorrectiveActionAssignmentEmail(r,action){
    if(!r||!action||!action.id) return {ok:false,sent:false,error:"ACTION_REQUIRED"};
    if(!action.owner_user_id) return {ok:true,sent:false,skipped:true,reason:"NO_DASHBOARD_ASSIGNEE",correctiveActionId:action.id,actionNumber:action.action_number};
    if(!currentSession||!currentSession.access_token) return {ok:false,sent:false,error:"AUTH_REQUIRED",correctiveActionId:action.id,actionNumber:action.action_number};
    try{
      var resp=await fetch(SUPA_URL+"/functions/v1/send-action-assignment-email",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:JSON.stringify({reportId:String(r.id),notificationType:"assignment",correctiveActionId:String(action.id)})
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok) return {ok:false,sent:false,error:data.error||("HTTP_"+resp.status),detail:data.detail||"",correctiveActionId:action.id,actionNumber:action.action_number};
      return data||{ok:true,sent:false,correctiveActionId:action.id,actionNumber:action.action_number};
    }catch(ex){
      console.error("multi-action assignment email",ex);
      return {ok:false,sent:false,error:"NETWORK_ERROR",detail:(ex&&ex.message)||"",correctiveActionId:action.id,actionNumber:action.action_number};
    }
  }

  async function sendCorrectiveActionWorkflowEmail(r,action,notificationType){
    if(!r||!action||!action.id) return {ok:false,sent:false,error:"ACTION_REQUIRED"};
    if(!currentSession||!currentSession.access_token) return {ok:false,sent:false,error:"AUTH_REQUIRED",correctiveActionId:action.id,actionNumber:action.action_number};
    try{
      var resp=await fetch(SUPA_URL+"/functions/v1/send-action-assignment-email",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:JSON.stringify({
          reportId:String(r.id),
          notificationType:String(notificationType||""),
          correctiveActionId:String(action.id)
        })
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok) return {
        ok:false,
        sent:false,
        error:data.error||("HTTP_"+resp.status),
        detail:data.detail||"",
        correctiveActionId:action.id,
        actionNumber:action.action_number
      };
      return data||{
        ok:true,
        sent:false,
        correctiveActionId:action.id,
        actionNumber:action.action_number
      };
    }catch(ex){
      console.error("corrective-action workflow email",notificationType,ex);
      return {
        ok:false,
        sent:false,
        error:"NETWORK_ERROR",
        detail:(ex&&ex.message)||"",
        correctiveActionId:action.id,
        actionNumber:action.action_number
      };
    }
  }
  function sendCorrectiveActionVerificationRequestedEmail(r,action){
    return sendCorrectiveActionWorkflowEmail(r,action,"verification_requested");
  }
  function sendCorrectiveActionVerifierAssignmentEmail(r,action){
    return sendCorrectiveActionWorkflowEmail(r,action,"verifier_assignment");
  }
  function sendCorrectiveActionChangesRequestedEmail(r,action){
    return sendCorrectiveActionWorkflowEmail(r,action,"changes_requested");
  }

  async function sendInvestigatorAssignmentEmail(r){
    if(!r||!r.investigator_user_id) return {ok:true,sent:false,skipped:true,reason:"NO_INVESTIGATOR"};
    if(!currentSession||!currentSession.access_token) return {ok:false,sent:false,error:"AUTH_REQUIRED"};
    try{
      var resp=await fetch(SUPA_URL+"/functions/v1/send-action-assignment-email",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:JSON.stringify({reportId:String(r.id),notificationType:"investigator_assignment"})
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok) return {ok:false,sent:false,error:data.error||("HTTP_"+resp.status),detail:data.detail||""};
      return data||{ok:true,sent:false};
    }catch(ex){
      console.error("investigator assignment email",ex);
      return {ok:false,sent:false,error:"NETWORK_ERROR",detail:(ex&&ex.message)||""};
    }
  }
  async function sendVerifierAssignmentEmail(r){
    if(!r||!r.verifier_user_id) return {ok:true,sent:false,skipped:true,reason:"NO_VERIFIER"};
    if(!currentSession||!currentSession.access_token) return {ok:false,sent:false,error:"AUTH_REQUIRED"};
    try{
      var resp=await fetch(SUPA_URL+"/functions/v1/send-action-assignment-email",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:JSON.stringify({reportId:String(r.id),notificationType:"verifier_assignment"})
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok) return {ok:false,sent:false,error:data.error||("HTTP_"+resp.status),detail:data.detail||""};
      return data||{ok:true,sent:false};
    }catch(ex){
      console.error("verifier assignment email",ex);
      return {ok:false,sent:false,error:"NETWORK_ERROR",detail:(ex&&ex.message)||""};
    }
  }
  async function sendActionChangesRequestedEmail(r){
    if(!r||!r.assigned_user_id) return {ok:true,sent:false,skipped:true,reason:"NO_DASHBOARD_ASSIGNEE"};
    if(!currentSession||!currentSession.access_token) return {ok:false,sent:false,error:"AUTH_REQUIRED"};
    try{
      var resp=await fetch(SUPA_URL+"/functions/v1/send-action-assignment-email",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:JSON.stringify({reportId:String(r.id),notificationType:"changes_requested"})
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok) return {ok:false,sent:false,error:data.error||("HTTP_"+resp.status),detail:data.detail||""};
      return data||{ok:true,sent:false};
    }catch(ex){
      console.error("changes-requested email",ex);
      return {ok:false,sent:false,error:"NETWORK_ERROR",detail:(ex&&ex.message)||""};
    }
  }
  async function sendActionVerificationRequestedEmail(r){
    if(!r) return {ok:false,sent:false,error:"REPORT_REQUIRED"};
    if(!currentSession||!currentSession.access_token) return {ok:false,sent:false,error:"AUTH_REQUIRED"};
    try{
      var resp=await fetch(SUPA_URL+"/functions/v1/send-action-assignment-email",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:JSON.stringify({reportId:String(r.id),notificationType:"verification_requested"})
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok) return {ok:false,sent:false,error:data.error||("HTTP_"+resp.status),detail:data.detail||""};
      return data||{ok:true,sent:false};
    }catch(ex){
      console.error("verification-request email",ex);
      return {ok:false,sent:false,error:"NETWORK_ERROR",detail:(ex&&ex.message)||""};
    }
  }
  function reviewValue(r,field,lang,tx){
    lang=normalizeLanguageCode(lang); tx=tx||{};
    if(field==="involves_injury") return r.involves_injury?(lang==="es"?"Sí":"Yes"):(lang==="es"?"No":"No");
    if(field==="reporter_name") return r.reporter_name||(lang==="es"?"Anónimo":"Anonymous");
    if(field==="language") return languageName(r.language||"en",lang);
    if(field==="created_at") return fmtDate(r.created_at);
    if(field==="observed_at") return r.observed_at?fmtDate(r.observed_at):"";
    if(Object.prototype.hasOwnProperty.call(tx,field)) return tx[field];
    return r[field];
  }
  function setIncidentLanguageState(r,lang,state){
    var el=$("incidentLanguageState"); if(!el) return; lang=normalizeLanguageCode(lang);
    el.className="incident-language-state"+(state==="loading"?" loading":"");
    if(state==="loading") el.textContent=(lang==="es"?"Traduciendo…":"Translating…");
    else if(state==="error") el.textContent=(lang==="es"?"No se pudo traducir; se muestra el texto original.":"Translation unavailable; showing original text.");
    else el.textContent=(lang==="es"?"Original: ":"Original: ")+languageName(r&&r.language||"en",lang)+(lang==="es"?" · Vista: ":" · Viewing: ")+languageName(lang,lang);
  }
  function applyReportLanguageToOpenIncident(r,lang,tx){
    if(!r||!$("incidentBody")) return; lang=normalizeLanguageCode(lang); tx=tx||{};
    var summary=$("incidentSummary"); if(summary){ var d=summary.querySelector(".is-desc"); if(d) d.textContent=reviewValue(r,"description",lang,tx)|| (lang==="es"?"No se proporcionó una descripción.":"No description provided."); }
    var title=$("incidentTitle"); if(title) title.textContent="#"+(r.ref_no||r.id)+" · "+(Object.prototype.hasOwnProperty.call(tx,"report_type")?tx.report_type:(r.report_type||"Safety report"));
    $("incidentBody").querySelectorAll("[data-report-field]").forEach(function(row){ var f=row.getAttribute("data-report-field"), lab=row.querySelector(".d-label"), val=row.querySelector(".d-val"); if(lab) lab.textContent=reportLabel(f,lang); if(val) val.textContent=reviewValue(r,f,lang,tx)||""; });
    $("incidentBody").querySelectorAll("[data-translation-field]").forEach(function(el){ var f=el.getAttribute("data-translation-field"), translated=Object.prototype.hasOwnProperty.call(tx,f)?String(tx[f]||""):"", original=String(r[f]||""); if(!translated||translated===original){ el.hidden=true; el.innerHTML=""; return; } el.hidden=false; el.innerHTML='<b>'+(lang==="es"?"Vista traducida":"Translated view")+'</b><p>'+esc(translated)+'</p>'; });
    setIncidentLanguageState(r,lang,"ready");
  }
  async function refreshCorrectiveActionTranslations(r,detail,state){
    if(!r||!detail||!state||!state.loaded) return;
    var cards=detail.querySelectorAll("[data-action-card]");
    if(!cards.length) return;
    var lang=normalizeLanguageCode(activeIncidentLanguage||preferredReadingLanguage());
    var originalLang=normalizeLanguageCode(r.language||"en");
    if(lang===originalLang){ cards.forEach(function(card){var el=card.querySelector("[data-action-translation]");if(el){el.hidden=true;el.innerHTML="";}}); return; }
    var fields={};
    state.actions.forEach(function(a,idx){var text=String(a.description||"").trim();if(text)fields["action_"+idx]=text;});
    if(!Object.keys(fields).length) return;
    var token=++state.translationToken;
    var tx=await translateTextMap(fields,lang,"corrective-actions:"+String(r.id)+":"+String(r.workflow_restart_count||0));
    if(token!==state.translationToken||activeIncident!==r||!detail.isConnected) return;
    cards.forEach(function(card,idx){
      var el=card.querySelector("[data-action-translation]"); if(!el) return;
      var original=String((state.actions[idx]&&state.actions[idx].description)||"").trim(), translated=tx&&String(tx["action_"+idx]||"").trim();
      if(!translated||translated===original){el.hidden=true;el.innerHTML="";return;}
      el.hidden=false;el.innerHTML='<b>'+(lang==="es"?"Vista traducida":"Translated view")+'</b><p>'+esc(translated)+'</p>';
    });
  }

  async function changeIncidentLanguage(r,lang){
    if(!r) return; activeIncidentLanguage=normalizeLanguageCode(lang); var sel=$("incidentLanguage"); if(sel) sel.value=activeIncidentLanguage;
    setIncidentLanguageState(r,activeIncidentLanguage,"loading");
    var tx=await translateReportForLanguage(r,activeIncidentLanguage);
    if(activeIncident!==r) return;
    if(!tx){ applyReportLanguageToOpenIncident(r,activeIncidentLanguage,{}); setIncidentLanguageState(r,activeIncidentLanguage,"error"); var d0=$("incidentBody"); if(d0&&d0._correctivePlanState) await refreshCorrectiveActionTranslations(r,d0,d0._correctivePlanState); return; }
    applyReportLanguageToOpenIncident(r,activeIncidentLanguage,tx);
    var d1=$("incidentBody"); if(d1&&d1._correctivePlanState) await refreshCorrectiveActionTranslations(r,d1,d1._correctivePlanState);
  }

  var $=function(id){return document.getElementById(id);};
  var loginView=$("loginView"), appView=$("appView"), listEl=$("list"), backdrop=$("backdrop");
  var allReports=[], allCorrectiveActions=[], filtered=[], attByReport={}, actionEvidenceUploads={}, investigationEvidenceUploads={};
  var allProfiles=[], profileById={}, currentSession=null, currentProfile=null, currentRole="read_only";
  var userNotifications=[], notificationActiveCount=0, notificationPollTimer=null, notificationLoading=false;
  var allOrgs=[], currentOrgId=null, currentOrgName="", isPlatformAdmin=false;
  var activeIncident=null, activeIncidentLanguage="en", translationCache={};
  var modalReport=null, modalCard=null, modalNotesEl=null;
  var dispositionReport=null, dispositionWrap=null, dispositionNotesEl=null;
  var reopenReport=null, reopenReturnView="records", restartReport=null, restartReturnView="records";
  var NAV_VIEW_KEY="rbh_safety_active_view_v1", NAV_INCIDENT_KEY="rbh_safety_active_incident_v1";
  var APP_VERSION="2026.09.28 · Corrective Action Status Pills V1";

  function storedView(){
    try{ var v=localStorage.getItem(NAV_VIEW_KEY); return v||(currentRole==="supervisor"?"mywork":"home"); }catch(_e){ return currentRole==="supervisor"?"mywork":"home"; }
  }
  function storeView(name){
    try{
      localStorage.setItem(NAV_VIEW_KEY,name);
      if(name!=="incident") localStorage.removeItem(NAV_INCIDENT_KEY);
    }catch(_e){}
  }
  function storeIncident(r,from){
    try{ localStorage.setItem(NAV_INCIDENT_KEY,JSON.stringify({id:r&&r.id,from:from||"records"})); }catch(_e){}
  }
  function requestedReportIdFromUrl(){
    try{ return new URLSearchParams(window.location.search||"").get("report")||""; }catch(_e){ return ""; }
  }
  function clearRequestedReportFromUrl(){
    try{
      var u=new URL(window.location.href); u.searchParams.delete("report");
      window.history.replaceState({},document.title,u.pathname+(u.search?u.search:"")+(u.hash||""));
    }catch(_e){}
  }
  function restoreSavedView(){
    var directReportId=requestedReportIdFromUrl();
    if(directReportId){
      var directReport=allReports.find(function(x){ return String(x.id)===String(directReportId); });
      clearRequestedReportFromUrl();
      if(directReport){ openIncident(directReport,"mywork"); return; }
      toast("That assigned record is unavailable or you no longer have access to it.","err");
    }
    var name=storedView();
    var allowed=["home","mywork","records","actions","metrics","platform","users","incident"];
    if(allowed.indexOf(name)<0) name="home";
    if(name==="users" && currentRole!=="admin") name="home";
    if(name==="platform" && !isPlatformAdmin) name="home";
    if(name==="incident") {
      try{
        var saved=JSON.parse(localStorage.getItem(NAV_INCIDENT_KEY)||"null");
        var r=saved&&allReports.find(function(x){ return String(x.id)===String(saved.id); });
        if(r){ openIncident(r,(saved&&saved.from)||"records"); return; }
      }catch(_e){}
      name="records";
    }
    showView(name);
  }

  $("mStatus").innerHTML=statusOptions("new");

  /* ---------- auth ---------- */
  function showLogin(){ stopNotificationPolling(); closeNotificationPanel(); userNotifications=[]; notificationActiveCount=0; renderNotificationCenter(); appView.style.display="none"; loginView.style.display="flex"; currentSession=null; currentProfile=null; currentRole="read_only"; isPlatformAdmin=false; currentOrgId=null; currentOrgName=""; allOrgs=[]; if(typeof closeProfileDrawer==="function") closeProfileDrawer(); }
  async function showApp(session){
    currentSession=session;
    if(setupPasswordModeRequested()){ showPasswordSetup(); return; }
    loginView.style.display="none"; appView.style.display="block";
    $("who").textContent=(session&&session.user&&session.user.email)||"";
    await upsertProfile(session);
    try{
      var activeCheck=await sb.rpc("rbh_current_user_active");
      if(!activeCheck.error && activeCheck.data===false){
        await sb.auth.signOut();
        var le=$("loginErr"); if(le){ le.textContent="Your RBH Safety dashboard access is inactive. Contact an administrator."; le.classList.add("show"); }
        return;
      }
    }catch(_e){}
    await loadProfiles();
    await loadPlatformContext();
    applyRoleUi();
    await loadReports();
    await loadNotifications(true);
    startNotificationPolling();
    restoreSavedView();
  }
  sb.auth.getSession().then(function(res){ var s=res.data&&res.data.session; if(s) showApp(s); else showLogin(); });
  sb.auth.onAuthStateChange(function(_e,s){
    if(!s){ showLogin(); return; }
    var sameUser=currentSession&&currentSession.user&&s.user&&String(currentSession.user.id)===String(s.user.id);
    if(sameUser && appView.style.display==="block"){
      currentSession=s;
      $("who").textContent=(s.user&&s.user.email)||"";
      return;
    }
    showApp(s);
  });

  $("loginForm").addEventListener("submit", async function(e){
    e.preventDefault(); var err=$("loginErr"); err.classList.remove("show");
    var btn=$("loginBtn"); btn.disabled=true; btn.textContent="Signing in…";
    try{ var r=await sb.auth.signInWithPassword({ email:$("email").value.trim(), password:$("password").value }); if(r.error) throw r.error; }
    catch(ex){ err.textContent="Incorrect email or password."; err.classList.add("show"); }
    finally{ btn.disabled=false; btn.textContent="Sign in"; }
  });
  var _signout=$("signout"); if(_signout) _signout.addEventListener("click", async function(){ await sb.auth.signOut(); });

  /* ---------- data ---------- */
  async function loadReports(){
    listEl.innerHTML='<div class="state">Loading reports…</div>';
    try{
      var repQ=sb.from("reports").select("*").order("created_at",{ascending:false});
      if(currentOrgId) repQ=repQ.eq("organization_id", currentOrgId);
      var rep=await repQ;
      if(rep.error) throw rep.error;
      allReports=rep.data||[];

      var caQ=sb.from("report_corrective_actions")
        .select("id,report_id,organization_id,workflow_generation,action_number,description,control_type,owner_user_id,due_date,priority,status,completion_note,completed_at,completed_by,verifier_user_id,verification_note,verified_at,verified_by,activated_at,activation_reopen_count,retired_at,created_at,updated_at")
        .is("retired_at",null);
      if(currentOrgId) caQ=caQ.eq("organization_id", currentOrgId);
      var ca=await caQ;
      if(ca.error) throw ca.error;
      allCorrectiveActions=ca.data||[];

      var atQ=sb.from("report_attachments").select("*");
      if(currentOrgId) atQ=atQ.eq("organization_id", currentOrgId);
      var at=await atQ;
      if(at.error) throw at.error;
      // Build attachment state locally, then replace it in one step. This prevents
      // overlapping report refreshes/auth events from pushing the same row twice
      // into the shared in-memory attachment map.
      var nextAttByReport={};
      (at.data||[]).forEach(function(a){
        var arr=nextAttByReport[a.report_id]=nextAttByReport[a.report_id]||[];
        var key=String(a.id||a.storage_path||"");
        var exists=arr.some(function(x){ return String(x.id||x.storage_path||"")===key; });
        if(!exists) arr.push(a);
      });
      attByReport=nextAttByReport;
      applyFilters(); renderMetrics(); renderHomeSnapshot(); renderMyWork(); renderActions();
    }catch(ex){ console.error(ex); listEl.innerHTML='<div class="state">Couldn\'t load reports. Please refresh.</div>'; }
  }
  $("refresh").addEventListener("click", async function(){ await loadReports(); await loadNotifications(true); });
  $("search").addEventListener("input", applyFilters);
  $("statusFilter").addEventListener("change", function(){ overdueOnly=false; injuryOnly=false; var v=$("statusFilter").value; setActiveChip(v==="all"||v==="open"||v==="new"?v:""); applyFilters(); });

  /* ---------- Step 12B: attention-only notification panel ---------- */
  function notificationTime(v){
    if(!v) return "";
    try{
      var ms=Date.now()-new Date(v).getTime();
      if(!Number.isFinite(ms)) return "";
      var min=Math.max(0,Math.floor(ms/60000));
      if(min<1) return "now";
      if(min<60) return min+"m";
      var hr=Math.floor(min/60); if(hr<24) return hr+"h";
      var day=Math.floor(hr/24); if(day<7) return day+"d";
      return new Date(v).toLocaleDateString();
    }catch(_e){ return ""; }
  }
  function notificationState(n){
    if(n&&n.resolved_at) return "resolved";
    if(n&&n.acknowledged_at) return "acknowledged";
    if(n&&n.viewed_at) return "viewed";
    return "new";
  }
  function notificationResolutionLabel(v){
    var map={
      review_started:"Review started",
      investigator_reassigned:"Investigator reassigned",
      investigation_handed_off:"Investigation handed off",
      action_owner_reassigned:"Action owner reassigned",
      verification_owner_changed:"Verification owner changed",
      action_submitted:"Action submitted",
      changes_resubmitted:"Changes resubmitted",
      verification_completed_or_returned:"Verification completed or returned",
      report_resolved:"Report resolved"
    };
    return map[String(v||"")]||"";
  }
  function notificationHistoryMeta(n){
    var bits=[];
    if(n&&n.acknowledged_at) bits.push("Acknowledged by you "+notificationTime(n.acknowledged_at));
    if(n&&n.resolved_at){
      var why=notificationResolutionLabel(n.resolution_reason);
      bits.push((why?why+" · ":"Resolved ")+notificationTime(n.resolved_at));
    }
    return bits.join(" · ");
  }
  function buildNotificationItem(n){
    var state=notificationState(n);
    var item=document.createElement("div");
    item.className="notification-item "+state;
    item.setAttribute("data-notification-id",String(n.id));

    var open=document.createElement("button");
    open.type="button";
    open.className="notification-open";
    open.setAttribute("aria-label",(n.title||"Notification")+". Open report.");
    open.innerHTML='<span class="notification-dot" aria-hidden="true"></span><span class="notification-item-copy"><span class="notification-item-title">'+esc(n.title||"Notification")+'</span><span class="notification-item-message">'+esc(n.message||"")+'</span></span><span class="notification-item-time">'+esc(notificationTime(n.created_at))+'</span>';
    open.addEventListener("click",function(){ openNotificationItem(n); });
    item.appendChild(open);

    var foot=document.createElement("div");
    foot.className="notification-item-foot";
    var left=document.createElement("div");
    left.className="notification-item-meta";

    var pill=document.createElement("span");
    pill.className="notification-state-pill "+state;
    pill.textContent=state==="new"?"New":state==="viewed"?"Viewed":state==="acknowledged"?"Acknowledged":"Resolved";
    left.appendChild(pill);

    var historyText=notificationHistoryMeta(n);
    if(historyText){
      var detail=document.createElement("span");
      detail.textContent=" · "+historyText;
      left.appendChild(detail);
    }
    foot.appendChild(left);

    if(!n.acknowledged_at&&!n.resolved_at){
      var ack=document.createElement("button");
      ack.type="button";
      ack.className="notification-ack";
      ack.textContent="Acknowledge";
      ack.setAttribute("aria-label","Acknowledge "+(n.title||"notification"));
      ack.addEventListener("click",function(e){ e.stopPropagation(); acknowledgeNotification(n,ack); });
      foot.appendChild(ack);
    }
    item.appendChild(foot);
    return item;
  }
  function appendNotificationSection(list,title,items){
    if(!items.length) return;
    var section=document.createElement("section");
    section.className="notification-section";
    var head=document.createElement("div");
    head.className="notification-section-head";
    head.innerHTML='<span>'+esc(title)+'</span><span class="notification-section-count">'+items.length+'</span>';
    section.appendChild(head);
    items.forEach(function(n){ section.appendChild(buildNotificationItem(n)); });
    list.appendChild(section);
  }
  function renderNotificationCenter(){
    var badge=$("notificationBadge"), countEl=$("notificationActiveCount"), list=$("notificationList"), bell=$("notificationBell");
    var count=Number(notificationActiveCount||0);
    if(badge){ badge.textContent=count>99?"99+":String(count); badge.classList.toggle("show",count>0); }
    if(countEl) countEl.textContent=count+" to acknowledge";
    if(bell) bell.setAttribute("aria-label",count?(`Notifications, ${count} unacknowledged`):"Notifications, none unacknowledged");
    if(!list) return;
    if(notificationLoading&&!userNotifications.length){ list.innerHTML='<div class="notification-empty">Loading notifications…</div>'; return; }
    if(!userNotifications.length){ list.innerHTML='<div class="notification-empty">No notifications need attention.</div>'; return; }

    list.innerHTML="";
    appendNotificationSection(list,"Needs attention",userNotifications);
  }
  async function loadNotifications(silent){
    if(!currentSession||!currentSession.user||notificationLoading) return;
    notificationLoading=true;
    if(!silent) renderNotificationCenter();
    try{
      var countQuery=sb.from("report_user_notifications")
        .select("id",{count:"exact",head:true})
        .is("acknowledged_at",null)
        .is("resolved_at",null);
      var attentionQuery=sb.from("report_user_notifications")
        .select("id,organization_id,recipient_user_id,report_id,notification_type,title,message,created_at,viewed_at,acknowledged_at,acknowledged_by_user_id,resolved_at,resolution_reason")
        .is("acknowledged_at",null)
        .is("resolved_at",null)
        .order("created_at",{ascending:false})
        .limit(100);
      var results=await Promise.all([countQuery,attentionQuery]);
      if(results[0].error) throw results[0].error;
      if(results[1].error) throw results[1].error;
      notificationActiveCount=typeof results[0].count==="number"?results[0].count:0;
      userNotifications=results[1].data||[];
    }catch(ex){
      console.error("notification load",ex);
      if(!silent&&$("notificationList")) $("notificationList").innerHTML='<div class="notification-empty">Could not load notifications.</div>';
    }finally{
      notificationLoading=false; renderNotificationCenter();
    }
  }
  async function acknowledgeNotification(n,button){
    if(!n||n.acknowledged_at||n.resolved_at) return;
    if(button){ button.disabled=true; button.textContent="Saving…"; }
    try{
      var ar=await sb.rpc("rbh_acknowledge_notification",{p_notification_id:n.id});
      if(ar.error) throw ar.error;
      if(ar.data!==true){
        await loadNotifications(true);
        toast("This notification is no longer active.","ok");
        return;
      }
      n.acknowledged_at=new Date().toISOString();
      n.acknowledged_by_user_id=currentSession&&currentSession.user?currentSession.user.id:null;
      notificationActiveCount=Math.max(0,Number(notificationActiveCount||0)-1);
      renderNotificationCenter();
      await loadNotifications(true);
      toast("Notification acknowledged.","ok");
    }catch(ex){
      console.error("notification acknowledge",ex);
      renderNotificationCenter();
      toast("Could not acknowledge this notification. Please try again.","err");
    }
  }
  function notificationReturnView(){
    var names=["home","mywork","records","actions","metrics","platform","users"];
    for(var i=0;i<names.length;i++){ var el=$("view-"+names[i]); if(el&&!el.hidden) return names[i]; }
    return currentRole==="read_only"?"records":"mywork";
  }
  async function openNotificationItem(n){
    if(!n) return;
    if(!n.viewed_at){
      try{
        var vr=await sb.rpc("rbh_mark_notification_viewed",{p_notification_id:n.id});
        if(vr.error) throw vr.error;
        n.viewed_at=new Date().toISOString(); renderNotificationCenter();
      }catch(ex){ console.error("notification viewed",ex); }
    }
    closeNotificationPanel();
    var r=allReports.find(function(x){ return String(x.id)===String(n.report_id); });
    if(!r){
      await loadReports();
      r=allReports.find(function(x){ return String(x.id)===String(n.report_id); });
    }
    if(r) openIncident(r,notificationReturnView());
    else toast("That report is unavailable or you no longer have access to it.","err");
  }
  function openNotificationPanel(){
    var p=$("notificationPanel"), b=$("notificationBell"); if(!p||!b) return;
    p.hidden=false; b.setAttribute("aria-expanded","true");
    loadNotifications(true);
  }
  function closeNotificationPanel(){
    var p=$("notificationPanel"), b=$("notificationBell"); if(p)p.hidden=true; if(b)b.setAttribute("aria-expanded","false");
  }
  function toggleNotificationPanel(){
    var p=$("notificationPanel"); if(!p)return; if(p.hidden)openNotificationPanel(); else closeNotificationPanel();
  }
  function startNotificationPolling(){
    stopNotificationPolling();
    notificationPollTimer=setInterval(function(){ if(document.visibilityState!=="hidden") loadNotifications(true); },30000);
  }
  function stopNotificationPolling(){ if(notificationPollTimer){clearInterval(notificationPollTimer);notificationPollTimer=null;} }
  var notificationBell=$("notificationBell"); if(notificationBell) notificationBell.addEventListener("click",function(e){e.stopPropagation();toggleNotificationPanel();});
  var notificationPanel=$("notificationPanel"); if(notificationPanel) notificationPanel.addEventListener("click",function(e){e.stopPropagation();});
  document.addEventListener("click",function(){closeNotificationPanel();});
  document.addEventListener("keydown",function(e){if(e.key==="Escape")closeNotificationPanel();});
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"&&currentSession)loadNotifications(true);});

  function applyFilters(){
    var q=($("search").value||"").toLowerCase().trim(), st=$("statusFilter").value;
    filtered=allReports.filter(function(r){
      if(overdueOnly && !isOverdue(r)) return false;
      if(injuryOnly && !r.involves_injury) return false;
      if(st==="open"){ if(r.status==="closed"||r.status==="no_action"||r.status==="duplicate") return false; }
      else if(st!=="all" && r.status!==st) return false;
      if(q){ var hay=[r.ref_no,r.report_type,r.description,r.hazard_category,r.reporter_name,r.people_involved,r.potential_severity,r.reporter_role,r.responsible_person,assigneeName(r),r.action_status,r.job_site]
        .map(function(x){return String(x==null?"":x).toLowerCase();}).join(" "); if(hay.indexOf(q)<0) return false; }
      return true;
    });
    var sv=$("sortBy")?$("sortBy").value:"newest";
    filtered.sort(function(a,b){
      if(sv==="oldest") return new Date(a.created_at)-new Date(b.created_at);
      if(sv==="priority"){ var pv={high:3,medium:2,low:1}; return (pv[b.priority]||0)-(pv[a.priority]||0) || (new Date(b.created_at)-new Date(a.created_at)); }
      if(sv==="due"){ var ad=a.due_date?new Date(a.due_date).getTime():8640000000000000, bd=b.due_date?new Date(b.due_date).getTime():8640000000000000; return ad-bd; }
      return new Date(b.created_at)-new Date(a.created_at);
    });
    renderList();
  }
  function renderList(){
    $("count").textContent=filtered.length+(filtered.length===1?" report":" reports");
    if(!filtered.length){ listEl.innerHTML='<div class="state">'+(allReports.length?"No reports match your filters.":"No reports yet.")+'</div>'; return; }
    listEl.innerHTML=""; filtered.forEach(function(r){ listEl.appendChild(card(r)); });
  }

  function card(r){
    var st=STATUS[r.status]||{l:r.status||"",c:"st-muted"};
    var sev=r.potential_severity?('<span class="badge sev '+sevClass(r.potential_severity)+'" title="Potential severity">'+esc(sevShort(r.potential_severity))+'</span>'):"";
    var resolved=(r.status==="closed"||r.status==="no_action"||r.status==="duplicate");
    var inboxStateClass=resolved
      ?" inbox-closed"
      :(r.involves_injury
        ?" inbox-injury"
        :(isOverdue(r)?" inbox-overdue":" inbox-active"));
    var wrap=document.createElement("div");
    wrap.className="card"+(resolved?" resolved":"")+inboxStateClass;
    wrap.setAttribute('data-report-id',r.id);
    var meta=[fmtDate(r.created_at),(r.reporter_name||"Anonymous")]; if(r.hazard_category) meta.push(r.hazard_category); if(investigatorName(r)) meta.push("Investigator: "+investigatorName(r)); if(assigneeName(r)) meta.push("Action owner: "+assigneeName(r)); if(r.due_date) meta.push((isOverdue(r)?"Overdue \u2014 due ":"Due ")+shortDate(r.due_date));
    var pri=r.priority?('<span class="badge pr-'+r.priority+'" title="Priority">'+({low:"Low priority",medium:"Medium priority",high:"High priority"}[r.priority]||r.priority)+'</span>'):"";
    wrap.innerHTML=
      '<button class="card-head" type="button">'+
        '<div class="ch-top"><span class="ref">#'+esc(r.ref_no)+'</span><span class="ch-type">'+esc(r.report_type||"Report")+'</span>'+sev+'</div>'+
        '<div class="ch-badges">'+(isOverdue(r)?'<span class="badge bg-overdue" data-overdue-badge>Overdue</span>':"")+(r.involves_injury?'<span class="badge bg-injury">Injury</span>':"")+pri+actionBadgeHtml(r)+'<span class="badge '+st.c+'" data-status-badge title="Status">'+esc(st.l)+'</span></div>'+
        '<div class="ch-meta">'+esc(meta.join("  \u00b7  "))+'</div>'+
        '<div class="ch-desc">'+esc(r.description||"")+'</div>'+
        '<span class="open-report">Open →</span>'+
      '</button><div class="card-detail" hidden></div>';
    var head=wrap.querySelector(".card-head");
    head.addEventListener("click", function(){ openIncident(r); });
    return wrap;
  }

  function assignmentOptions(selected){
    var opts=['<option value="">Unassigned</option>'];
    allProfiles.filter(function(p){ return p.is_active!==false && p.app_role!=="read_only"; })
      .sort(function(a,b){ return profileName(a).localeCompare(profileName(b)); })
      .forEach(function(p){
        opts.push('<option value="'+esc(p.id)+'"'+(String(p.id)===String(selected||"")?' selected':'')+'>'+esc(profileName(p))+' · '+esc(roleLabel(p.app_role))+'</option>');
      });
    return opts.join("");
  }
  function investigatorOptions(selected){ return assignmentOptions(selected); }
  function verifierOptions(selected){
    var opts=['<option value="">Unassigned — any Admin / Safety Manager can verify</option>'];
    allProfiles.filter(function(p){ return p.is_active!==false && (p.app_role==="admin"||p.app_role==="safety_manager"); })
      .sort(function(a,b){ return profileName(a).localeCompare(profileName(b)); })
      .forEach(function(p){
        opts.push('<option value="'+esc(p.id)+'"'+(String(p.id)===String(selected||"")?' selected':'')+'>'+esc(profileName(p))+' · '+esc(roleLabel(p.app_role))+'</option>');
      });
    return opts.join("");
  }

  var CALOSHA_SCREEN_LABELS={pending:"Pending - follow-up required",yes:"Yes - possible §342 event",no:"No - criteria not currently identified"};
  function caloshaScreenLabel(v){ return CALOSHA_SCREEN_LABELS[v]||"Not screened"; }
  function caloshaScreenComplete(r){
    if(!r||!r.involves_injury) return true;
    var s=String(r.calosha_screening_status||"");
    if(["pending","yes","no"].indexOf(s)<0) return false;
    if((s==="pending"||s==="yes")&&!r.calosha_awareness_at) return false;
    return true;
  }
  function localDateTimeValue(v){
    if(!v) return "";
    var d=new Date(v); if(isNaN(d.getTime())) return "";
    function z(n){return String(n).padStart(2,"0");}
    return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"T"+z(d.getHours())+":"+z(d.getMinutes());
  }
  function regulatoryReviewHtml(r){
    if(!r||!r.involves_injury) return "";
    var st=String(r.calosha_screening_status||"");
    var chipClass=st?st:"unset";
    var chipText=caloshaScreenLabel(st);
    return '<div class="reg-review" data-regulatory-review>'+
      '<div class="reg-review-head"><div><b>Cal/OSHA serious-event screening</b><p>Management screening only. This does not submit a report to Cal/OSHA or replace a legal determination.</p></div><span class="reg-chip reg-chip-'+esc(chipClass)+'" data-reg-chip>'+esc(chipText)+'</span></div>'+
      '<div class="reg-review-grid">'+
        '<label class="inv-l">Screening result<select class="reg-status"><option value="">— Select result —</option><option value="pending"'+(st==="pending"?' selected':'')+'>Pending — more information needed</option><option value="yes"'+(st==="yes"?' selected':'')+'>Yes — possible §342 serious event; escalate now</option><option value="no"'+(st==="no"?' selected':'')+'>No — serious-event criteria not currently identified</option></select></label>'+
        '<label class="inv-l">When RBH first knew of the potentially serious outcome<input type="datetime-local" class="reg-awareness" value="'+esc(localDateTimeValue(r.calosha_awareness_at))+'"></label>'+
      '</div>'+
      '<div class="reg-review-help">For a Yes or Pending result, record the time RBH first knew, or with diligent inquiry would have known, of the potentially serious outcome. Do not delay required reporting while completing this screen.</div>'+
      '<div class="reg-review-state" data-reg-state></div>'+
      '<div class="reg-elapsed" data-reg-elapsed role="status" aria-live="polite"></div>'+
      '<div class="reg-required" data-reg-required></div>'+
      '<div class="reg-review-actions"><button class="reg-save" type="button">Save regulatory review</button><span class="reg-saved" hidden>Saved ✓</span><a class="calosha-link" href="https://www.dir.ca.gov/dosh/report-accident-or-injury.html" target="_blank" rel="noopener">Official Cal/OSHA reporting instructions ↗</a></div>'+
    '</div>';
  }
  function elapsedAwarenessText(ms){
    if(!isFinite(ms) || ms < 0) return "";
    var totalMin=Math.floor(ms/60000), days=Math.floor(totalMin/1440), hours=Math.floor((totalMin%1440)/60), mins=totalMin%60;
    var parts=[];
    if(days) parts.push(days+" day"+(days===1?"":"s"));
    if(hours || days) parts.push(hours+" hr");
    parts.push(mins+" min");
    return parts.join(" ");
  }
  function persistentRegulatoryBannerHtml(r,viewingStep){
    if(!r || !r.involves_injury) return "";
    var status=String(r.calosha_screening_status||"");
    if(status!=="pending" && status!=="yes") return "";
    var cls=status==="yes"?"urgent":"";
    var title=status==="yes"?"Cal/OSHA review active":"Cal/OSHA follow-up active";
    var timing="RBH awareness time is required.";
    var message=status==="yes"?"Escalate immediately; do not wait for the 8-hour outer limit.":"Follow-up is still required; escalate promptly if serious-event criteria may be met.";
    if(r.calosha_awareness_at){
      var d=new Date(r.calosha_awareness_at);
      if(!isNaN(d.getTime()) && d.getTime()<=Date.now()+300000){
        var ms=Math.max(0,Date.now()-d.getTime()), hrs=ms/3600000;
        timing="Elapsed since RBH awareness: "+elapsedAwarenessText(ms);
        if(hrs>=8){
          cls="overdue";
          message="More than 8 hours have elapsed from the recorded awareness time. Escalate immediately.";
        }else if(hrs>=4 || status==="yes"){
          cls="urgent";
        }
      }
    }
    viewingStep=parseInt(viewingStep||"0",10)||recommendedWizardStep(r);
    var currentStep=recommendedWizardStep(r);
    var navAction='';
    if(viewingStep===1 && currentStep>1 && !isResolvedReport(r)){
      navAction='<button type="button" class="reg-return-current" data-reg-return-step="'+currentStep+'">Return to '+esc(wizardShortTitle(currentStep))+'</button>';
    }else if(viewingStep!==1){
      navAction='<button type="button" data-reg-review-jump>Review screening</button>';
    }
    return '<div class="reg-persistent '+esc(cls)+'" data-reg-persistent role="status" aria-live="polite">'+
      '<div class="reg-persistent-copy"><strong>'+esc(title)+'</strong><span>'+esc(timing)+' · '+esc(message)+'</span></div>'+
      '<div class="reg-persistent-actions">'+navAction+'<a href="https://www.dir.ca.gov/dosh/report-accident-or-injury.html" target="_blank" rel="noopener">Reporting instructions ↗</a></div>'+
    '</div>';
  }
  function refreshPersistentRegulatoryBanner(detail,r){
    if(!detail) return;
    var host=detail.querySelector("[data-reg-persistent-host]");
    var viewingStep=parseInt(detail.dataset.wizardStep||"0",10)||recommendedWizardStep(r);
    if(host) host.innerHTML=persistentRegulatoryBannerHtml(r,viewingStep);
  }
  function refreshUrgentTriage(detail,r){
    if(!detail) return;
    var host=detail.querySelector("[data-urgent-triage]");
    if(host) host.innerHTML=urgentTriageHtml(r);
  }
  function refreshRegulatoryElapsed(card){
    if(!card) return;
    var sel=card.querySelector(".reg-status"), awareness=card.querySelector(".reg-awareness"), elapsed=card.querySelector("[data-reg-elapsed]");
    if(!elapsed) return;
    elapsed.className="reg-elapsed"; elapsed.innerHTML="";
    var status=sel?sel.value:"";
    if(status!=="yes" && status!=="pending") return;
    var raw=awareness?awareness.value:"";
    if(!raw) return;
    var d=new Date(raw);
    if(isNaN(d.getTime()) || d.getTime()>Date.now()+300000) return;
    var ms=Math.max(0,Date.now()-d.getTime()), hrs=ms/3600000, label=elapsedAwarenessText(ms);
    var message="Cal/OSHA requires qualifying events to be reported immediately, as soon as practically possible. Do not wait for the 8-hour outer limit.";
    elapsed.classList.add("show");
    if(hrs>=8){
      elapsed.classList.add("overdue");
      message="More than 8 hours have elapsed from the recorded awareness time. Escalate immediately and follow the official Cal/OSHA reporting instructions. This application does not determine whether the event is legally reportable.";
    }else if(hrs>=4 || status==="yes"){
      elapsed.classList.add("urgent");
    }
    elapsed.innerHTML='<strong>Elapsed since RBH awareness: '+esc(label)+'</strong>'+esc(message);
  }
  function refreshRegulatoryCardUi(card){
    if(!card) return;
    var sel=card.querySelector(".reg-status"), state=card.querySelector("[data-reg-state]"), chip=card.querySelector("[data-reg-chip]");
    var v=sel?sel.value:"";
    if(chip){ chip.textContent=caloshaScreenLabel(v); chip.className="reg-chip reg-chip-"+(v||"unset"); }
    if(state){
      state.className="reg-review-state"; state.textContent="";
      if(v==="yes"){ state.classList.add("show","yes"); state.textContent="Escalate immediately. This application does not report the event to Cal/OSHA."; }
      else if(v==="pending"){ state.classList.add("show","pending"); state.textContent="Follow-up is still required. If serious-event criteria may be met, do not wait on this application before escalating."; }
      else if(v==="no"){ state.classList.add("show","no"); state.textContent="Screening recorded as criteria not currently identified. Reassess if new facts become available."; }
    }
    refreshRegulatoryElapsed(card);
  }

  function workflowGuidanceEnabled(){
    return !(currentProfile && currentProfile.show_workflow_guidance === false);
  }

  async function saveWorkflowGuidancePreference(enabled){
    if(!currentSession || !currentSession.user) throw new Error("AUTH_REQUIRED");
    var res=await sb.rpc("rbh_update_my_guidance",{p_show_guidance:!!enabled});
    if(res.error) throw res.error;
    if(!currentProfile) currentProfile={};
    currentProfile.show_workflow_guidance=!!enabled;
  }

  function detailHtml(r){
    var rows=[], lang=activeIncidentLanguage||preferredReadingLanguage();
    function add(field,val){ if(val!=null && String(val).trim()!=="") rows.push('<div class="d-row" data-report-field="'+esc(field)+'"><div class="d-label">'+esc(reportLabel(field,lang))+'</div><div class="d-val">'+esc(reviewValue(r,field,lang,{}))+'</div></div>'); }
    add("description", r.description); add("hazard_category", r.hazard_category); add("potential_severity", r.potential_severity); add("involves_injury", r.involves_injury?"Yes":"No");
    add("people_involved", r.people_involved); add("immediate_action", r.immediate_action); add("suggested_fix", r.suggested_fix);
    add("job_site", r.job_site); add("site_location", r.site_location); add("observed_at", r.observed_at?fmtDate(r.observed_at):"");
    add("reporter_name", r.reporter_name||"Anonymous"); add("reporter_role", r.reporter_role); add("reporter_contact", r.reporter_contact);
    add("language", r.language||"en"); add("created_at", fmtDate(r.created_at));
    var guidanceOn=workflowGuidanceEnabled();
    return '<div class="wizard-shell'+(guidanceOn?'':' guidance-hidden')+'">'+
      '<div class="record-progress" data-record-progress></div>'+
      '<div class="guidance-control"><label class="guidance-toggle"><input type="checkbox" data-guidance-toggle'+(guidanceOn?' checked':'')+'><span>Show guidance</span></label></div>'+
      '<div data-resolved-banner></div>'+
      '<div data-urgent-triage>'+urgentTriageHtml(r)+'</div>'+

      '<section class="wizard-panel" data-wizard-step="1" hidden>'+
        '<div class="wizard-step-head"><span class="wizard-step-badge">1</span><div class="wizard-step-copy"><h3>Review the report</h3><p>Confirm what was submitted, then choose what happens next.</p></div></div>'+
        '<div class="wizard-task"><b>Start here</b><span>Review the report and attachments. If an injury is involved, complete the serious-event screen. Then either continue to Investigation or close the report with a documented reason.</span></div>'+
        '<span class="field-guidance">This step is intentionally simple: review what was submitted, then choose what happens next.</span>'+
        '<div class="d-rows">'+rows.join("")+'</div>'+
        '<div class="d-atts" data-atts></div>'+
        regulatoryReviewHtml(r)+
        '<div class="wizard-footer review-footer">'+
          '<div class="wizard-footer-copy"><b>Choose what happens next.</b><span>Continue to Investigation if this report needs follow-up, or close it now when no further action is needed.</span></div>'+
          '<div class="wizard-footer-actions review-footer-actions">'+
            '<button class="wizard-save noaction-btn" type="button" data-noaction-btn>Close — no action needed</button>'+
            '<button class="wizard-primary" data-step-complete="1" type="button">Continue to investigation →</button>'+
          '</div>'+
        '</div>'+
        '<div class="gate-msg" data-role-gate>This account can view this incident but does not have permission to update it.</div>'+
      '</section>'+

      '<section class="wizard-panel" data-wizard-step="2" hidden>'+
        '<div class="wizard-step-head"><span class="wizard-step-badge">2</span><div class="wizard-step-copy"><h3>Investigation</h3><p>Document what the investigation found and why it happened.</p></div></div>'+
        '<div class="wizard-task"><b>Two questions before continuing</b><span>Keep this simple and factual. Supporting evidence is optional, but recommended when it helps explain what happened.</span></div>'+
        '<label class="inv-l">What happened?<textarea class="inv-findings" placeholder="What did the investigation determine actually happened?"></textarea><span class="field-guidance">Describe the sequence of events or condition you found. This can be different from the original report.</span></label><div class="translation-preview" data-translation-field="investigation_findings" hidden></div>'+
        '<label class="inv-l">Why did it happen?<textarea class="inv-root" placeholder="What caused or allowed this issue to happen?"></textarea><span class="field-guidance">Describe the underlying condition, process, equipment issue, training gap, or other reason that allowed it to happen.</span></label><div class="translation-preview" data-translation-field="root_cause" hidden></div>'+
        '<div class="evidence-panel investigation-evidence-panel" data-investigation-evidence></div>'+
        '<div class="wizard-required" data-required="2">Answer both investigation questions before continuing.</div>'+
        '<div class="wizard-footer"><div class="wizard-footer-copy">Save and close keeps a draft. Continue when the investigation is documented.</div><div class="wizard-footer-actions"><button class="wizard-save root-save" data-step-save="2" type="button">Save and close</button><span class="root-saved section-saved" hidden>Saved ✓</span><button class="wizard-primary" data-step-complete="2" type="button">Continue to corrective actions →</button></div></div>'+
      '</section>'+

      '<section class="wizard-panel ca-unified-stage" data-wizard-step="3" data-ca-stage="plan" hidden>'+
        '<div class="wizard-step-head"><span class="wizard-step-badge">3</span><div class="wizard-step-copy"><h3>Corrective Actions</h3><p>Work through one focused stage at a time. You will only see the information that needs attention now.</p></div></div>'+
        '<div class="ca-lifecycle" data-ca-lifecycle>'+
          '<div class="ca-life-item next" data-ca-life="3"><span class="ca-life-dot">1</span><div class="ca-life-copy"><b>Plan &amp; assign</b><span>Define the fix and owner</span></div></div>'+
          '<div class="ca-life-item next" data-ca-life="4"><span class="ca-life-dot">2</span><div class="ca-life-copy"><b>Complete work</b><span>Document what was done</span></div></div>'+
          '<div class="ca-life-item next" data-ca-life="5"><span class="ca-life-dot">3</span><div class="ca-life-copy"><b>Verify</b><span>Approve or request changes</span></div></div>'+
        '</div>'+
        '<div class="ca-stage-heading"><span class="ca-stage-num">1</span><div><b>Plan &amp; assign</b><p>Create one action for each distinct fix, owner, or deadline.</p></div><span class="ca-stage-state" data-ca-stage-state>Next</span></div>'+
        '<div class="ca-focus-note"><b>What you need to do now</b>Complete the required fields for every corrective action, then assign the plan. Complete Work will open next.</div>'+
        '<div class="multi-action-toolbar"><div class="multi-action-summary"><b>Corrective actions</b><span>Add a separate action when different work, owners, or deadlines are needed.</span></div></div>'+
        '<div class="multi-action-list" data-corrective-action-plan><div class="multi-action-loading">Loading corrective-action plan…</div></div>'+
        '<div class="multi-action-add-wrap"><button class="multi-action-add" type="button" data-add-corrective-action>+ Add another corrective action</button></div>'+
        '<div class="wizard-required" data-required="3"></div>'+
        '<div class="wizard-footer"><div class="wizard-footer-copy">Save and close keeps a draft. Assign actions when every required field is complete.</div><div class="wizard-footer-actions"><button class="wizard-save action-plan-save" data-step-save="3" type="button">Save and close</button><span class="action-plan-saved section-saved" hidden>Saved ✓</span><button class="wizard-primary" data-step-complete="3" type="button">Assign actions →</button></div></div>'+
      '</section>'+

      '<section class="wizard-panel ca-unified-stage" data-wizard-step="4" data-ca-stage="complete" hidden>'+
        '<div class="wizard-step-head"><span class="wizard-step-badge">3</span><div class="wizard-step-copy"><h3>Corrective Actions</h3><p>Complete the assigned work. Actions already submitted or verified stay out of the way.</p></div></div>'+
        '<div class="ca-lifecycle" data-ca-lifecycle>'+
          '<div class="ca-life-item next" data-ca-life="3"><span class="ca-life-dot">1</span><div class="ca-life-copy"><b>Plan &amp; assign</b><span>Define the fix and owner</span></div></div>'+
          '<div class="ca-life-item next" data-ca-life="4"><span class="ca-life-dot">2</span><div class="ca-life-copy"><b>Complete work</b><span>Document what was done</span></div></div>'+
          '<div class="ca-life-item next" data-ca-life="5"><span class="ca-life-dot">3</span><div class="ca-life-copy"><b>Verify</b><span>Approve or request changes</span></div></div>'+
        '</div>'+
        '<div class="ca-stage-heading"><span class="ca-stage-num">2</span><div><b>Complete work</b><p>Record what was completed for each action that still needs attention.</p></div><span class="ca-stage-state" data-ca-stage-state>Next</span></div>'+
        '<div class="ca-focus-note"><b>Only unfinished or returned actions are shown</b>Submit each action when its work is complete. Verification opens only after every action is ready for review. If a reviewer sends an action back later, only that returned action comes back here.</div>'+
        '<div class="multi-action-completion-list" data-multi-action-completion></div>'+
        '<div class="action-workflow" data-action-completion></div>'+
      '</section>'+

      '<section class="wizard-panel ca-unified-stage" data-wizard-step="5" data-ca-stage="verify" hidden>'+
        '<div class="wizard-step-head"><span class="wizard-step-badge">3</span><div class="wizard-step-copy"><h3>Corrective Actions</h3><p>Review only the actions waiting for a decision. Verified actions stay complete and out of the way.</p></div></div>'+
        '<div class="ca-lifecycle" data-ca-lifecycle>'+
          '<div class="ca-life-item next" data-ca-life="3"><span class="ca-life-dot">1</span><div class="ca-life-copy"><b>Plan &amp; assign</b><span>Define the fix and owner</span></div></div>'+
          '<div class="ca-life-item next" data-ca-life="4"><span class="ca-life-dot">2</span><div class="ca-life-copy"><b>Complete work</b><span>Document what was done</span></div></div>'+
          '<div class="ca-life-item next" data-ca-life="5"><span class="ca-life-dot">3</span><div class="ca-life-copy"><b>Verify</b><span>Approve or request changes</span></div></div>'+
        '</div>'+
        '<div class="ca-stage-heading"><span class="ca-stage-num">3</span><div><b>Verify work</b><p>Approve each completed action or return only the action that needs more work.</p></div><span class="ca-stage-state" data-ca-stage-state>Next</span></div>'+
        '<div class="ca-focus-note"><b>Review and decide — no verification assignment needed</b>Each submitted action is ready for an authorized reviewer. Verify the actions that are complete, or send back only the action that needs more work. Returned actions go back to their assigned corrective-action owner.</div>'+
        '<div class="multi-action-verification-list" data-multi-action-verification-stage hidden></div>'+
        '<div class="action-workflow" data-action-verification></div>'+
      '</section>'+

      '<section class="wizard-panel" data-wizard-step="6" hidden>'+
        '<div class="wizard-step-head"><span class="wizard-step-badge">4</span><div class="wizard-step-copy"><h3>Close record</h3><p>Perform one final check and close the incident when every required step is complete.</p></div></div>'+
        '<div data-close-step></div>'+
      '</section>'+

      '<details class="record-support" open><summary>Notes &amp; activity history</summary><div class="record-support-body"><div class="support-grid">'+
        '<div class="d-section"><div class="d-sec-title-row"><span class="d-sec-title">Notes</span><button class="add-note" type="button">+ Add Note</button></div><div class="notes" data-notes></div></div>'+
        '<div class="d-section"><div class="d-sec-title">Activity timeline</div><p class="step-section-note">A readable history of submissions, updates, evidence, verification, and closure.</p><div class="audit" data-audit></div></div>'+
      '</div></div></details>'+
      '<div class="detail-actions"><button class="reopen-record-btn" type="button" hidden>Reopen record</button><button class="restart-workflow-btn" type="button" hidden>Restart workflow</button><span class="pdf-language-wrap">PDF language <select class="pdf-language-select"><option value="viewer">My reading language</option><option value="original">Original record</option><option value="en">English</option><option value="es">Español</option></select></span><button class="pdf-btn" type="button">Download PDF</button></div>'+
    '</div>';
  }

  function hasWorkflowValue(v){ return v!=null && String(v).trim()!==""; }
  function isResolvedReport(r){ return !!(r && (r.status==="closed" || r.status==="no_action" || r.status==="duplicate")); }
  function correctiveActionSummary(r){
    var s=r&&r._correctiveActionSummary;
    return s&&Number(s.total||0)>0?s:null;
  }
  function correctiveActionInCurrentCycle(a,r){
    if(!a||!r||a.retired_at||!a.activated_at) return false;
    if(parseInt(a.workflow_generation||0,10)!==parseInt(r.workflow_restart_count||0,10)) return false;
    return parseInt(a.activation_reopen_count||0,10)===parseInt(r.reopen_count||0,10);
  }
  function currentCycleActionsForReport(r,includeVerified){
    return (allCorrectiveActions||[]).filter(function(a){
      if(String(a.report_id||"")!==String(r&&r.id||"")) return false;
      if(!correctiveActionInCurrentCycle(a,r)) return false;
      return includeVerified!==false || String(a.status||"")!=="verified";
    });
  }
  function activeReopenStep(r){
    if(!r || isResolvedReport(r)) return 0;
    var n=parseInt(r.reopen_workflow_step||"0",10);
    return n>=1&&n<=6?n:0;
  }
  function workflowProgress(r){
    var disposed=r && (r.status==="no_action" || r.status==="duplicate");
    if(disposed){
      return {complete:true,steps:[
        {n:1,title:"Review report",state:"done",detail:"Reviewed and disposition recorded."},
        {n:2,title:"Document root cause",state:"na",detail:"Not required for this closure."},
        {n:3,title:"Plan corrective action",state:"na",detail:"Not required for this closure."},
        {n:4,title:"Complete action",state:"na",detail:"Not required for this closure."},
        {n:5,title:"Verify action",state:"na",detail:"Not required for this closure."},
        {n:6,title:"Close record",state:"done",detail:"Record closed without corrective action."}
      ]};
    }
    var reopenStep=activeReopenStep(r);
    if(reopenStep){
      var reopenTitles=["Review report","Document investigation","Plan corrective action","Complete action","Verify action","Close record"];
      var reopenDetails=[
        "Review the reopened report and confirm the carried-forward information still applies.",
        (hasWorkflowValue(r.investigation_findings)&&hasWorkflowValue(r.root_cause))?"Previous investigation carried forward — confirm or update what happened and why.":"Document what happened and why it happened.",
        (hasWorkflowValue(r.corrective_action)&&hasWorkflowValue(r.assigned_user_id))?"Previous action plan carried forward — confirm or update the action, control type, owner, due date, and priority.":"Complete the corrective-action plan.",
        hasWorkflowValue(r.action_completion_note)?"Previous completion note carried forward — update it as needed and submit the current work for verification.":"Document what was completed and submit it for verification.",
        r.action_status==="awaiting_verification"?"Admin or Safety Manager must verify the current reopened-cycle work.":"Verification is required again for the reopened record.",
        "After the reopened cycle is verified, close the record again."
      ];
      var reopenSteps=reopenTitles.map(function(title,i){var n=i+1;return {n:n,title:title,state:n<reopenStep?"done":(n===reopenStep?"current":"needed"),detail:reopenDetails[i]};});
      return {complete:false,steps:reopenSteps,current:reopenStep-1,reopened:true};
    }
    var owner=hasWorkflowValue(r.assigned_user_id);
    var childSummary=correctiveActionSummary(r);
    var step1=!!(r.status && r.status!=="new");
    var step2=hasWorkflowValue(r.investigation_findings) && hasWorkflowValue(r.root_cause);
    var missing3=[];
    var step3=false, step4=false, step5=false;
    if(childSummary){
      step3=childSummary.total>0;
      /* Complete Work stays active while any first-pass work is unfinished.
         During verification, a returned action does not interrupt review of
         other actions still awaiting a decision. Once those decisions are
         finished, returned actions become the focused Complete Work stage. */
      step4=childSummary.work_open===0 && !(childSummary.changes_requested>0 && childSummary.awaiting===0);
      step5=childSummary.verified===childSummary.total;
    } else {
      if(!hasWorkflowValue(r.corrective_action)) missing3.push("corrective action");
      if(!owner) missing3.push("owner");
      if(!hasWorkflowValue(r.due_date)) missing3.push("due date");
      if(!hasWorkflowValue(r.priority)) missing3.push("priority");
      step3=missing3.length===0;
      step4=(r.action_status==="awaiting_verification" || r.action_status==="verified") && hasWorkflowValue(r.action_completion_note) && hasWorkflowValue(r.action_completed_at);
      step5=r.action_status==="verified";
    }
    var step6=r.status==="closed";
    var done=[step1,step2,step3,step4,step5,step6];
    var current=-1; for(var i=0;i<done.length;i++){ if(!done[i]){ current=i; break; } }
    var changeMsg=r.action_status==="changes_requested"?"Reviewer requested changes. Update the completed work and resubmit.":"Document what was completed and submit it for verification.";
    var step3Detail=childSummary?(childSummary.total+" corrective action"+(childSummary.total===1?"":"s")+" assigned."): (step3?"Action, assigned user, due date, and priority are set.":("Still needed: "+missing3.join(", ")+"."));
    var step4Detail=childSummary?(step4?
      (childSummary.changes_requested>0&&childSummary.awaiting>0?
        (childSummary.changes_requested+" action"+(childSummary.changes_requested===1?" has":"s have")+" been returned; finish the "+childSummary.awaiting+" review"+(childSummary.awaiting===1?"":"s")+" still waiting."):
        ("All actions are ready for verification.")):
      (childSummary.changes_requested>0&&childSummary.work_open===0?
        (childSummary.changes_requested+" returned action"+(childSummary.changes_requested===1?" needs":"s need")+" updates before verification can finish."):
        (childSummary.submitted+" of "+childSummary.total+" corrective actions submitted; "+childSummary.work_open+" still need completion."))):
      (step4?"Completed work was submitted for review.":changeMsg);
    var step5Detail=childSummary?(step5?("All "+childSummary.total+" corrective actions are verified."):
      (childSummary.awaiting>0?
        (childSummary.awaiting+" action"+(childSummary.awaiting===1?" is":"s are")+" waiting for a verification decision; "+childSummary.verified+" already verified."):
        (childSummary.verified+" of "+childSummary.total+" corrective actions verified."))):
      (step5?"Corrective action was verified.":"An authorized reviewer must verify the completed work.");
    var details=[
      step1?"Report acknowledged and moved out of New.":"Review the report and change status to Under review.",
      step2?"Investigation documented.":"Document what happened and why it happened.",
      step3Detail,
      step4Detail,
      step5Detail,
      step6?"Record is closed.":"After verification, set Report Status to Closed."
    ];
    var titles=["Review report","Document investigation","Plan corrective action","Complete action","Verify action","Close record"];
    var steps=titles.map(function(title,i){ return {n:i+1,title:title,state:done[i]?"done":(i===current?"current":"needed"),detail:details[i]}; });
    return {complete:current===-1,steps:steps,current:current};
  }
  function visibleWizardStep(n){
    n=parseInt(n,10)||1;
    if(n<=2) return n;
    if(n<=5) return 3;
    return 4;
  }
  function correctiveGroupTarget(r){
    if(isResolvedReport(r)) return 3;
    var p=workflowProgress(r);
    for(var n=3;n<=5;n++){ if(p.steps[n-1]&&p.steps[n-1].state==="current") return n; }
    for(var m=3;m<=5;m++){ if(p.steps[m-1]&&p.steps[m-1].state==="needed"&&wizardStepAccessible(r,m)) return m; }
    return 5;
  }
  function updateCorrectiveLifecycle(detail,r){
    if(!detail) return;
    var p=workflowProgress(r);
    [3,4,5].forEach(function(n){
      var st=p.steps[n-1]||{state:"needed"};
      var caSummary=correctiveActionSummary(r);
      var blocked=n===4 && st.state==="current" && ((caSummary&&caSummary.changes_requested>0)||r.action_status==="changes_requested");
      var uiState=st.state==="done"?"done":(blocked?"blocked":(st.state==="current"?"current":"next"));
      var panel=detail.querySelector('[data-wizard-step="'+n+'"]');
      if(panel){
        panel.classList.remove("ca-stage-done","ca-stage-current","ca-stage-blocked","ca-stage-next");
        panel.classList.add("ca-stage-"+uiState);
        var chip=panel.querySelector("[data-ca-stage-state]");
        if(chip) chip.textContent=uiState==="done"?"Complete":(uiState==="blocked"?"Changes requested":(uiState==="current"?"Current":"Next"));
      }
      detail.querySelectorAll('[data-ca-life="'+n+'"]').forEach(function(life){
        life.classList.remove("done","current","blocked","next");
        life.classList.add(uiState);
        var dot=life.querySelector(".ca-life-dot");
        if(dot) dot.textContent=uiState==="done"?"✓":String(n-2);
        var copy=life.querySelector(".ca-life-copy span");
        if(copy){
          if(n===3) copy.textContent=uiState==="done"?"Plan assigned":(uiState==="current"?"Finish required fields":"Define the fix and owner");
          if(n===4) copy.textContent=uiState==="done"?"Work ready":(uiState==="blocked"?"Owner must update returned work":(uiState==="current"?"Complete the actions shown":"Document what was done"));
          if(n===5) copy.textContent=uiState==="done"?"All actions verified":(uiState==="current"?"Review actions waiting for a decision":"Approve or request changes");
        }
      });
    });
  }
  function renderRecordProgress(r, el){
    if(!el) return;
    var p=workflowProgress(r), detail=el.closest("#incidentBody")||el.parentElement;
    var active=parseInt((detail&&detail.dataset.wizardStep)||"0",10)||recommendedWizardStep(r);
    var activeState=p.steps[active-1]||null;
    var groupTarget=correctiveGroupTarget(r);
    var defs=[
      {visible:1,internal:1,title:"Review",steps:[1]},
      {visible:2,internal:2,title:"Investigation",steps:[2]},
      {visible:3,internal:groupTarget,title:"Corrective Actions",steps:[3,4,5]},
      {visible:4,internal:6,title:"Close",steps:[6]}
    ];
    var activeVisible=visibleWizardStep(active);
    var arrows=defs.map(function(def){
      var states=def.steps.map(function(n){return p.steps[n-1]?p.steps[n-1].state:"needed";});
      var state=states.every(function(x){return x==="done"||x==="na";})?(states.every(function(x){return x==="na";})?"na":"done"):(states.indexOf("current")>=0?"current":"needed");
      var caSummary=correctiveActionSummary(r);
      var blocked=def.visible===3 && ((caSummary&&caSummary.changes_requested>0)||r.action_status==="changes_requested") && p.steps[3] && p.steps[3].state==="current";
      // Keep Close visually pending until the reviewer explicitly leaves the
      // Corrective Actions stage with the final Continue to Close button.
      // workflowProgress can already consider Close current once every child
      // action is verified, but the user has not advanced the UI yet.
      var closePending=def.visible===4 && activeVisible===3 && state==="current" && !isResolvedReport(r);
      if(closePending) state="needed";
      var cls=state==="done"?"ps-done":(state==="current"?(blocked?"ps-blocked":"ps-current"):(state==="na"?"ps-na":"ps-future"));
      if(def.visible===activeVisible && state!=="current") cls+=" ps-viewing";
      var accessible=def.visible===3?def.steps.some(function(n){return wizardStepAccessible(r,n);}):wizardStepAccessible(r,def.internal);
      if(closePending) accessible=false;
      var icon=state==="done"?'<span class="ps-check">✓</span>':'';
      return '<button type="button" class="process-step '+cls+'" data-wizard-nav="'+def.internal+'"'+(accessible?'':' disabled')+'><span class="ps-num">STEP '+def.visible+'</span>'+icon+esc(def.title)+'</button>';
    }).join("");
    var labels=wizardActionLabels(r,active);
    var topSave=labels.save?'<button class="wizard-save" type="button" data-wizard-top-save>'+esc(labels.save)+'</button>':'';
    var topPrimary=labels.complete?'<button class="wizard-primary" type="button" data-wizard-top-complete>'+esc(labels.complete)+'</button>':'';
    var resolved=isResolvedReport(r);
    var currentText=resolved?'Closed record review':((activeState&&activeState.state==="done")?'Reviewing a completed step':('Step '+activeVisible+' of 4'));
    var helpText=resolved?'Read-only record. Completed information is grouped by stage below. Click a green step to jump to it. Notes can still be added.':wizardHelp(active,r);
    el.className="wizard-process";
    el.innerHTML='<div class="wizard-process-head"><div class="wizard-process-copy"><b>'+esc(currentText)+(resolved?'':' · '+esc(wizardLongTitle(active)))+'</b><span>'+esc(helpText)+'</span></div><div class="wizard-top-actions">'+topSave+topPrimary+'</div></div><div class="process-flow">'+arrows+'</div><div class="reg-persistent-host" data-reg-persistent-host>'+persistentRegulatoryBannerHtml(r,active)+'</div>';
    updateCorrectiveLifecycle(detail,r);
  }

  function wizardShortTitle(n){ return ({1:"Review",2:"Investigation",3:"Corrective Actions",4:"Corrective Actions",5:"Corrective Actions",6:"Close"})[n]||"Step"; }
  function wizardLongTitle(n){ return ({1:"Review Report",2:"Investigation",3:"Corrective Actions · Plan & Assign",4:"Corrective Actions · Complete Work",5:"Corrective Actions · Verify Work",6:"Close Record"})[n]||"Record"; }
  function wizardHelp(n,r){
    var map={1:"Review the submission, then acknowledge it for investigation or close it with a documented reason.",2:"Document what happened and why it happened.",3:"Create each fix, assign an owner, and complete every required field.",4:"Record what was completed for each action and submit it for review.",5:"Review each submitted action and either verify it or clearly request changes.",6:"Confirm everything is complete and close the record."};
    var childSummary=correctiveActionSummary(r);
    if(childSummary&&n===4){
      if(childSummary.changes_requested>0&&childSummary.work_open===0) return childSummary.changes_requested+" returned action"+(childSummary.changes_requested===1?" needs":"s need")+" an update. Only returned work is shown here.";
      return childSummary.work_open>0?(childSummary.work_open+" corrective action"+(childSummary.work_open===1?" still needs":"s still need")+" completion. Submitted actions stay hidden until every action is ready for review."):"All corrective actions are ready for verification.";
    }
    if(childSummary&&n===5){
      if(childSummary.awaiting>0&&childSummary.changes_requested>0) return childSummary.awaiting+" action"+(childSummary.awaiting===1?" still needs":"s still need")+" a review decision. "+childSummary.changes_requested+" action"+(childSummary.changes_requested===1?" has":"s have")+" already been sent back.";
      return childSummary.awaiting>0?(childSummary.awaiting+" action"+(childSummary.awaiting===1?" is":"s are")+" waiting for review; "+childSummary.verified+" already verified."):(childSummary.verified+" of "+childSummary.total+" corrective actions verified.");
    }
    if(n===4 && r.action_status==="changes_requested" && canEditStep(r,4)) return "Changes were requested. Update the work and resubmit it for verification.";
    if(currentRole==="supervisor" && n===1 && isInvestigatorAssignedToMe(r) && r.involves_injury && ["yes","no","pending"].indexOf(String(r.calosha_screening_status||""))<0) return "You own this investigation, but an Admin or Safety Manager must complete the regulatory screening before Review can advance.";
    if(currentRole==="supervisor" && n<=3 && !isInvestigatorAssignedToMe(r)) return "This investigation is owned by "+(investigatorName(r)||"another dashboard user")+". You can review this step, but only the assigned investigator can change it.";
    if(currentRole==="supervisor" && n===4 && !isActionAssignedToMe(r)) return "This corrective action is owned by "+(assigneeName(r)||"another dashboard user")+". You can review it, but only the assigned action owner can change it.";
    if(n===5 && !canVerify()) return "This step is waiting for an Admin or Safety Manager to verify the work.";
    if(n===5 && isManager()) return "Review the completed work and evidence, then verify it or request changes.";
    if(n===6 && !canVerify()) return "An Admin or Safety Manager closes the record after verification.";
    return map[n]||"Follow the guided steps.";
  }
  function recommendedWizardStep(r){ var p=workflowProgress(r); if(r.status==="closed"||r.status==="no_action"||r.status==="duplicate") return 6; return p.current>=0?p.current+1:6; }
  function wizardStepAccessible(r,n){
    var p=workflowProgress(r), st=p.steps[n-1]; if(!st) return false;
    if(r.status==="closed") return true;
    if(r.status==="no_action"||r.status==="duplicate") return n===1||n===6;
    return st.state==="done"||st.state==="current";
  }
  function wizardActionLabels(r,n){
    var p=workflowProgress(r), st=p.steps[n-1], isCurrent=st&&st.state==="current";
    var childSummary=correctiveActionSummary(r);
    if(childSummary && (n===4||n===5)) return {save:null,complete:null};
    var canEdit=canEditStep(r,n);
    if(!canEdit) return {save:null,complete:null};
    if(st&&st.state==="done" && n!==6) return {save:(n===2||n===3?"Save and close":null),complete:null};
    if(!isCurrent && n!==6) return {save:null,complete:null};
    if(n===1) return {save:null,complete:"Continue to investigation →"};
    if(n===2) return {save:"Save and close",complete:"Continue to corrective actions →"};
    if(n===3) return {save:"Save and close",complete:"Assign actions →"};
    if(n===4){ if(r.action_status==="awaiting_verification"||r.action_status==="verified") return {save:null,complete:null}; return {save:"Save and close",complete:r.action_status==="changes_requested"?"Resubmit for verification →":"Submit for verification →"}; }
    if(n===5){
      /* Multi-action verification is intentionally decision-based, not assigned.
         Each submitted corrective action has its own Verify / Send back controls,
         and the workflow advances only after every action is verified. */
      if(correctiveActionSummary(r)) return {save:null,complete:null};
      if(!canPerformVerification(r)||r.action_status!=="awaiting_verification") return {save:null,complete:null};
      return {save:"Save and close",complete:"Verify & continue →"};
    }
    if(n===6){ if(r.status==="closed"||r.status==="no_action"||r.status==="duplicate") return {save:null,complete:null}; return {save:null,complete:canClose(r)?"Close record":null}; }
    return {save:null,complete:null};
  }
  function syncWorkflowStickyOffset(){
    var topbar=document.querySelector(".topbar");
    var height=topbar?Math.ceil(topbar.getBoundingClientRect().height):56;
    document.documentElement.style.setProperty("--rbh-topbar-height",height+"px");
  }
  syncWorkflowStickyOffset();
  window.addEventListener("resize",syncWorkflowStickyOffset,{passive:true});

  function scrollWizardStepIntoView(detail,n){
    if(!detail) return;
    var progress=detail.querySelector("[data-record-progress]");
    var panel=detail.querySelector('[data-wizard-step="'+n+'"]');
    var target=progress||panel;
    if(!target) return;

    syncWorkflowStickyOffset();
    var topbar=document.querySelector(".topbar");
    var offset=(topbar?topbar.offsetHeight:0);
    var top=target.getBoundingClientRect().top+window.pageYOffset-offset;
    var reduceMotion=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({top:Math.max(0,top),behavior:reduceMotion?"auto":"smooth"});

    /* Move accessibility/keyboard focus to the newly active step without changing scroll position. */
    window.setTimeout(function(){
      var heading=panel?panel.querySelector(".wizard-step-copy h3"):null;
      var mobileHeading=detail.querySelector(".wizard-process-copy b");
      var focusTarget=(heading&&heading.offsetParent!==null)?heading:mobileHeading;
      if(!focusTarget) return;
      focusTarget.setAttribute("tabindex","-1");
      try{ focusTarget.focus({preventScroll:true}); }catch(_){ focusTarget.focus(); }
    },reduceMotion?0:260);
  }
  function setWizardStep(detail,r,n,force){
    if(!detail) return;
    n=parseInt(n,10)||recommendedWizardStep(r);
    if(!force && !wizardStepAccessible(r,n)){ toast("Finish the current step before moving forward.","err"); return; }
    detail.dataset.wizardStep=String(n);
    var inCorrectiveWorkspace=n>=3&&n<=5;
    detail.querySelectorAll("[data-wizard-step]").forEach(function(panel){
      var pn=parseInt(panel.getAttribute("data-wizard-step"),10);
      panel.hidden=pn!==n;
    });
    var planPanel=detail.querySelector('[data-wizard-step="3"]');
    if(planPanel) planPanel.classList.remove("ca-plan-summary-mode");
    var p=workflowProgress(r), panel=detail.querySelector('[data-wizard-step="'+n+'"]'), state=p.steps[n-1]?p.steps[n-1].state:"needed";
    if(panel){ var staticComplete=panel.querySelector('[data-step-complete="'+n+'"]'); if(staticComplete && n<=3) staticComplete.style.display=(state==="done"?"none":"inline-flex"); }
    updateCorrectiveLifecycle(detail,r);
    renderRecordProgress(r,detail.querySelector("[data-record-progress]"));
    scrollWizardStepIntoView(detail,n);
  }
  function initialWizardStep(r){ return recommendedWizardStep(r); }
  function renderCloseStep(r,el,detail,auditEl){
    if(!el) return;
    var disposed=r.status==="no_action"||r.status==="duplicate", closed=r.status==="closed";
    if(disposed){ el.innerHTML='<div class="ops-alert"><b>Record complete — no corrective action required</b>This report was reviewed and closed with a documented disposition.</div>'; return; }
    var childSummary=correctiveActionSummary(r);
    var checks=childSummary?[
      [!!(r.status&&r.status!=="new"),"Report reviewed"],
      [hasWorkflowValue(r.root_cause),"Investigation completed"],
      [childSummary.total>0,childSummary.total+" corrective action"+(childSummary.total===1?"":"s")+" assigned"],
      [childSummary.open===0,"All corrective actions submitted for verification"],
      [childSummary.verified===childSummary.total,"All corrective actions verified"]
    ]:[
      [!!(r.status&&r.status!=="new"),"Report reviewed"],
      [hasWorkflowValue(r.root_cause),"Investigation completed"],
      [hasWorkflowValue(r.corrective_action),"Corrective action documented"],
      [hasWorkflowValue(r.assigned_user_id),"Corrective action owner assigned"],
      [hasWorkflowValue(r.due_date),"Due date documented"],
      [hasWorkflowValue(r.priority),"Priority documented"],
      [r.action_status==="verified","Corrective action verified"]
    ];
    var list=checks.map(function(x){return '<div class="close-check '+(x[0]?'ok':'missing')+'"><b>'+(x[0]?'✓':'!')+'</b><span>'+esc(x[1])+'</span></div>';}).join("");
    if(closed){ el.innerHTML='<div class="ops-alert"><b>Record complete</b>This incident is closed. The full history remains available below.</div><div class="close-checklist">'+list+'</div>'; return; }
    var ready=canClose(r), button=ready&&canEditStep(r,6)?'<button class="wizard-close" type="button" data-step-complete="6">Close record</button>':'';
    el.innerHTML='<div class="close-checklist">'+list+'</div>'+(ready?'<div class="wizard-context"><b>Ready to close</b><p>All required workflow steps are complete. Closing the record will preserve the full history and mark it resolved.</p></div>':'<div class="wizard-required show">Complete the missing checklist items before this record can be closed.</div>')+'<div class="wizard-footer"><div class="wizard-footer-copy">Closing is a deliberate final action. There is no autosave or automatic closure.</div><div class="wizard-footer-actions">'+button+'</div></div>';
    var btn=el.querySelector('[data-step-complete="6"]');
    if(btn) btn.addEventListener("click",async function(){
      if(!canEditStep(r,6)){ toast("Only an Admin or Safety Manager can close the record.","err"); return; }
      if(!canClose(r)){ toast("Finish and verify every corrective action before closing the record.","err"); return; }
      btn.disabled=true; var old=btn.textContent; btn.textContent="Closing…";
      try{ await updateStatus(r.id,"closed",null); $("incidentSummary").innerHTML='<div class="is-badges">'+incidentBadgeHtml(r)+'</div><div class="is-desc">'+esc(r.description||"No description provided.")+'</div>'; refreshRecordWorkflow(r,detail); loadAudit(r.id,auditEl); renderMyWork(); renderActions(); applyFilters(); toast("Record closed","ok"); }
      catch(ex){ console.error(ex); toast("Could not close the record.","err"); }
      finally{ if(btn.isConnected){btn.disabled=false;btn.textContent=old;} }
    });
  }
  function applyResolvedReviewMode(r,detail){
    if(!detail || !isResolvedReport(r)) return false;
    detail.classList.add("resolved-review");
    var reopenBtn=detail.querySelector(".reopen-record-btn"); if(reopenBtn) reopenBtn.hidden=!canReopenReport(r);
    var restartBtn=detail.querySelector(".restart-workflow-btn"); if(restartBtn) restartBtn.hidden=true;
    var progress=workflowProgress(r), resolvedActionSummary=correctiveActionSummary(r);
    detail.querySelectorAll("[data-wizard-step]").forEach(function(panel){
      var n=parseInt(panel.getAttribute("data-wizard-step"),10), st=progress.steps[n-1];
      var redundantCompletion=n===4 && resolvedActionSummary && resolvedActionSummary.total>0 && resolvedActionSummary.verified===resolvedActionSummary.total;
      panel.hidden=!!(st&&st.state==="na") || redundantCompletion;
      panel.querySelectorAll("input,textarea,select,button").forEach(function(control){ control.disabled=true; });
    });
    var banner=detail.querySelector("[data-resolved-banner]");
    if(banner){
      var disposition=(r.status==="no_action"||r.status==="duplicate")?"This report was closed without corrective action.":"This incident is closed and the workflow is locked.";
      var canReopen=canReopenReport(r);
      var reopenHelp=canReopen?" Admins and Safety Managers can reopen this record if new information arises or it was closed in error.":"";
      var reopenAction=canReopen?'<button class="banner-action" type="button" data-reopen-inline>Reopen record</button>':'';
      banner.innerHTML='<div class="resolved-review-banner"><b>Closed record · read only</b><span>'+esc(disposition)+' Review the preserved information below. Authorized users can still add a note in Notes &amp; activity history.'+esc(reopenHelp)+'</span>'+reopenAction+'</div>';
      var inlineReopen=banner.querySelector("[data-reopen-inline]"); if(inlineReopen) inlineReopen.addEventListener("click",function(){ openReopenModal(r,lastOperationalView); });
    }
    renderRecordProgress(r,detail.querySelector("[data-record-progress]"));
    return true;
  }
  function refreshRecordWorkflow(r, detail){
    if(!detail) return;
    renderCloseStep(r,detail.querySelector("[data-close-step]"),detail,detail.querySelector("[data-audit]"));
    if(isResolvedReport(r)){ applyResolvedReviewMode(r,detail); return; }
    detail.classList.remove("resolved-review");
    var reopenBtn=detail.querySelector(".reopen-record-btn"); if(reopenBtn) reopenBtn.hidden=true;
    var restartBtn=detail.querySelector(".restart-workflow-btn"); if(restartBtn) restartBtn.hidden=!canRestartWorkflow(r);
    var banner=detail.querySelector("[data-resolved-banner]");
    if(banner){
      if(r.last_reopened_at){
        var prior=STATUS[r.last_reopen_from_status]?STATUS[r.last_reopen_from_status].l:(r.last_reopen_from_status||"resolved");
        banner.innerHTML='<div class="resolved-review-banner"><b>Reopened record · review starts again at Step 1</b><span>Previously '+esc(prior)+' · reopened '+esc(fmtDate(r.last_reopened_at))+'. Prior investigation and action-plan values were carried forward so you can confirm or update them instead of re-entering everything. Each step must still be reconfirmed in order, and verification is required again before closure.</span></div>';
      } else banner.innerHTML="";
    }
    var n=parseInt(detail.dataset.wizardStep||"0",10)||initialWizardStep(r);
    if(!wizardStepAccessible(r,n)) n=recommendedWizardStep(r);
    /* Corrective Actions is one visible Step 3 with three internal stages.
       If Complete Work just finished or a returned action becomes active,
       always show the stage that currently needs attention instead of leaving
       a completed internal panel on screen. */
    if(n>=3&&n<=5){
      var currentCorrectiveStage=correctiveGroupTarget(r);
      if(currentCorrectiveStage>=3&&currentCorrectiveStage<=5) n=currentCorrectiveStage;
    }
    setWizardStep(detail,r,n,true);
  }

  function buildDetail(r, detail, wrap){
    detail.innerHTML=detailHtml(r);
    var guidanceToggle=detail.querySelector("[data-guidance-toggle]");
    if(guidanceToggle){
      guidanceToggle.addEventListener("change",async function(){
        var shell=detail.querySelector(".wizard-shell");
        var enabled=!!guidanceToggle.checked;
        if(shell) shell.classList.toggle("guidance-hidden",!enabled);
        guidanceToggle.disabled=true;
        try{
          await saveWorkflowGuidancePreference(enabled);
          var pg=$("profileGuidance"); if(pg) pg.checked=enabled;
          toast(enabled?"Workflow guidance will be shown by default.":"Workflow guidance will stay hidden by default.","ok");
        }catch(ex){
          console.error("guidance preference",ex);
          guidanceToggle.checked=!enabled;
          if(shell) shell.classList.toggle("guidance-hidden",enabled);
          toast("Could not save your guidance preference. Please try again.","err");
        }finally{
          guidanceToggle.disabled=false;
        }
      });
    }
    var mobileSupport=detail.querySelector(".record-support");
    if(mobileSupport && window.matchMedia && window.matchMedia("(max-width: 620px)").matches) mobileSupport.removeAttribute("open");
    detail.dataset.wizardStep=String(initialWizardStep(r));
    var auditEl=detail.querySelector("[data-audit]");
    var gate=detail.querySelector("[data-role-gate]");
    var canEdit=canEditReport(r);
    if(!canEdit && gate) gate.classList.add("show");

    var investigatorCard=detail.querySelector("[data-investigator-card]"), investigatorSelect=investigatorCard?investigatorCard.querySelector(".inv-investigator"):null, investigatorSave=investigatorCard?investigatorCard.querySelector(".investigator-save"):null, investigatorSelf=investigatorCard?investigatorCard.querySelector(".investigator-self"):null, investigatorSaved=investigatorCard?investigatorCard.querySelector(".investigator-saved"):null, investigatorChip=investigatorCard?investigatorCard.querySelector("[data-investigator-chip]"):null, investigatorPermission=investigatorCard?investigatorCard.querySelector("[data-investigator-permission]"):null;
    function syncInvestigatorUi(){
      if(!investigatorCard) return;
      var managerCanAssign=isManager()&&!isResolvedReport(r);
      [investigatorSelect,investigatorSave,investigatorSelf].forEach(function(x){if(x)x.disabled=!managerCanAssign;});
      if(investigatorPermission) investigatorPermission.hidden=managerCanAssign;
      if(investigatorSelect) investigatorSelect.value=r.investigator_user_id||"";
      if(investigatorChip){ investigatorChip.textContent=r.investigator_user_id?"Assigned":"Unassigned"; investigatorChip.className="investigator-chip"+(r.investigator_user_id?" assigned":""); }
    }
    async function persistInvestigator(nextId,showToast){
      if(!isManager()||isResolvedReport(r)) throw new Error("NOT_AUTHORIZED");
      nextId=nextId||null;
      if(nextId){
        var selected=profileById[String(nextId)];
        if(!selected || selected.is_active===false || selected.app_role==="read_only") throw new Error("INVALID_INVESTIGATOR");
      }
      if(String(r.investigator_user_id||"")===String(nextId||"")){ syncInvestigatorUi(); if(showToast) toast("Investigator assignment is already up to date","ok"); return true; }
      var res=await sb.from("reports").update({investigator_user_id:nextId}).eq("id",r.id);
      if(res.error) throw res.error;
      r.investigator_user_id=nextId;
      syncInvestigatorUi();
      if(investigatorSaved){investigatorSaved.hidden=false;setTimeout(function(){if(investigatorSaved.isConnected)investigatorSaved.hidden=true;},2200);}
      loadAudit(r.id,auditEl); renderHomeSnapshot(); applyFilters();
      var notify=null;
      if(nextId) notify=await sendInvestigatorAssignmentEmail(r);
      if(showToast){
        if(!nextId) toast("Investigator assignment cleared","ok");
        else if(notify&&notify.sent) toast(notify.duplicate?"Investigator assigned — email was already sent":"Investigator assigned — email notification sent","ok");
        else if(notify&&notify.skipped&&(notify.reason==="NO_INVESTIGATOR_EMAIL"||notify.reason==="SEND_ALREADY_IN_PROGRESS")) toast(notify.reason==="NO_INVESTIGATOR_EMAIL"?"Investigator assigned — no email is available for that user":"Investigator assigned — email notification is already in progress","ok");
        else { console.error("investigator notification failed",notify); toast("Investigator assigned, but the email notification could not be sent.","err"); }
      } else if(nextId && notify && !notify.sent && !notify.skipped){
        console.error("investigator notification failed",notify);
        toast("Investigator was assigned, but the email notification could not be sent.","err");
      }
      return true;
    }
    syncInvestigatorUi();
    if(investigatorSave) investigatorSave.addEventListener("click",async function(){ investigatorSave.disabled=true; try{await persistInvestigator(investigatorSelect?investigatorSelect.value:null,true);}catch(ex){console.error(ex);toast(ex&&ex.message==="INVALID_INVESTIGATOR"?"Choose an active dashboard user who is not Read Only.":"Could not save the investigator assignment.","err");}finally{syncInvestigatorUi();} });
    if(investigatorSelf) investigatorSelf.addEventListener("click",async function(){
      if(!currentSession||!currentSession.user){toast("Sign in again before assigning this report.","err");return;}
      investigatorSelf.disabled=true;
      try{ if(investigatorSelect) investigatorSelect.value=currentSession.user.id; await persistInvestigator(currentSession.user.id,true); }
      catch(ex){console.error(ex);toast("Could not assign this investigation to your account.","err");}
      finally{syncInvestigatorUi();}
    });

    var regCard=detail.querySelector("[data-regulatory-review]"), regStatus=regCard?regCard.querySelector(".reg-status"):null, regAwareness=regCard?regCard.querySelector(".reg-awareness"):null, regSave=regCard?regCard.querySelector(".reg-save"):null, regSaved=regCard?regCard.querySelector(".reg-saved"):null, regRequired=regCard?regCard.querySelector("[data-reg-required]"):null;
    if(regCard){
      refreshRegulatoryCardUi(regCard);
      if(regStatus) regStatus.addEventListener("change",function(){ if(regRequired) regRequired.classList.remove("show"); refreshRegulatoryCardUi(regCard); });
      if(regAwareness){
        ["change","input"].forEach(function(evt){regAwareness.addEventListener(evt,function(){ if(regRequired) regRequired.classList.remove("show"); refreshRegulatoryElapsed(regCard); });});
      }
      var regElapsedTimer=setInterval(function(){
        if(!regCard.isConnected){clearInterval(regElapsedTimer);return;}
        refreshRegulatoryElapsed(regCard);
        refreshPersistentRegulatoryBanner(detail,r);
      },60000);
      if(!canVerify() || isResolvedReport(r)){ [regStatus,regAwareness,regSave].forEach(function(x){if(x)x.disabled=true;}); }
    }
    async function persistRegulatoryReview(showToast){
      if(!r.involves_injury) return true;
      if(!regCard || !regStatus || !regAwareness) return false;
      if(!canVerify()){ toast("Only an Admin or Safety Manager can complete the regulatory screening.","err"); return false; }
      var status=regStatus.value, awareRaw=regAwareness.value;
      if(!status){ if(regRequired){regRequired.textContent="Choose a screening result before completing this review.";regRequired.classList.add("show");} toast("Choose a regulatory screening result.","err"); return false; }
      if((status==="yes"||status==="pending")&&!awareRaw){ if(regRequired){regRequired.textContent="Record when RBH first knew of the potentially serious outcome for a Yes or Pending screening.";regRequired.classList.add("show");} toast("Add the RBH awareness date and time.","err"); return false; }
      var awareIso=null;
      if(awareRaw){
        var d=new Date(awareRaw);
        if(isNaN(d.getTime())){ if(regRequired){regRequired.textContent="Enter a valid awareness date and time.";regRequired.classList.add("show");} return false; }
        if(d.getTime()>Date.now()+300000){ if(regRequired){regRequired.textContent="The awareness time cannot be in the future.";regRequired.classList.add("show");} toast("Check the awareness date and time.","err"); return false; }
        awareIso=d.toISOString();
      }
      if(regRequired) regRequired.classList.remove("show");
      var patch={calosha_screening_status:status,calosha_awareness_at:awareIso};
      var changed=String(r.calosha_screening_status||"")!==String(status||"") || String(r.calosha_awareness_at||"")!==String(awareIso||"");
      if(changed){ var res=await sb.from("reports").update(patch).eq("id",r.id); if(res.error) throw res.error; r.calosha_screening_status=status; r.calosha_awareness_at=awareIso; }
      refreshRegulatoryCardUi(regCard);
      refreshPersistentRegulatoryBanner(detail,r);
      refreshUrgentTriage(detail,r);
      if(regSaved){regSaved.hidden=false;setTimeout(function(){regSaved.hidden=true;},2200);}
      if(changed) loadAudit(r.id,auditEl);
      if(showToast) toast("Regulatory screening saved","ok");
      return true;
    }
    if(regSave) regSave.addEventListener("click",async function(){ regSave.disabled=true; try{await persistRegulatoryReview(true);}catch(ex){console.error(ex);toast("Could not save the regulatory screening.","err");}finally{if(regSave.isConnected)regSave.disabled=!canVerify()||isResolvedReport(r);} });

    var noActionBox=detail.querySelector("[data-noaction-box]"), noActionBtn=detail.querySelector("[data-noaction-btn]");
    if(noActionBox) noActionBox.style.display=(canVerify() && r.status!=="closed" && r.status!=="no_action" && r.status!=="duplicate")?"flex":"none";
    if(noActionBtn) noActionBtn.addEventListener("click",async function(){
      if(!canVerify()){toast("Only an Admin or Safety Manager can close a report without corrective action.","err");return;}
      if(r.involves_injury){ try{ if(!(await persistRegulatoryReview(false))) return; }catch(ex){console.error(ex);toast("Could not save the regulatory screening.","err");return;} }
      openDispositionModal(r,wrap,detail.querySelector("[data-notes]"));
    });

    var invFindings=detail.querySelector(".inv-findings"), invRoot=detail.querySelector(".inv-root");
    var rootSave=detail.querySelector(".root-save"), rootSaved=detail.querySelector(".root-saved"), actionPlanSave=detail.querySelector(".action-plan-save"), actionPlanSaved=detail.querySelector(".action-plan-saved");
    var actionPlanList=detail.querySelector("[data-corrective-action-plan]"), actionPlanAdd=detail.querySelector("[data-add-corrective-action]"), actionPlanOverviews=detail.querySelectorAll("[data-corrective-action-overview]"), multiActionCompletionEl=detail.querySelector("[data-multi-action-completion]"), multiActionVerificationStage=detail.querySelector("[data-multi-action-verification-stage]");
    var actionPlanState={actions:[],loading:true,loaded:false,translationToken:0};
    detail._correctivePlanState=actionPlanState;
    invFindings.value=r.investigation_findings||"";
    invRoot.value=r.root_cause||"";
    if(!canEditStep(r,2)){ [invFindings,invRoot,rootSave].forEach(function(x){if(x)x.disabled=true;}); }
    if(!canEditStep(r,3)){ [actionPlanSave,actionPlanAdd].forEach(function(x){if(x)x.disabled=true;}); }

    async function persistInvestigation(showToast,advanceReopen){
      if(!canEditStep(r,2)) throw new Error("NOT_AUTHORIZED");
      var findings=invFindings.value.trim()||null, cause=invRoot.value.trim()||null;
      var patch={investigation_findings:findings,root_cause:cause};
      if(advanceReopen && activeReopenStep(r)) patch.reopen_workflow_step=3;
      var changed={}; Object.keys(patch).forEach(function(k){if(String(r[k]??"")!==String(patch[k]??""))changed[k]=patch[k];});
      if(Object.keys(changed).length){var res=await sb.from("reports").update(changed).eq("id",r.id);if(res.error)throw res.error;Object.keys(changed).forEach(function(k){r[k]=changed[k];});}
      refreshRecordWorkflow(r,detail); loadAudit(r.id,auditEl); if(showToast) toast("Investigation saved","ok"); return true;
    }
    function actionStatusLabel(status){
      return ({not_started:"Not started",in_progress:"In progress",awaiting_verification:"Awaiting verification",verified:"Verified",changes_requested:"Changes requested"})[status]||"Draft";
    }
    function renderCorrectiveActionOverview(){
      if(!actionPlanOverviews||!actionPlanOverviews.length) return;
      var html="";
      if(actionPlanState.loading){
        html='<div class="multi-action-loading">Loading corrective-action plan…</div>';
      } else {
        var rows=actionPlanState.actions.filter(function(a){return !!a.id && !a.retired_at && !!a.activated_at;});
        if(!rows.length){
          html='<div class="multi-action-loading">No active corrective actions are recorded for this workflow.</div>';
        } else {
          html='<div class="multi-action-overview-head"><b>Corrective action plan</b><span>'+rows.length+' active action'+(rows.length===1?'':'s')+' assigned for this report.</span></div>'+
            rows.map(function(a){
              var owner=a.owner_user_id&&profileById[String(a.owner_user_id)]?profileName(profileById[String(a.owner_user_id)]):"Not assigned";
              var control=a.control_type?(controlTypeLabel(a.control_type)||a.control_type):"Not selected";
              var due=a.due_date?fmtDate(a.due_date):"No due date";
              var priority=a.priority?String(a.priority).charAt(0).toUpperCase()+String(a.priority).slice(1):"No priority";
              return '<div class="multi-action-overview-card">'+
                '<div class="multi-action-overview-top"><div class="multi-action-overview-title">Corrective Action #'+esc(a.action_number||"")+'</div><span class="multi-action-status">'+esc(actionStatusLabel(a.status))+'</span></div>'+
                '<div class="multi-action-overview-desc">'+esc(a.description||"No description recorded.")+'</div>'+
                '<div class="multi-action-overview-meta"><span><b>Owner:</b> '+esc(owner)+'</span><span><b>Due:</b> '+esc(due)+'</span><span><b>Priority:</b> '+esc(priority)+'</span><span><b>Control:</b> '+esc(control)+'</span></div>'+
              '</div>';
            }).join("");
        }
      }
      actionPlanOverviews.forEach(function(el){el.innerHTML=html;});
    }

    function newLocalCorrectiveAction(){
      return {id:null,action_number:null,description:"",control_type:"",owner_user_id:"",due_date:"",priority:"",status:"not_started",activated_at:null,activation_reopen_count:null,_local:true};
    }
    function planHasBeenActivated(){
      return actionPlanState.actions.some(function(a){return !!a.activated_at;});
    }
    function syncCorrectiveActionSummary(){
      var rows=actionPlanState.actions.filter(function(a){
        return !!a.id && correctiveActionInCurrentCycle(a,r);
      });
      if(!rows.length){ r._correctiveActionSummary=null; return null; }
      var summary={total:rows.length,open:0,work_open:0,awaiting:0,verified:0,changes_requested:0,submitted:0};
      rows.forEach(function(a){
        var s=String(a.status||"not_started");
        if(s==="verified") summary.verified++;
        else if(s==="awaiting_verification") summary.awaiting++;
        else if(s==="changes_requested"){summary.changes_requested++;summary.open++;}
        else {summary.work_open++;summary.open++;}
      });
      summary.submitted=summary.awaiting+summary.verified;
      r._correctiveActionSummary=summary;
      return summary;
    }
    function canCompleteCorrectiveAction(a){
      if(!a||isResolvedReport(r)) return false;
      if(isManager()) return true;
      return currentRole==="supervisor" && currentUserId() && String(a.owner_user_id||"")===currentUserId();
    }
    function canVerifyCorrectiveAction(a){
      return !!(a&&!isResolvedReport(r)&&isManager());
    }
    async function releaseLegacyCorrectiveActionVerifier(a){
      if(!a||!a.verifier_user_id||!isManager()) return true;
      var res=await sb.rpc("rbh_set_corrective_action_verifier",{p_action_id:a.id,p_verifier_user_id:null});
      if(res.error) throw res.error;
      a.verifier_user_id=null;
      return true;
    }
    function renderMultiActionVerification(){
      var summary=syncCorrectiveActionSummary();
      if(!multiActionVerificationStage) return;
      if(!summary){
        multiActionVerificationStage.innerHTML="";
        multiActionVerificationStage.hidden=true;
        return;
      }

      multiActionVerificationStage.hidden=false;
      var allRows=actionPlanState.actions.filter(function(a){return !!a.id&&correctiveActionInCurrentCycle(a,r);});
      if(!allRows.length){
        multiActionVerificationStage.innerHTML='<div class="multi-action-stage-note">No active corrective actions are available for verification.</div>';
        return;
      }
      var rows=allRows.filter(function(a){
        var s=String(a.status||"");
        return isResolvedReport(r)?["awaiting_verification","verified"].indexOf(s)>=0:s==="awaiting_verification";
      });
      var verifiedCount=allRows.filter(function(a){return String(a.status||"")==="verified";}).length;
      var awaitingCount=allRows.filter(function(a){return String(a.status||"")==="awaiting_verification";}).length;
      var returnedCount=allRows.filter(function(a){return String(a.status||"")==="changes_requested";}).length;
      var allVerified=allRows.length>0&&verifiedCount===allRows.length;
      var cardsHtml=rows.length?rows.map(function(a){
        var status=String(a.status||"not_started");
        var owner=a.owner_user_id&&profileById[String(a.owner_user_id)]?profileName(profileById[String(a.owner_user_id)]):"Not assigned";
        var completedBy=a.completed_by&&profileById[String(a.completed_by)]?profileName(profileById[String(a.completed_by)]):"";
        var verifiedBy=a.verified_by&&profileById[String(a.verified_by)]?profileName(profileById[String(a.verified_by)]):"";
        var review="";

        if(status==="verified"){
          review='<div class="multi-action-verifier-note"><b>Verified'+(a.verified_at?' · '+esc(fmtDate(a.verified_at)):'')+'</b>'+
            (a.verification_note?esc(a.verification_note):"No reviewer note recorded.")+
            (verifiedBy?'<div class="action-meta">Verified by '+esc(verifiedBy)+'</div>':'')+
          '</div>';
        } else if(status==="awaiting_verification"){
          var canReview=canVerifyCorrectiveAction(a);
          if(canReview){
            review='<div class="multi-action-verifier-note"><b>Ready for verification</b>Review the completed work and evidence below. No verifier needs to be assigned. Verify it if the fix is complete, or send this action back for changes.</div>'+
              '<div class="mav-review">'+
                '<label class="inv-l">Verification notes <span style="font-weight:400;color:var(--muted)">(optional when approving)</span>'+
                  '<textarea data-child-verification-note="'+esc(a.id)+'" placeholder="What did you verify? If requesting changes, explain exactly what still needs to be done.">'+esc(a.verification_note||"")+'</textarea>'+
                '</label>'+
                '<div class="wizard-required" data-child-verification-required="'+esc(a.id)+'">Add a reviewer note explaining the requested changes.</div>'+
                '<div class="multi-action-verification-actions">'+
                  '<button class="multi-action-request-changes" type="button" data-child-request-changes="'+esc(a.id)+'">Send back for changes</button>'+
                  '<button class="wizard-primary" type="button" data-child-verify-action="'+esc(a.id)+'">Verify action</button>'+
                '</div>'+
              '</div>';
          } else {
            review='<div class="multi-action-verifier-note"><b>Verification required</b>An authorized reviewer must review the completed work and either verify it or send it back for changes.</div>';
          }
        } else if(status==="changes_requested"){
          review='<div class="ops-alert critical"><b>Changes requested</b>'+esc(a.verification_note||"The reviewer requested additional work.")+'</div>'+
            '<div class="multi-action-verifier-note"><b>Waiting for owner</b>'+esc(owner)+' must update and resubmit this corrective action.</div>';
        } else {
          review='<div class="multi-action-verifier-note"><b>Not ready for verification</b>This action must be completed and submitted by '+esc(owner)+' before a reviewer can verify it.</div>';
        }

        return '<div class="multi-action-verification-card ca-status-'+esc(status)+'" data-child-verification-card="'+esc(a.id)+'">'+
          '<div class="mav-head"><div class="mav-title"><b>Corrective Action #'+esc(a.action_number||"")+'</b><span>Owner: '+esc(owner)+'</span></div><span class="multi-action-status mas-status-'+esc(status)+'">'+esc(actionStatusLabel(status))+'</span></div>'+
          '<div class="mav-desc">'+esc(a.description||"No description recorded.")+'</div>'+
          (a.completion_note?'<div class="multi-action-completion-note"><b>Completed work submitted</b>'+esc(a.completion_note)+(a.completed_at?'<div class="action-meta">Submitted '+esc(fmtDate(a.completed_at))+(completedBy?' by '+esc(completedBy):'')+'</div>':'')+'</div>':'')+
          '<div class="evidence-panel" data-action-evidence data-corrective-action-id="'+esc(a.id)+'"></div>'+
          review+
        '</div>';
      }).join(""):(allVerified?
        '<div class="multi-action-stage-note"><b>All corrective actions are verified.</b> Nothing else needs a verification decision.</div>':
        '<div class="multi-action-stage-note"><b>No actions are waiting for a decision.</b> Returned actions will appear in Complete Work.</div>');

      var reviewStatusHtml=!isResolvedReport(r)&&returnedCount>0&&awaitingCount>0?
        '<div class="multi-action-review-status"><b>'+returnedCount+' action'+(returnedCount===1?' has':'s have')+' been sent back.</b><span>Finish reviewing the '+awaitingCount+' action'+(awaitingCount===1?'':'s')+' still waiting. Returned actions will then appear by themselves in Complete Work.</span></div>':'';

      var footerHtml=
        '<div class="multi-action-verification-footer">'+
          '<div class="mavf-status"><b>'+verifiedCount+' of '+allRows.length+' corrective action'+(allRows.length===1?'':'s')+' verified.</b>'+
          (allVerified?' All corrective actions are complete. Continue to the final Close step.':
            (returnedCount>0&&awaitingCount===0?' Returned work must be updated before verification can finish.':
              (' '+awaitingCount+' action'+(awaitingCount===1?' is':'s are')+' still waiting for a decision.')))+
          '</div>'+
          (allVerified&&!isResolvedReport(r)?'<button class="wizard-primary" type="button" data-all-actions-verified>All actions verified — Continue to Close</button>':'')+
        '</div>';

      // Build the complete DOM once. Do not mutate innerHTML after evidence
      // rendering starts, or the browser destroys the evidence nodes/listeners.
      multiActionVerificationStage.innerHTML=reviewStatusHtml+cardsHtml+footerHtml;

      Array.prototype.slice.call(multiActionVerificationStage.querySelectorAll("[data-action-evidence][data-corrective-action-id]")).forEach(function(panel){
        var aid=panel.getAttribute("data-corrective-action-id");
        var action=actionPlanState.actions.find(function(x){return String(x.id||"")===String(aid||"");});
        if(action) renderActionEvidence(r,panel,auditEl,action).catch(function(ex){console.error("action evidence",ex);});
      });
    }

    function renderMultiActionCompletion(){
      var legacyCompletion=detail.querySelector("[data-action-completion]");
      var legacyVerification=detail.querySelector("[data-action-verification]");
      var summary=syncCorrectiveActionSummary();
      if(!summary){
        if(multiActionCompletionEl){multiActionCompletionEl.innerHTML="";multiActionCompletionEl.hidden=true;}
        if(multiActionVerificationStage){multiActionVerificationStage.innerHTML="";multiActionVerificationStage.hidden=true;}
        if(legacyCompletion) legacyCompletion.hidden=false;
        if(legacyVerification) legacyVerification.hidden=false;
        return;
      }
      if(legacyCompletion) legacyCompletion.hidden=true;
      if(legacyVerification) legacyVerification.hidden=true;
      if(multiActionVerificationStage) multiActionVerificationStage.hidden=false;
      if(!multiActionCompletionEl) return;
      multiActionCompletionEl.hidden=false;
      var allRows=actionPlanState.actions.filter(function(a){return !!a.id&&correctiveActionInCurrentCycle(a,r);});
      var rows=allRows.filter(function(a){return ["awaiting_verification","verified"].indexOf(String(a.status||"not_started"))<0;});
      if(!rows.length){
        multiActionCompletionEl.innerHTML='<div class="multi-action-stage-note"><b>No work needs updating here.</b> Submitted actions are shown in Verify work below.</div>';
        return;
      }
      multiActionCompletionEl.innerHTML=rows.map(function(a){
        var owner=a.owner_user_id&&profileById[String(a.owner_user_id)]?profileName(profileById[String(a.owner_user_id)]):"Not assigned";
        var control=a.control_type?(controlTypeLabel(a.control_type)||a.control_type):"Not selected";
        var due=a.due_date?fmtDate(a.due_date):"No due date";
        var priority=a.priority?String(a.priority).charAt(0).toUpperCase()+String(a.priority).slice(1):"No priority";
        var status=String(a.status||"not_started"), editable=canCompleteCorrectiveAction(a)&&["not_started","in_progress","changes_requested"].indexOf(status)>=0;
        var completedBy=a.completed_by&&profileById[String(a.completed_by)]?profileName(profileById[String(a.completed_by)]):"";
        var work="";
        if(status==="verified"){
          work='<div class="multi-action-completion-note"><b>Verified</b>'+(a.completion_note?esc(a.completion_note):"Completion recorded.")+(a.completed_at?'<div class="action-meta">Submitted '+esc(fmtDate(a.completed_at))+(completedBy?' by '+esc(completedBy):'')+'</div>':'')+'</div>';
        } else if(status==="awaiting_verification"){
          work='<div class="multi-action-completion-note"><b>Awaiting verification</b>'+esc(a.completion_note||"Completion submitted.")+(a.completed_at?'<div class="action-meta">Submitted '+esc(fmtDate(a.completed_at))+(completedBy?' by '+esc(completedBy):'')+'</div>':'')+'</div>';
        } else if(editable){
          work=(status==="changes_requested"&&a.verification_note?'<div class="ops-alert"><b>Changes requested</b>'+esc(a.verification_note)+'</div>':'')+
            '<div class="mac-work"><div class="action-missing-list"><b>Required:</b> Describe what was completed. Add any supporting evidence below before submitting. Evidence is optional unless your company requires it.</div><label class="inv-l">What was completed?<textarea data-child-completion-note="'+esc(a.id)+'" placeholder="Describe what was completed and anything the reviewer should know.">'+esc(a.completion_note||"")+'</textarea></label></div>';
        } else {
          work='<div class="multi-action-completion-note"><b>Assigned owner</b>'+esc(owner)+' must complete this corrective action before it can move to verification.</div>';
        }
        return '<div class="multi-action-completion-card ca-status-'+esc(status)+'" data-child-completion-card="'+esc(a.id)+'">'+
          '<div class="mac-head"><div class="mac-title"><b>Corrective Action #'+esc(a.action_number||"")+'</b><span>'+esc(owner)+'</span></div><span class="multi-action-status mas-status-'+esc(status)+'">'+esc(actionStatusLabel(status))+'</span></div>'+
          '<div class="mac-desc">'+esc(a.description||"No description recorded.")+'</div>'+
          '<div class="mac-meta"><span><b>Due:</b> '+esc(due)+'</span><span><b>Priority:</b> '+esc(priority)+'</span><span><b>Control:</b> '+esc(control)+'</span></div>'+
          work+
          '<div class="evidence-panel" data-action-evidence data-corrective-action-id="'+esc(a.id)+'"></div>'+
          (editable?'<div class="multi-action-completion-actions multi-action-submit-after-evidence"><button class="wizard-primary" type="button" data-submit-child-completion="'+esc(a.id)+'">'+(status==="changes_requested"?'Resubmit for verification →':'Submit for verification →')+'</button></div>':'')+
        '</div>';
      }).join("");
      Array.prototype.slice.call(multiActionCompletionEl.querySelectorAll("[data-action-evidence][data-corrective-action-id]")).forEach(function(panel){
        var aid=panel.getAttribute("data-corrective-action-id");
        var action=actionPlanState.actions.find(function(x){return String(x.id||"")===String(aid||"");});
        if(action) renderActionEvidence(r,panel,auditEl,action).catch(function(ex){console.error("action evidence",ex);});
      });
    }
    function correctiveActionMissingFields(a){
      var missing=[];
      if(!String(a.description||"").trim()) missing.push("what needs to be fixed");
      if(!a.control_type) missing.push("control type");
      if(!a.owner_user_id) missing.push("owner");
      if(!a.due_date) missing.push("due date");
      if(!a.priority) missing.push("priority");
      return missing;
    }
    function refreshPlanCardFieldProgress(card){
      if(!card) return;
      var labels={description:"what needs to be fixed",control_type:"control type",owner_user_id:"owner",due_date:"due date",priority:"priority"};
      var missing=[];
      Object.keys(labels).forEach(function(key){
        var field=card.querySelector('[data-action-field="'+key+'"]');
        if(!field||!String(field.value||"").trim()) missing.push(labels[key]);
      });
      var progress=card.querySelector("[data-action-field-progress]");
      if(progress){
        progress.className="action-field-progress "+(missing.length?"missing":"complete");
        progress.textContent=missing.length?((5-missing.length)+" of 5 required fields"):"Plan complete ✓";
      }
      var msg=card.querySelector("[data-action-missing]");
      if(msg){
        msg.hidden=!missing.length;
        msg.innerHTML=missing.length?'<b>Still needed:</b> '+esc(missing.join(", "))+'.':'';
      }
    }
    function renderCorrectiveActionPlan(){
      renderCorrectiveActionOverview();
      if(!actionPlanList) return;
      if(actionPlanState.loading){ actionPlanList.innerHTML='<div class="multi-action-loading">Loading corrective-action plan…</div>'; return; }
      if(!actionPlanState.actions.length) actionPlanState.actions=[newLocalCorrectiveAction()];
      var editable=canEditStep(r,3);
      actionPlanList.innerHTML=actionPlanState.actions.map(function(a,idx){
        var status=String(a.status||"not_started");
        var locked=!!(a.id && ["awaiting_verification","verified","changes_requested"].indexOf(status)>=0);
        var disabled=(!editable||locked)?' disabled':'';
        var title=a.action_number?("Corrective Action #"+a.action_number):("New Corrective Action "+(idx+1));
        var live=!!a.activated_at;
        var missing=correctiveActionMissingFields(a), completeCount=5-missing.length;
        var owner=a.owner_user_id&&profileById[String(a.owner_user_id)]?profileName(profileById[String(a.owner_user_id)]):"Not assigned";
        var due=a.due_date?fmtDate(a.due_date):"No due date";
        var priority=a.priority?String(a.priority).charAt(0).toUpperCase()+String(a.priority).slice(1):"No priority";
        var control=a.control_type?(controlTypeLabel(a.control_type)||a.control_type):"Not selected";
        var progress='<span class="action-field-progress '+(missing.length?'missing':'complete')+'" data-action-field-progress>'+(missing.length?(completeCount+' of 5 required fields'):'Plan complete ✓')+'</span>';
        var missingHtml='<div class="action-missing-list" data-action-missing'+(missing.length?'':' hidden')+'>'+(missing.length?'<b>Still needed:</b> '+esc(missing.join(", "))+'.':'')+'</div>';
        var fields='<div class="multi-action-fields">'+
            '<label class="inv-l">What needs to be fixed?<textarea data-action-field="description" placeholder="Describe the specific fix or change needed."'+disabled+'>'+esc(a.description||"")+'</textarea><span class="field-guidance compact">Be specific enough that the assigned person knows exactly what to do.</span><div class="multi-action-translation" data-action-translation hidden></div></label>'+ 
            '<label class="inv-l">Control type<select data-action-field="control_type"'+disabled+'><option value="">— Select control type —</option><option value="elimination"'+(a.control_type==="elimination"?' selected':'')+'>Elimination — remove the hazard</option><option value="substitution"'+(a.control_type==="substitution"?' selected':'')+'>Substitution — replace the hazard</option><option value="engineering"'+(a.control_type==="engineering"?' selected':'')+'>Engineering control — isolate people from the hazard</option><option value="administrative"'+(a.control_type==="administrative"?' selected':'')+'>Administrative / work practice — change how work is performed</option><option value="ppe"'+(a.control_type==="ppe"?' selected':'')+'>PPE — protect the worker</option><option value="other"'+(a.control_type==="other"?' selected':'')+'>Other</option></select><span class="field-guidance compact">Choose the highest practical level in the hierarchy of controls.</span></label>'+ 
            '<label class="inv-l">Who will complete this?<select data-action-field="owner_user_id"'+disabled+'>'+assignmentOptions(a.owner_user_id||"")+'</select><span class="field-guidance compact">Choose the person responsible for this specific action.</span></label>'+ 
            '<div class="inv-row"><label class="inv-l">Due date<input type="date" data-action-field="due_date" value="'+esc(a.due_date||"")+'"'+disabled+'><span class="field-guidance compact">When should this work be finished?</span></label><label class="inv-l">Priority<select data-action-field="priority"'+disabled+'><option value="">— Choose priority —</option><option value="low"'+(a.priority==="low"?' selected':'')+'>Low</option><option value="medium"'+(a.priority==="medium"?' selected':'')+'>Medium</option><option value="high"'+(a.priority==="high"?' selected':'')+'>High</option></select><span class="field-guidance compact">How urgent is this action?</span></label></div>'+ 
          '</div>';
        var planBody=live?('<details class="action-plan-details"><summary>'+((!editable||locked)?'View plan details':'View / edit plan details')+' · '+esc(owner)+' · '+esc(due)+'</summary>'+fields+'</details>'):fields;
        var liveMessage=status==="verified"?"Work completed and verified.":(status==="awaiting_verification"?"Work submitted and waiting for verification.":(status==="changes_requested"?"The reviewer requested changes. Continue in Complete work below.":"Continue below to Complete work."));
        var liveNote=live?'<div class="multi-action-live-note"><b>Plan assigned</b>'+esc(control)+' · '+esc(priority)+' priority. '+esc(liveMessage)+' Open the plan details only if the plan itself needs attention.</div>':'';
        return '<div class="multi-action-card ca-status-'+esc(status)+(live?' is-activated':'')+(locked?' is-locked':'')+'" data-action-card data-action-index="'+idx+'">'+
          '<div class="multi-action-head"><div class="multi-action-title"><b>'+esc(title)+'</b><span>'+(live?'Assigned action':'Draft action')+(locked?' · plan locked while this action is in review':'')+'</span></div><div class="multi-action-head-actions">'+progress+'<span class="multi-action-status mas-status-'+esc(status)+'">'+esc(actionStatusLabel(status))+'</span><button class="multi-action-remove" type="button" data-remove-corrective-action="'+idx+'"'+((!editable||locked)?' disabled':'')+'>Remove</button></div></div>'+ 
          missingHtml+planBody+liveNote+
        '</div>';
      }).join("");
      if(actionPlanAdd){ actionPlanAdd.disabled=!editable || actionPlanState.actions.length>=25; actionPlanAdd.hidden=!editable&&planHasBeenActivated(); }
      refreshCorrectiveActionTranslations(r,detail,actionPlanState);
      syncCorrectiveActionSummary();
      renderCorrectiveActionOverview();
      renderMultiActionCompletion();
      renderMultiActionVerification();
      Array.prototype.slice.call(actionPlanList.querySelectorAll("[data-action-card]")).forEach(refreshPlanCardFieldProgress);
    }
    function syncCorrectiveActionStateFromUi(){
      if(!actionPlanList) return;
      actionPlanList.querySelectorAll("[data-action-card]").forEach(function(card){
        var idx=parseInt(card.getAttribute("data-action-index"),10), a=actionPlanState.actions[idx]; if(!a) return;
        card.querySelectorAll("[data-action-field]").forEach(function(field){ a[field.getAttribute("data-action-field")]=field.value||""; });
      });
    }
    function correctiveActionPayload(){
      syncCorrectiveActionStateFromUi();
      return actionPlanState.actions.map(function(a){return {id:a.id||undefined,description:String(a.description||"").trim(),control_type:a.control_type||null,owner_user_id:a.owner_user_id||null,due_date:a.due_date||null,priority:a.priority||null};});
    }
    function validateCorrectiveActionPlan(requireComplete){
      syncCorrectiveActionStateFromUi();
      var missing=[];
      if(!actionPlanState.actions.length) missing.push("at least one corrective action");
      actionPlanState.actions.forEach(function(a,idx){
        var label=a.action_number?("Action #"+a.action_number):("Action "+(idx+1));
        if(!String(a.description||"").trim()) missing.push(label+" description");
        if(requireComplete){
          if(!a.control_type) missing.push(label+" control type");
          if(!a.owner_user_id) missing.push(label+" owner");
          if(!a.due_date) missing.push(label+" due date");
          if(!a.priority) missing.push(label+" priority");
        }
      });
      return missing;
    }
    async function loadCorrectiveActionPlan(){
      actionPlanState.loading=true; renderCorrectiveActionPlan();
      var res=await sb.from("report_corrective_actions").select("id,report_id,organization_id,workflow_generation,action_number,description,control_type,owner_user_id,due_date,priority,status,completion_note,completed_at,completed_by,verifier_user_id,verification_note,verified_at,verified_by,activated_at,activation_reopen_count,retired_at").eq("report_id",r.id).eq("workflow_generation",parseInt(r.workflow_restart_count||0,10)).is("retired_at",null).order("action_number",{ascending:true});
      if(res.error) throw res.error;
      actionPlanState.actions=(res.data||[]).map(function(a){return Object.assign({},a,{control_type:a.control_type||"",owner_user_id:a.owner_user_id||"",due_date:a.due_date||"",priority:a.priority||""});});
      // Keep My Work and the Corrective Actions list synchronized immediately
      // when a child action is submitted, verified, or sent back from the full incident workflow.
      actionPlanState.actions.forEach(function(a){ if(a&&a.id) replaceGlobalCorrectiveAction(a); });
      if(!actionPlanState.actions.length) actionPlanState.actions=[newLocalCorrectiveAction()];
      actionPlanState.loading=false; actionPlanState.loaded=true; renderCorrectiveActionPlan();
      refreshRecordWorkflow(r,detail);
      var current=parseInt(detail.dataset.wizardStep||"0",10)||recommendedWizardStep(r), rec=recommendedWizardStep(r);
      if(!wizardStepAccessible(r,current) || (current===6 && rec<6)) setWizardStep(detail,r,rec,true);
    }
    async function refreshReportAfterPlanActivation(){
      var rr=await sb.from("reports").select("*").eq("id",r.id).single();
      if(rr.error) throw rr.error;
      Object.keys(rr.data||{}).forEach(function(k){r[k]=rr.data[k];});
      $("incidentSummary").innerHTML='<div class="is-badges">'+incidentBadgeHtml(r)+'</div><div class="is-desc">'+esc(r.description||"No description provided.")+'</div>';
    }
    async function emailActivatedCorrectiveActions(actions){
      var results=[];
      for(var i=0;i<(actions||[]).length;i++) results.push(await sendCorrectiveActionAssignmentEmail(r,actions[i]));
      return results;
    }
    async function persistActionPlan(showToast,assign){
      if(!canEditStep(r,3)) throw new Error("NOT_AUTHORIZED");
      if(actionPlanState.loading) throw new Error("PLAN_STILL_LOADING");
      var req=detail.querySelector('[data-required="3"]');
      var missing=validateCorrectiveActionPlan(!!assign);
      if(missing.length){
        if(req){req.textContent=(assign?"Still required: ":"Add a description before saving: ")+missing.join(", ")+".";req.classList.add("show");}
        throw new Error(assign?"PLAN_INCOMPLETE":"PLAN_DESCRIPTION_REQUIRED");
      }
      if(req) req.classList.remove("show");
      var wasActivated=planHasBeenActivated();
      var save=await sb.rpc("rbh_save_corrective_action_plan",{p_report_id:r.id,p_actions:correctiveActionPayload()});
      if(save.error) throw save.error;
      await loadCorrectiveActionPlan();
      var activation=null, emailResults=[];
      if(assign || wasActivated){
        activation=await sb.rpc("rbh_activate_corrective_action_plan",{p_report_id:r.id});
        if(activation.error) throw activation.error;
        await refreshReportAfterPlanActivation();
        await loadCorrectiveActionPlan();
        emailResults=await emailActivatedCorrectiveActions((activation.data&&activation.data.actions)||actionPlanState.actions);
      }
      loadAudit(r.id,auditEl); refreshOverdue(r,wrap); refreshRecordWorkflow(r,detail); renderMetrics(); renderHomeSnapshot(); renderMyWork(); renderActions();
      if(showToast) toast(wasActivated?"Active action plan updated":"Action plan saved","ok");
      return {ok:true,activation:activation&&activation.data,emailResults:emailResults};
    }

    if(actionPlanAdd) actionPlanAdd.addEventListener("click",function(){
      if(!canEditStep(r,3)||actionPlanState.actions.length>=25) return;
      syncCorrectiveActionStateFromUi(); actionPlanState.actions.push(newLocalCorrectiveAction()); renderCorrectiveActionPlan();
      var cards=actionPlanList.querySelectorAll("[data-action-card]"); var last=cards[cards.length-1]; if(last){var ta=last.querySelector('textarea[data-action-field="description"]'); if(ta) ta.focus();}
    });
    if(actionPlanList) actionPlanList.addEventListener("click",function(e){
      var btn=e.target.closest("[data-remove-corrective-action]"); if(!btn||btn.disabled||!canEditStep(r,3)) return;
      var idx=parseInt(btn.getAttribute("data-remove-corrective-action"),10); if(isNaN(idx)) return;
      if(actionPlanState.actions.length<=1){toast("Keep at least one corrective action in the plan.","err");return;}
      syncCorrectiveActionStateFromUi(); actionPlanState.actions.splice(idx,1); renderCorrectiveActionPlan();
    });
    if(actionPlanList) actionPlanList.addEventListener("input",function(e){ var req=detail.querySelector('[data-required="3"]'); if(req)req.classList.remove("show"); refreshPlanCardFieldProgress(e.target.closest("[data-action-card]")); });
    if(actionPlanList) actionPlanList.addEventListener("change",function(e){ var req=detail.querySelector('[data-required="3"]'); if(req)req.classList.remove("show"); refreshPlanCardFieldProgress(e.target.closest("[data-action-card]")); });
    if(multiActionCompletionEl) multiActionCompletionEl.addEventListener("click",async function(e){
      var btn=e.target.closest("[data-submit-child-completion]"); if(!btn||btn.disabled) return;
      var actionId=btn.getAttribute("data-submit-child-completion"), a=actionPlanState.actions.find(function(x){return String(x.id||"")===String(actionId||"");});
      if(!a||!canCompleteCorrectiveAction(a)){toast("Only this corrective-action owner or an Admin/Safety Manager can submit the work.","err");return;}
      var card=btn.closest("[data-child-completion-card]"), ta=card&&card.querySelector("[data-child-completion-note]"), note=ta?ta.value.trim():"";
      if(!note){toast("Describe what was completed before submitting this action for verification.","err");if(ta)ta.focus();return;}
      btn.disabled=true;
      try{
        await waitForActionEvidenceUpload(r.id,a.id);
        var res=await sb.rpc("rbh_submit_corrective_action_completion",{p_action_id:a.id,p_completion_note:note});
        if(res.error) throw res.error;
        await loadCorrectiveActionPlan();
        var submittedAction=actionPlanState.actions.find(function(x){return String(x.id||"")===String(a.id||"");})||a;
        var verificationEmail=await sendCorrectiveActionVerificationRequestedEmail(r,submittedAction);
        loadAudit(r.id,auditEl); renderHomeSnapshot(); renderMyWork(); renderActions(); refreshRecordWorkflow(r,detail);
        var summary=correctiveActionSummary(r);
        if(summary&&summary.open===0) setWizardStep(detail,r,5,true); else setWizardStep(detail,r,4,true);
        if(!verificationEmail || (!verificationEmail.sent&&!verificationEmail.skipped&&verificationEmail.ok===false)){
          console.error("action verification-request email failed",verificationEmail);
          toast("Corrective Action #"+a.action_number+" was submitted, but the verification email could not be sent.","err");
        } else {
          toast("Corrective Action #"+a.action_number+" submitted for verification","ok");
        }
      }catch(ex){console.error(ex);toast("Could not submit this corrective action.","err");}
      finally{if(btn.isConnected)btn.disabled=false;}
    });

    if(multiActionVerificationStage) multiActionVerificationStage.addEventListener("click",async function(e){
      var allVerifiedBtn=e.target.closest("[data-all-actions-verified]");
      if(allVerifiedBtn){
        var finalSummary=syncCorrectiveActionSummary();
        if(!finalSummary||finalSummary.total<1||finalSummary.verified!==finalSummary.total){
          toast("Every corrective action must be verified before continuing to Close.","err");
          return;
        }
        setWizardStep(detail,r,6,true);
        toast("All corrective actions verified — ready for final closure","ok");
        return;
      }

      var verifyBtn=e.target.closest("[data-child-verify-action]");
      var changesBtn=e.target.closest("[data-child-request-changes]");

      if(verifyBtn){
        var verifyId=verifyBtn.getAttribute("data-child-verify-action");
        var verifyAction=actionPlanState.actions.find(function(x){return String(x.id||"")===String(verifyId||"");});
        if(!verifyAction||!canVerifyCorrectiveAction(verifyAction)){toast("You do not have verification permission for this corrective action.","err");return;}
        var verifyCard=verifyBtn.closest("[data-child-verification-card]");
        var verifyNoteEl=verifyCard&&verifyCard.querySelector("[data-child-verification-note]");
        var verifyNote=(verifyNoteEl&&verifyNoteEl.value.trim())||null;
        verifyBtn.disabled=true;
        try{
          await waitForActionEvidenceUpload(r.id,verifyAction.id);
          await releaseLegacyCorrectiveActionVerifier(verifyAction);
          var verifyRes=await sb.rpc("rbh_verify_corrective_action",{p_action_id:verifyAction.id,p_verification_note:verifyNote});
          if(verifyRes.error) throw verifyRes.error;
          await loadCorrectiveActionPlan();
          await loadNotifications(true);
          loadAudit(r.id,auditEl); renderHomeSnapshot(); renderMyWork(); renderActions(); refreshRecordWorkflow(r,detail);
          var verifySummary=correctiveActionSummary(r);
          if(verifySummary&&verifySummary.verified===verifySummary.total){
            setWizardStep(detail,r,5,true);
            toast("Corrective Action #"+verifyAction.action_number+" verified — all corrective actions are verified","ok");
          } else if(verifySummary&&verifySummary.awaiting===0&&verifySummary.changes_requested>0){
            setWizardStep(detail,r,4,true);
            toast("Corrective Action #"+verifyAction.action_number+" verified — returned action"+(verifySummary.changes_requested===1?" is":"s are")+" ready for updates","ok");
          } else {
            setWizardStep(detail,r,5,true);
            toast("Corrective Action #"+verifyAction.action_number+" verified","ok");
          }
        }catch(ex){console.error(ex);toast("Could not verify this corrective action.","err");}
        finally{if(verifyBtn.isConnected)verifyBtn.disabled=false;}
        return;
      }

      if(changesBtn){
        var changesId=changesBtn.getAttribute("data-child-request-changes");
        var changesAction=actionPlanState.actions.find(function(x){return String(x.id||"")===String(changesId||"");});
        if(!changesAction||!canVerifyCorrectiveAction(changesAction)){toast("You do not have verification permission for this corrective action.","err");return;}
        var changesCard=changesBtn.closest("[data-child-verification-card]");
        var changesNoteEl=changesCard&&changesCard.querySelector("[data-child-verification-note]");
        var changesNote=(changesNoteEl&&changesNoteEl.value.trim())||"";
        var changesReq=changesCard&&changesCard.querySelector("[data-child-verification-required]");
        if(!changesNote){
          if(changesReq) changesReq.classList.add("show");
          toast("Explain what still needs to be changed before sending this action back.","err");
          if(changesNoteEl) changesNoteEl.focus();
          return;
        }
        if(changesReq) changesReq.classList.remove("show");
        changesBtn.disabled=true;
        try{
          await waitForActionEvidenceUpload(r.id,changesAction.id);
          await releaseLegacyCorrectiveActionVerifier(changesAction);
          var changesRes=await sb.rpc("rbh_request_corrective_action_changes",{p_action_id:changesAction.id,p_verification_note:changesNote});
          if(changesRes.error) throw changesRes.error;
          await loadCorrectiveActionPlan();
          var refreshedChangesAction=actionPlanState.actions.find(function(x){return String(x.id||"")===String(changesAction.id||"");})||changesAction;
          var changesEmail=await sendCorrectiveActionChangesRequestedEmail(r,refreshedChangesAction);
          await loadNotifications(true);
          loadAudit(r.id,auditEl); renderHomeSnapshot(); renderMyWork(); renderActions(); refreshRecordWorkflow(r,detail);
          var changesSummary=correctiveActionSummary(r);
          if(changesSummary&&changesSummary.awaiting>0) setWizardStep(detail,r,5,true);
          else setWizardStep(detail,r,4,true);
          if(!changesEmail || (!changesEmail.sent&&!changesEmail.skipped&&changesEmail.ok===false)){
            console.error("action changes-requested email failed",changesEmail);
            toast("Changes were requested for Corrective Action #"+changesAction.action_number+", but the owner email could not be sent.","err");
          } else if(changesSummary&&changesSummary.awaiting>0){
            toast("Corrective Action #"+changesAction.action_number+" sent back — continue reviewing the remaining actions","ok");
          } else {
            toast("Corrective Action #"+changesAction.action_number+" sent back — only returned work is shown now","ok");
          }
        }catch(ex){console.error(ex);toast("Could not request changes for this corrective action.","err");}
        finally{if(changesBtn.isConnected)changesBtn.disabled=false;}
      }
    });

    loadCorrectiveActionPlan().catch(function(ex){console.error("corrective action plan load",ex);actionPlanState.loading=false;if(actionPlanList)actionPlanList.innerHTML='<div class="wizard-required show">Could not load the corrective-action plan. Refresh the record and try again.</div>';if(actionPlanAdd)actionPlanAdd.disabled=true;if(actionPlanSave)actionPlanSave.disabled=true;});

    if(rootSave) rootSave.addEventListener("click",async function(){ rootSave.disabled=true; try{await waitForInvestigationEvidenceUpload();await persistInvestigation(true);rootSaved.hidden=false;setTimeout(function(){rootSaved.hidden=true;},2200);showView("home");}catch(ex){console.error(ex);toast("Could not save the investigation.","err");}finally{rootSave.disabled=!canEditStep(r,2);} });
    if(actionPlanSave) actionPlanSave.addEventListener("click",async function(){ actionPlanSave.disabled=true; try{await persistActionPlan(true,false);actionPlanSaved.hidden=false;setTimeout(function(){actionPlanSaved.hidden=true;},2200);showView("home");}catch(ex){console.error(ex);if(ex&&ex.message!=="PLAN_DESCRIPTION_REQUIRED")toast("Could not save the action plan.","err");}finally{actionPlanSave.disabled=!canEditStep(r,3);} });

    detail.addEventListener("click",async function(e){
      if(e.target.closest("[data-reg-review-jump]")){ setWizardStep(detail,r,1,true); return; }
      var regReturn=e.target.closest("[data-reg-return-step]"); if(regReturn){
        var returnStep=parseInt(regReturn.getAttribute("data-reg-return-step")||"0",10)||recommendedWizardStep(r);
        setWizardStep(detail,r,returnStep,true); return;
      }
      var nav=e.target.closest("[data-wizard-nav]"); if(nav){
        var navStep=parseInt(nav.getAttribute("data-wizard-nav"),10);
        if(isResolvedReport(r)){ var target=detail.querySelector('[data-wizard-step="'+navStep+'"]'); if(target&&!target.hidden) scrollWizardStepIntoView(detail,navStep); return; }
        setWizardStep(detail,r,navStep,false); return;
      }
      if(e.target.closest("[data-wizard-top-save]")){ var n=parseInt(detail.dataset.wizardStep||"1",10); var b=detail.querySelector('[data-wizard-step="'+n+'"] [data-step-save="'+n+'"]'); if(b&&!b.disabled)b.click(); return; }
      if(e.target.closest("[data-wizard-top-complete]")){ var n2=parseInt(detail.dataset.wizardStep||"1",10); var b2=detail.querySelector('[data-wizard-step="'+n2+'"] [data-step-complete="'+n2+'"]'); if(b2&&!b2.disabled)b2.click(); return; }
    });

    var complete1=detail.querySelector('[data-step-complete="1"]'); if(complete1) complete1.addEventListener("click",async function(){
      if(!canEditStep(r,1)){toast("You do not have permission to acknowledge this report.","err");return;} complete1.disabled=true;
      try{
        /* Step 1 is acknowledgment/triage only. Do not change investigator ownership here.
           Ownership can be handled in Investigation without blocking the Review -> Investigation transition. */
        if(r.involves_injury){
          if(canVerify()){
            if(!(await persistRegulatoryReview(false))) return;
          } else if(["yes","no","pending"].indexOf(String(r.calosha_screening_status||""))<0){
            toast("An Admin or Safety Manager must complete the regulatory screening before this injury review can advance.","err"); return;
          }
        }
        if(r.status==="new") await updateStatus(r.id,"under_review",wrap,activeReopenStep(r)?2:null);
        else if(activeReopenStep(r)===1) await updateStatus(r.id,r.status,wrap,2);
        refreshRecordWorkflow(r,detail); setWizardStep(detail,r,2,true); loadAudit(r.id,auditEl); toast("Report acknowledged — continue to Investigation","ok");
      }
      catch(ex){console.error(ex);toast("Could not acknowledge the report.","err");} finally{if(complete1.isConnected)complete1.disabled=!canEditStep(r,1);} });

    var complete2=detail.querySelector('[data-step-complete="2"]'); if(complete2) complete2.addEventListener("click",async function(){
      if(!canEditStep(r,2)){toast("Only the assigned investigator or an Admin/Safety Manager can complete Investigation.","err");return;}
      var req=detail.querySelector('[data-required="2"]'), missing=[];
      if(!invFindings.value.trim()) missing.push("what happened");
      if(!invRoot.value.trim()) missing.push("why it happened");
      if(missing.length){if(req){req.textContent="Still required: "+missing.join(" and ")+".";req.classList.add("show");}toast("Answer both investigation questions before continuing.","err");return;}
      if(req)req.classList.remove("show"); complete2.disabled=true;
      try{await waitForInvestigationEvidenceUpload();await persistInvestigation(false,true);setWizardStep(detail,r,3,true);toast("Investigation complete — continue to Corrective Actions","ok");}catch(ex){console.error(ex);toast("Could not complete Investigation.","err");}finally{if(complete2.isConnected)complete2.disabled=!canEditStep(r,2);} });

    var complete3=detail.querySelector('[data-step-complete="3"]'); if(complete3) complete3.addEventListener("click",async function(){
      if(!canEditStep(r,3)){toast("Only the assigned investigator or an Admin/Safety Manager can assign the corrective actions.","err");return;}
      if(actionPlanState.loading){toast("The corrective-action plan is still loading.","err");return;}
      var miss=validateCorrectiveActionPlan(true), req=detail.querySelector('[data-required="3"]');
      if(miss.length){if(req){req.textContent="Still required: "+miss.join(", ")+".";req.classList.add("show");}toast("Complete the required fields for every corrective action first.","err");return;} if(req)req.classList.remove("show"); complete3.disabled=true;
      try{
        var result=await persistActionPlan(false,true);
        renderActionWorkflow(r,detail.querySelector("[data-action-completion]"),auditEl,detail,"complete");
        renderActionWorkflow(r,detail.querySelector("[data-action-verification]"),auditEl,detail,"verify");
        setWizardStep(detail,r,4,true);
        var emails=(result&&result.emailResults)||[], failed=emails.filter(function(x){return !x || (!x.sent&&!x.skipped);}), unavailable=emails.filter(function(x){return x&&x.skipped&&(x.reason==="NO_DASHBOARD_ASSIGNEE"||x.reason==="NO_ASSIGNEE_EMAIL");});
        if(failed.length){console.error("multi-action assignment notification failures",failed);toast("Actions assigned, but "+failed.length+" email notification"+(failed.length===1?"":"s")+" could not be sent.","err");}
        else if(unavailable.length){toast("Actions assigned. "+unavailable.length+" owner"+(unavailable.length===1?" has":"s have")+" no available assignment email.","ok");}
        else toast("Corrective actions assigned — owner notifications sent","ok");
      }catch(ex){console.error(ex);if(ex&&ex.message!=="PLAN_INCOMPLETE")toast("Could not assign the corrective actions.","err");}finally{if(complete3.isConnected)complete3.disabled=!canEditStep(r,3);} });

    renderActionWorkflow(r,detail.querySelector("[data-action-completion]"),auditEl,detail,"complete");
    renderActionWorkflow(r,detail.querySelector("[data-action-verification]"),auditEl,detail,"verify");
    renderCloseStep(r,detail.querySelector("[data-close-step]"),detail,auditEl);
    refreshRecordWorkflow(r,detail);

    loadAtts(r.id,detail.querySelector("[data-atts]"));
    renderInvestigationEvidence(r,detail.querySelector("[data-investigation-evidence]"),auditEl);
    var notesEl=detail.querySelector("[data-notes]"); loadNotes(r.id,notesEl); loadAudit(r.id,auditEl);
    var noteBtn=detail.querySelector(".add-note"); if(!canAddNotes(r))noteBtn.disabled=true; noteBtn.addEventListener("click",function(){if(canAddNotes(r))openNoteModal(r,wrap,notesEl);});
    var reopenBtn=detail.querySelector(".reopen-record-btn");
    if(reopenBtn){ reopenBtn.hidden=!canReopenReport(r); reopenBtn.addEventListener("click",function(){ if(canReopenReport(r)) openReopenModal(r,lastOperationalView); }); }
    var restartBtn=detail.querySelector(".restart-workflow-btn");
    if(restartBtn){ restartBtn.hidden=!canRestartWorkflow(r); restartBtn.addEventListener("click",function(){ if(canRestartWorkflow(r)) openRestartModal(r,lastOperationalView); }); }
    detail.querySelector(".pdf-btn").addEventListener("click",function(){ var ps=detail.querySelector(".pdf-language-select"); generatePdf(r,this,ps?ps.value:"viewer"); });
  }

  async function updateStatus(reportId, status, wrap, nextReopenStep){
    var r=null; allReports.forEach(function(x){ if(x.id===reportId) r=x; });
    if(!r) throw new Error("NOT_AUTHORIZED");
    if(status==="under_review" || (status===r.status && nextReopenStep)){
      if(!canEditStep(r,1)) throw new Error("NOT_AUTHORIZED");
    } else if(!canVerify()) throw new Error("MANAGER_REQUIRED");
    if((status==="no_action" || status==="duplicate") && !canVerify()) throw new Error("MANAGER_REQUIRED");
    if(status==="closed" && (!canVerify() || !canClose(r))) throw new Error("CORRECTIVE_ACTION_NOT_VERIFIED");
    var resolved=(status==="closed" || status==="no_action" || status==="duplicate");
    var patch={ status:status, closed_at: resolved ? new Date().toISOString() : null };
    if(resolved && r.reopen_workflow_step) patch.reopen_workflow_step=null;
    else if(nextReopenStep && activeReopenStep(r)) patch.reopen_workflow_step=nextReopenStep;
    var res=await sb.from("reports").update(patch).eq("id",reportId);
    if(res.error) throw res.error;
    if(r){ Object.keys(patch).forEach(function(k){r[k]=patch[k];}); }
    if(wrap){
      var st=STATUS[status]||{l:status,c:"st-muted"};
      var badge=wrap.querySelector("[data-status-badge]");
      if(badge){ badge.className="badge "+st.c; badge.setAttribute("data-status-badge",""); badge.textContent=st.l; }
      var selx=wrap.querySelector(".status-select"); if(selx) selx.value=status;
      refreshOverdue(r, wrap);
    }
    var currentBody=$("incidentBody"); if(currentBody && currentBody.getAttribute("data-report-id")===String(reportId)) refreshRecordWorkflow(r,currentBody);
    renderMetrics(); renderHomeSnapshot();
  }

  var DISPOSITION_LABELS={no_issue:"No issue found",informational:"Informational only",not_safety:"Not safety-related",duplicate:"Duplicate report",other:"Other"};
  function openDispositionModal(r, wrap, notesEl, presetStatus){
    if(!r || !canVerify()){ toast("Only an Admin or Safety Manager can close a report without corrective action.","err"); return; }
    dispositionReport=r; dispositionWrap=wrap; dispositionNotesEl=notesEl;
    $("dHeading").textContent="Close report #"+r.ref_no+" — no corrective action";
    $("dReason").value=(presetStatus==="duplicate"?"duplicate":"no_issue");
    $("dNote").value=""; $("dErr").classList.remove("show");
    $("dispositionBackdrop").classList.add("open");
    setTimeout(function(){ $("dReason").focus(); },40);
  }
  function closeDispositionModal(){
    $("dispositionBackdrop").classList.remove("open");
    dispositionReport=null; dispositionWrap=null; dispositionNotesEl=null;
  }
  $("dispositionBackdrop").addEventListener("click",function(e){ if(e.target===$("dispositionBackdrop")) closeDispositionModal(); });
  $("dCancel").addEventListener("click",closeDispositionModal);
  document.addEventListener("keydown",function(e){ if(e.key==="Escape" && $("dispositionBackdrop").classList.contains("open")) closeDispositionModal(); });
  $("dSave").addEventListener("click",async function(){
    if(!dispositionReport) return;
    if(!canVerify()){ toast("Only an Admin or Safety Manager can close a report without corrective action.","err"); closeDispositionModal(); return; }
    var reason=$("dReason").value, note=$("dNote").value.trim(), err=$("dErr");
    if(!reason){ err.textContent="Choose a closure reason."; err.classList.add("show"); return; }
    if(reason==="other" && !note){ err.textContent="Add a short closure note when using Other."; err.classList.add("show"); return; }
    err.classList.remove("show");
    var btn=$("dSave"); btn.disabled=true; btn.textContent="Closing…";
    try{
      var status=(reason==="duplicate"?"duplicate":"no_action");
      var label=DISPOSITION_LABELS[reason]||"No corrective action required";
      var sess=(await sb.auth.getSession()).data.session; var email=(sess&&sess.user)?sess.user.email:null;
      var body=note||"Reviewed and closed without corrective action.";
      var ins=await sb.from("report_notes").insert({report_id:dispositionReport.id,organization_id:dispositionReport.organization_id||currentOrgId,title:"Closed without corrective action — "+label,body:body,author_email:email});
      if(ins.error) throw ins.error;
      var rid=dispositionReport.id, notesEl=dispositionNotesEl, wrap=dispositionWrap;
      await updateStatus(rid,status,wrap);
      closeDispositionModal();
      if(notesEl) loadNotes(rid,notesEl);
      applyFilters(); renderActions(); renderMyWork(); renderHomeSnapshot();
      toast("Report closed — no corrective action required","ok");
    }catch(ex){ console.error(ex); err.textContent="Could not close the report. Please try again."; err.classList.add("show"); }
    finally{ btn.disabled=false; btn.textContent="Close report"; }
  });

  function openReopenModal(r, returnView){
    if(!r || !canReopenReport(r)){ toast("Only an Admin or Safety Manager can reopen a resolved record.","err"); return; }
    reopenReport=r; reopenReturnView=returnView||lastOperationalView||"records";
    $("reopenHeading").textContent="Reopen record — Report #"+r.ref_no;
    $("reopenReason").value=""; $("reopenNote").value=""; $("reopenErr").classList.remove("show");
    $("reopenBackdrop").classList.add("open");
    setTimeout(function(){ $("reopenReason").focus(); },40);
  }
  function closeReopenModal(){
    $("reopenBackdrop").classList.remove("open"); reopenReport=null; reopenReturnView="records";
  }
  $("reopenBackdrop").addEventListener("click",function(e){ if(e.target===$("reopenBackdrop")) closeReopenModal(); });
  $("reopenCancel").addEventListener("click",closeReopenModal);
  document.addEventListener("keydown",function(e){ if(e.key==="Escape" && $("reopenBackdrop").classList.contains("open")) closeReopenModal(); });
  $("reopenSave").addEventListener("click",async function(){
    if(!reopenReport) return;
    if(!canReopenReport(reopenReport)){ toast("This record can no longer be reopened.","err"); closeReopenModal(); return; }
    var code=$("reopenReason").value, note=$("reopenNote").value.trim(), err=$("reopenErr");
    if(!code){ err.textContent="Choose a reason for reopening the record."; err.classList.add("show"); return; }
    if(!note){ err.textContent="Add a short explanation so the reopen action is documented."; err.classList.add("show"); return; }
    err.classList.remove("show");
    var btn=$("reopenSave"); btn.disabled=true; var old=btn.textContent; btn.textContent="Reopening…";
    var rid=reopenReport.id, backView=reopenReturnView;
    try{
      var res=await sb.rpc("rbh_reopen_report",{p_report_id:String(rid),p_reason_code:code,p_reason:note});
      if(res.error) throw res.error;
      closeReopenModal();
      await loadReports();
      var fresh=allReports.find(function(x){return String(x.id)===String(rid);});
      if(fresh){ openIncident(fresh,backView); } else { showView(backView||"records"); }
      toast("Record reopened at Step 1 — prior information carried forward","ok");
    }catch(ex){
      console.error(ex);
      err.textContent=(ex&&ex.message)?ex.message:"Could not reopen the record. Please try again."; err.classList.add("show");
    }finally{ btn.disabled=false; btn.textContent=old; }
  });

  function openRestartModal(r, returnView){
    if(!r || !canRestartWorkflow(r)){ toast("Only an Admin or Safety Manager can restart an open workflow that has progressed beyond the initial report.","err"); return; }
    restartReport=r; restartReturnView=returnView||lastOperationalView||"records";
    $("rHeading").textContent="Restart workflow — Report #"+r.ref_no;
    $("rReason").value=""; $("rNote").value=""; $("rErr").classList.remove("show");
    $("restartBackdrop").classList.add("open");
    setTimeout(function(){ $("rReason").focus(); },40);
  }
  function closeRestartModal(){
    $("restartBackdrop").classList.remove("open"); restartReport=null; restartReturnView="records";
  }
  $("restartBackdrop").addEventListener("click",function(e){ if(e.target===$("restartBackdrop")) closeRestartModal(); });
  $("rCancel").addEventListener("click",closeRestartModal);
  document.addEventListener("keydown",function(e){ if(e.key==="Escape" && $("restartBackdrop").classList.contains("open")) closeRestartModal(); });
  $("rSave").addEventListener("click",async function(){
    if(!restartReport) return;
    if(!canRestartWorkflow(restartReport)){ toast("This workflow can no longer be restarted.","err"); closeRestartModal(); return; }
    var code=$("rReason").value, note=$("rNote").value.trim(), err=$("rErr");
    if(!code){ err.textContent="Choose a reason for the restart."; err.classList.add("show"); return; }
    if(!note){ err.textContent="Add a short explanation so the restart is documented."; err.classList.add("show"); return; }
    err.classList.remove("show");
    var btn=$("rSave"); btn.disabled=true; var old=btn.textContent; btn.textContent="Restarting…";
    var rid=restartReport.id, backView=restartReturnView;
    try{
      var res=await sb.rpc("rbh_restart_workflow",{p_report_id:String(rid),p_reason_code:code,p_reason:note});
      if(res.error) throw res.error;
      closeRestartModal();
      await loadReports();
      var fresh=allReports.find(function(x){return String(x.id)===String(rid);});
      if(fresh){ openIncident(fresh,backView); }
      else { showView(backView||"records"); }
      toast("Workflow restarted — returned to Step 1","ok");
    }catch(ex){
      console.error(ex);
      err.textContent=(ex&&ex.message)?ex.message:"Could not restart the workflow. Please try again."; err.classList.add("show");
    }finally{ btn.disabled=false; btn.textContent=old; }
  });

  async function loadAtts(reportId, el){
    var seenAtts={};
    var atts=(attByReport[reportId]||[]).filter(function(a){
      if(isActionEvidence(a) || isInvestigationEvidence(a)) return false;
      var key=String(a.id||a.storage_path||"");
      if(seenAtts[key]) return false;
      seenAtts[key]=true;
      return true;
    });
    if(!atts.length){ el.innerHTML='<div class="muted small">No photos or files attached.</div>'; return; }
    el.innerHTML='<div class="muted small">Loading files\u2026</div>';
    try{
      var paths=atts.map(function(a){return a.storage_path;});
      var res=await sb.storage.from("report-attachments").createSignedUrls(paths, 3600);
      if(res.error) throw res.error;
      var box=document.createElement("div"); box.className="atts";
      (res.data||[]).forEach(function(d,i){ var a=atts[i]; if(!d||d.error||!d.signedUrl) return;
        var isImg=(a.mime_type||"").indexOf("image/")===0;
        var link=document.createElement("a"); link.href=d.signedUrl; link.target="_blank"; link.rel="noopener";
        if(isImg){ link.className="att-thumb"; var img=document.createElement("img"); img.src=d.signedUrl; img.loading="lazy"; img.alt=a.file_name||"photo"; link.appendChild(img); }
        else { link.className="att-file"; link.textContent="\ud83d\udcce "+(a.file_name||"file"); }
        box.appendChild(link);
      });
      el.innerHTML='<div class="d-atts-title">Photos &amp; files</div>'; el.appendChild(box);
    }catch(ex){ console.error(ex); el.innerHTML='<div class="muted small">Couldn\'t load files.</div>'; }
  }

  async function loadNotes(reportId, el){
    el.innerHTML='<div class="notes-empty">Loading notes\u2026</div>';
    try{
      var res=await sb.from("report_notes").select("*").eq("report_id",reportId).order("created_at",{ascending:false});
      if(res.error) throw res.error;
      var notes=(res.data||[]).filter(function(n){ return String(n.title||"").indexOf("[System]")!==0; });
      if(!notes.length){ el.innerHTML='<div class="notes-empty">No notes yet.</div>'; return; }
      el.innerHTML="";
      actionAudits.forEach(function(a){
        var oldS=a.old_snapshot||{}, newS=a.new_snapshot||{};
        var oldStatus=String(oldS.status||""), newStatus=String(newS.status||"");
        var title="Corrective Action #"+String(a.action_number||"")+" updated";
        var detail="";
        if(a.event_type==="created") title="Corrective Action #"+String(a.action_number||"")+" created";
        else if(a.event_type==="retired") title="Corrective Action #"+String(a.action_number||"")+" retired";
        else if(a.event_type==="restored") title="Corrective Action #"+String(a.action_number||"")+" restored";
        else if(oldStatus!==newStatus){
          if(newStatus==="awaiting_verification") title="Corrective Action #"+String(a.action_number||"")+" submitted for verification";
          else if(newStatus==="verified") title="Corrective Action #"+String(a.action_number||"")+" verified";
          else if(newStatus==="changes_requested") title="Changes requested for Corrective Action #"+String(a.action_number||"");
          else if(newStatus==="not_started"&&oldStatus) title="Corrective Action #"+String(a.action_number||"")+" reset for current workflow";
          else title="Corrective Action #"+String(a.action_number||"")+" status changed to "+actionLabel(newStatus);
        } else if(String(oldS.owner_user_id||"")!==String(newS.owner_user_id||"")){
          title="Corrective Action #"+String(a.action_number||"")+" owner updated";
        } else if(String(oldS.verifier_user_id||"")!==String(newS.verifier_user_id||"")){
          title="Corrective Action #"+String(a.action_number||"")+" verification owner updated";
        } else if(String(oldS.completion_note||"")!==String(newS.completion_note||"")){
          title="Corrective Action #"+String(a.action_number||"")+" completion updated";
        } else if(
          String(oldS.description||"")!==String(newS.description||"") ||
          String(oldS.control_type||"")!==String(newS.control_type||"") ||
          String(oldS.due_date||"")!==String(newS.due_date||"") ||
          String(oldS.priority||"")!==String(newS.priority||"")
        ){
          title="Corrective Action #"+String(a.action_number||"")+" plan updated";
        }
        if(newS.description) detail=String(newS.description);
        events.push({
          kind:"action",
          title:title,
          created_at:a.created_at,
          actor:a.actor_email?auditActor(a.actor_email):(a.actor_id&&profileById[String(a.actor_id)]?profileName(profileById[String(a.actor_id)]):"System"),
          detail:detail
        });
      });
      notes.forEach(function(n){
        var d=document.createElement("div"); d.className="note";
        var meta=fmtDate(n.created_at)+(n.author_email?("  \u00b7  "+n.author_email):"");
        d.innerHTML='<div class="note-title"></div><div class="note-meta"></div>'+(n.body?'<div class="note-body"></div>':"");
        d.querySelector(".note-title").textContent=n.title||"(untitled)";
        d.querySelector(".note-meta").textContent=meta;
        if(n.body) d.querySelector(".note-body").textContent=n.body;
        el.appendChild(d);
      });
    }catch(ex){ console.error(ex); el.innerHTML='<div class="notes-empty">Couldn\'t load notes.</div>'; }
  }

  /* ---------- Add-note modal ---------- */
  function openNoteModal(r, wrap, notesEl){
    modalReport=r; modalCard=wrap; modalNotesEl=notesEl;
    $("mHeading").textContent="Add note — Report #"+r.ref_no;
    $("mTitleInput").value=""; $("mBody").value=""; $("mErr").classList.remove("show");
    $("mStatus").value=r.status||"new";
    backdrop.classList.add("open");
    setTimeout(function(){ $("mTitleInput").focus(); }, 40);
  }
  function closeModal(){ backdrop.classList.remove("open"); modalReport=null; modalCard=null; modalNotesEl=null; }
  backdrop.addEventListener("click", function(e){ if(e.target===backdrop) closeModal(); });
  $("mCancel").addEventListener("click", closeModal);
  document.addEventListener("keydown", function(e){ if(e.key==="Escape" && backdrop.classList.contains("open")) closeModal(); });

  $("mSave").addEventListener("click", async function(){
    if(!modalReport) return;
    if(!canAddNotes(modalReport)){ toast("You do not have permission to add notes to this report.","err"); closeModal(); return; }
    var title=$("mTitleInput").value.trim(), body=$("mBody").value.trim(), err=$("mErr");
    if(!title){ err.textContent="Please enter a title for the note."; err.classList.add("show"); return; }
    err.classList.remove("show");
    var resolvedNote=isResolvedReport(modalReport);
    if(!resolvedNote && $("mStatus").value==="closed" && !canClose(modalReport)){ err.textContent="To close a report, document the root cause and corrective action, then complete and verify the corrective action."; err.classList.add("show"); return; }
    if(!resolvedNote && ($("mStatus").value==="no_action" || $("mStatus").value==="duplicate")){ err.textContent="Use Close without corrective action in the Incident workspace so the closure reason is documented."; err.classList.add("show"); return; }
    var btn=$("mSave"); btn.disabled=true; btn.textContent="Saving…";
    try{
      var sess=(await sb.auth.getSession()).data.session; var email=(sess&&sess.user)?sess.user.email:null;
      var ins=await sb.from("report_notes").insert({ report_id:modalReport.id, organization_id:modalReport.organization_id||currentOrgId, title:title, body:body||null, author_email:email });
      if(ins.error) throw ins.error;
      var newStatus=$("mStatus").value;
      if(!resolvedNote && newStatus && newStatus!==modalReport.status){ await updateStatus(modalReport.id, newStatus, modalCard); }
      var nEl=modalNotesEl, rid=modalReport.id;
      closeModal();
      if(nEl) loadNotes(rid, nEl);
      var openAudit=document.querySelector("#incidentBody [data-audit]"); if(openAudit) loadAudit(rid,openAudit);
      toast("Note added","ok");
    }catch(ex){ console.error(ex); err.textContent="Could not save the note. Please try again."; err.classList.add("show"); }
    finally{ btn.disabled=false; btn.textContent="Save note"; }
  });

  /* ---------- Metrics ---------- */
  function renderMetrics(){
    var m=$("metrics");
    if(!allReports.length){ m.style.display="none"; return; }
    m.style.display="block";
    var total=allReports.length, cNew=0, cProg=0, cClosed=0, cOverdue=0, cInjury=0;
    var byType={}, bySev={Critical:0,Serious:0,Moderate:0,Minor:0,Unspecified:0};
    var now=Date.now();
    allReports.forEach(function(r){
      if(r.status==="new") cNew++;
      if(r.status==="under_review"||r.status==="assigned"||r.status==="corrective_action") cProg++;
      if(r.status==="closed"||r.status==="no_action"||r.status==="duplicate") cClosed++;
      if(r.due_date && r.status!=="closed" && r.status!=="no_action" && r.status!=="duplicate"){
        var d=new Date(r.due_date).getTime(); if(!isNaN(d) && d<now) cOverdue++;
      }
      if(r.involves_injury) cInjury++;
      var t=r.report_type||"Other"; byType[t]=(byType[t]||0)+1;
      var s=sevShort(r.potential_severity);
      if(s==="Critical")bySev.Critical++; else if(s==="Serious")bySev.Serious++;
      else if(s==="Moderate")bySev.Moderate++; else if(s==="Minor")bySev.Minor++; else bySev.Unspecified++;
    });
    function stat(n,k,alert){ return '<div class="stat'+(alert?" alert":"")+'"><div class="n">'+n+'</div><div class="k">'+k+'</div></div>'; }
    function brk(title,obj){ var keys=Object.keys(obj).filter(function(k){return obj[k]>0;}); if(!keys.length) return "";
      return '<div class="brk"><h4>'+esc(title)+'</h4>'+keys.map(function(k){return '<div class="line"><span>'+esc(k)+'</span><span>'+obj[k]+'</span></div>';}).join("")+'</div>'; }
    m.innerHTML=
      '<div class="stat-row">'+stat(total,"Total")+stat(cNew,"New")+stat(cProg,"In progress")+stat(cClosed,"Closed")+stat(cInjury,"Injuries",cInjury>0)+stat(cOverdue,"Overdue",cOverdue>0)+'</div>'+
      '<div class="breaks">'+brk("By type",byType)+brk("By potential severity",bySev)+'</div>'+ monthChartHtml();
  }

  /* ---------- CSV export ---------- */
  var CSV_COLS=[
    ["ref_no","Reference"],["created_at","Submitted"],["status","Status"],["report_type","Type"],
    ["hazard_category","Hazard"],["potential_severity","Potential severity"],["description","Description"],
    ["people_involved","Involved / witnesses"],["immediate_action","Immediate action"],["suggested_fix","Suggested fix"],
    ["reporter_name","Reporter name"],["reporter_role","Reporter role"],["reporter_contact","Reporter contact"],
    ["language","Form language"],["involves_injury","Involves injury"],["job_site","Incident address"],["site_location","Specific location"],["observed_at","Observed at"],
    ["calosha_screening_status","Cal/OSHA serious-event screening"],["calosha_awareness_at","RBH awareness time"],
    ["investigator_user_id","Case owner / investigator user ID"],
    ["priority","Priority"],["likelihood","Likelihood"],["assigned_to","Assigned to"],
    ["assigned_user_id","Assigned dashboard user ID"],["action_status","Corrective action status"],
    ["investigation_findings","Investigation — what happened"],["root_cause","Investigation — why it happened"],["corrective_action","Corrective action"],["corrective_control_type","Control type"],["responsible_person","Responsible person"],
    ["due_date","Due date"],["action_completed_at","Action completed at"],["action_completion_note","Completion note"],
    ["action_verified_at","Action verified at"],["action_verification_note","Verification note"],
    ["closed_at","Closed at"],["workflow_restart_count","Workflow restart count"],["last_workflow_restart_at","Last workflow restart"],["id","Record ID"]
  ];
  function csvCell(v){ v=(v==null?"":String(v)); return /[",\n\r]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }
  function reportsToCsv(reports, notesByReport){
    var header=CSV_COLS.map(function(c){return c[1];}).concat([
      "Corrective action count",
      "Corrective actions",
      "Corrective action evidence",
      "Attachments",
      "Notes"
    ]);
    var lines=[header.map(csvCell).join(",")];
    reports.forEach(function(r){
      var cells=CSV_COLS.map(function(c){return csvCell(r[c[0]]);});
      var childActions=(allCorrectiveActions||[]).filter(function(a){
        return String(a.report_id||"")===String(r.id)
          && parseInt(a.workflow_generation||0,10)===parseInt(r.workflow_restart_count||0,10)
          && !a.retired_at;
      }).sort(function(a,b){return Number(a.action_number||0)-Number(b.action_number||0);});
      var childActionIds={};
      childActions.forEach(function(a){childActionIds[String(a.id)]=true;});
      var childText=childActions.map(function(a){
        var owner=a.owner_user_id&&profileById[String(a.owner_user_id)]?profileName(profileById[String(a.owner_user_id)]):"";
        return [
          "Action #"+String(a.action_number||""),
          "Description: "+String(a.description||""),
          "Owner: "+owner,
          "Control: "+String(a.control_type||""),
          "Due: "+String(a.due_date||""),
          "Priority: "+String(a.priority||""),
          "Status: "+String(a.status||""),
          "Completion: "+String(a.completion_note||""),
          "Verification: "+String(a.verification_note||"")
        ].join(" | ");
      }).join("  ||  ");
      var evidence=(attByReport[r.id]||[]).filter(function(a){return a.corrective_action_id&&childActionIds[String(a.corrective_action_id)];}).map(function(a){
        var ca=childActions.find(function(x){return String(x.id)===String(a.corrective_action_id);});
        return "Action #"+String(ca&&ca.action_number||"")+": "+String(a.file_name||a.storage_path||"");
      }).join(" | ");
      var atts=(attByReport[r.id]||[]).filter(function(a){return !a.corrective_action_id;}).map(function(a){return a.file_name||a.storage_path;}).join(" | ");
      var notes=(notesByReport[r.id]||[]).map(function(n){
        return fmtDate(n.created_at)+(n.author_email?(" "+n.author_email):"")+": "+(n.title||"")+(n.body?(" — "+n.body):"");
      }).join("  ||  ");
      cells.push(csvCell(childActions.length),csvCell(childText),csvCell(evidence),csvCell(atts),csvCell(notes));
      lines.push(cells.join(","));
    });
    return lines.join("\r\n");
  }
  function downloadFile(content, filename, mime){
    var blob=new Blob([content], {type:mime});
    var url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  }
  async function fetchAllNotes(){
    var map={};
    try{ var res=await sb.from("report_notes").select("*").order("created_at",{ascending:true});
      (res.data||[]).forEach(function(n){ (map[n.report_id]=map[n.report_id]||[]).push(n); }); }
    catch(e){ console.error(e); }
    return map;
  }
  async function exportCsv(which){
    var btn = which==="all" ? $("expAll") : $("expView");
    var lbl=btn.textContent; btn.disabled=true; btn.textContent="Exporting…";
    try{
      var notesMap=await fetchAllNotes();
      var data = which==="all" ? allReports : filtered;
      var csv=reportsToCsv(data, notesMap);
      var stamp=new Date().toISOString().slice(0,10);
      downloadFile("\ufeff"+csv, "rbh-safety-reports-"+which+"-"+stamp+".csv", "text/csv;charset=utf-8;");
    }catch(e){ console.error(e); toast("Export failed \u2014 please try again.","err"); }
    finally{ btn.disabled=false; btn.textContent=lbl; }
  }
  $("expView").addEventListener("click", function(){ exportCsv("view"); });
  $("expAll").addEventListener("click", function(){ exportCsv("all"); });

  /* ---------- After-action PDF | Phase 2.9.6 ---------- */
  async function generatePdf(r, btn, languageMode){
    if(!window.jspdf || !window.jspdf.jsPDF){ toast("PDF is still loading - try again in a moment.","err"); return; }
    var lbl=btn.textContent; btn.disabled=true; btn.textContent="Generating...";
    try{
      var notes=[];
      try{ var nr=await sb.from("report_notes").select("*").eq("report_id",r.id).order("created_at",{ascending:true}); notes=nr.data||[]; }catch(e){}
      var atts=attByReport[r.id]||[];
      try{ atts=await refreshReportAttachments(r.id); }catch(e){ console.warn("Could not refresh attachments before PDF export",e); }
      var audit=[];
      try{ var ar=await sb.from("report_audit").select("*").eq("report_id",r.id).order("created_at",{ascending:true}); audit=ar.data||[]; }catch(e){}
      var pdfActions=[];
      try{
        var car=await sb.from("report_corrective_actions")
          .select("id,workflow_generation,action_number,description,control_type,owner_user_id,due_date,priority,status,completion_note,completed_at,completed_by,verifier_user_id,verification_note,verified_at,verified_by,activated_at,activation_reopen_count,retired_at")
          .eq("report_id",r.id)
          .eq("workflow_generation",parseInt(r.workflow_restart_count||0,10))
          .is("retired_at",null)
          .order("action_number",{ascending:true});
        if(!car.error) pdfActions=car.data||[];
      }catch(e){}
      var pdfActionAudit=[];
      try{
        var caar=await sb.from("report_corrective_action_audit").select("*").eq("report_id",r.id).order("created_at",{ascending:true});
        if(!caar.error) pdfActionAudit=caar.data||[];
      }catch(e){}

      var pdfMode=languageMode||"viewer", pdfLang=(pdfMode==="original"?normalizeLanguageCode(r.language||"en"):(pdfMode==="viewer"?(activeIncident===r?activeIncidentLanguage:preferredReadingLanguage()):normalizeLanguageCode(pdfMode)));
      var pdfLabels={
        en:{notRecorded:"Not recorded",dashboardUser:"Dashboard user",reportWord:"Report",step:"STEP",workflow:["Review","Investigation","Corrective Actions","Close"],headerSubtitle:"Incident record - after-action summary",submitted:"Submitted",generated:"Generated",section1:"Report and review",section1Sub:"What was submitted and how the report entered the safety workflow.",reportType:"Report type",actualInjury:"Actual injury or illness",address:"Address of incident",specificSpot:"Specific spot on the site",whenNoticed:"When noticed",potentialSeverity:"Potential severity",hazardType:"Type of hazard",formLanguage:"Form language",describe:"Describe what you saw",noDescription:"No description recorded",involved:"Who or what was involved / any witnesses",immediate:"What was done right away",suggested:"What would fix it or prevent it",reporter:"Reporter",reportedBy:"Reported by",reporterRole:"Reporter role",reporterContact:"Reporter contact",reviewCompleted:"Review completed",reviewedBy:"Reviewed by",investigator:"Case owner / investigator",verifier:"Verification owner",workflowRestarts:"Workflow restarts",lastRestart:"Last restart",none:"None",originalFiles:"Original report photos and files",noOriginalFiles:"No original files attached",calosha:"Cal/OSHA serious-event screening",screeningResult:"Screening result",awareness:"RBH awareness time",screeningNote:"Screening note",screeningDisclaimer:"Management screening only. This application does not submit a report to Cal/OSHA and the screening does not replace required regulatory reporting.",section2:"Investigation",section2Sub:"Document what the investigation found and why it happened.",whatHappened:"What happened?",rootCause:"Why did it happen?",investigationEvidence:"Investigation evidence",noInvestigationEvidence:"No investigation evidence attached",notYetRecorded:"Not yet recorded",section3:"Corrective actions - Plan & assign",section3Sub:"Define the fix, ownership, due date, and priority.",correctiveRequired:"Corrective action required",actionNumber:"Corrective Action",actionStatus:"Action status",controlType:"Control type",assignedUser:"Assigned dashboard user",notAssigned:"Not assigned",responsible:"Responsible person / crew",dueDate:"Due date",priority:"Priority",section4:"Corrective actions - Complete work",section4Sub:"Record what was actually completed and the supporting evidence.",completedWork:"Completed work submitted",notYetSubmitted:"Not yet submitted",completedOn:"Completed on",completedBy:"Completed by",currentEvidence:"Current-workflow corrective-action evidence",noCurrentEvidence:"No corrective-action evidence attached in the current workflow",priorEvidence:"Preserved evidence from earlier workflow",section5:"Corrective actions - Verify work",section5Sub:"Show the review decision and any verification or change-request note.",verificationOutcome:"Verification outcome",verifiedOn:"Verified on",verifiedBy:"Verified by",requestedChanges:"Requested changes",reviewerNote:"Reviewer verification note",noVerificationNote:"No verification note recorded",section6:"Close record",section6Sub:"Final disposition and closure information for the incident.",recordStatus:"Record status",closedOn:"Closed on",notYetClosed:"Not yet closed",closedBy:"Closed by",closurePath:"Closure path",closureReason:"Closure reason",closureNote:"Closure note",additionalNotes:"Additional notes",activityHistory:"Activity history",reportSubmitted:"Report submitted",anonymousReporter:"Anonymous reporter",note:"Note",system:"System",footer:"RBH Insulation, Inc. | Confidential safety document | License #558799",page:"Page",yes:"Yes",no:"No",originalRecord:"Original record",appendixTitle:"Attachment Appendix",appendixSub:"Files preserved with this record at the time the PDF was generated.",attachment:"Attachment",source:"Source",uploaded:"Uploaded",fileType:"File type",fileSize:"File size",sha256:"SHA-256",sourceOriginal:"Original report attachment",sourceInvestigationEvidence:"Investigation evidence",sourceCurrentEvidence:"Corrective-action evidence",sourcePriorEvidence:"Earlier-workflow corrective-action evidence",embeddedOnly:"Source file embedded in PDF",embeddedOnlyBody:"This file type cannot be rendered reliably as visible PDF pages in the browser. The original source file is embedded inside this PDF package so it remains with the exported record.",pdfPages:"Source PDF pages follow",appendixCount:"Attachments included",appendixNote:"Removed attachments are not included; their removal remains documented in the activity history.",attachmentUnavailable:"Attachment could not be loaded",attachmentUnavailableBody:"This attachment could not be retrieved when the PDF was generated. Its metadata remains listed in the appendix.",summaryPage:"Summary page"},
        es:{notRecorded:"No registrado",dashboardUser:"Usuario del panel",reportWord:"Reporte",step:"PASO",workflow:["Revisión","Investigación","Acciones correctivas","Cerrar"],headerSubtitle:"Registro del incidente - resumen posterior a la acción",submitted:"Enviado",generated:"Generado",section1:"Reporte y revisión",section1Sub:"Lo que se envió y cómo el reporte ingresó al flujo de seguridad.",reportType:"Tipo de reporte",actualInjury:"Lesión o enfermedad real",address:"Dirección del incidente",specificSpot:"Lugar específico en la obra",whenNoticed:"Cuándo se observó",potentialSeverity:"Gravedad potencial",hazardType:"Tipo de peligro",formLanguage:"Idioma del formulario",describe:"Describa lo que vio",noDescription:"No se registró descripción",involved:"Quién o qué estuvo involucrado / testigos",immediate:"Qué se hizo de inmediato",suggested:"Qué lo corregiría o evitaría",reporter:"Reportante",reportedBy:"Reportado por",reporterRole:"Función del reportante",reporterContact:"Contacto del reportante",reviewCompleted:"Revisión completada",reviewedBy:"Revisado por",investigator:"Responsable / investigador",verifier:"Responsable de verificación",workflowRestarts:"Reinicios del flujo",lastRestart:"Último reinicio",none:"Ninguno",originalFiles:"Fotos y archivos del reporte original",noOriginalFiles:"No hay archivos originales adjuntos",calosha:"Evaluación de evento grave de Cal/OSHA",screeningResult:"Resultado de la evaluación",awareness:"Hora en que RBH tuvo conocimiento",screeningNote:"Nota de evaluación",screeningDisclaimer:"Solo evaluación de la gerencia. Esta aplicación no presenta un reporte a Cal/OSHA y la evaluación no reemplaza los reportes regulatorios requeridos.",section2:"Investigación",section2Sub:"Documente lo que determinó la investigación y por qué ocurrió.",whatHappened:"¿Qué pasó?",rootCause:"¿Por qué pasó?",investigationEvidence:"Evidencia de la investigación",noInvestigationEvidence:"No hay evidencia de investigación adjunta",notYetRecorded:"Aún no registrado",section3:"Acciones correctivas - Planificar y asignar",section3Sub:"Defina la corrección, el responsable, la fecha límite y la prioridad.",correctiveRequired:"Acción correctiva requerida",actionNumber:"Acción correctiva",actionStatus:"Estado de la acción",controlType:"Tipo de control",assignedUser:"Usuario asignado del panel",notAssigned:"No asignado",responsible:"Persona / equipo responsable",dueDate:"Fecha límite",priority:"Prioridad",section4:"Acciones correctivas - Completar trabajo",section4Sub:"Registre lo que realmente se completó y la evidencia de respaldo.",completedWork:"Trabajo completado enviado",notYetSubmitted:"Aún no enviado",completedOn:"Completado el",completedBy:"Completado por",currentEvidence:"Evidencia de acción correctiva del flujo actual",noCurrentEvidence:"No hay evidencia de acción correctiva adjunta en el flujo actual",priorEvidence:"Evidencia preservada de un flujo anterior",section5:"Acciones correctivas - Verificar trabajo",section5Sub:"Muestre la decisión de revisión y cualquier nota de verificación o solicitud de cambios.",verificationOutcome:"Resultado de la verificación",verifiedOn:"Verificado el",verifiedBy:"Verificado por",requestedChanges:"Cambios solicitados",reviewerNote:"Nota de verificación del revisor",noVerificationNote:"No se registró una nota de verificación",section6:"Cerrar registro",section6Sub:"Disposición final e información de cierre del incidente.",recordStatus:"Estado del registro",closedOn:"Cerrado el",notYetClosed:"Aún no cerrado",closedBy:"Cerrado por",closurePath:"Ruta de cierre",closureReason:"Motivo de cierre",closureNote:"Nota de cierre",additionalNotes:"Notas adicionales",activityHistory:"Historial de actividad",reportSubmitted:"Reporte enviado",anonymousReporter:"Reportante anónimo",note:"Nota",system:"Sistema",footer:"RBH Insulation, Inc. | Documento confidencial de seguridad | Licencia #558799",page:"Página",yes:"Sí",no:"No",originalRecord:"Registro original",appendixTitle:"Apéndice de archivos adjuntos",appendixSub:"Archivos preservados con este registro al momento de generar el PDF.",attachment:"Adjunto",source:"Origen",uploaded:"Cargado",fileType:"Tipo de archivo",fileSize:"Tamaño",sha256:"SHA-256",sourceOriginal:"Adjunto del reporte original",sourceInvestigationEvidence:"Evidencia de la investigación",sourceCurrentEvidence:"Evidencia de acción correctiva",sourcePriorEvidence:"Evidencia de acción correctiva de un flujo anterior",embeddedOnly:"Archivo fuente incorporado en el PDF",embeddedOnlyBody:"Este tipo de archivo no se puede representar de forma confiable como páginas PDF visibles en el navegador. El archivo fuente original está incorporado dentro de este paquete PDF para que permanezca con el registro exportado.",pdfPages:"Las páginas del PDF fuente siguen",appendixCount:"Adjuntos incluidos",appendixNote:"Los adjuntos eliminados no se incluyen; su eliminación permanece documentada en el historial de actividad.",attachmentUnavailable:"No se pudo cargar el adjunto",attachmentUnavailableBody:"No se pudo recuperar este adjunto cuando se generó el PDF. Sus metadatos permanecen listados en el apéndice.",summaryPage:"Página de resumen"}
      };
      var L=pdfLabels[pdfLang]||pdfLabels.en;
      if(!pdfLabels[pdfLang] && pdfMode!=="original"){
        var autoLabels=await translateTextMap(pdfLabels.en,pdfLang,"pdf-labels"); if(autoLabels) L=Object.assign({},pdfLabels.en,autoLabels);
      }
      var pdfFields=reportTranslationFields(r), pdfHistory=[];
      groupAuditRows(audit).forEach(function(g,i){ var title=auditGroupTitle(g.rows); pdfHistory.push({title:title,created_at:g.created_at,actor:auditActor(g.rows[0].actor_email),key:"history_"+i}); pdfFields["history_"+i]=title; });
      notes.filter(function(n){return /^\[System\]\s*Workflow restarted/i.test(String(n.title||""));}).forEach(function(n){ var title=String(n.title||"").replace(/^\[System\]\s*/,""); var key="history_restart_"+pdfHistory.length; pdfHistory.push({title:title,created_at:n.created_at,actor:auditActor(n.author_email),key:key}); pdfFields[key]=title; });
      pdfActionAudit.forEach(function(a){
        var oldS=a.old_snapshot||{}, newS=a.new_snapshot||{}, title="Corrective Action #"+String(a.action_number||"")+" updated";
        if(a.event_type==="created") title="Corrective Action #"+String(a.action_number||"")+" created";
        else if(a.event_type==="retired") title="Corrective Action #"+String(a.action_number||"")+" retired";
        else if(String(oldS.status||"")!==String(newS.status||"")){
          var ns=String(newS.status||"");
          title=ns==="verified"?"Corrective Action #"+String(a.action_number||"")+" verified":
            (ns==="awaiting_verification"?"Corrective Action #"+String(a.action_number||"")+" submitted for verification":
            (ns==="changes_requested"?"Changes requested for Corrective Action #"+String(a.action_number||""):
            "Corrective Action #"+String(a.action_number||"")+" status updated"));
        }
        var key="history_action_"+pdfHistory.length;
        pdfHistory.push({title:title,created_at:a.created_at,actor:a.actor_email?auditActor(a.actor_email):L.system,key:key});
        pdfFields[key]=title;
      });
      notes.forEach(function(n,i){ if(n.title) pdfFields["note_title_"+i]=String(n.title); if(n.body) pdfFields["note_body_"+i]=String(n.body); });
      pdfFields.status_value=(STATUS[r.status]||{l:r.status||"Unknown"}).l;
      if(r.action_status) pdfFields.verification_outcome=actionLabel(r.action_status||"not_started");
      if(r.calosha_screening_status) pdfFields.screening_result=caloshaScreenLabel(r.calosha_screening_status);
      pdfActions.forEach(function(a,i){
        if(a.description) pdfFields["ca_desc_"+i]=String(a.description);
        if(a.completion_note) pdfFields["ca_completion_"+i]=String(a.completion_note);
        if(a.verification_note) pdfFields["ca_verification_"+i]=String(a.verification_note);
      });
      pdfFields.closure_path=(r.status==="no_action"||r.status==="duplicate")?"Closed without corrective action":(r.status==="closed"?"Corrective action verified and record closed":"Record remains open");
      if(r.priority) pdfFields.priority_value=String(r.priority).charAt(0).toUpperCase()+String(r.priority).slice(1);
      if(r.corrective_control_type) pdfFields.control_type_value=controlTypeLabel(r.corrective_control_type,pdfLang)||r.corrective_control_type;
      // Only call the translation service when the requested PDF language actually
      // differs from the language in which the report was recorded. This keeps the
      // normal/original-language PDF path independent from the translation service.
      var sourcePdfLang=normalizeLanguageCode(r.language||"en");
      var needsPdfTranslation=(pdfMode!=="original" && pdfLang!==sourcePdfLang);
      var pdfTx={};
      if(needsPdfTranslation){
        pdfTx=await translateTextMap(pdfFields,pdfLang,"pdf:"+String(r.id));
        if(!pdfTx) throw new Error("TRANSLATION_UNAVAILABLE");
      }
      function PV(key,fallback){ return Object.prototype.hasOwnProperty.call(pdfTx,key)?pdfTx[key]:fallback; }

      var doc=new window.jspdf.jsPDF({unit:"pt",format:"letter"});
      var W=doc.internal.pageSize.getWidth(), H=doc.internal.pageSize.getHeight();
      var M=42, contentW=W-M*2, y=34;
      var C={
        red:[176,30,40], redDark:[138,20,28], ink:[22,22,22], black:[20,20,20],
        surface:[246,245,243], surface2:[239,237,234], line:[217,213,207],
        lineStrong:[195,189,180], muted:[108,104,98], green:[31,122,68],
        greenBg:[230,244,236], blue:[31,79,158], blueBg:[230,238,251],
        gray:[92,99,92], grayBg:[238,240,238], white:[255,255,255]
      };

      function safe(v){
        return String(v==null?"":v)
          .replace(/\u00a0/g," ")
          .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g,"-")
          .replace(/\u2192/g," to ").replace(/\u2190/g," from ")
          .replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"')
          .replace(/\u2022/g,"-").replace(/\u00b7/g,"|")
          .replace(/\u2713/g,"Complete").replace(/\u2026/g,"...");
      }
      function has(v){ return v!=null && String(v).trim()!==""; }
      function setText(c){ doc.setTextColor(c[0],c[1],c[2]); }
      function setFill(c){ doc.setFillColor(c[0],c[1],c[2]); }
      function setDraw(c){ doc.setDrawColor(c[0],c[1],c[2]); }
      function pdfDate(v){
        if(!v) return L.notRecorded;
        try{ return new Date(v).toLocaleString(undefined,{year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit"}); }
        catch(e){ return safe(v); }
      }
      function pdfDateOnly(v){
        if(!v) return L.notRecorded;
        try{
          var d=/^\d{4}-\d{2}-\d{2}$/.test(String(v))?new Date(String(v)+"T12:00:00"):new Date(v);
          return d.toLocaleDateString();
        }catch(e){ return safe(v); }
      }
      function userById(id){
        if(!id) return L.notRecorded;
        var p=profileById[String(id)];
        return p?profileName(p):L.dashboardUser;
      }
      function statusLabel(){ return safe((STATUS[r.status]||{l:r.status||"Unknown"}).l); }
      function pageChrome(continuation){
        setFill(C.black); doc.rect(0,0,W,10,"F");
        setFill(C.red); doc.rect(0,10,W,3,"F");
        if(continuation){
          doc.setFont("helvetica","bold"); doc.setFontSize(9); setText(C.ink);
          doc.text("RBH SAFETY",M,31);
          doc.setFont("helvetica","normal"); doc.setFontSize(8.5); setText(C.muted);
          var rt=L.reportWord+" #"+safe(r.ref_no);
          doc.text(rt,W-M-doc.getTextWidth(rt),31);
          setDraw(C.line); doc.setLineWidth(.7); doc.line(M,39,W-M,39);
          y=53;
        }
      }
      pageChrome(false);
      function newPage(){ doc.addPage(); pageChrome(true); }
      function ensure(space){ if(y+space>H-58) newPage(); }
      function linesFor(text,width,size){ doc.setFontSize(size||10); return doc.splitTextToSize(safe(text),width); }
      function rightText(text,x,yy){ text=safe(text); doc.text(text,x-doc.getTextWidth(text),yy); }
      function gap(n){ y+=(n==null?8:n); }

      function pill(text,fill,textColor,x,yy){
        text=safe(text).toUpperCase();
        doc.setFont("helvetica","bold"); doc.setFontSize(7.5);
        var w=doc.getTextWidth(text)+16;
        setFill(fill); doc.roundedRect(x,yy,w,19,9.5,9.5,"F");
        setText(textColor); doc.text(text,x+8,yy+12.5);
        return w;
      }
      function workflowBar(){
        var prog=workflowProgress(r), names=L.workflow;
        ensure(42);
        var groups=[[0],[1],[2,3,4],[5]], gapW=5, boxW=(contentW-gapW*3)/4, yy=y;
        groups.forEach(function(indexes,i){
          var states=indexes.map(function(idx){return prog.steps[idx]?prog.steps[idx].state:"needed";});
          var state=states.every(function(x){return x==="done"||x==="na";})?(states.every(function(x){return x==="na";})?"na":"done"):(states.indexOf("current")>=0?"current":"needed");
          var fill=C.grayBg, txt=C.gray;
          if(state==="done"){ fill=C.green; txt=C.white; }
          else if(state==="current"){ fill=C.blue; txt=C.white; }
          else if(state==="na"){ fill=C.surface2; txt=C.muted; }
          setFill(fill); doc.roundedRect(M+i*(boxW+gapW),yy,boxW,29,5,5,"F");
          doc.setFont("helvetica","bold"); doc.setFontSize(5.7); setText(txt);
          doc.text(L.step+" "+(i+1),M+i*(boxW+gapW)+7,yy+10);
          doc.setFontSize(7.2); doc.text(names[i],M+i*(boxW+gapW)+7,yy+21);
        });
        y+=39;
      }
      function section(step,title,subtitle){
        ensure(48);
        var h=38;
        setFill(C.surface); setDraw(C.line); doc.setLineWidth(.7); doc.roundedRect(M,y,contentW,h,7,7,"FD");
        setFill(C.red); doc.roundedRect(M+10,y+8,22,22,5,5,"F");
        doc.setFont("helvetica","bold"); doc.setFontSize(10); setText(C.white); doc.text(String(step),M+18,y+23);
        doc.setFont("helvetica","bold"); doc.setFontSize(11.5); setText(C.ink); doc.text(safe(title),M+42,y+17);
        if(subtitle){ doc.setFont("helvetica","normal"); doc.setFontSize(7.8); setText(C.muted); doc.text(safe(subtitle),M+42,y+29); }
        y+=h+9;
      }
      function subhead(title){
        ensure(24); doc.setFont("helvetica","bold"); doc.setFontSize(8.2); setText(C.red); doc.text(safe(title).toUpperCase(),M,y+9);
        y+=15;
      }
      function pairRow(items){
        items=(items||[]).filter(function(it){ return it && has(it.value); });
        if(!items.length) return;
        var cols=Math.min(2,items.length), gapW=8, cellW=(contentW-gapW*(cols-1))/cols;
        var rows=[]; for(var i=0;i<items.length;i+=cols) rows.push(items.slice(i,i+cols));
        rows.forEach(function(row){
          var heights=row.map(function(it){ var ls=linesFor(it.value,cellW-20,9.5); return Math.max(42,25+ls.length*11); });
          var h=Math.max.apply(null,heights); ensure(h+8);
          row.forEach(function(it,j){
            var x=M+j*(cellW+gapW);
            setFill(C.surface); setDraw(C.line); doc.roundedRect(x,y,cellW,h,6,6,"FD");
            doc.setFont("helvetica","bold"); doc.setFontSize(7); setText(C.muted); doc.text(safe(it.label).toUpperCase(),x+10,y+13);
            doc.setFont("helvetica",it.strong===false?"normal":"bold"); doc.setFontSize(9.5); setText(C.ink);
            var ls=linesFor(it.value,cellW-20,9.5); for(var k=0;k<ls.length;k++) doc.text(ls[k],x+10,y+28+k*11);
          });
          y+=h+8;
        });
      }
      function wideField(label,value,opts){
        opts=opts||{}; if(!has(value) && opts.skipEmpty!==false) return;
        value=has(value)?value:(opts.emptyText||"Not recorded");
        var ls=linesFor(value,contentW-22,9.5), h=Math.max(45,27+ls.length*11);
        ensure(h+8); setFill(opts.fill||C.surface); setDraw(C.line); doc.roundedRect(M,y,contentW,h,6,6,"FD");
        doc.setFont("helvetica","bold"); doc.setFontSize(7); setText(C.muted); doc.text(safe(label).toUpperCase(),M+11,y+14);
        doc.setFont("helvetica","normal"); doc.setFontSize(9.5); setText(C.ink); for(var i=0;i<ls.length;i++) doc.text(ls[i],M+11,y+30+i*11);
        y+=h+8;
      }
      function fileBox(label,list,emptyText){
        list=(list||[]).filter(Boolean); var display=list.length?list:[emptyText||L.none];
        var lineCount=0, wrapped=[];
        display.forEach(function(v){ var ls=linesFor(v,contentW-42,8.8); wrapped.push(ls); lineCount+=ls.length; });
        var h=29+lineCount*11+Math.max(0,display.length-1)*4; ensure(h+8);
        setFill(C.surface2); setDraw(C.line); doc.roundedRect(M,y,contentW,h,6,6,"FD");
        doc.setFont("helvetica","bold"); doc.setFontSize(7); setText(C.muted); doc.text(safe(label).toUpperCase(),M+11,y+14);
        var yy=y+29; display.forEach(function(v,idx){
          setFill(list.length?C.red:C.muted); doc.circle(M+15,yy-3,2.2,"F");
          doc.setFont("helvetica","normal"); doc.setFontSize(8.8); setText(C.ink);
          wrapped[idx].forEach(function(line,li){ doc.text(line,M+25,yy+li*11); });
          yy+=wrapped[idx].length*11+4;
        });
        y+=h+8;
      }
      function noteCard(n){
        var title=safe(n.title||L.note), body=safe(n.body||""), meta=pdfDate(n.created_at)+(n.author_email?(" | "+safe(auditActor(n.author_email))):"");
        var titleLines=linesFor(title,contentW-22,9.5), bodyLines=body?linesFor(body,contentW-22,9):[];
        var h=33+titleLines.length*11+(bodyLines.length?8+bodyLines.length*10.5:0); ensure(h+8);
        setFill(C.surface); setDraw(C.line); doc.roundedRect(M,y,contentW,h,6,6,"FD");
        doc.setFont("helvetica","bold"); doc.setFontSize(9.5); setText(C.ink); var yy=y+15; titleLines.forEach(function(line){doc.text(line,M+11,yy);yy+=11;});
        doc.setFont("helvetica","normal"); doc.setFontSize(7.5); setText(C.muted); doc.text(safe(meta),M+11,yy+2); yy+=10;
        if(bodyLines.length){ doc.setFontSize(9); setText(C.ink); bodyLines.forEach(function(line){doc.text(line,M+11,yy+5);yy+=10.5;}); }
        y+=h+8;
      }
      function timelineEvent(title,created,actor){
        var meta=pdfDate(created)+" | "+safe(actor||L.system), titleLines=linesFor(title,contentW-45,9.2), h=Math.max(37,22+titleLines.length*10.5);
        ensure(h+4); setDraw(C.line); doc.setLineWidth(.7); doc.line(M+8,y+3,M+8,y+h-3); setFill(C.red); doc.circle(M+8,y+12,3.1,"F");
        doc.setFont("helvetica","bold"); doc.setFontSize(9.2); setText(C.ink); var yy=y+13; titleLines.forEach(function(line){doc.text(line,M+21,yy);yy+=10.5;});
        doc.setFont("helvetica","normal"); doc.setFontSize(7.4); setText(C.muted); doc.text(safe(meta),M+21,yy+2); y+=h;
      }

      // Header designed to mirror the RBH Safety application.
      try{
        var logoSrc=(document.querySelector("#loginView img")||{}).src||"";
        if(logoSrc.indexOf("data:image")===0) doc.addImage(logoSrc,"PNG",M,y+4,58,36);
      }catch(e){}
      doc.setFont("helvetica","bold"); doc.setFontSize(18); setText(C.ink); doc.text("RBH SAFETY",M+70,y+18);
      doc.setFont("helvetica","normal"); doc.setFontSize(9.5); setText(C.muted); doc.text(L.headerSubtitle,M+70,y+34);
      doc.setFont("helvetica","bold"); doc.setFontSize(16); setText(C.ink); rightText(L.reportWord.toUpperCase()+" #"+safe(r.ref_no),W-M,y+18);
      var status=PV("status_value",statusLabel()), statusFill=(r.status==="closed"?C.greenBg:(r.status==="new"?[253,236,236]:C.grayBg)), statusText=(r.status==="closed"?C.green:(r.status==="new"?C.red:C.gray));
      var pw=(function(){ doc.setFont("helvetica","bold"); doc.setFontSize(7.5); return doc.getTextWidth(status.toUpperCase())+16; })();
      pill(status,statusFill,statusText,W-M-pw,y+25);
      y+=53;
      setDraw(C.line); doc.setLineWidth(.8); doc.line(M,y,W-M,y); y+=13;
      pairRow([
        {label:L.submitted,value:pdfDate(r.created_at),strong:false},
        {label:L.generated,value:pdfDate(new Date()),strong:false}
      ]);
      workflowBar();

      var investigationAtts=atts.filter(isInvestigationEvidence);
      var originalAtts=atts.filter(function(a){return !isActionEvidence(a) && !isInvestigationEvidence(a);});
      var evidenceAll=atts.filter(isActionEvidence);
      var pdfResetAt=workflowResetBoundaryMs(r);
      var pdfActionById={};
      pdfActions.forEach(function(a){pdfActionById[String(a.id)]=a;});
      var evidenceAtts=evidenceAll.filter(function(a){
        if(a.corrective_action_id) return !!pdfActionById[String(a.corrective_action_id)];
        if(!pdfResetAt) return true;
        var t=new Date(a.created_at||0).getTime(); return !isNaN(t)&&t>=pdfResetAt;
      });
      var priorEvidenceAtts=evidenceAll.filter(function(a){
        if(a.corrective_action_id) return !pdfActionById[String(a.corrective_action_id)];
        if(!pdfResetAt) return false;
        var t=new Date(a.created_at||0).getTime(); return !isNaN(t)&&t<pdfResetAt;
      });
      var reviewAudit=audit.find(function(a){return a.field==="status" && a.new_value==="under_review";});
      var closureAudits=audit.filter(function(a){return a.field==="status" && (a.new_value==="closed"||a.new_value==="no_action"||a.new_value==="duplicate");});
      var closureAudit=closureAudits.length?closureAudits[closureAudits.length-1]:null;
      var noActionNote=notes.find(function(n){return /^Closed without corrective action/i.test(String(n.title||""));});
      var closureReason="";
      if(noActionNote){ var m=String(noActionNote.title||"").match(/Closed without corrective action\s*[\-\u2013\u2014]\s*(.+)$/i); if(m) closureReason=m[1]; }
      if(closureReason && !Object.prototype.hasOwnProperty.call(pdfTx,"closure_reason") && pdfMode!=="original"){ var cr=await translateTextMap({closure_reason:closureReason},pdfLang,"pdf-closure:"+String(r.id)); if(cr&&cr.closure_reason) pdfTx.closure_reason=cr.closure_reason; }
      if(noActionNote&&noActionNote.body && !Object.prototype.hasOwnProperty.call(pdfTx,"closure_note") && pdfMode!=="original"){ var cn=await translateTextMap({closure_note:noActionNote.body},pdfLang,"pdf-closure-note:"+String(r.id)); if(cn&&cn.closure_note) pdfTx.closure_note=cn.closure_note; }

      section(1,L.section1,L.section1Sub);
      pairRow([
        {label:L.reportType,value:PV("report_type",r.report_type)},
        {label:L.actualInjury,value:r.involves_injury?L.yes:L.no},
        {label:L.address,value:r.job_site},
        {label:L.specificSpot,value:PV("site_location",r.site_location)},
        {label:L.whenNoticed,value:r.observed_at?pdfDate(r.observed_at):""},
        {label:L.potentialSeverity,value:PV("potential_severity",r.potential_severity)},
        {label:L.hazardType,value:PV("hazard_category",r.hazard_category)},
        {label:L.formLanguage,value:languageName(r.language||"en",pdfLang)}
      ]);
      wideField(L.describe,PV("description",r.description),{skipEmpty:false,emptyText:L.noDescription});
      wideField(L.involved,PV("people_involved",r.people_involved));
      wideField(L.immediate,PV("immediate_action",r.immediate_action));
      wideField(L.suggested,PV("suggested_fix",r.suggested_fix));
      subhead(L.reporter);
      pairRow([
        {label:L.reportedBy,value:r.reporter_name||(pdfLang==="es"?"Anónimo":"Anonymous")},
        {label:L.reporterRole,value:PV("reporter_role",r.reporter_role)},
        {label:L.reporterContact,value:r.reporter_contact},
        {label:L.reviewCompleted,value:reviewAudit?pdfDate(reviewAudit.created_at):""},
        {label:L.reviewedBy,value:reviewAudit?auditActor(reviewAudit.actor_email):""},
        {label:L.investigator,value:investigatorName(r)||L.notAssigned},
        {label:L.workflowRestarts,value:(r.workflow_restart_count?String(r.workflow_restart_count):L.none)},
        {label:L.lastRestart,value:r.last_workflow_restart_at?pdfDate(r.last_workflow_restart_at):""}
      ]);
      fileBox(L.originalFiles,originalAtts.map(function(a){return a.file_name||a.storage_path;}),L.noOriginalFiles);
      if(r.involves_injury){
        subhead(L.calosha);
        pairRow([
          {label:L.screeningResult,value:PV("screening_result",caloshaScreenLabel(r.calosha_screening_status))},
          {label:L.awareness,value:r.calosha_awareness_at?pdfDate(r.calosha_awareness_at):L.notRecorded}
        ]);
        wideField(L.screeningNote,L.screeningDisclaimer,{skipEmpty:false});
      }

      section(2,L.section2,L.section2Sub);
      wideField(L.whatHappened,PV("investigation_findings",r.investigation_findings),{skipEmpty:false,emptyText:L.notYetRecorded});
      wideField(L.rootCause,PV("root_cause",r.root_cause),{skipEmpty:false,emptyText:L.notYetRecorded});
      fileBox(L.investigationEvidence,investigationAtts.map(function(a){return a.file_name||a.storage_path;}),L.noInvestigationEvidence);

      section("3A",L.section3,L.section3Sub);
      if(pdfActions.length){
        pdfActions.forEach(function(a,i){
          subhead(L.actionNumber+" #"+String(a.action_number||""));
          wideField(L.correctiveRequired,PV("ca_desc_"+i,a.description),{skipEmpty:false,emptyText:L.notYetRecorded});
          pairRow([
            {label:L.controlType,value:a.control_type?controlTypeLabel(a.control_type,pdfLang)||a.control_type:L.notRecorded},
            {label:L.assignedUser,value:a.owner_user_id?userById(a.owner_user_id):L.notAssigned},
            {label:L.dueDate,value:a.due_date?pdfDateOnly(a.due_date):L.notRecorded},
            {label:L.priority,value:a.priority?titleCase(a.priority):L.notRecorded},
            {label:L.actionStatus,value:actionLabel(a.status||"not_started")}
          ]);
        });
      } else {
        wideField(L.correctiveRequired,PV("corrective_action",r.corrective_action),{skipEmpty:false,emptyText:L.notYetRecorded});
        pairRow([
          {label:L.controlType,value:r.corrective_control_type?PV("control_type_value",controlTypeLabel(r.corrective_control_type,pdfLang)||r.corrective_control_type):L.notRecorded},
          {label:L.assignedUser,value:assigneeName(r)||L.notAssigned},
          {label:L.dueDate,value:r.due_date?pdfDateOnly(r.due_date):L.notRecorded},
          {label:L.priority,value:r.priority?PV("priority_value",String(r.priority).charAt(0).toUpperCase()+String(r.priority).slice(1)):L.notRecorded}
        ]);
      }

      section("3B",L.section4,L.section4Sub);
      if(pdfActions.length){
        pdfActions.forEach(function(a,i){
          subhead(L.actionNumber+" #"+String(a.action_number||""));
          wideField(L.completedWork,PV("ca_completion_"+i,a.completion_note),{skipEmpty:false,emptyText:L.notYetSubmitted});
          pairRow([
            {label:L.completedOn,value:a.completed_at?pdfDate(a.completed_at):""},
            {label:L.completedBy,value:a.completed_by?userById(a.completed_by):""}
          ]);
          var actionEvidence=evidenceAtts.filter(function(ev){return String(ev.corrective_action_id||"")===String(a.id);});
          fileBox(L.currentEvidence,actionEvidence.map(function(ev){return ev.file_name||ev.storage_path;}),L.noCurrentEvidence);
        });
        var unlinkedCurrent=evidenceAtts.filter(function(ev){return !ev.corrective_action_id;});
        if(unlinkedCurrent.length) fileBox(L.currentEvidence,unlinkedCurrent.map(function(ev){return ev.file_name||ev.storage_path;}),L.noCurrentEvidence);
      } else {
        wideField(L.completedWork,PV("action_completion_note",r.action_completion_note),{skipEmpty:false,emptyText:L.notYetSubmitted});
        pairRow([
          {label:L.completedOn,value:r.action_completed_at?pdfDate(r.action_completed_at):""},
          {label:L.completedBy,value:r.action_completed_by?userById(r.action_completed_by):""}
        ]);
        fileBox(L.currentEvidence,evidenceAtts.map(function(a){return a.file_name||a.storage_path;}),L.noCurrentEvidence);
      }
      if(priorEvidenceAtts.length) fileBox(L.priorEvidence,priorEvidenceAtts.map(function(a){return a.file_name||a.storage_path;}),"");

      section("3C",L.section5,L.section5Sub);
      if(pdfActions.length){
        pdfActions.forEach(function(a,i){
          subhead(L.actionNumber+" #"+String(a.action_number||""));
          pairRow([
            {label:L.verificationOutcome,value:actionLabel(a.status||"not_started")},
            {label:L.verifiedOn,value:a.verified_at?pdfDate(a.verified_at):""},
            {label:L.verifiedBy,value:a.verified_by?userById(a.verified_by):""}
          ]);
          var verifyLabel=(a.status==="changes_requested")?L.requestedChanges:L.reviewerNote;
          wideField(verifyLabel,PV("ca_verification_"+i,a.verification_note),{skipEmpty:false,emptyText:L.noVerificationNote});
        });
      } else {
        var verifyOutcome=PV("verification_outcome",actionLabel(r.action_status||"not_started"));
        pairRow([
          {label:L.verificationOutcome,value:verifyOutcome},
          {label:L.verifiedOn,value:r.action_verified_at?pdfDate(r.action_verified_at):""},
          {label:L.verifiedBy,value:r.action_verified_by?userById(r.action_verified_by):""}
        ]);
        var verifyLabel=(r.action_status==="changes_requested")?L.requestedChanges:L.reviewerNote;
        wideField(verifyLabel,PV("action_verification_note",r.action_verification_note),{skipEmpty:false,emptyText:L.noVerificationNote});
      }

      section(4,L.section6,L.section6Sub);
      pairRow([
        {label:L.recordStatus,value:PV("status_value",statusLabel())},
        {label:L.closedOn,value:r.closed_at?pdfDate(r.closed_at):L.notYetClosed},
        {label:L.closedBy,value:closureAudit?auditActor(closureAudit.actor_email):""},
        {label:L.closurePath,value:PV("closure_path",(r.status==="no_action"||r.status==="duplicate")?"Closed without corrective action":(r.status==="closed"?"Corrective action verified and record closed":"Record remains open"))}
      ]);
      if(closureReason) pairRow([{label:L.closureReason,value:PV("closure_reason",closureReason)}]);
      if(noActionNote && has(noActionNote.body)) wideField(L.closureNote,PV("closure_note",noActionNote.body));

      var visibleNotes=notes.filter(function(n){ return String(n.title||"").indexOf("[System]")!==0 && n!==noActionNote; });
      if(visibleNotes.length){
        subhead(L.additionalNotes);
        visibleNotes.forEach(function(n){ var idx=notes.indexOf(n), copy=Object.assign({},n); copy.title=PV("note_title_"+idx,n.title); copy.body=PV("note_body_"+idx,n.body); noteCard(copy); });
      }

      subhead(L.activityHistory);
      timelineEvent(L.reportSubmitted,r.created_at,r.reporter_name||L.anonymousReporter);
      pdfHistory.sort(function(a,b){return new Date(a.created_at)-new Date(b.created_at);}).forEach(function(ev){ timelineEvent(PV(ev.key,ev.title),ev.created_at,ev.actor); });

      // Footers are added last so page counts are always correct.
      var pages=doc.internal.getNumberOfPages();
      for(var p=1;p<=pages;p++){
        doc.setPage(p); setDraw(C.line); doc.setLineWidth(.6); doc.line(M,H-43,W-M,H-43);
        doc.setFont("helvetica","normal"); doc.setFontSize(7.4); setText(C.muted);
        doc.text(L.footer,M,H-27);
        rightText(L.reportWord+" #"+safe(r.ref_no)+" | "+(L.summaryPage||L.page)+" "+p+" / "+pages,W-M,H-27);
      }

      var outputName="RBH-Safety-Report-"+(r.ref_no!=null?("No"+r.ref_no):String(r.id).slice(0,8))+".pdf";
      if(atts.length){
        // A missing appendix library should never block the report summary PDF.
        if(!window.PDFLib || !window.PDFLib.PDFDocument){
          console.error("PDF appendix library unavailable");
          doc.save(outputName);
          toast("PDF downloaded without the attachment appendix. Try again if you need the files included.","err");
          return;
        }
        btn.textContent="Adding attachments...";
        try{
        var basePdfBytes=doc.output("arraybuffer");
        var PDFDocument=window.PDFLib.PDFDocument, StandardFonts=window.PDFLib.StandardFonts, rgb=window.PDFLib.rgb;
        var merged=await PDFDocument.load(basePdfBytes);
        var helv=await merged.embedFont(StandardFonts.Helvetica), helvBold=await merged.embedFont(StandardFonts.HelveticaBold);
        var letter=[612,792], appendixMargin=44;
        function inferAttachmentMime(a){
          var m=String((a&&a.mime_type)||"").toLowerCase(); if(m) return m;
          var n=String((a&&a.file_name)||"").toLowerCase();
          if(/\.pdf$/.test(n)) return "application/pdf";
          if(/\.(jpe?g)$/.test(n)) return "image/jpeg";
          if(/\.png$/.test(n)) return "image/png";
          if(/\.gif$/.test(n)) return "image/gif";
          if(/\.webp$/.test(n)) return "image/webp";
          if(/\.(heic|heif)$/.test(n)) return "image/heic";
          if(/\.docx$/.test(n)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          if(/\.doc$/.test(n)) return "application/msword";
          return "application/octet-stream";
        }
        function prettyBytes(n){ n=Number(n||0); if(!n) return ""; if(n<1024) return n+" B"; if(n<1048576) return (n/1024).toFixed(n<10240?1:0)+" KB"; return (n/1048576).toFixed(1)+" MB"; }
        async function sha256Hex(bytes){
          if(!(window.crypto&&window.crypto.subtle)) return "";
          var h=await window.crypto.subtle.digest("SHA-256",bytes); return Array.from(new Uint8Array(h)).map(function(b){return b.toString(16).padStart(2,"0");}).join("");
        }
        function attachmentSource(a){
          if(isInvestigationEvidence(a)) return L.sourceInvestigationEvidence;
          if(!isActionEvidence(a)) return L.sourceOriginal;
          if(a.corrective_action_id && pdfActionById[String(a.corrective_action_id)]){
            return L.actionNumber+" #"+String(pdfActionById[String(a.corrective_action_id)].action_number||"")+" — "+L.sourceCurrentEvidence;
          }
          if(a.corrective_action_id) return L.sourcePriorEvidence;
          var t=new Date(a.created_at||0).getTime();
          if(pdfResetAt && !isNaN(t) && t<pdfResetAt) return L.sourcePriorEvidence;
          return L.sourceCurrentEvidence;
        }
        function pdfLibSafeText(value){
          return String(value==null?"":value)
            .replace(/[\u2013\u2014]/g,"-")
            .replace(/[\u2018\u2019]/g,"'")
            .replace(/[\u201c\u201d]/g,'"')
            .replace(/\u2026/g,"...")
            .replace(/[^\u0020-\u00ff]/g,"?");
        }
        function safeEmbeddedName(value){
          var name=pdfLibSafeText(value||"file").replace(/[\\/:*?"<>|]+/g,"_").trim();
          return name||"file";
        }
        function pdfWrap(text,font,size,maxW){
          text=pdfLibSafeText(text); var words=text.split(/\s+/), lines=[], cur="";
          words.forEach(function(w){ var test=cur?cur+" "+w:w; if(font.widthOfTextAtSize(test,size)<=maxW) cur=test; else { if(cur) lines.push(cur); cur=w; } }); if(cur) lines.push(cur); return lines.length?lines:[""];
        }
        function drawAppendixHeader(page,title,sub){
          page.drawText("RBH SAFETY",{x:appendixMargin,y:742,size:15,font:helvBold,color:rgb(.086,.086,.086)});
          page.drawText(pdfLibSafeText(title),{x:appendixMargin,y:709,size:18,font:helvBold,color:rgb(.086,.086,.086)});
          if(sub){ var ls=pdfWrap(sub,helv,9,524); ls.slice(0,3).forEach(function(line,i){page.drawText(line,{x:appendixMargin,y:690-i*12,size:9,font:helv,color:rgb(.42,.4,.38)});}); }
          page.drawLine({start:{x:appendixMargin,y:670},end:{x:568,y:670},thickness:.8,color:rgb(.85,.84,.82)});
        }
        function drawMeta(page,a,idx,extra){
          var name=String(a.file_name||a.storage_path||("Attachment "+idx));
          var fields=[
            [L.source,attachmentSource(a)],
            [L.uploaded,a.created_at?pdfDate(a.created_at):""],
            [L.fileType,inferAttachmentMime(a)],
            [L.fileSize,prettyBytes(a.size_bytes)],
            [L.sha256,extra&&extra.hash?extra.hash:""]
          ].filter(function(x){return x[1];});
          var y0=642;
          fields.forEach(function(f,i){
            page.drawText(pdfLibSafeText(String(f[0]).toUpperCase()),{x:appendixMargin,y:y0-i*24,size:7,font:helvBold,color:rgb(.42,.4,.38)});
            var ls=pdfWrap(f[1],helv,9,392); ls.slice(0,2).forEach(function(line,j){page.drawText(line,{x:172,y:y0-i*24-j*10,size:9,font:helv,color:rgb(.086,.086,.086)});});
          });
          return {name:name,bottom:y0-fields.length*24-12};
        }
        async function normalizeImage(bytes,mime){
          var blob=new Blob([bytes],{type:mime||"application/octet-stream"}), url=URL.createObjectURL(blob);
          try{
            var img=await new Promise(function(resolve,reject){ var im=new Image(); im.onload=function(){resolve(im);}; im.onerror=function(){reject(new Error("IMAGE_DECODE_FAILED"));}; im.src=url; });
            var maxPx=2400, scale=Math.min(1,maxPx/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
            var cw=Math.max(1,Math.round((img.naturalWidth||img.width)*scale)), ch=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
            var canvas=document.createElement("canvas"); canvas.width=cw; canvas.height=ch; var ctx=canvas.getContext("2d");
            ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,cw,ch); ctx.drawImage(img,0,0,cw,ch);
            var out=await new Promise(function(resolve,reject){ canvas.toBlob(function(b){b?resolve(b):reject(new Error("IMAGE_CONVERT_FAILED"));},"image/jpeg",.92); });
            return new Uint8Array(await out.arrayBuffer());
          } finally { URL.revokeObjectURL(url); }
        }
        function addInfoPage(a,idx,hash,message){
          var page=merged.addPage(letter), title=(L.attachment||"Attachment")+" "+idx+" - "+String(a.file_name||"file");
          drawAppendixHeader(page,title,message||"");
          var meta=drawMeta(page,a,idx,{hash:hash});
          return {page:page,bottom:meta.bottom};
        }

        // Create signed links for attachments that still have a valid storage path.
        // Incomplete legacy metadata should not prevent the report itself from downloading.
        var appendAtts=atts.filter(function(a){return !!String(a&&a.storage_path||"").trim();});
        var skippedAttachmentMetadata=atts.length-appendAtts.length;
        if(!appendAtts.length){
          doc.save(outputName);
          toast("PDF downloaded. Attachment metadata was incomplete, so files were not appended.","err");
          return;
        }
        var paths=appendAtts.map(function(a){return a.storage_path;});
        var signed=await sb.storage.from("report-attachments").createSignedUrls(paths,3600);
        if(signed.error) throw signed.error;
        var signedRows=signed.data||[];

        // Appendix cover / manifest.
        var cover=merged.addPage(letter); drawAppendixHeader(cover,L.appendixTitle,L.appendixSub);
        cover.drawText(pdfLibSafeText((L.appendixCount||"Attachments included")+": "+appendAtts.length),{x:appendixMargin,y:642,size:10,font:helvBold,color:rgb(.086,.086,.086)});
        var cy=616;
        appendAtts.forEach(function(a,i){
          var n=(i+1)+". "+String(a.file_name||a.storage_path||"file");
          var ls=pdfWrap(n,helv,8.5,500), needed=Math.max(28,ls.length*10+16);
          if(cy-needed<72){ cover=merged.addPage(letter); drawAppendixHeader(cover,L.appendixTitle,L.appendixSub); cy=642; }
          ls.slice(0,2).forEach(function(line,j){cover.drawText(line,{x:appendixMargin+6,y:cy-j*10,size:8.5,font:helv,color:rgb(.086,.086,.086)});});
          cover.drawText(pdfLibSafeText(attachmentSource(a)),{x:appendixMargin+18,y:cy-12-ls.length*8,size:7.2,font:helv,color:rgb(.42,.4,.38)});
          cy-=needed;
        });
        if(cy<64){ cover=merged.addPage(letter); drawAppendixHeader(cover,L.appendixTitle,L.appendixSub); cy=642; }
        pdfWrap(L.appendixNote,helv,7.8,500).slice(0,3).forEach(function(line,j){cover.drawText(line,{x:appendixMargin,y:cy-j*10,size:7.8,font:helv,color:rgb(.42,.4,.38)});});

        for(var ai=0;ai<appendAtts.length;ai++){
          var a=appendAtts[ai], sr=signedRows[ai]; btn.textContent="Adding attachment "+(ai+1)+" of "+appendAtts.length+"...";
          if(!sr||sr.error||!sr.signedUrl){
            var missingSigned=addInfoPage(a,ai+1,"",L.attachmentUnavailable);
            pdfWrap(L.attachmentUnavailableBody,helv,10,500).slice(0,9).forEach(function(line,j){missingSigned.page.drawText(line,{x:appendixMargin,y:missingSigned.bottom-12-j*13,size:10,font:helv,color:rgb(.086,.086,.086)});});
            continue;
          }
          var response;
          try{ response=await fetch(sr.signedUrl); }catch(fetchErr){ response=null; }
          if(!response||!response.ok){
            var missingFetch=addInfoPage(a,ai+1,"",L.attachmentUnavailable);
            pdfWrap(L.attachmentUnavailableBody,helv,10,500).slice(0,9).forEach(function(line,j){missingFetch.page.drawText(line,{x:appendixMargin,y:missingFetch.bottom-12-j*13,size:10,font:helv,color:rgb(.086,.086,.086)});});
            continue;
          }
          var buf=await response.arrayBuffer(), bytes=new Uint8Array(buf), mime=inferAttachmentMime(a), hash="";
          try{hash=await sha256Hex(buf);}catch(e){}
          if(mime==="application/pdf" || /\.pdf$/i.test(String(a.file_name||""))){
            addInfoPage(a,ai+1,hash,L.pdfPages);
            try{
              var srcPdf=await PDFDocument.load(buf,{ignoreEncryption:false});
              var copied=await merged.copyPages(srcPdf,srcPdf.getPageIndices()); copied.forEach(function(pg){merged.addPage(pg);});
            }catch(pdfErr){
              // Keep the original file inside the PDF package if the source PDF cannot be rendered/copied.
              await merged.attach(bytes,"Attachment-"+String(ai+1).padStart(2,"0")+"-"+safeEmbeddedName(a.file_name||"file.pdf"),{mimeType:mime,description:pdfLibSafeText(attachmentSource(a))});
              var fallback=addInfoPage(a,ai+1,hash,L.embeddedOnly);
              pdfWrap(L.embeddedOnlyBody,helv,10,500).slice(0,9).forEach(function(line,j){fallback.page.drawText(line,{x:appendixMargin,y:fallback.bottom-12-j*13,size:10,font:helv,color:rgb(.086,.086,.086)});});
            }
            continue;
          }
          if(mime.indexOf("image/")===0 || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(String(a.file_name||""))){
            try{
              var jpgBytes=await normalizeImage(bytes,mime), img=await merged.embedJpg(jpgBytes), page=merged.addPage(letter);
              var title=(L.attachment||"Attachment")+" "+(ai+1)+" - "+String(a.file_name||"image");
              drawAppendixHeader(page,title,attachmentSource(a));
              var dims=img.scale(1), maxW=524, maxH=570, sc=Math.min(maxW/dims.width,maxH/dims.height,1), w=dims.width*sc,h=dims.height*sc;
              page.drawImage(img,{x:(612-w)/2,y:70+(maxH-h)/2,width:w,height:h});
              page.drawText((L.uploaded||"Uploaded")+": "+(a.created_at?pdfDate(a.created_at):"")+"   |   "+(L.fileSize||"File size")+": "+prettyBytes(a.size_bytes),{x:appendixMargin,y:50,size:7.5,font:helv,color:rgb(.42,.4,.38)});
              if(hash) page.drawText("SHA-256: "+hash,{x:appendixMargin,y:37,size:6.2,font:helv,color:rgb(.42,.4,.38)});
            }catch(imgErr){
              await merged.attach(bytes,"Attachment-"+String(ai+1).padStart(2,"0")+"-"+safeEmbeddedName(a.file_name||"image"),{mimeType:mime,description:pdfLibSafeText(attachmentSource(a))});
              var fallbackImg=addInfoPage(a,ai+1,hash,L.embeddedOnly);
              pdfWrap(L.embeddedOnlyBody,helv,10,500).slice(0,9).forEach(function(line,j){fallbackImg.page.drawText(line,{x:appendixMargin,y:fallbackImg.bottom-12-j*13,size:10,font:helv,color:rgb(.086,.086,.086)});});
            }
            continue;
          }
          // Word and other non-page formats remain part of the export as true embedded source files,
          // with a visible appendix page so reviewers know exactly what is included.
          await merged.attach(bytes,"Attachment-"+String(ai+1).padStart(2,"0")+"-"+safeEmbeddedName(a.file_name||"file"),{mimeType:mime,description:pdfLibSafeText(attachmentSource(a))});
          var fp=addInfoPage(a,ai+1,hash,L.embeddedOnly);
          pdfWrap(L.embeddedOnlyBody,helv,10,500).slice(0,9).forEach(function(line,j){fp.page.drawText(line,{x:appendixMargin,y:fp.bottom-12-j*13,size:10,font:helv,color:rgb(.086,.086,.086)});});
        }
        var finalBytes=await merged.save();
        var blob=new Blob([finalBytes],{type:"application/pdf"}), url=URL.createObjectURL(blob), a=document.createElement("a");
        a.href=url; a.download=outputName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(url);},1500);
        if(skippedAttachmentMetadata>0) toast("PDF downloaded. "+skippedAttachmentMetadata+" attachment record"+(skippedAttachmentMetadata===1?" was":"s were")+" missing storage information and could not be appended.","err");
        }catch(appendixErr){
          console.error("PDF attachment appendix failed",appendixErr);
          doc.save(outputName);
          toast("PDF downloaded, but the attachment appendix could not be added. The report summary is complete.","err");
        }
      }else{
        doc.save(outputName);
      }
    }catch(e){ console.error(e); toast(e&&e.message==="TRANSLATION_UNAVAILABLE"?"The requested PDF language could not be generated. Check the translation service and try again.":"Could not generate the PDF - please try again.","err"); }
    finally{ btn.disabled=false; btn.textContent=lbl; }
  }


  /* ================= My Profile V1 ================= */
  function profileInitials(name,email){
    var src=String(name||"").trim();
    if(src){ var parts=src.split(/\s+/).filter(Boolean); return ((parts[0]||"").charAt(0)+(parts.length>1?(parts[parts.length-1]||"").charAt(0):"")).toUpperCase()||"RB"; }
    var em=String(email||"").trim(); return em?em.charAt(0).toUpperCase():"RB";
  }
  function refreshProfileCard(){
    var user=currentSession&&currentSession.user, email=(user&&user.email)||"";
    var name=(currentProfile&&currentProfile.full_name)||"My Profile";
    var initials=profileInitials(currentProfile&&currentProfile.full_name,email);
    var dn=$("profileDisplayName"), av=$("profileAvatar"), hav=$("profileHeadAvatar"), he=$("profileHeadEmail");
    if(dn) dn.textContent=name; if(av) av.textContent=initials; if(hav) hav.textContent=initials; if(he) he.textContent=email;
    var who=$("who"); if(who) who.textContent=email+(currentOrgName?(" · "+currentOrgName):"");
  }
  function currentViewLabel(){ var pt=$("pageTitle"); return pt&&pt.textContent?pt.textContent:"RBH Safety"; }
  function fillProfileForm(){
    var user=currentSession&&currentSession.user; if(!user) return;
    var p=currentProfile||{};
    $("profileFullName").value=p.full_name||"";
    $("profileEmail").value=user.email||p.email||"";
    $("profilePhone").value=p.phone||"";
    $("profileJobTitle").value=p.job_title||"";
    $("profileDepartment").value=p.department||"";
    $("profileRole").value=roleLabel(currentRole);
    $("profileLanguage").value=(p.preferred_language&&["auto","en","es"].indexOf(String(p.preferred_language))>=0)?String(p.preferred_language):"auto";
    $("profileGuidance").checked=workflowGuidanceEnabled();
    $("profileHeadEmail").textContent=user.email||"";
    $("profileAppVersion").textContent="Version "+APP_VERSION;
    $("feedbackContext").textContent="App context included automatically: "+(currentOrgName?(currentOrgName+" · "):"")+currentViewLabel()+" · "+APP_VERSION;
    var afs=$("adminFeedbackSection"); if(afs) afs.hidden=true;
    var hc=$("platformContextLabel"); if(hc) hc.textContent=currentOrgName?("Current company: "+currentOrgName):"Platform overview";
    refreshProfileCard();
  }
  function setProfileTab(name){
    document.querySelectorAll(".profile-tab").forEach(function(b){ b.classList.toggle("active",b.getAttribute("data-profile-tab")===name); });
    document.querySelectorAll("[data-profile-panel]").forEach(function(p){ p.hidden=p.getAttribute("data-profile-panel")!==name; });
  }
  function openProfileDrawer(tab){
    var bd=$("profileBackdrop"); if(!bd) return; fillProfileForm(); setProfileTab(tab||"profile"); closeSidebar(); bd.classList.add("open"); bd.setAttribute("aria-hidden","false"); document.body.style.overflow="hidden";
  }
  function closeProfileDrawer(){ var bd=$("profileBackdrop"); if(!bd) return; bd.classList.remove("open"); bd.setAttribute("aria-hidden","true"); document.body.style.overflow=""; }

  var _profileOpen=$("profileOpen"); if(_profileOpen) _profileOpen.addEventListener("click",function(){ openProfileDrawer("profile"); });
  var _profileClose=$("profileClose"); if(_profileClose) _profileClose.addEventListener("click",closeProfileDrawer);
  var _profileBackdrop=$("profileBackdrop"); if(_profileBackdrop) _profileBackdrop.addEventListener("click",function(e){ if(e.target===_profileBackdrop) closeProfileDrawer(); });
  document.addEventListener("keydown",function(e){ if(e.key==="Escape" && _profileBackdrop && _profileBackdrop.classList.contains("open")) closeProfileDrawer(); });
  document.querySelectorAll(".profile-tab").forEach(function(b){ b.addEventListener("click",function(){ setProfileTab(b.getAttribute("data-profile-tab")); }); });

  var _profileForm=$("profileForm"); if(_profileForm) _profileForm.addEventListener("submit",async function(e){
    e.preventDefault(); if(!currentSession||!currentSession.user) return;
    var btn=$("profileSave"); btn.disabled=true; btn.textContent="Saving…";
    var patch={
      full_name:$("profileFullName").value.trim()||null,
      phone:$("profilePhone").value.trim()||null,
      job_title:$("profileJobTitle").value.trim()||null,
      department:$("profileDepartment").value.trim()||null,
      preferred_language:$("profileLanguage").value||"auto",
      show_workflow_guidance:!!$("profileGuidance").checked
    };
    try{
      // Language and guidance preferences are standalone capabilities and must not depend on
      // the optional Profile V1 migration (phone/job title/department).
      var lr=await sb.rpc("rbh_update_my_language",{p_preferred_language:patch.preferred_language});
      if(lr.error) throw lr.error;

      var gr=await sb.rpc("rbh_update_my_guidance",{p_show_guidance:patch.show_workflow_guidance});
      if(gr.error) throw gr.error;
      if(!currentProfile) currentProfile={};
      currentProfile.show_workflow_guidance=patch.show_workflow_guidance;

      var profileV1Saved=false, profileV1Unavailable=false;
      var res=await sb.rpc("rbh_update_my_profile",{p_full_name:patch.full_name,p_phone:patch.phone,p_job_title:patch.job_title,p_department:patch.department});
      if(res.error){
        var code=String(res.error.code||"");
        var msg=String(res.error.message||"");
        // PGRST202 / schema-cache missing-function errors mean Profile V1 is
        // simply not installed. Do not fail the language or guidance preference saves.
        if(code==="PGRST202" || /rbh_update_my_profile|function.*not found|schema cache/i.test(msg)) profileV1Unavailable=true;
        else throw res.error;
      }else profileV1Saved=true;

      await loadProfiles(); applyRoleUi(); fillProfileForm();
      if(profileV1Unavailable) toast("Preferences saved. Optional Profile V1 fields are not installed in this database.","ok");
      else if(profileV1Saved) toast("Profile updated","ok");
      else toast("Preferences saved","ok");
    }catch(ex){ console.error("profile update",ex); toast(ex&&ex.message?ex.message:"Could not save profile preferences.","err"); }
    finally{ btn.disabled=false; btn.textContent="Save Profile"; }
  });

  var _passwordForm=$("passwordForm"); if(_passwordForm) _passwordForm.addEventListener("submit",async function(e){
    e.preventDefault(); var a=$("profileNewPassword").value, b=$("profileConfirmPassword").value;
    if(a.length<8){ toast("Use at least 8 characters for the new password.","err"); return; }
    if(a!==b){ toast("The new passwords do not match.","err"); return; }
    var btn=$("passwordSave"); btn.disabled=true; btn.textContent="Updating…";
    try{ var res=await sb.auth.updateUser({password:a}); if(res.error) throw res.error; $("profileNewPassword").value=""; $("profileConfirmPassword").value=""; toast("Password changed","ok"); }
    catch(ex){ console.error("password update",ex); toast(ex&&ex.message?ex.message:"Could not change password.","err"); }
    finally{ btn.disabled=false; btn.textContent="Change Password"; }
  });

  var _passwordReset=$("passwordReset"); if(_passwordReset) _passwordReset.addEventListener("click",async function(){
    var email=currentSession&&currentSession.user&&currentSession.user.email; if(!email) return;
    _passwordReset.disabled=true; _passwordReset.textContent="Sending…";
    try{ var redirect=window.location.origin+window.location.pathname; var res=await sb.auth.resetPasswordForEmail(email,{redirectTo:redirect}); if(res.error) throw res.error; toast("Password reset email sent","ok"); }
    catch(ex){ console.error("password reset",ex); toast(ex&&ex.message?ex.message:"Could not send reset email.","err"); }
    finally{ _passwordReset.disabled=false; _passwordReset.textContent="Send Reset Email"; }
  });

  var _signoutAll=$("signoutAll"); if(_signoutAll) _signoutAll.addEventListener("click",async function(){
    _signoutAll.disabled=true; _signoutAll.textContent="Signing out…";
    try{ var res=await sb.auth.signOut({scope:"global"}); if(res&&res.error) throw res.error; }
    catch(ex){ console.error("global signout",ex); toast("Could not sign out all sessions.","err"); _signoutAll.disabled=false; _signoutAll.textContent="Sign Out Everywhere"; }
  });

  var _feedbackForm=$("feedbackForm"); if(_feedbackForm) _feedbackForm.addEventListener("submit",async function(e){
    e.preventDefault(); if(!currentSession||!currentSession.user) return;
    var btn=$("feedbackSubmit"), statusEl=$("feedbackStatus"), subject=$("feedbackSubject").value.trim(), message=$("feedbackMessage").value.trim();
    function feedbackStatus(msg,kind){ if(!statusEl) return; statusEl.textContent=msg||""; statusEl.className="feedback-status"+(msg?(" show "+(kind||"")):""); }
    feedbackStatus("","");
    if(!subject||!message){ feedbackStatus("Add a subject and message before sending feedback.","err"); toast("Add a subject and message before sending feedback.","err"); return; }
    btn.disabled=true; btn.textContent="Sending…";
    try{
      if(!currentOrgId) throw new Error("Your account is not attached to a company.");
      var res=await sb.from("app_feedback").insert({
        organization_id:currentOrgId,
        user_id:currentSession.user.id,
        user_email:currentSession.user.email||null,
        feedback_type:$("feedbackType").value,
        subject:subject,
        message:message,
        page_context:currentViewLabel(),
        app_version:APP_VERSION,
        status:"new"
      }).select("id").single();
      if(res.error) throw res.error;
      _feedbackForm.reset(); $("feedbackType").value="suggestion"; fillProfileForm();
      feedbackStatus("Feedback sent successfully. Thank you — your submission is now in the Platform feedback inbox.","ok");
      toast("Feedback sent — thank you","ok");
    }catch(ex){
      console.error("feedback submit",ex);
      var msg=(ex&&ex.message)?ex.message:"Feedback could not be submitted.";
      feedbackStatus("Could not send feedback: "+msg,"err");
      toast("Could not send feedback.","err");
    }
    finally{ btn.disabled=false; btn.textContent="Send Feedback"; }
  });

  function feedbackStatusLabel(v){ return ({new:"New",reviewed:"Reviewed",planned:"Planned",resolved:"Resolved"})[v]||"New"; }
  async function loadFeedbackAdmin(){
    var el=$("feedbackAdminList"), sum=$("feedbackSummary"); if(!el||currentRole!=="admin") return;
    el.innerHTML='<div class="state">Loading feedback…</div>';
    try{
      var res=await sb.from("app_feedback").select("*").order("created_at",{ascending:false}).limit(100); if(res.error) throw res.error;
      var rows=res.data||[], counts={new:0,reviewed:0,planned:0,resolved:0}; rows.forEach(function(x){ counts[x.status||"new"]=(counts[x.status||"new"]||0)+1; });
      if(sum) sum.innerHTML=['new','reviewed','planned','resolved'].map(function(k){return '<span class="fb-sum"><b>'+counts[k]+'</b>'+feedbackStatusLabel(k)+'</span>';}).join('');
      if(!rows.length){ el.innerHTML='<div class="state">No app feedback has been submitted yet.</div>'; return; }
      el.innerHTML="";
      rows.forEach(function(f){
        var card=document.createElement("div"); card.className="feedback-admin-card";
        card.innerHTML='<div class="feedback-admin-top"><div><div class="feedback-admin-title"><span class="feedback-type-pill"></span><span class="feedback-subject"></span></div><div class="feedback-admin-meta"></div></div><select aria-label="Feedback status"><option value="new">New</option><option value="reviewed">Reviewed</option><option value="planned">Planned</option><option value="resolved">Resolved</option></select></div><div class="feedback-admin-body"></div>';
        card.querySelector('.feedback-type-pill').textContent=(f.feedback_type||'other').replace('_',' ');
        card.querySelector('.feedback-subject').textContent=f.subject||'Feedback';
        var fp=profileById[String(f.user_id||'')], feedbackWho=(fp&&fp.email)||f.user_email||'Unknown user';
        card.querySelector('.feedback-admin-meta').textContent=feedbackWho+' · '+fmtDate(f.created_at)+(f.page_context?(' · '+f.page_context):'');
        card.querySelector('.feedback-admin-body').textContent=f.message||'';
        var sel=card.querySelector('select'); sel.value=f.status||'new';
        sel.addEventListener('change',async function(){
          sel.disabled=true; try{ var up=await sb.from('app_feedback').update({status:sel.value,updated_at:new Date().toISOString()}).eq('id',f.id); if(up.error) throw up.error; toast('Feedback status updated','ok'); loadFeedbackAdmin(); }
          catch(ex){ console.error(ex); toast('Could not update feedback status.','err'); sel.value=f.status||'new'; sel.disabled=false; }
        });
        el.appendChild(card);
      });
    }catch(ex){ console.error('load feedback',ex); if(sum) sum.innerHTML=''; el.innerHTML='<div class="state">Feedback inbox is unavailable. Apply the Profile V1 database migration if it has not been run yet.</div>'; }
  }
  var _feedbackRefresh=$("feedbackRefresh"); if(_feedbackRefresh) _feedbackRefresh.addEventListener("click",loadFeedbackAdmin);

  function companyStatus(msg,kind){ var el=$("platformCompanyStatus"); if(!el) return; el.textContent=msg||""; el.className="feedback-status"+(msg?(" show "+(kind||"")):""); }
  function makeSlug(v){ return String(v||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-"); }
  function platformAdminExists(rows){ return !!(rows&&rows.length); }
  async function loadPlatformContext(){
    isPlatformAdmin=false; currentOrgName=""; allOrgs=[];
    var user=currentSession&&currentSession.user;
    if(user){
      try{
        var pa=await sb.from("platform_admins").select("user_id,role").eq("user_id",user.id).limit(1);
        if(!pa.error) isPlatformAdmin=platformAdminExists(pa.data);
      }catch(_e){}
    }
    currentOrgId=(currentProfile&&(currentProfile.current_organization_id||currentProfile.organization_id))||null;
    if(currentOrgId){
      try{
        var orgRes=await sb.from("organizations").select("id,name,slug,status,plan").eq("id",currentOrgId).maybeSingle();
        if(!orgRes.error && orgRes.data){ currentOrgName=orgRes.data.name||""; allOrgs=[orgRes.data]; }
      }catch(_e){}
    }
    var hh=$("homeGreeting"); if(hh && currentOrgName) hh.textContent=currentOrgName+" Safety";
    refreshProfileCard();
  }
  function renderPlatformStatCards(row){
    var el=$("platformStats"); if(!el) return;
    row=row||{};
    var cards=[
      {label:"Companies",value:row.company_count||0,sub:"Organizations on the platform"},
      {label:"Active users",value:row.active_user_count||0,sub:"Active organization memberships"},
      {label:"Open reports",value:row.open_report_count||0,sub:"Non-closed reports across companies"},
      {label:"Open feedback",value:row.open_feedback_count||0,sub:"New or reviewed platform feedback items"}
    ];
    el.innerHTML=cards.map(function(c){ return '<article class="stat-card"><div class="stat-eyebrow">'+esc(c.label)+'</div><div class="stat-num">'+esc(c.value)+'</div><div class="stat-sub">'+esc(c.sub)+'</div></article>'; }).join("");
  }
  async function loadPlatformSummary(){
    if(!isPlatformAdmin) return;
    var el=$("platformStats"); if(el) el.innerHTML='<div class="state">Loading platform summary…</div>';
    try{
      var orgs=await sb.from("organizations").select("id"); if(orgs.error) throw orgs.error;
      var memberships=await sb.from("organization_memberships").select("id,status"); if(memberships.error) throw memberships.error;
      var reports=await sb.from("reports").select("id,status"); if(reports.error) throw reports.error;
      var feedback=await sb.from("app_feedback").select("id,status"); if(feedback.error) throw feedback.error;
      var openReports=(reports.data||[]).filter(function(r){ return ["closed","duplicate","no_action"].indexOf(r.status||"new")<0; }).length;
      var openFeedback=(feedback.data||[]).filter(function(f){ return ["new","reviewed"].indexOf(f.status||"new")>=0; }).length;
      renderPlatformStatCards({
        company_count:(orgs.data||[]).length,
        active_user_count:(memberships.data||[]).filter(function(m){return m.status==="active";}).length,
        open_report_count:openReports,
        open_feedback_count:openFeedback
      });
    }catch(ex){ console.error("platform summary",ex); if(el) el.innerHTML='<div class="state">Could not load platform summary. Apply the function-free tenant security SQL if needed.</div>'; }
  }
  async function loadPlatformCompanies(){
    var el=$("platformCompanies"); if(!el||!isPlatformAdmin) return;
    el.innerHTML='<div class="state">Loading companies…</div>';
    try{
      var orgRes=await sb.from("organizations").select("id,name,slug,status,plan,created_at").order("created_at",{ascending:false}); if(orgRes.error) throw orgRes.error;
      var memRes=await sb.from("organization_memberships").select("organization_id,role,status,created_at"); if(memRes.error) throw memRes.error;
      var repRes=await sb.from("reports").select("organization_id,status,created_at"); if(repRes.error) throw repRes.error;
      var fbRes=await sb.from("app_feedback").select("organization_id,created_at"); if(fbRes.error) throw fbRes.error;
      var rows=(orgRes.data||[]).map(function(o){
        var mem=(memRes.data||[]).filter(function(x){return String(x.organization_id)===String(o.id);});
        var rep=(repRes.data||[]).filter(function(x){return String(x.organization_id)===String(o.id);});
        var fb=(fbRes.data||[]).filter(function(x){return String(x.organization_id)===String(o.id);});
        var dates=rep.map(function(x){return x.created_at;}).concat(fb.map(function(x){return x.created_at;})).filter(Boolean).map(function(x){return new Date(x).getTime();});
        return {
          id:o.id,name:o.name,slug:o.slug,status:o.status,plan:o.plan,
          user_count:mem.filter(function(x){return x.status==="active";}).length,
          admin_count:mem.filter(function(x){return x.status==="active"&&x.role==="admin";}).length,
          report_count:rep.length,
          open_report_count:rep.filter(function(x){return ["closed","duplicate","no_action"].indexOf(x.status||"new")<0;}).length,
          feedback_count:fb.length,
          last_activity:dates.length?new Date(Math.max.apply(Math,dates)).toISOString():null
        };
      });
      if(!rows.length){ el.innerHTML='<div class="state">No companies have been created yet.</div>'; return; }
      el.innerHTML='';
      rows.forEach(function(o){
        var card=document.createElement('div'); card.className='feedback-admin-card';
        var last=o.last_activity?fmtDate(o.last_activity):'No activity yet';
        card.innerHTML='<div class="feedback-admin-top"><div><div class="feedback-admin-title">'+esc(o.name||'Company')+'</div><div class="feedback-admin-meta">'+esc(o.slug||'')+' · '+esc((o.status||'active').replace('_',' '))+' · '+esc((o.plan||'standard').replace('_',' '))+'</div></div></div>'+
          '<div class="feedback-admin-body"><div><b>Users:</b> '+esc(o.user_count||0)+' &nbsp; <b>Admins:</b> '+esc(o.admin_count||0)+'</div><div><b>Reports:</b> '+esc(o.report_count||0)+' total · '+esc(o.open_report_count||0)+' open</div><div><b>Feedback:</b> '+esc(o.feedback_count||0)+'</div><div><b>Last activity:</b> '+esc(last)+'</div></div>';
        el.appendChild(card);
      });
    }catch(ex){ console.error("platform companies",ex); el.innerHTML='<div class="state">Could not load companies. Apply the function-free tenant security SQL if needed.</div>'; }
  }
  async function loadPlatformFeedback(){
    var el=$("platformFeedbackList"), sum=$("platformFeedbackSummary"); if(!el||!isPlatformAdmin) return;
    el.innerHTML='<div class="state">Loading platform feedback…</div>';
    try{
      var res=await sb.from("app_feedback").select("*").order("created_at",{ascending:false}).limit(200); if(res.error) throw res.error;
      var orgRes=await sb.from("organizations").select("id,name"); if(orgRes.error) throw orgRes.error;
      var orgMap={}; (orgRes.data||[]).forEach(function(o){orgMap[String(o.id)]=o.name;});
      var rows=res.data||[], counts={new:0,reviewed:0,planned:0,resolved:0}; rows.forEach(function(x){ counts[x.status||"new"]=(counts[x.status||"new"]||0)+1; });
      if(sum) sum.innerHTML=['new','reviewed','planned','resolved'].map(function(k){return '<span class="fb-sum"><b>'+counts[k]+'</b>'+feedbackStatusLabel(k)+'</span>';}).join('');
      if(!rows.length){ el.innerHTML='<div class="state">No platform feedback has been submitted yet.</div>'; return; }
      el.innerHTML='';
      rows.forEach(function(f){
        var card=document.createElement('div'); card.className='feedback-admin-card';
        card.innerHTML='<div class="feedback-admin-top"><div><div class="feedback-admin-title"><span class="feedback-type-pill"></span><span class="feedback-subject"></span></div><div class="feedback-admin-meta"></div></div><select aria-label="Feedback status"><option value="new">New</option><option value="reviewed">Reviewed</option><option value="planned">Planned</option><option value="resolved">Resolved</option></select></div><div class="feedback-admin-body"></div>';
        card.querySelector('.feedback-type-pill').textContent=(f.feedback_type||'other').replace('_',' ');
        card.querySelector('.feedback-subject').textContent=f.subject||'Feedback';
        card.querySelector('.feedback-admin-meta').textContent=(orgMap[String(f.organization_id)]||'Unknown company')+' · '+(f.user_email||'Unknown user')+' · '+fmtDate(f.created_at)+(f.page_context?(' · '+f.page_context):'');
        card.querySelector('.feedback-admin-body').textContent=f.message||'';
        var sel=card.querySelector('select'); sel.value=f.status||'new';
        sel.addEventListener('change',async function(){
          sel.disabled=true;
          try{ var up=await sb.from('app_feedback').update({status:sel.value,updated_at:new Date().toISOString()}).eq('id',f.id); if(up.error) throw up.error; toast('Feedback status updated','ok'); loadPlatformFeedback(); }
          catch(ex){ console.error(ex); toast('Could not update feedback status.','err'); sel.value=f.status||'new'; sel.disabled=false; }
        });
        el.appendChild(card);
      });
    }catch(ex){ console.error('platform feedback',ex); if(sum) sum.innerHTML=''; el.innerHTML='<div class="state">Platform feedback is unavailable. Apply the function-free tenant security SQL if it has not been run yet.</div>'; }
  }
  async function loadPlatformDashboard(){
    if(!isPlatformAdmin){ showView('home'); return; }
    await loadPlatformSummary();
    await loadPlatformCompanies();
    await loadPlatformFeedback();
  }
  var _platformRefresh=$("platformRefresh"); if(_platformRefresh) _platformRefresh.addEventListener('click',loadPlatformDashboard);
  var _platformFeedbackRefresh=$("platformFeedbackRefresh"); if(_platformFeedbackRefresh) _platformFeedbackRefresh.addEventListener('click',loadPlatformFeedback);
  var _platformCompanyName=$("platformCompanyName"), _platformCompanySlug=$("platformCompanySlug");
  if(_platformCompanyName&&_platformCompanySlug){ _platformCompanyName.addEventListener('input',function(){ if(!_platformCompanySlug.value.trim()) _platformCompanySlug.value=makeSlug(_platformCompanyName.value); }); }
  var _platformCompanyForm=$("platformCompanyForm");
  if(_platformCompanyForm) _platformCompanyForm.addEventListener('submit',async function(e){
    e.preventDefault(); if(!isPlatformAdmin||!currentSession||!currentSession.user) return;
    var btn=$("platformCompanySubmit"), name=($("platformCompanyName").value||'').trim(), slug=makeSlug($("platformCompanySlug").value||name), plan=$("platformCompanyPlan").value||'standard';
    companyStatus('','');
    if(!name||!slug){ companyStatus('Enter a company name and slug before creating the company.','err'); return; }
    btn.disabled=true; btn.textContent='Creating…';
    try{
      var res=await sb.from('organizations').insert({name:name,slug:slug,status:'active',plan:plan,created_by:currentSession.user.id}).select('id').single();
      if(res.error) throw res.error;
      _platformCompanyForm.reset(); companyStatus('Company created successfully. The organization shell is ready for admin/user onboarding.','ok');
      await loadPlatformDashboard();
    }catch(ex){ console.error('create company',ex); companyStatus('Could not create company: '+((ex&&ex.message)||'Unknown error'),'err'); }
    finally{ btn.disabled=false; btn.textContent='Create company'; }
  });

  /* ================= Phase 2 workspaces ================= */
  var lastOperationalView="records";
  var activeFocusedAction=null, focusedActionOrigin="mywork";
  var ROLE_LABELS={admin:"Admin",safety_manager:"Safety Manager",supervisor:"Supervisor",read_only:"Read Only"};
  var ACTION_LABELS={not_started:"Not started",in_progress:"In progress",awaiting_verification:"Awaiting verification",verified:"Verified",changes_requested:"Changes requested"};

  function roleLabel(v){ return ROLE_LABELS[v]||"Read Only"; }
  function actionLabel(v){ return ACTION_LABELS[v]||"Not started"; }
  var CONTROL_TYPE_LABELS={elimination:"Elimination",substitution:"Substitution",engineering:"Engineering control",administrative:"Administrative / work practice",ppe:"PPE",other:"Other"};
  var CONTROL_TYPE_LABELS_ES={elimination:"Eliminación",substitution:"Sustitución",engineering:"Control de ingeniería",administrative:"Administrativo / práctica de trabajo",ppe:"EPP",other:"Otro"};
  function controlTypeLabel(v,lang){ var map=normalizeLanguageCode(lang||"en")==="es"?CONTROL_TYPE_LABELS_ES:CONTROL_TYPE_LABELS; return map[v]||""; }
  function profileName(p){ return p?(p.full_name||p.email||"User"):""; }
  function assigneeName(r){ var p=r&&r.assigned_user_id?profileById[String(r.assigned_user_id)]:null; return p?profileName(p):""; }
  function investigatorName(r){ var p=r&&r.investigator_user_id?profileById[String(r.investigator_user_id)]:null; return p?profileName(p):""; }
  function verifierName(r){ var p=r&&r.verifier_user_id?profileById[String(r.verifier_user_id)]:null; return p?profileName(p):""; }
  function isManager(){ return currentRole==="admin"||currentRole==="safety_manager"; }
  function canVerify(){ return isManager(); }
  function currentUserId(){ return currentSession&&currentSession.user?String(currentSession.user.id):""; }
  function isInvestigatorAssignedToMe(r){ return !!(r&&currentUserId()&&String(r.investigator_user_id||"")===currentUserId()); }
  function isActionAssignedToMe(r){ return !!(r&&currentUserId()&&String(r.assigned_user_id||"")===currentUserId()); }
  function isVerifierAssignedToMe(r){ return !!(r&&currentUserId()&&String(r.verifier_user_id||"")===currentUserId()); }
  function canPerformVerification(r){
    return !!(r&&isManager());
  }
  function canWorkInvestigation(r){
    if(!r||isResolvedReport(r)) return false;
    if(isManager()) return true;
    return currentRole==="supervisor" && isInvestigatorAssignedToMe(r);
  }
  function canWorkCorrectiveAction(r){
    if(!r||isResolvedReport(r)) return false;
    if(isManager()) return true;
    return currentRole==="supervisor" && isActionAssignedToMe(r);
  }
  function hasOperationalAccess(r){
    if(isManager()) return true;
    return currentRole==="supervisor" && (isInvestigatorAssignedToMe(r)||isActionAssignedToMe(r));
  }
  function canEditStep(r,n){
    if(!r||isResolvedReport(r)) return false;
    if(n===3 && ["new","under_review","assigned"].indexOf(String(r.status||"new"))<0) return false;
    if(isManager()){
      if(n===5) return canPerformVerification(r);
      return true;
    }
    if(currentRole!=="supervisor") return false;
    if(n>=1&&n<=3) return isInvestigatorAssignedToMe(r);
    if(n===4) return isActionAssignedToMe(r);
    return false;
  }
  function canEditReport(r){ return !isResolvedReport(r) && hasOperationalAccess(r); }
  function canAddNotes(r){ return !isResolvedReport(r) && hasOperationalAccess(r); }
  function canReopenReport(r){ return !!(r && isResolvedReport(r) && canVerify()); }
  function canManageUsers(){ return currentRole==="admin"; }
  function workflowHasProgress(r){
    if(!r || isResolvedReport(r)) return false;
    return r.status!=="new" || hasWorkflowValue(r.investigation_findings) || hasWorkflowValue(r.root_cause) || hasWorkflowValue(r.corrective_action) ||
      hasWorkflowValue(r.assigned_user_id) || hasWorkflowValue(r.responsible_person) || hasWorkflowValue(r.due_date) ||
      hasWorkflowValue(r.priority) || hasWorkflowValue(r.verifier_user_id) || (r.action_status&&r.action_status!=="not_started") ||
      hasWorkflowValue(r.action_completion_note) || hasWorkflowValue(r.action_verification_note);
  }
  function canRestartWorkflow(r){ return !!(r && canVerify() && workflowHasProgress(r)); }

  function applyRoleUi(){
    var pill=$("rolePill");
    if(pill){ pill.textContent=roleLabel(currentRole); pill.className="role-pill r-"+currentRole; }
    var adminNav=document.querySelector('.nav-item[data-view="users"]');
    if(adminNav) adminNav.style.display=(currentRole==="admin"?"":"none");
    var addUserBtn=$("addUserBtn"); if(addUserBtn) addUserBtn.style.display=(currentRole==="admin"?"":"none");
    var platformNav=$("platformNav");
    if(platformNav) platformNav.style.display="none";
    var myWorkNav=document.querySelector('.nav-item[data-view="mywork"]');
    var canOwnWork=currentRole!=="read_only";
    if(myWorkNav) myWorkNav.style.display=(canOwnWork?"":"none");
    var hot=$("homeOpenTitle"), hod=$("homeOpenDesc");
    if(hot) hot.textContent=canOwnWork?"Open My Work":"Open Safety Inbox";
    if(hod) hod.textContent=canOwnWork?"See investigations, corrective actions, and verification reviews that need your attention.":"Review reports and safety activity.";
    var note=$("adminPermissionNote");
    var afs=$("adminFeedbackSection"); if(afs) afs.hidden=true;
    var hc=$("platformContextLabel"); if(hc) hc.textContent=currentOrgName?("Current company: "+currentOrgName):"Platform overview";
    refreshProfileCard();
    if(note){
      note.innerHTML=canManageUsers()
        ?'<strong>You are an Admin.</strong> You can change roles and activate/deactivate dashboard access.'
        :'<strong>'+esc(roleLabel(currentRole))+' access.</strong> Only an Admin can change user roles or account activation.';
    }
  }

  function findReport(id){ for(var i=0;i<allReports.length;i++) if(String(allReports[i].id)===String(id)) return allReports[i]; return null; }
  function daysUntilDue(r){
    if(!r||!r.due_date) return null;
    var d=new Date(r.due_date+"T23:59:59"), now=new Date();
    return Math.ceil((d.getTime()-now.getTime())/86400000);
  }
  function escalationInfo(r){
    var d=daysUntilDue(r);
    if(d===null) return {level:0,label:"No due date",cls:""};
    if(d<0){
      var late=Math.abs(d);
      if(late>=14) return {level:3,label:late+" days overdue · escalation 3",cls:"over"};
      if(late>=7) return {level:2,label:late+" days overdue · escalation 2",cls:"over"};
      return {level:1,label:late+" day"+(late===1?"":"s")+" overdue",cls:"over"};
    }
    if(d===0) return {level:1,label:"Due today",cls:"soon"};
    if(d<=3) return {level:1,label:"Due in "+d+" day"+(d===1?"":"s"),cls:"soon"};
    return {level:0,label:"Due "+shortDate(r.due_date),cls:""};
  }
  function isHighPotential(r){
    var s=(r&&r.potential_severity||"").toLowerCase();
    return !!(r&&r.involves_injury)||(s.indexOf("critical")===0)||(s.indexOf("serious")===0);
  }
  function urgentTriageHtml(r){
    if(!isHighPotential(r)) return "";
    if(r.involves_injury){
      var screen=String(r.calosha_screening_status||"");
      if(screen==="pending" || screen==="yes" || screen==="no") return "";
      return '<div class="ops-alert critical calosha-screen"><b>Injury report — regulatory screening required</b>'+
        '<div class="calosha-screen-copy">Review promptly. If the event involved or may involve any of the following, notify RBH management immediately: inpatient hospitalization other than medical observation or diagnostic testing; amputation; loss of an eye; serious permanent disfigurement; or death.</div>'+
        '<div class="calosha-screen-copy"><strong>California timing:</strong> qualifying serious injuries, illnesses, and deaths must be reported to Cal/OSHA immediately — as soon as practically possible and ordinarily no later than 8 hours after the employer knows, or with diligent inquiry would have known, of the event. Section 342 contains a limited exigent-circumstances exception. This screen is a prompt only; it does not make the legal determination or submit the report.</div>'+
        '<a class="calosha-link" href="https://www.dir.ca.gov/dosh/report-accident-or-injury.html" target="_blank" rel="noopener">Open official Cal/OSHA reporting instructions ↗</a>'+
      '</div>';
    }
    return '<div class="ops-alert critical"><b>Priority triage</b>Higher-potential event — prioritize review, assignment, and corrective action.</div>';
  }
  function reportAttentionRank(r){
    var n=0; if(r.involves_injury) n+=100; if(isOverdue(r)) n+=80;
    if(r.action_status==="awaiting_verification") n+=70;
    if(r.action_status==="changes_requested") n+=55;
    if(r.status==="new") n+=40;
    var s=(r.potential_severity||"").toLowerCase(); if(s.indexOf("critical")===0)n+=35; else if(s.indexOf("serious")===0)n+=25;
    if(r.priority==="high")n+=20; n+=Math.min(escalationInfo(r).level*8,24); return n;
  }
  function actionBadgeHtml(r){
    var a=r.action_status||"not_started";
    if(!actionEligible(r) && a==="not_started") return "";
    return '<span class="badge action-state as-'+esc(a)+'">'+esc(actionLabel(a))+'</span>';
  }
  function incidentBadgeHtml(r){
    var st=STATUS[r.status]||{l:r.status||"",c:"st-muted"}; var out='';
    if(isOverdue(r)) out+='<span class="badge bg-overdue">Overdue</span>'; if(r.involves_injury) out+='<span class="badge bg-injury">Injury</span>';
    if(r.potential_severity) out+='<span class="badge '+sevClass(r.potential_severity)+'">'+esc(sevShort(r.potential_severity))+'</span>';
    if(r.priority) out+='<span class="badge pr-'+esc(r.priority)+'">'+esc(r.priority.charAt(0).toUpperCase()+r.priority.slice(1))+' priority</span>';
    out+=actionBadgeHtml(r);
    out+='<span class="badge '+st.c+'">'+esc(st.l)+'</span>'; return out;
  }
  function openIncident(r, from){
    if(!r) return; activeIncident=r; activeIncidentLanguage=preferredReadingLanguage(); lastOperationalView=from||((document.getElementById('view-mywork')&&!document.getElementById('view-mywork').hidden)?'mywork':((document.getElementById('view-actions')&&!document.getElementById('view-actions').hidden)?'actions':'records'));
    storeIncident(r,lastOperationalView);
    var back=$("incidentBack"); if(back) back.textContent=lastOperationalView==="mywork"?"← Back to My Work":(lastOperationalView==="actions"?"← Back to Corrective Actions":"← Back to Safety Inbox");
    $("incidentTitle").textContent="#"+(r.ref_no||r.id)+" · "+(r.report_type||"Safety report");
    var meta=[]; if(r.job_site) meta.push(r.job_site); if(investigatorName(r)) meta.push("Investigator: "+investigatorName(r)); if(assigneeName(r)) meta.push("Action owner: "+assigneeName(r)); meta.push(fmtDate(r.created_at)); $("incidentMeta").textContent=meta.join(" · ");
    $("incidentSummary").innerHTML='<div class="is-badges">'+incidentBadgeHtml(r)+'</div><div class="is-desc">'+esc(r.description||"No description provided.")+'</div>';
    var langSel=$("incidentLanguage"); if(langSel){ langSel.value=activeIncidentLanguage; }
    setIncidentLanguageState(r,activeIncidentLanguage,"loading");
    var body=$("incidentBody"); body.innerHTML=''; body.setAttribute("data-report-id",String(r.id)); buildDetail(r,body,null); showView('incident');
    changeIncidentLanguage(r,activeIncidentLanguage);
  }
  var _incidentLanguage=$("incidentLanguage"); if(_incidentLanguage) _incidentLanguage.addEventListener("change",function(){ if(activeIncident) changeIncidentLanguage(activeIncident,this.value); });

  function renderHomeAttention(){
    var el=$("homeAttention"); if(!el) return; var items=allReports.filter(function(r){ return r.status!=="closed"&&r.status!=="no_action"&&r.status!=="duplicate"; });
    items.sort(function(a,b){ return reportAttentionRank(b)-reportAttentionRank(a) || new Date(b.created_at)-new Date(a.created_at); }); items=items.slice(0,5);
    if(!items.length){ el.innerHTML='<div class="notes-empty">Nothing needs attention right now.</div>'; return; }
    el.innerHTML=''; items.forEach(function(r){
      var b=document.createElement('button'); b.className='attention-item'+(r.involves_injury?' attention-injury':''); b.type='button';
      var tag=r.action_status==="awaiting_verification"?'Verify':(isOverdue(r)?'Overdue':(r.involves_injury?'Injury':(r.status==='new'?'New':'Open')));
      b.innerHTML='<span class="a-title">#'+esc(r.ref_no)+' · '+esc(r.report_type||'Report')+'</span><span class="a-meta">'+esc((r.job_site?r.job_site+' · ':'')+(assigneeName(r)?'Assigned: '+assigneeName(r)+' · ':'')+fmtDate(r.created_at))+'</span><span class="a-tag badge '+(tag==='Overdue'?'bg-overdue':tag==='Injury'?'bg-injury':tag==='Verify'?'as-awaiting_verification':'st-new')+'">'+tag+'</span>';
      b.addEventListener('click',function(){ openIncident(r,'home'); }); el.appendChild(b);
    });
  }
  function isOpenOperational(r){ return !!(r && r.status!=="closed" && r.status!=="no_action" && r.status!=="duplicate"); }
  function isAssignedToMe(r){ return isActionAssignedToMe(r); }
  function investigatorWorkActive(r){
    if(!isOpenOperational(r)||!isInvestigatorAssignedToMe(r)) return false;
    return recommendedWizardStep(r)<=3;
  }
  function myActionWorkRows(){
    var uid=currentUserId();
    if(!uid) return [];
    return (allCorrectiveActions||[]).filter(function(a){
      var r=findReport(a.report_id);
      if(!r||!isOpenOperational(r)||!correctiveActionInCurrentCycle(a,r)) return false;
      if(String(a.owner_user_id||"")!==uid) return false;
      return ["not_started","in_progress","changes_requested"].indexOf(String(a.status||"not_started"))>=0;
    });
  }
  function myVerificationWorkRows(){
    if(!isManager()) return [];
    return (allCorrectiveActions||[]).filter(function(a){
      var r=findReport(a.report_id);
      if(!r||!isOpenOperational(r)||!correctiveActionInCurrentCycle(a,r)) return false;
      if(String(a.status||"")!=="awaiting_verification") return false;
      return true;
    });
  }
  function childActionSort(a,b){
    if(isOverdue(a)!==isOverdue(b)) return isOverdue(a)?-1:1;
    if((a.status==="changes_requested")!==(b.status==="changes_requested")) return a.status==="changes_requested"?-1:1;
    var ad=a.due_date?new Date(a.due_date+"T23:59:59").getTime():8640000000000000;
    var bd=b.due_date?new Date(b.due_date+"T23:59:59").getTime():8640000000000000;
    if(ad!==bd) return ad-bd;
    var ar=findReport(a.report_id), br=findReport(b.report_id);
    return new Date((br&&br.created_at)||0)-new Date((ar&&ar.created_at)||0);
  }
  function childWorkCard(a,mode){
    var r=findReport(a.report_id);
    var b=document.createElement("button"); b.type="button"; b.className="task-card";
    var owner=a.owner_user_id&&profileById[String(a.owner_user_id)]?profileName(profileById[String(a.owner_user_id)]):"Not assigned";
    var info=escalationInfo(a), status=String(a.status||"not_started");
    var label=mode==="verify"
      ? "Ready for verification"
      : (status==="changes_requested"?"Changes requested":actionLabel(status));
    var meta=mode==="verify"
      ? "Action owner: "+owner
      : "Assigned: "+owner+(r&&r.job_site?" · "+r.job_site:"");
    var due=mode==="verify"
      ? (a.completed_at?"Submitted "+shortDate(a.completed_at):"Ready for review")
      : (a.due_date?shortDate(a.due_date):"No due date");
    b.innerHTML=
      '<div class="task-title">#'+esc(r&&r.ref_no)+' · Action #'+esc(a.action_number||"")+' · '+esc((r&&r.report_type)||"Report")+
        '<span class="task-state">'+esc(label)+'</span></div>'+
      '<div class="task-action">'+esc(a.description||"Corrective action")+'</div>'+
      '<div class="task-meta">'+esc(meta)+'</div>'+
      '<div class="task-due"><b class="due-signal '+(mode==="verify"?"":esc(info.cls))+'">'+
        esc(mode==="verify"?"Ready for verification":info.label)+'</b><span>'+esc(due)+'</span></div>';
    b.addEventListener("click",function(){ if(r) openFocusedCorrectiveAction(a,"mywork"); });
    return b;
  }
  function renderMyWork(){
    var list=$("myWorkList"), summary=$("myWorkSummary"), count=$("myWorkCount"); if(!list||!summary) return;
    var canOwn=currentRole!=="read_only", user=currentSession&&currentSession.user;
    if(!canOwn||!user){
      list.innerHTML='<div class="state">My Work is available to Admins, Safety Managers, and Supervisors.</div>';
      summary.innerHTML='';
      var navOff=$("navMyWorkCount"); if(navOff) navOff.textContent='';
      return;
    }

    var investigations=allReports.filter(investigatorWorkActive).sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);});
    var actions=myActionWorkRows().sort(childActionSort);
    var reviews=myVerificationWorkRows().sort(childActionSort);
    var overdue=actions.filter(isOverdue).length;
    var soon=actions.filter(function(a){var d=daysUntilDue(a);return d!==null&&d>=0&&d<=3;}).length;
    var reviewCount=reviews.length;

    function stat(n,l,cls){return '<div class="mywork-stat '+(cls||'')+'"><b>'+n+'</b><span>'+l+'</span></div>';}
    summary.innerHTML=
      stat(investigations.length+actions.length,'Assigned to me')+
      stat(investigations.length,'Investigations')+
      stat(soon,'Due in 3 days',soon?'warn':'')+
      stat(overdue,'Overdue',overdue?'alert':'');

    var personalCount=investigations.length+actions.length+reviewCount;
    if(count) count.textContent=personalCount+(personalCount===1?' open assignment':' open assignments');

    var ng=$("myWorkGreeting"), br=$("myWorkBannerText"), role=$("myWorkRole");
    var nm=currentProfile?profileName(currentProfile):((user&&user.email)||'');
    if(ng) ng.textContent=nm?('Work for '+nm):'Your work queue';
    if(br){
      if(reviewCount) br.textContent=reviewCount+' corrective action'+(reviewCount===1?' is':'s are')+' ready for verification.';
      else if(investigations.length) br.textContent=investigations.length+' investigation'+(investigations.length===1?'':'s')+' currently need'+(investigations.length===1?'s':'')+' your attention.';
      else if(actions.length) br.textContent='Start with overdue, changes-requested, or due-soon corrective actions first.';
      else br.textContent='Your assigned investigations, corrective actions, and verification reviews will appear here.';
    }
    if(role) role.textContent=roleLabel(currentRole);

    list.innerHTML='';
    if(!investigations.length&&!actions.length) list.innerHTML='<div class="state">Nothing is assigned to you right now.</div>';
    investigations.forEach(function(r){list.appendChild(myWorkCard(r,'mywork'));});
    actions.forEach(function(a){list.appendChild(childWorkCard(a,'action'));});

    var panel=$("myWorkReviewPanel"), reviewList=$("myWorkReviewList");
    if(panel) panel.classList.toggle('show',isManager());
    if(reviewList&&isManager()){
      reviewList.innerHTML='';
      if(!reviews.length) reviewList.innerHTML='<div class="state">Nothing is waiting for verification.</div>';
      else reviews.forEach(function(a){reviewList.appendChild(childWorkCard(a,'verify'));});
    }

    var nav=$("navMyWorkCount");
    if(nav){
      var attention=investigations.length+actions.length+reviewCount;
      nav.textContent=attention?String(attention):'';
    }
  }
  // Legacy report-level helper is still used by My Work while the app is
  // transitioning to the multi-action child-table model. Keep it available so
  // one workspace cannot break the global report refresh/render sequence.
  function actionEligible(r){
    return !!(r && (
      r.corrective_action ||
      r.responsible_person ||
      r.assigned_user_id ||
      r.due_date ||
      r.status==='corrective_action' ||
      (r.action_status && r.action_status!=="not_started")
    ));
  }

  function currentCorrectiveActionWorkspaceRows(){
    return (allCorrectiveActions||[]).filter(function(a){
      var r=findReport(a.report_id);
      if(!r||isResolvedReport(r)||!correctiveActionInCurrentCycle(a,r)) return false;
      return String(a.status||"not_started")!=="verified";
    });
  }
  function correctiveActionNeedsMyAttention(a){
    if(!a||!currentUserId()) return false;
    if(String(a.owner_user_id||"")===currentUserId()) return true;
    if(String(a.status||"")==="awaiting_verification" && isManager()) return true;
    return false;
  }
  function renderActionSummary(arr){
    var el=$("actionSummary"); if(!el) return;
    var overdue=0,soon=0,verify=0,mine=0;
    arr.forEach(function(a){
      var d=daysUntilDue(a);
      if(d!==null&&d<0) overdue++;
      else if(d!==null&&d<=3) soon++;
      if(String(a.status||"")==="awaiting_verification") verify++;
      if(currentUserId()&&String(a.owner_user_id||"")===currentUserId()) mine++;
    });
    function s(n,l){ return '<div class="action-stat"><b>'+n+'</b><span>'+l+'</span></div>'; }
    el.innerHTML=s(overdue,"Overdue")+s(soon,"Due in 3 days")+s(verify,"Awaiting verification")+s(mine,"Assigned to me");
  }
  function renderActions(){
    var el=$("actionList"), count=$("actionCount"); if(!el) return;
    var arr=currentCorrectiveActionWorkspaceRows();

    arr.sort(function(a,b){
      var as=String(a.status||""), bs=String(b.status||"");
      if(as==="awaiting_verification"&&bs!=="awaiting_verification") return -1;
      if(bs==="awaiting_verification"&&as!=="awaiting_verification") return 1;
      if(isOverdue(a)!==isOverdue(b)) return isOverdue(a)?-1:1;
      var ad=a.due_date?new Date(a.due_date+"T23:59:59").getTime():8640000000000000;
      var bd=b.due_date?new Date(b.due_date+"T23:59:59").getTime():8640000000000000;
      if(ad!==bd) return ad-bd;
      var ar=findReport(a.report_id), br=findReport(b.report_id);
      return Number((br&&br.ref_no)||0)-Number((ar&&ar.ref_no)||0);
    });

    renderActionSummary(arr);
    if(count) count.textContent=arr.length+(arr.length===1?' open action':' open actions');

    var nav=$("navActionCount");
    if(nav){
      var attention=arr.filter(correctiveActionNeedsMyAttention).length;
      nav.textContent=attention?String(attention):'';
    }

    if(!arr.length){
      el.innerHTML='<div class="state">No open corrective actions.</div>';
      return;
    }

    el.innerHTML='';
    arr.forEach(function(a){
      var r=findReport(a.report_id);
      if(!r) return;

      var b=document.createElement('button');
      b.type='button';
      b.className='task-card corrective-action-card'+(isOverdue(a)?' ca-overdue':'');

      var escInfo=escalationInfo(a);
      var ownerProfile=a.owner_user_id?profileById[String(a.owner_user_id)]:null;
      var assignee=ownerProfile?profileName(ownerProfile):"Not assigned";
      var reportType=r.report_type||'Report';

      b.innerHTML=
        '<div class="task-title">#'+esc(r.ref_no)+' · Action #'+esc(a.action_number||"")+' · '+esc(reportType)+
          '<span class="task-state ca-status-'+esc(String(a.status||"not_started"))+'">'+esc(actionLabel(a.status||"not_started"))+'</span></div>'+
        '<div class="task-action">'+esc(a.description||'Corrective action needs to be documented.')+'</div>'+
        '<div class="task-meta">Assigned: <span class="assignment-name">'+esc(assignee)+'</span>'+
          (r.job_site?' · '+esc(r.job_site):'')+'</div>'+
        '<div class="task-due"><b class="due-signal '+escInfo.cls+'">'+esc(escInfo.label)+'</b><span>'+
          (a.due_date?esc(shortDate(a.due_date)):'No due date')+'</span></div>';

      b.addEventListener('click',function(){ openFocusedCorrectiveAction(a,'actions'); });
      el.appendChild(b);
    });
  }

  function focusedActionCanComplete(a,r){
    if(!a||!r||isResolvedReport(r)||!correctiveActionInCurrentCycle(a,r)) return false;
    if(isManager()) return true;
    return currentRole==="supervisor" && currentUserId() && String(a.owner_user_id||"")===currentUserId();
  }
  function focusedActionCanVerify(a,r){
    return !!(a&&r&&!isResolvedReport(r)&&correctiveActionInCurrentCycle(a,r)&&isManager()&&String(a.status||"")==="awaiting_verification");
  }
  function replaceGlobalCorrectiveAction(row){
    if(!row||!row.id) return;
    var found=false;
    allCorrectiveActions=(allCorrectiveActions||[]).map(function(a){
      if(String(a.id)===String(row.id)){found=true;return Object.assign({},a,row);}
      return a;
    });
    if(!found) allCorrectiveActions.push(row);
  }
  function replaceGlobalReport(row){
    if(!row||!row.id) return;
    allReports=(allReports||[]).map(function(r){return String(r.id)===String(row.id)?Object.assign(r,row):r;});
    if(activeIncident&&String(activeIncident.id)===String(row.id)) Object.assign(activeIncident,row);
  }
  async function refreshFocusedCorrectiveActionData(actionId,reportId){
    var actionRes=await sb.from("report_corrective_actions")
      .select("id,report_id,organization_id,workflow_generation,action_number,description,control_type,owner_user_id,due_date,priority,status,completion_note,completed_at,completed_by,verifier_user_id,verification_note,verified_at,verified_by,activated_at,activation_reopen_count,retired_at,created_at,updated_at")
      .eq("id",actionId).maybeSingle();
    if(actionRes.error) throw actionRes.error;
    if(actionRes.data){ replaceGlobalCorrectiveAction(actionRes.data); activeFocusedAction=actionRes.data; }
    if(reportId){
      var reportRes=await sb.from("reports").select("*").eq("id",reportId).maybeSingle();
      if(reportRes.error) throw reportRes.error;
      if(reportRes.data) replaceGlobalReport(reportRes.data);
      await refreshReportAttachments(reportId);
    }
    renderMyWork(); renderActions(); renderHomeSnapshot();
    return activeFocusedAction;
  }
  async function clearFocusedLegacyVerifier(a){
    if(!a||!a.verifier_user_id||!isManager()) return true;
    var res=await sb.rpc("rbh_set_corrective_action_verifier",{p_action_id:a.id,p_verifier_user_id:null});
    if(res.error) throw res.error;
    a.verifier_user_id=null;
    return true;
  }
  function focusedActionOwnerName(a){
    var p=a&&a.owner_user_id?profileById[String(a.owner_user_id)]:null;
    return p?profileName(p):"Not assigned";
  }
  function focusedActionPersonName(id,fallback){
    var p=id?profileById[String(id)]:null;
    return p?profileName(p):(fallback||"");
  }
  function focusedMeta(label,value){
    return '<div class="focused-action-meta-item"><span>'+esc(label)+'</span><b>'+esc(value||"Not recorded")+'</b></div>';
  }
  function openFocusedCorrectiveAction(a,from){
    if(!a) return;
    var r=findReport(a.report_id);
    if(!r) return;
    activeFocusedAction=a;
    focusedActionOrigin=from==="actions"?"actions":"mywork";
    var back=$("myActionBack"); if(back) back.textContent=focusedActionOrigin==="actions"?"← Back to Corrective Actions":"← Back to My Work";
    showView("myaction");
    renderFocusedCorrectiveAction();
  }
  function renderFocusedCorrectiveAction(){
    var shell=$("myActionShell"); if(!shell) return;
    var a=activeFocusedAction;
    var r=a?findReport(a.report_id):null;
    if(!a||!r){shell.innerHTML='<div class="state">This corrective action is no longer available.</div>';return;}
    if(!correctiveActionInCurrentCycle(a,r)&&!isResolvedReport(r)){
      shell.innerHTML='<div class="state">This corrective action belongs to an earlier workflow cycle. Open the incident details to review its history.</div>';return;
    }

    var status=String(a.status||"not_started");
    var owner=focusedActionOwnerName(a);
    var control=a.control_type?(controlTypeLabel(a.control_type)||a.control_type):"Not selected";
    var due=a.due_date?fmtDate(a.due_date):"No due date";
    var priority=a.priority?String(a.priority).charAt(0).toUpperCase()+String(a.priority).slice(1):"No priority";
    var completedBy=focusedActionPersonName(a.completed_by,"");
    var verifiedBy=focusedActionPersonName(a.verified_by,"");
    var canComplete=focusedActionCanComplete(a,r)&&["not_started","in_progress","changes_requested"].indexOf(status)>=0;
    var canVerify=focusedActionCanVerify(a,r);
    var isMine=currentUserId()&&String(a.owner_user_id||"")===currentUserId();
    var reportLine='Report #'+String(r.ref_no||r.id)+(r.report_type?' · '+r.report_type:'')+(r.job_site?' · '+r.job_site:'');
    var statusClass='mas-status-'+status;

    var html='<div class="focused-action-head"><div><div class="home-kicker">'+esc(reportLine)+'</div><h2>Corrective Action #'+esc(a.action_number||"")+'</h2><p>This page is only for this corrective action. Updates save to the same action shown in the main incident workflow.</p></div><div class="focused-action-status"><span class="multi-action-status '+esc(statusClass)+'">'+esc(actionLabel(status))+'</span></div></div>'+
      '<div class="focused-action-body">';

    if(status==="changes_requested"){
      html+='<div class="focused-action-callout returned"><b>Changes requested</b>'+esc(a.verification_note||"The reviewer requested an update to this corrective action.")+'</div>';
    } else if(status==="awaiting_verification"){
      html+='<div class="focused-action-callout waiting"><b>Submitted for verification</b>'+(canVerify?'Review the completed work and evidence below. No verifier assignment is required.':'Your work is waiting for an authorized reviewer. You do not need to do anything unless it is sent back.')+'</div>';
    } else if(status==="verified"){
      html+='<div class="focused-action-complete"><b>Verified</b>This corrective action is complete and no longer needs work.</div>';
    } else if(isMine){
      html+='<div class="focused-action-callout"><b>This is your assigned action</b>Complete only the work shown on this page. Other corrective actions for this incident stay out of the way.</div>';
    } else {
      html+='<div class="focused-action-callout"><b>Focused action view</b>You are viewing this corrective action by itself. Only the assigned owner or an authorized manager can update the completion work.</div>';
    }

    html+='<section class="focused-action-section"><h3>Assigned work</h3><p class="focused-action-description">'+esc(a.description||"No corrective-action description recorded.")+'</p><div class="focused-action-meta">'+
      focusedMeta("Assigned to",owner)+focusedMeta("Due date",due)+focusedMeta("Priority",priority)+focusedMeta("Control type",control)+
      '</div></section>';

    if(["not_started","in_progress","changes_requested"].indexOf(status)>=0){
      html+='<section class="focused-action-section focused-action-work"><h3>'+(status==="changes_requested"?'Update completed work':'Complete this action')+'</h3>'+
        '<label for="focusedCompletionNote">What was completed?</label><textarea id="focusedCompletionNote" '+(canComplete?'':'disabled')+' placeholder="Describe exactly what was done to complete this corrective action.">'+esc(a.completion_note||"")+'</textarea>'+
        '<p class="focused-action-help">Required before submitting for verification. Be specific enough that a reviewer can understand what changed.</p>'+
        '<div class="evidence-panel" id="focusedActionEvidence"></div>'+
        (canComplete?'<div class="focused-action-actions"><button class="wizard-primary" id="focusedSubmitAction" type="button">'+(status==="changes_requested"?'Resubmit for verification →':'Submit for verification →')+'</button></div>':'<div class="focused-action-readonly">This action is assigned to '+esc(owner)+'. You can review it here, but you cannot submit work for this owner.</div>')+
        '</section>';
    } else {
      html+='<section class="focused-action-section"><h3>Completed work</h3>'+
        '<div class="focused-action-submitted"><b>Completed work submitted</b><p>'+esc(a.completion_note||"No completion note recorded.")+'</p>'+
        (a.completed_at?'<div class="action-meta">Submitted '+esc(fmtDate(a.completed_at))+(completedBy?' by '+esc(completedBy):'')+'</div>':'')+'</div>'+
        '<div class="evidence-panel" id="focusedActionEvidence"></div></section>';
    }

    if(status==="awaiting_verification"){
      html+='<section class="focused-action-section focused-action-review"><h3>Verification</h3>';
      if(canVerify){
        html+='<label for="focusedVerificationNote">Verification notes <span style="font-weight:400;color:var(--muted)">(optional when approving)</span></label>'+
          '<textarea id="focusedVerificationNote" placeholder="What did you verify? If sending this back, explain exactly what still needs to be done.">'+esc(a.verification_note||"")+'</textarea>'+
          '<div class="wizard-required" id="focusedVerificationRequired">Add a reviewer note explaining the requested changes.</div>'+
          '<div class="focused-action-actions"><button class="multi-action-request-changes" id="focusedRequestChanges" type="button">Send back for changes</button><button class="wizard-primary" id="focusedVerifyAction" type="button">Verify action</button></div>';
      } else {
        html+='<div class="focused-action-readonly">An authorized reviewer will verify this action or send it back with a specific note. No verification owner needs to be assigned.</div>';
      }
      html+='</section>';
    } else if(status==="verified"){
      html+='<section class="focused-action-section"><h3>Verification</h3><div class="focused-action-submitted"><b>Verified'+(a.verified_at?' · '+esc(fmtDate(a.verified_at)):'')+'</b><p>'+esc(a.verification_note||"No reviewer note recorded.")+'</p>'+(verifiedBy?'<div class="action-meta">Verified by '+esc(verifiedBy)+'</div>':'')+'</div></section>';
    }

    html+='</div>';
    shell.innerHTML=html;

    var evidence=$("focusedActionEvidence");
    if(evidence) renderActionEvidence(r,evidence,null,a,{readOnly:status==="awaiting_verification"||status==="verified"}).catch(function(ex){console.error("focused action evidence",ex);});

    var submit=$("focusedSubmitAction");
    if(submit) submit.addEventListener("click",async function(){
      var ta=$("focusedCompletionNote"), note=(ta&&ta.value.trim())||"";
      if(!note){toast("Describe what was completed before submitting this action for verification.","err");if(ta)ta.focus();return;}
      submit.disabled=true; var old=submit.textContent; submit.textContent="Submitting…";
      try{
        await waitForActionEvidenceUpload(r.id,a.id);
        var res=await sb.rpc("rbh_submit_corrective_action_completion",{p_action_id:a.id,p_completion_note:note});
        if(res.error) throw res.error;
        await refreshFocusedCorrectiveActionData(a.id,r.id);
        var fresh=activeFocusedAction||a;
        var emailResult=await sendCorrectiveActionVerificationRequestedEmail(r,fresh);
        if(!emailResult||(!emailResult.sent&&!emailResult.skipped&&emailResult.ok===false)) console.error("focused verification-request email failed",emailResult);
        renderFocusedCorrectiveAction();
        toast("Corrective Action #"+String(a.action_number||"")+" submitted for verification","ok");
      }catch(ex){console.error(ex);toast("Could not submit this corrective action.","err");}
      finally{if(submit.isConnected){submit.disabled=false;submit.textContent=old;}}
    });

    var verify=$("focusedVerifyAction");
    if(verify) verify.addEventListener("click",async function(){
      if(!focusedActionCanVerify(a,r)){toast("You do not have verification permission for this corrective action.","err");return;}
      var noteEl=$("focusedVerificationNote"), note=(noteEl&&noteEl.value.trim())||null;
      verify.disabled=true; var old=verify.textContent; verify.textContent="Verifying…";
      try{
        await waitForActionEvidenceUpload(r.id,a.id);
        await clearFocusedLegacyVerifier(a);
        var res=await sb.rpc("rbh_verify_corrective_action",{p_action_id:a.id,p_verification_note:note});
        if(res.error) throw res.error;
        await refreshFocusedCorrectiveActionData(a.id,r.id);
        await loadNotifications(true);
        renderFocusedCorrectiveAction();
        toast("Corrective Action #"+String(a.action_number||"")+" verified","ok");
      }catch(ex){console.error(ex);toast("Could not verify this corrective action.","err");}
      finally{if(verify.isConnected){verify.disabled=false;verify.textContent=old;}}
    });

    var changes=$("focusedRequestChanges");
    if(changes) changes.addEventListener("click",async function(){
      if(!focusedActionCanVerify(a,r)){toast("You do not have verification permission for this corrective action.","err");return;}
      var noteEl=$("focusedVerificationNote"), note=(noteEl&&noteEl.value.trim())||"", req=$("focusedVerificationRequired");
      if(!note){if(req)req.classList.add("show");toast("Explain what still needs to be changed before sending this action back.","err");if(noteEl)noteEl.focus();return;}
      if(req) req.classList.remove("show");
      changes.disabled=true; var old=changes.textContent; changes.textContent="Sending back…";
      try{
        await waitForActionEvidenceUpload(r.id,a.id);
        await clearFocusedLegacyVerifier(a);
        var res=await sb.rpc("rbh_request_corrective_action_changes",{p_action_id:a.id,p_verification_note:note});
        if(res.error) throw res.error;
        await refreshFocusedCorrectiveActionData(a.id,r.id);
        var fresh=activeFocusedAction||a;
        var emailResult=await sendCorrectiveActionChangesRequestedEmail(r,fresh);
        if(!emailResult||(!emailResult.sent&&!emailResult.skipped&&emailResult.ok===false)) console.error("focused changes-requested email failed",emailResult);
        await loadNotifications(true);
        renderFocusedCorrectiveAction();
        toast("Corrective Action #"+String(a.action_number||"")+" sent back for changes","ok");
      }catch(ex){console.error(ex);toast("Could not request changes for this corrective action.","err");}
      finally{if(changes.isConnected){changes.disabled=false;changes.textContent=old;}}
    });
  }

  var _myActionBack=$("myActionBack"); if(_myActionBack) _myActionBack.addEventListener("click",function(){showView(focusedActionOrigin==="actions"?"actions":"mywork");});
  var _myActionIncident=$("myActionViewIncident"); if(_myActionIncident) _myActionIncident.addEventListener("click",function(){
    var r=activeFocusedAction?findReport(activeFocusedAction.report_id):null;
    if(r) openIncident(r,focusedActionOrigin==="actions"?"actions":"mywork");
  });

  /* ================= App shell: navigation, home, users ================= */
  var PAGE_TITLES={home:"Home",mywork:"My Work",records:"Safety Inbox",actions:"Corrective Actions",myaction:"Corrective Action",metrics:"Analytics",users:"Admin",incident:"Incident"};
  var sidebarEl=document.getElementById("sidebar"), sbBackdrop=document.getElementById("sbBackdrop");
  function openSidebar(){ if(sidebarEl) sidebarEl.classList.add("open"); if(sbBackdrop) sbBackdrop.classList.add("show"); }
  function closeSidebar(){ if(sidebarEl) sidebarEl.classList.remove("open"); if(sbBackdrop) sbBackdrop.classList.remove("show"); }

  function showView(name){
    if(name==="users" && currentRole!=="admin") name="home";
    if(name==="platform" && !isPlatformAdmin) name="home";
    if(name==="mywork" && currentRole==="read_only") name="records";
    if(name==="myaction" && !activeFocusedAction) name=(focusedActionOrigin==="actions"?"actions":"mywork");
    if(name!=="myaction") storeView(name);
    ["home","mywork","records","actions","myaction","metrics","platform","users","incident"].forEach(function(v){ var el=document.getElementById("view-"+v); if(el) el.hidden=(v!==name); });
    var activeNav=name==="myaction"?(focusedActionOrigin==="actions"?"actions":"mywork"):name;
    document.querySelectorAll(".nav-item").forEach(function(n){ n.classList.toggle("active", n.getAttribute("data-view")===activeNav); });
    var pt=$("pageTitle"); if(pt) pt.textContent=PAGE_TITLES[name]||"";
    if(name==="metrics") renderMetrics();
    if(name==="mywork") renderMyWork();
    if(name==="actions") renderActions();
    if(name==="platform") loadPlatformDashboard();
    if(name==="users"){ loadUsers(); loadAdminUserEvents(); }
    if(name==="home") renderHomeSnapshot();
    closeSidebar();
    window.scrollTo({top:0});
  }

  function renderHomeSnapshot(){ renderHomeGreeting(); renderHomeStats(); renderHomeAttention(); renderHomeActivity(); updateNavCounts(); renderActions(); renderMyWork(); }

  async function upsertProfile(session){
    if(!session||!session.user) return;
    try{
      var res=await sb.from("profiles").upsert({ id:session.user.id, email:session.user.email, last_active:new Date().toISOString() }, { onConflict:"id" }).select("*").maybeSingle();
      if(res.error) console.warn("profile upsert",res.error);
    }catch(e){ console.error("profile upsert", e); }
  }

  async function loadProfiles(){
    allProfiles=[]; profileById={}; currentProfile=null; currentRole="read_only";
    try{
      if(currentSession&&currentSession.user){
        var meRes=await sb.from("profiles").select("*").eq("id",currentSession.user.id).maybeSingle();
        if(meRes.error) throw meRes.error;
        currentProfile=meRes.data||null;
        currentOrgId=(currentProfile&&(currentProfile.current_organization_id||currentProfile.organization_id))||null;
        currentRole=(currentProfile&&currentProfile.app_role)||"read_only";
      }
      var query=sb.from("profiles").select("*").order("last_active",{ascending:false});
      if(currentOrgId) query=query.eq("organization_id", currentOrgId);
      var res=await query;
      if(res.error) throw res.error;
      allProfiles=res.data||[];
      allProfiles.forEach(function(p){ profileById[String(p.id)]=p; });
      if(currentSession&&currentSession.user) currentProfile=profileById[String(currentSession.user.id)]||currentProfile||null;
      currentRole=(currentProfile&&currentProfile.app_role)||currentRole||"read_only";
    }catch(ex){
      console.error("load profiles", ex);
      try{
        var roleRes=await sb.rpc("rbh_current_app_role");
        if(!roleRes.error&&roleRes.data) currentRole=roleRes.data;
      }catch(_e){}
    }
  }

  async function adminManageUser(payload){
    if(!canManageUsers()) return {ok:false,error:"ADMIN_REQUIRED"};
    if(!currentSession||!currentSession.access_token) return {ok:false,error:"AUTH_REQUIRED"};
    try{
      var resp=await fetch(SUPA_URL+"/functions/v1/admin-manage-user",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:JSON.stringify(payload||{})
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok) return {ok:false,error:data.error||("HTTP_"+resp.status),detail:data.detail||""};
      return data||{ok:true};
    }catch(ex){
      console.error("admin manage user",ex);
      return {ok:false,error:"NETWORK_ERROR",detail:(ex&&ex.message)||""};
    }
  }
  function adminActionErrorMessage(code){
    var map={
      ADMIN_REQUIRED:"Admin access is required.",
      AUTH_REQUIRED:"Your session expired. Sign in again.",
      CANNOT_CHANGE_OWN_ROLE:"You cannot change your own role. Ask another Admin.",
      CANNOT_DEACTIVATE_SELF:"You cannot deactivate your own account.",
      CANNOT_DELETE_SELF:"You cannot delete your own account.",
      LAST_ACTIVE_ADMIN_REQUIRED:"RBH must retain at least one active Admin.",
      USER_ACCESS_DELETED:"This user's login access has already been removed.",
      USER_INACTIVE:"Reactivate this user before sending a password reset.",
      INVALID_RESET_REDIRECT:"The password-reset destination was not accepted.",
      PASSWORD_RESET_SEND_FAILED:"Supabase could not send the password-reset email.",
      ROLE_UPDATE_FAILED:"The role could not be updated.",
      ACTIVATION_FAILED:"The account could not be activated.",
      DEACTIVATION_FAILED:"The account could not be deactivated.",
      AUTH_DELETE_FAILED:"The login could not be deleted.",
      PROFILE_DELETE_MARK_FAILED:"RBH could not preserve the user's historical removal state."
    };
    return map[code]||"The Admin action could not be completed.";
  }
  function adminUserState(u){
    if(u&&u.access_deleted_at) return "removed";
    return u&&u.is_active===false?"inactive":"active";
  }
  function adminResetRedirect(){
    var u=new URL(window.location.href);
    u.search="";
    u.hash="";
    u.searchParams.set("setup","1");
    return u.toString();
  }
  async function changeAdminUserRole(user,nextRole,selectEl){
    var oldRole=user.app_role||"read_only";
    if(String(nextRole)===String(oldRole)) return;
    if(selectEl) selectEl.disabled=true;
    var result=await adminManageUser({action:"set_role",targetUserId:user.id,role:nextRole});
    if(!result.ok){
      if(selectEl){selectEl.value=oldRole;selectEl.disabled=false;}
      toast(adminActionErrorMessage(result.error),"err");
      return;
    }
    toast("Role updated","ok");
    await loadProfiles(); await loadUsers(); await loadAdminUserEvents();
  }
  async function setAdminUserActive(user,nextActive,buttonEl){
    if(buttonEl) buttonEl.disabled=true;
    var result=await adminManageUser({action:"set_active",targetUserId:user.id,active:!!nextActive});
    if(!result.ok){
      if(buttonEl) buttonEl.disabled=false;
      toast(adminActionErrorMessage(result.error),"err");
      return;
    }
    toast(nextActive?"User reactivated":"User deactivated","ok");
    await loadProfiles(); await loadUsers(); await loadAdminUserEvents();
  }
  async function sendAdminPasswordReset(user,buttonEl){
    if(buttonEl){buttonEl.disabled=true;buttonEl.textContent="Sending…";}
    var result=await adminManageUser({action:"password_reset",targetUserId:user.id,redirectTo:adminResetRedirect()});
    if(!result.ok){
      if(buttonEl){buttonEl.disabled=false;buttonEl.textContent="Send password reset";}
      toast(adminActionErrorMessage(result.error),"err");
      return;
    }
    toast("Password reset email sent to "+(user.email||"user"),"ok");
    if(buttonEl){buttonEl.disabled=false;buttonEl.textContent="Send password reset";}
    await loadAdminUserEvents();
  }
  async function deleteAdminUserAccess(user,buttonEl){
    var label=user.full_name||user.email||"this user";
    if(!window.confirm(
      'Delete login access for '+label+'?\n\n'+
      'This permanently removes the user’s ability to sign in. RBH will retain their profile, report assignments, audit history, and other historical references.'
    )) return;

    var typed=window.prompt('Type the user’s email address to confirm deletion:\n\n'+String(user.email||""));
    if(String(typed||"").trim().toLowerCase()!==String(user.email||"").trim().toLowerCase()){
      toast("Deletion cancelled — the email confirmation did not match.","err");
      return;
    }

    var reason=window.prompt("Optional removal reason (stored in the Admin audit):","")||"";
    if(buttonEl){buttonEl.disabled=true;buttonEl.textContent="Deleting…";}
    var result=await adminManageUser({action:"delete_access",targetUserId:user.id,reason:String(reason||"").trim()});
    if(!result.ok){
      if(buttonEl){buttonEl.disabled=false;buttonEl.textContent="Delete user";}
      toast(adminActionErrorMessage(result.error),"err");
      return;
    }
    toast("User login deleted — RBH history retained","ok");
    await loadProfiles(); await loadUsers(); await loadAdminUserEvents();
  }
  function renderAdminUserSummary(rows){
    var el=$("adminUserSummary"); if(!el) return;
    var active=0,inactive=0,removed=0,admins=0;
    (rows||[]).forEach(function(u){
      var st=adminUserState(u);
      if(st==="removed") removed++;
      else if(st==="inactive") inactive++;
      else active++;
      if(st!=="removed"&&String(u.app_role||"")==="admin") admins++;
    });
    function card(n,label){return '<div class="admin-user-stat"><b>'+n+'</b><span>'+label+'</span></div>';}
    el.innerHTML=card(active,"Active users")+card(inactive,"Inactive users")+card(removed,"Removed · history retained")+card(admins,"Admins");
  }
  function filteredAdminUsers(){
    var q=String(($("adminUserSearch")&&$("adminUserSearch").value)||"").trim().toLowerCase();
    var status=String(($("adminUserStatusFilter")&&$("adminUserStatusFilter").value)||"all");
    var role=String(($("adminUserRoleFilter")&&$("adminUserRoleFilter").value)||"all");
    return (allProfiles||[]).filter(function(u){
      var hay=(String(u.full_name||"")+" "+String(u.email||"")).toLowerCase();
      if(q&&hay.indexOf(q)<0) return false;
      if(status!=="all"&&adminUserState(u)!==status) return false;
      if(role!=="all"&&String(u.app_role||"read_only")!==role) return false;
      return true;
    }).sort(function(a,b){
      var order={active:0,inactive:1,removed:2};
      var as=adminUserState(a),bs=adminUserState(b);
      if(order[as]!==order[bs]) return order[as]-order[bs];
      return new Date(b.last_active||0)-new Date(a.last_active||0);
    });
  }
  async function loadUsers(){
    var el=$("usersList"); if(!el) return;
    el.innerHTML='<div class="state">Loading team…</div>';
    try{
      if(!allProfiles.length) await loadProfiles();
      renderAdminUserSummary(allProfiles);
      var rows=filteredAdminUsers();
      var resultCount=$("adminUserResultCount");
      if(resultCount) resultCount.textContent=rows.length+" of "+allProfiles.length+" users";
      if(!rows.length){el.innerHTML='<div class="state">No users match these filters.</div>';return;}

      el.innerHTML="";
      var box=document.createElement("div"); box.className="user-rows";

      rows.forEach(function(u){
        var state=adminUserState(u);
        var isRemoved=state==="removed";
        var isSelf=currentSession&&currentSession.user&&String(u.id)===String(currentSession.user.id);
        var d=document.createElement("div");
        d.className="user-row"+(isRemoved?" removed":"");

        var roleOptions=Object.keys(ROLE_LABELS).map(function(k){
          return '<option value="'+k+'"'+((u.app_role||"read_only")===k?' selected':'')+'>'+ROLE_LABELS[k]+'</option>';
        }).join("");

        var statusText=isRemoved?"Removed":(state==="inactive"?"Inactive":"Active");
        var lastActive=u.last_active?fmtDate(u.last_active):"—";
        var deletedAt=u.access_deleted_at?fmtDate(u.access_deleted_at):"";
        var deletedBy=u.access_deleted_by&&profileById[String(u.access_deleted_by)]?profileName(profileById[String(u.access_deleted_by)]):"";
        var removalMeta=isRemoved
          ? ("Removed "+deletedAt+(deletedBy?" by "+deletedBy:"")+(u.access_deletion_reason?" · "+u.access_deletion_reason:""))
          : ("Last active "+lastActive);

        d.innerHTML=
          '<div class="user-card-top">'+
            '<div class="u-main"><div class="u-name"></div><div class="u-email"></div></div>'+
            '<span class="u-status '+(state==="inactive"?"off":(isRemoved?"removed":""))+'">'+esc(statusText)+'</span>'+
          '</div>'+
          '<div class="user-card-grid">'+
            '<label class="user-field"><span>Role</span><select class="u-role" aria-label="Application role">'+roleOptions+'</select></label>'+
            '<div class="user-field"><span>Access activity</span><div class="u-access-meta"></div></div>'+
          '</div>'+
          '<div class="user-card-actions">'+
            '<button class="user-reset" type="button">Send password reset</button>'+
            '<button class="user-toggle" type="button"></button>'+
            '<button class="user-delete danger" type="button">Delete user</button>'+
          '</div>'+
          '<div class="user-self-note" hidden></div>'+
          '<div class="user-removed-note" hidden></div>';

        d.querySelector(".u-name").textContent=u.full_name||u.email||"(unknown)";
        d.querySelector(".u-email").textContent=u.full_name?(u.email||""):"";
        d.querySelector(".u-access-meta").textContent=removalMeta;

        var rs=d.querySelector(".u-role");
        var reset=d.querySelector(".user-reset");
        var tog=d.querySelector(".user-toggle");
        var del=d.querySelector(".user-delete");
        var selfNote=d.querySelector(".user-self-note");
        var removedNote=d.querySelector(".user-removed-note");

        tog.textContent=state==="inactive"?"Reactivate":"Deactivate";

        if(isSelf){
          selfNote.hidden=false;
          selfNote.textContent="Your own role, activation state, and login access can only be changed by another Admin.";
        }
        if(isRemoved){
          removedNote.hidden=false;
          removedNote.textContent="Login access has been permanently removed. Historical RBH information is retained.";
        }

        rs.disabled=!canManageUsers()||isSelf||isRemoved;
        reset.disabled=!canManageUsers()||isRemoved||state==="inactive";
        tog.disabled=!canManageUsers()||isSelf||isRemoved;
        del.disabled=!canManageUsers()||isSelf||isRemoved;

        rs.addEventListener("change",function(){changeAdminUserRole(u,rs.value,rs);});
        reset.addEventListener("click",function(){sendAdminPasswordReset(u,reset);});
        tog.addEventListener("click",function(){setAdminUserActive(u,state==="inactive",tog);});
        del.addEventListener("click",function(){deleteAdminUserAccess(u,del);});

        box.appendChild(d);
      });

      el.appendChild(box);
      applyRoleUi();
    }catch(ex){
      console.error(ex);
      el.innerHTML='<div class="state">Could not load users.</div>';
    }
  }
  async function loadAdminUserEvents(){
    var el=$("adminUserHistory"); if(!el||currentRole!=="admin") return;
    el.innerHTML='<div class="state">Loading Admin activity…</div>';
    try{
      var q=sb.from("admin_user_events").select("*").order("created_at",{ascending:false}).limit(40);
      if(currentOrgId) q=q.eq("organization_id",currentOrgId);
      var res=await q;
      if(res.error) throw res.error;
      var rows=res.data||[];
      if(!rows.length){el.innerHTML='<div class="state">No Admin user-management activity yet.</div>';return;}

      var labels={
        role_changed:"Role changed",
        activated:"User activated",
        deactivated:"User deactivated",
        password_reset_sent:"Password reset sent",
        user_access_deleted:"User access deleted"
      };

      el.innerHTML=rows.map(function(ev){
        var actor=ev.actor_user_id&&profileById[String(ev.actor_user_id)]?profileName(profileById[String(ev.actor_user_id)]):"Admin";
        var target=ev.target_name_snapshot||ev.target_email_snapshot||"User";
        var detail="";
        if(ev.event_type==="role_changed") detail=(ROLE_LABELS[ev.old_role]||ev.old_role||"")+" → "+(ROLE_LABELS[ev.new_role]||ev.new_role||"");
        else if(ev.event_type==="activated") detail="Dashboard access restored.";
        else if(ev.event_type==="deactivated") detail="Dashboard access temporarily disabled.";
        else if(ev.event_type==="password_reset_sent") detail="Recovery email requested.";
        else if(ev.event_type==="user_access_deleted") detail="Login access removed; RBH historical identity retained.";

        return '<div class="admin-history-item">'+
          '<div><b>'+esc(labels[ev.event_type]||"Admin user update")+' · '+esc(target)+'</b>'+
          '<p>'+esc(detail)+(actor?' · by '+esc(actor):'')+'</p></div>'+
          '<div class="admin-history-time">'+esc(fmtDate(ev.created_at))+'</div>'+
        '</div>';
      }).join("");
    }catch(ex){
      console.error("admin user events",ex);
      el.innerHTML='<div class="state">Could not load Admin activity.</div>';
    }
  }

  function openAddUserModal(){
    if(!canManageUsers()){ toast("Admin access is required.","err"); return; }
    $("addUserName").value=""; $("addUserEmail").value=""; $("addUserRole").value="supervisor"; $("addUserSendEmail").checked=true;
    var e=$("addUserErr"); if(e){e.textContent="";e.classList.remove("show");}
    $("addUserBackdrop").classList.add("open"); setTimeout(function(){$("addUserName").focus();},50);
  }
  function closeAddUserModal(){ $("addUserBackdrop").classList.remove("open"); }
  async function provisionDashboardUser(){
    var name=$("addUserName").value.trim(), email=$("addUserEmail").value.trim().toLowerCase(), role=$("addUserRole").value, sendEmail=$("addUserSendEmail").checked;
    var err=$("addUserErr"), btn=$("addUserSave");
    err.textContent=""; err.classList.remove("show");
    if(!name){err.textContent="Enter the user's full name.";err.classList.add("show");return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){err.textContent="Enter a valid email address.";err.classList.add("show");return;}
    btn.disabled=true; btn.textContent="Creating access…";
    try{
      if(!currentSession||!currentSession.access_token) throw new Error("Your session expired. Sign in again.");
      var resp=await fetch(SUPA_URL+"/functions/v1/admin-provision-user",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:JSON.stringify({fullName:name,email:email,role:role,sendSetupEmail:sendEmail})
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok) throw new Error(data.detail||data.error||("HTTP "+resp.status));
      closeAddUserModal();
      await loadProfiles(); await loadUsers(); await loadAdminUserEvents();
      if(data.emailWarning){ toast("User access created, but the setup email needs attention.","err"); console.warn("user setup email",data.emailWarning); }
      else if(data.setupEmailSent){ toast((data.createdAuthUser?"User created":"Existing user repaired")+" — setup email sent","ok"); }
      else { toast((data.createdAuthUser?"User created":"Existing user repaired")+" and activated","ok"); }
    }catch(ex){
      console.error("provision user",ex);
      err.textContent="Could not create access: "+((ex&&ex.message)||"Unknown error");
      err.classList.add("show");
    }finally{
      btn.disabled=false;
      btn.textContent="Create access";
    }
  }
  function setupPasswordModeRequested(){ try{return new URLSearchParams(window.location.search).get("setup")==="1";}catch(_e){return false;} }
  function showPasswordSetup(){
    loginView.style.display="none"; appView.style.display="none";
    var e=$("passwordSetupErr"); if(e){e.textContent="";e.classList.remove("show");}
    $("passwordSetup1").value=""; $("passwordSetup2").value=""; $("passwordSetupBackdrop").classList.add("open");
  }
  async function finishPasswordSetup(){
    var p1=$("passwordSetup1").value, p2=$("passwordSetup2").value, e=$("passwordSetupErr"), b=$("passwordSetupSave");
    e.textContent="";e.classList.remove("show");
    if(p1.length<8){e.textContent="Use at least 8 characters.";e.classList.add("show");return;}
    if(p1!==p2){e.textContent="The passwords do not match.";e.classList.add("show");return;}
    b.disabled=true;b.textContent="Saving…";
    try{
      var res=await sb.auth.updateUser({password:p1}); if(res.error) throw res.error;
      $("passwordSetupBackdrop").classList.remove("open");
      var u=new URL(window.location.href);u.searchParams.delete("setup");history.replaceState({},"",u.pathname+(u.search||"")+(u.hash||""));
      toast("Password saved — welcome to RBH Safety","ok");
      var ses=(await sb.auth.getSession()).data.session;if(ses) await showApp(ses);else showLogin();
    }catch(ex){
      console.error("password setup",ex);
      e.textContent="Could not save the password. Request a new setup link from an Admin.";
      e.classList.add("show");
    }finally{
      b.disabled=false;
      b.textContent="Save password & continue";
    }
  }

  var _adminSearch=$("adminUserSearch"); if(_adminSearch) _adminSearch.addEventListener("input",function(){loadUsers();});
  var _adminStatus=$("adminUserStatusFilter"); if(_adminStatus) _adminStatus.addEventListener("change",function(){loadUsers();});
  var _adminRole=$("adminUserRoleFilter"); if(_adminRole) _adminRole.addEventListener("change",function(){loadUsers();});
  var _adminHistoryRefresh=$("adminHistoryRefresh"); if(_adminHistoryRefresh) _adminHistoryRefresh.addEventListener("click",loadAdminUserEvents);

  var _aub=$("addUserBtn"); if(_aub) _aub.addEventListener("click",openAddUserModal);
  var _auc=$("addUserCancel"); if(_auc) _auc.addEventListener("click",closeAddUserModal);
  var _aus=$("addUserSave"); if(_aus) _aus.addEventListener("click",provisionDashboardUser);
  var _aubd=$("addUserBackdrop"); if(_aubd) _aubd.addEventListener("click",function(e){if(e.target===_aubd)closeAddUserModal();});
  var _pss=$("passwordSetupSave"); if(_pss) _pss.addEventListener("click",finishPasswordSetup);

  document.querySelectorAll(".nav-item").forEach(function(n){ n.addEventListener("click", function(){ showView(n.getAttribute("data-view")); }); });
  var _ho=$("homeOpen"); if(_ho) _ho.addEventListener("click", function(){ if(currentRole!=="read_only") showView("mywork"); else { var sf=$("statusFilter"); if(sf) sf.value="open"; showView("records"); applyFilters(); } });
  var _hc=$("homeCreate"); if(_hc) _hc.addEventListener("click", function(){ window.open("index.html","_blank","noopener"); });

  var _ib=$("incidentBack"); if(_ib) _ib.addEventListener("click", function(){ showView(lastOperationalView==='mywork'?'mywork':(lastOperationalView==='actions'?'actions':'records')); });
  var _hb=$("hamburger"); if(_hb) _hb.addEventListener("click", openSidebar);
  if(sbBackdrop) sbBackdrop.addEventListener("click", closeSidebar);


  /* ================= Corrective action / overdue / audit ================= */
  function isOverdue(r){ return !!(r.due_date && r.status!=="closed" && r.status!=="no_action" && r.status!=="duplicate" && (new Date(r.due_date).getTime() < Date.now())); }
  function refreshOverdue(r, wrap){
    if(!wrap||!r) return; var badges=wrap.querySelector(".ch-badges"); if(!badges) return;
    var ex=badges.querySelector("[data-overdue-badge]");
    if(isOverdue(r)){ if(!ex){ var b=document.createElement("span"); b.className="badge bg-overdue"; b.setAttribute("data-overdue-badge",""); b.textContent="Overdue"; badges.insertBefore(b, badges.firstChild); } }
    else if(ex){ ex.remove(); }
  }
  function canClose(r){
    var childSummary=correctiveActionSummary(r);
    if(childSummary) return childSummary.total>0 && childSummary.verified===childSummary.total;
    var owner=!!(r && hasWorkflowValue(r.assigned_user_id));
    return !!(r && hasWorkflowValue(r.root_cause) && hasWorkflowValue(r.corrective_action) && owner && hasWorkflowValue(r.due_date) && hasWorkflowValue(r.priority) && r.action_status==="verified");
  }

  function renderActionWorkflow(r, el, auditEl, detail, mode){
    if(!el) return; mode=mode||"complete";
    var status=r.action_status||"not_started", assignee=assigneeName(r)||"Not assigned", due=escalationInfo(r);
    var completed=r.action_completed_at?("Completed "+fmtDate(r.action_completed_at)):"", verified=r.action_verified_at?("Verified "+fmtDate(r.action_verified_at)):"";
    var h='<div class="action-head"><div><h4>'+(mode==="verify"?'Verification review':'Assigned corrective action')+'</h4><p>'+esc(assignee)+(r.due_date?' · '+esc(due.label):' · no due date')+'</p></div><span class="action-state as-'+esc(status)+'">'+esc(actionLabel(status))+'</span></div>';
    if(r.corrective_action&&String(r.corrective_action).trim()) h+='<div class="action-context"><b>Corrective action required</b><p>'+esc(r.corrective_action)+'</p>'+(r.corrective_control_type?'<div class="action-meta">Control type: '+esc(controlTypeLabel(r.corrective_control_type)||r.corrective_control_type)+'</div>':'')+'</div>';
    else h+='<div class="wizard-required show">The corrective action plan has not been completed yet.</div>';

    if(mode==="complete"){
      if(status==="changes_requested"&&r.action_verification_note) h+='<div class="ops-alert critical"><b>Changes requested by reviewer</b>'+esc(r.action_verification_note)+'</div>';
      if(status==="awaiting_verification"){ h+='<div class="ops-alert"><b>Waiting for verification</b>Your completed work has been submitted. An Admin or Safety Manager must review it before the record can move forward.</div>'; }
      if(status==="verified"){ h+='<div class="ops-alert"><b>Corrective action verified</b>This step is complete.</div>'; }
      if(canEditStep(r,4)&&status!=="verified"){
        var label=status==="changes_requested"?'Update completed work':(status==="awaiting_verification"?'Completed work submitted':'What did you complete?');
        var help=status==="changes_requested"?'Update the note to explain the corrected work, then resubmit it.':(status==="awaiting_verification"?'The submitted completion note is shown below. You can correct the wording while it is waiting for verification.':'Describe exactly what was done. This note is required before submission.');
        h+='<label class="inv-l">'+label+'<textarea class="action-note" placeholder="Describe what was completed or changed.">'+esc(r.action_completion_note||'')+'</textarea></label><div class="translation-preview" data-translation-field="action_completion_note" hidden></div><p class="action-help">'+help+'</p>';
      } else if(r.action_completion_note){ h+='<div class="action-context"><b>Completed work submitted</b><p>'+esc(r.action_completion_note)+'</p></div><div class="translation-preview" data-translation-field="action_completion_note" hidden></div>'; }
      if(completed){var cb=r.action_completed_by&&profileById[String(r.action_completed_by)]?profileName(profileById[String(r.action_completed_by)]):'';h+='<div class="action-meta">'+esc(completed)+(cb?' by '+esc(cb):'')+'</div>';}
      h+='<div class="evidence-panel" data-action-evidence></div>';
      if(canEditStep(r,4)&&status!=="verified"){
        var primary=(status==="awaiting_verification")?'':(status==="changes_requested"?'Resubmit for verification →':'Submit for verification →');
        h+='<div class="wizard-footer"><div class="wizard-footer-copy">Save and close keeps a draft. Submit for verification hands the completed work to the reviewer.</div><div class="wizard-footer-actions"><button class="wizard-save btn-save-completion" data-step-save="4" type="button">Save and close</button><span class="completion-saved section-saved" hidden>Saved ✓</span>'+(primary?'<button class="wizard-primary btn-complete" data-step-complete="4" type="button">'+primary+'</button>':'')+'</div></div>';
      }
    } else {
      if(r.action_completion_note) h+='<div class="action-context"><b>Completed work submitted</b><p>'+esc(r.action_completion_note)+'</p></div><div class="translation-preview" data-translation-field="action_completion_note" hidden></div>';
      if(completed){var cb2=r.action_completed_by&&profileById[String(r.action_completed_by)]?profileName(profileById[String(r.action_completed_by)]):'';h+='<div class="action-meta">'+esc(completed)+(cb2?' by '+esc(cb2):'')+'</div>';}
      h+='<div class="evidence-panel" data-action-evidence></div>';
      if(status==="awaiting_verification"){
        if(canPerformVerification(r)){
          h+='<div class="multi-action-verifier-note"><b>Ready for verification</b>Review the completed work and evidence. Verify it if the fix is complete, or request changes if more work is needed.</div>'+
            '<label class="inv-l">Reviewer verification note <span style="font-weight:400;color:var(--muted)">(optional when approving)</span><textarea class="verify-note" placeholder="What did you verify? If requesting changes, explain exactly what still needs to be done.">'+esc(r.action_verification_note||'')+'</textarea></label><div class="wizard-required" data-verify-required>Add a verification note explaining the requested changes.</div>'+
            '<div class="translation-preview" data-translation-field="action_verification_note" hidden></div><div class="wizard-footer"><div class="wizard-footer-copy">Save and close keeps a draft. Verify advances the record; Request changes sends it back to Complete work.</div><div class="wizard-footer-actions"><button class="wizard-save btn-save-verification" data-step-save="5" type="button">Save and close</button><span class="verification-saved section-saved" hidden>Saved ✓</span><button class="btn-changes" type="button">Request changes</button><button class="wizard-primary btn-verify" data-step-complete="5" type="button">Verify &amp; continue →</button></div></div>';
        } else {
          h+='<div class="readonly-step-note">An Admin or Safety Manager reviews completed corrective actions and either verifies them or requests changes.</div>';
        }
      } else if(status==="verified"){
        if(r.action_verification_note) h+='<div class="action-context"><b>Verification note</b><p>'+esc(r.action_verification_note)+'</p></div><div class="translation-preview" data-translation-field="action_verification_note" hidden></div>';
        if(verified){var vb=r.action_verified_by&&profileById[String(r.action_verified_by)]?profileName(profileById[String(r.action_verified_by)]):'';h+='<div class="action-meta">'+esc(verified)+(vb?' by '+esc(vb):'')+'</div>';}
        h+='<div class="ops-alert"><b>Verification complete</b>The corrective action was approved. Continue to Close Record.</div>';
      } else if(status==="changes_requested") h+='<div class="readonly-step-note">Changes were requested. Complete work is active again so the assigned owner can update and resubmit the work.</div>';
      else h+='<div class="readonly-step-note">Verification becomes available after the assigned owner submits the completed work.</div>';
    }
    el.innerHTML=h;
    renderActionEvidence(r,el.querySelector("[data-action-evidence]"),auditEl);
    if(activeIncident===r) translateReportForLanguage(r,activeIncidentLanguage).then(function(tx){ if(tx&&activeIncident===r) applyReportLanguageToOpenIncident(r,activeIncidentLanguage,tx); });

    var saveCompletionBtn=el.querySelector(".btn-save-completion"); if(saveCompletionBtn) saveCompletionBtn.addEventListener("click",async function(){
      if(!canEditStep(r,4)){toast("Only the assigned corrective-action owner or an Admin/Safety Manager can update this work.","err");return;}
      await waitForActionEvidenceUpload(r.id);
      var note=(el.querySelector(".action-note")&&el.querySelector(".action-note").value.trim())||""; saveCompletionBtn.disabled=true;
      try{var patch={action_completion_note:note||null};if((r.action_status||"not_started")==="not_started"&&note)patch.action_status="in_progress";var res=await sb.from("reports").update(patch).eq("id",r.id);if(res.error)throw res.error;Object.keys(patch).forEach(function(k){r[k]=patch[k];});var flag=el.querySelector(".completion-saved");if(flag){flag.hidden=false;setTimeout(function(){flag.hidden=true;},2200);}toast("Completion note saved","ok");loadAudit(r.id,auditEl);refreshRecordWorkflow(r,detail);renderHomeSnapshot();renderMyWork();showView("home");}
      catch(ex){console.error(ex);toast("Could not save completion note.","err");}finally{if(saveCompletionBtn.isConnected)saveCompletionBtn.disabled=false;}
    });
    var completeBtn=el.querySelector(".btn-complete"); if(completeBtn) completeBtn.addEventListener("click",async function(){
      if(!canEditStep(r,4)){toast("Only the assigned corrective-action owner or an Admin/Safety Manager can submit this work.","err");return;}
      await waitForActionEvidenceUpload(r.id);
      var note=(el.querySelector(".action-note")&&el.querySelector(".action-note").value.trim())||"";
      if(!note){toast("Describe what was completed before submitting for verification.","err");return;}
      completeBtn.disabled=true;
      try{
        var uid=currentSession&&currentSession.user?currentSession.user.id:null;
        var patch={action_status:"awaiting_verification",action_completed_at:new Date().toISOString(),action_completed_by:uid,action_completion_note:note,action_verified_at:null,action_verified_by:null,status:"corrective_action"};
        if(activeReopenStep(r)) patch.reopen_workflow_step=5;
        var res=await sb.from("reports").update(patch).eq("id",r.id); if(res.error)throw res.error;
        Object.keys(patch).forEach(function(k){r[k]=patch[k];});
        $("incidentSummary").innerHTML='<div class="is-badges">'+incidentBadgeHtml(r)+'</div><div class="is-desc">'+esc(r.description||"No description provided.")+'</div>';
        renderActionWorkflow(r,detail.querySelector("[data-action-completion]"),auditEl,detail,"complete");
        renderActionWorkflow(r,detail.querySelector("[data-action-verification]"),auditEl,detail,"verify");
        loadAudit(r.id,auditEl); renderHomeSnapshot(); renderMyWork(); refreshRecordWorkflow(r,detail); setWizardStep(detail,r,5,true);

        // The workflow submission is already saved before email is attempted. Email failure never rolls it back.
        var notify=await sendActionVerificationRequestedEmail(r);
        var sentCount=Number(notify&&notify.sentCount||0), duplicateCount=Number(notify&&notify.duplicateCount||0), failedCount=Number(notify&&notify.failedCount||0);
        if(notify&&notify.ok&&(sentCount>0||duplicateCount>0)&&failedCount===0){
          var total=sentCount+duplicateCount;
          toast("Corrective action submitted — "+total+" reviewer"+(total===1?"":"s")+" notified by email","ok");
        } else if(notify&&notify.ok&&sentCount>0&&failedCount>0){
          toast("Corrective action submitted — some reviewer emails could not be sent.","err");
        } else if(notify&&notify.skipped&&(notify.reason==="NO_VERIFIER_EMAILS"||notify.reason==="NO_VERIFIER_EMAIL")){
          toast(notify.reason==="NO_VERIFIER_EMAIL"?"Corrective action submitted — the assigned verification owner has no email available.":"Corrective action submitted — no Admin or Safety Manager email was available.","ok");
        } else {
          console.error("verification-request notification failed",notify);
          toast("Corrective action submitted, but the reviewer email notification could not be sent.","err");
        }
      }
      catch(ex){console.error(ex);toast("Could not submit the corrective action.","err");}
      finally{if(completeBtn.isConnected)completeBtn.disabled=false;}
    });
    async function releaseLegacyReportVerifier(){
      if(!r.verifier_user_id||!isManager()) return true;
      var vr=await sb.from("reports").update({verifier_user_id:null}).eq("id",r.id);
      if(vr.error) throw vr.error;
      r.verifier_user_id=null;
      return true;
    }
    var saveVerificationBtn=el.querySelector(".btn-save-verification"); if(saveVerificationBtn) saveVerificationBtn.addEventListener("click",async function(){if(!canPerformVerification(r)){toast("You do not have verification permission.","err");return;}await waitForActionEvidenceUpload(r.id);await releaseLegacyReportVerifier();var note=(el.querySelector(".verify-note")&&el.querySelector(".verify-note").value.trim())||null;saveVerificationBtn.disabled=true;try{var res=await sb.from("reports").update({action_verification_note:note}).eq("id",r.id);if(res.error)throw res.error;r.action_verification_note=note;var flag=el.querySelector(".verification-saved");if(flag){flag.hidden=false;setTimeout(function(){flag.hidden=true;},2200);}toast("Verification note saved","ok");loadAudit(r.id,auditEl);showView("home");}catch(ex){console.error(ex);toast("Could not save verification note.","err");}finally{if(saveVerificationBtn.isConnected)saveVerificationBtn.disabled=false;}});
    var verifyBtn=el.querySelector(".btn-verify"); if(verifyBtn) verifyBtn.addEventListener("click",async function(){if(!canPerformVerification(r)){toast("You do not have verification permission.","err");return;}verifyBtn.disabled=true;try{await waitForActionEvidenceUpload(r.id);await releaseLegacyReportVerifier();var note=(el.querySelector(".verify-note")&&el.querySelector(".verify-note").value.trim())||null;var patch={action_status:"verified",action_verified_at:new Date().toISOString(),action_verified_by:currentSession.user.id,action_verification_note:note};if(activeReopenStep(r))patch.reopen_workflow_step=6;var res=await sb.from("reports").update(patch).eq("id",r.id);if(res.error)throw res.error;Object.keys(patch).forEach(function(k){r[k]=patch[k];});renderActionWorkflow(r,detail.querySelector("[data-action-completion]"),auditEl,detail,"complete");renderActionWorkflow(r,detail.querySelector("[data-action-verification]"),auditEl,detail,"verify");loadAudit(r.id,auditEl);renderHomeSnapshot();renderMyWork();refreshRecordWorkflow(r,detail);setWizardStep(detail,r,6,true);toast("Corrective action verified — ready for closure","ok");}catch(ex){console.error(ex);toast("Could not verify corrective action.","err");}finally{if(verifyBtn.isConnected)verifyBtn.disabled=false;}});
    var changesBtn=el.querySelector(".btn-changes"); if(changesBtn) changesBtn.addEventListener("click",async function(){
      if(!canPerformVerification(r)){toast("You do not have verification permission.","err");return;}
      await waitForActionEvidenceUpload(r.id);
      await releaseLegacyReportVerifier();
      var note=(el.querySelector(".verify-note")&&el.querySelector(".verify-note").value.trim())||"";
      var req=el.querySelector("[data-verify-required]");
      if(!note){if(req)req.classList.add("show");toast("Explain what evidence or changes are still needed before sending the action back.","err");return;}
      if(req)req.classList.remove("show");
      changesBtn.disabled=true;
      try{
        var patch={action_status:"changes_requested",action_verification_note:note,action_verified_at:null,action_verified_by:null};
        if(activeReopenStep(r)) patch.reopen_workflow_step=4;
        var res=await sb.from("reports").update(patch).eq("id",r.id); if(res.error)throw res.error;
        Object.keys(patch).forEach(function(k){r[k]=patch[k];});
        renderActionWorkflow(r,detail.querySelector("[data-action-completion]"),auditEl,detail,"complete");
        loadAudit(r.id,auditEl); renderHomeSnapshot(); renderMyWork(); refreshRecordWorkflow(r,detail); setWizardStep(detail,r,4,true);
        var notify=await sendActionChangesRequestedEmail(r);
        if(notify&&notify.sent){
          toast(notify.duplicate?"Changes requested — assignee was already notified":"Changes requested — assignee notified by email","ok");
        } else if(notify&&notify.skipped&&(notify.reason==="NO_DASHBOARD_ASSIGNEE"||notify.reason==="NO_ASSIGNEE_EMAIL")){
          toast("Changes requested — no assignee email was available","ok");
        } else if(notify&&notify.skipped){
          toast("Changes requested — notification already in progress","ok");
        } else {
          console.error("changes-requested notification failed",notify);
          toast("Changes requested and saved, but the email notification could not be sent.","err");
        }
      }catch(ex){console.error(ex);toast("Could not request changes.","err");}
      finally{if(changesBtn.isConnected)changesBtn.disabled=false;}
    });
  }

  function isInvestigationEvidence(a){
    return !!(a && /^reports\/[^/]+\/investigation\//.test(String(a.storage_path||"")));
  }
  function investigationEvidenceGeneration(a){
    var m=String(a&&a.storage_path||"").match(/\/investigation\/g(\d+)\//);
    return m?parseInt(m[1],10):0;
  }
  function investigationEvidenceUploadKey(reportId){ return String(reportId); }
  async function uploadInvestigationEvidenceFiles(r,files){
    files=Array.prototype.slice.call(files||[]);
    if(!files.length) return {ok:0,failed:0};
    if(files.length>5) throw new Error("Choose no more than 5 investigation files at a time.");
    for(var i=0;i<files.length;i++) if(files[i].size>10*1024*1024) throw new Error("Each investigation file must be 10 MB or smaller.");
    if(!currentSession||!currentSession.access_token) throw new Error("Please sign in again before adding investigation evidence.");
    var key=investigationEvidenceUploadKey(r.id);
    var task=(async function(){
      var ok=0,failed=0, generation=parseInt(r.workflow_restart_count||0,10)||0;
      for(var j=0;j<files.length;j++){
        var f=files[j], path="";
        try{
          var safe=(f.name||"investigation-file").replace(/[^a-zA-Z0-9._-]/g,"_"); if(safe.length>120) safe=safe.slice(-120);
          path="reports/"+r.id+"/investigation/g"+generation+"/"+Date.now()+"_"+j+"_"+safe;
          var up=await sb.storage.from("report-attachments").upload(path,f,{contentType:f.type||undefined,upsert:false});
          if(up.error) throw up.error;
          var meta=await sb.rpc("add_attachment",{p_report_id:r.id,p_storage_path:path,p_file_name:f.name,p_mime_type:f.type||null,p_size_bytes:f.size||null});
          if(meta.error){
            try{await sb.storage.from("report-attachments").remove([path]);}catch(_cleanup){}
            throw meta.error;
          }
          ok++;
        }catch(ex){ console.error("investigation evidence upload",ex); failed++; }
      }
      await refreshReportAttachments(r.id);
      return {ok:ok,failed:failed};
    })();
    investigationEvidenceUploads[key]=task;
    try{ return await task; }
    finally{ if(investigationEvidenceUploads[key]===task) delete investigationEvidenceUploads[key]; }
  }
  async function waitForInvestigationEvidenceUpload(){
    var tasks=Object.keys(investigationEvidenceUploads).map(function(k){return investigationEvidenceUploads[k];}).filter(Boolean);
    if(!tasks.length) return {ok:0,failed:0};
    var results=await Promise.all(tasks), ok=0,failed=0;
    results.forEach(function(x){ok+=Number(x&&x.ok||0);failed+=Number(x&&x.failed||0);});
    return {ok:ok,failed:failed};
  }
  async function renderInvestigationEvidence(r,el,auditEl){
    if(!el) return;
    var all=(attByReport[r.id]||[]).filter(isInvestigationEvidence);
    var generation=parseInt(r.workflow_restart_count||0,10)||0;
    var current=all.filter(function(a){return investigationEvidenceGeneration(a)===generation;});
    var prior=all.filter(function(a){return investigationEvidenceGeneration(a)!==generation;});
    var canManage=canEditStep(r,2);
    var countLabel=current.length+(current.length===1?" file":" files");
    el.innerHTML=
      '<div class="evidence-head"><div><b>Investigation evidence <span style="font-weight:400;color:var(--muted)">(optional)</span></b><span>Add photos, documents, statements, or other information that supports what the investigation found.</span></div><span class="evidence-count">'+countLabel+'</span></div>'+ 
      '<div class="evidence-files" data-investigation-evidence-files>'+(current.length?'<span class="evidence-empty">Loading evidence…</span>':'<span class="evidence-empty">No investigation evidence added yet.</span>')+'</div>'+ 
      (prior.length?'<details class="evidence-history"><summary>Earlier investigation evidence ('+prior.length+')</summary><div class="evidence-files" data-prior-investigation-evidence-files><span class="evidence-empty">Loading preserved evidence…</span></div></details>':'')+
      (canManage?'<div class="evidence-upload"><input class="evidence-file-input" type="file" multiple accept="image/*,.pdf,.doc,.docx,.txt"><button class="evidence-pick" type="button">Add investigation evidence</button><span class="evidence-selected">Files save automatically after selection.</span><div class="evidence-help">Optional. Up to 5 files at a time, 10 MB each.</div></div>':'');

    async function renderFiles(items,target){
      if(!target||!items.length) return;
      try{
        var paths=items.map(function(a){return a.storage_path;});
        var signed=await sb.storage.from("report-attachments").createSignedUrls(paths,3600);
        if(signed.error) throw signed.error;
        target.innerHTML="";
        (signed.data||[]).forEach(function(d,i){
          var a=items[i]; if(!d||d.error||!d.signedUrl) return;
          var item=document.createElement("div"); item.className="evidence-item";
          var isImg=String(a.mime_type||"").indexOf("image/")===0;
          var link=document.createElement("a"); link.href=d.signedUrl; link.target="_blank"; link.rel="noopener"; link.title=a.file_name||"Investigation evidence";
          if(isImg){ link.className="evidence-thumb"; var img=document.createElement("img"); img.src=d.signedUrl; img.loading="lazy"; img.alt=a.file_name||"Investigation evidence"; link.appendChild(img); }
          else { link.className="evidence-file"; link.innerHTML='<b>FILE</b><span></span>'; link.querySelector("span").textContent=a.file_name||"Investigation file"; }
          item.appendChild(link); target.appendChild(item);
        });
        if(!target.children.length) target.innerHTML='<span class="evidence-empty">Evidence is saved, but the preview could not be loaded.</span>';
      }catch(ex){ console.error(ex); target.innerHTML='<span class="evidence-empty">Evidence is saved, but the preview could not be loaded.</span>'; }
    }
    await renderFiles(current,el.querySelector("[data-investigation-evidence-files]"));
    await renderFiles(prior,el.querySelector("[data-prior-investigation-evidence-files]"));
    if(!canManage) return;
    var input=el.querySelector(".evidence-file-input"), pick=el.querySelector(".evidence-pick"), selected=el.querySelector(".evidence-selected");
    if(!input||!pick||!selected) return;
    pick.addEventListener("click",function(){input.click();});
    input.addEventListener("change",async function(){
      var files=Array.prototype.slice.call(input.files||[]); if(!files.length) return;
      selected.textContent="Uploading "+files.length+" file"+(files.length===1?"":"s")+"…"; pick.disabled=true; input.disabled=true;
      try{
        var result=await uploadInvestigationEvidenceFiles(r,files);
        if(result.ok) toast(result.ok+" investigation file"+(result.ok===1?"":"s")+" added","ok");
        if(result.failed) toast(result.failed+" investigation file"+(result.failed===1?"":"s")+" could not be uploaded","err");
        loadAudit(r.id,auditEl);
        if(el.isConnected) await renderInvestigationEvidence(r,el,auditEl);
      }catch(ex){ console.error(ex); toast(ex&&ex.message?ex.message:"Could not add investigation evidence.","err"); selected.textContent="Files save automatically after selection."; pick.disabled=false; input.disabled=false; }
    });
  }

  function workflowResetBoundaryMs(r){
    if(!r) return null;
    var vals=[r.last_workflow_restart_at,r.last_reopened_at].map(function(v){var t=v?new Date(v).getTime():NaN;return isNaN(t)?null:t;}).filter(function(v){return v!==null;});
    return vals.length?Math.max.apply(Math,vals):null;
  }
  function isActionEvidence(a){ return !!(a && String(a.storage_path||"").indexOf("corrective-evidence/")===0); }
  async function refreshReportAttachments(reportId){
    var res=await sb.from("report_attachments").select("*").eq("report_id",reportId);
    if(res.error) throw res.error;
    var seen={};
    attByReport[reportId]=(res.data||[]).filter(function(a){
      var key=String(a.id||a.storage_path||"");
      if(seen[key]) return false;
      seen[key]=true;
      return true;
    });
    return attByReport[reportId];
  }
  function canManageActionEvidence(r,a){
    if(a&&a.id){
      if(a.retired_at||!a.activated_at) return false;
      if(parseInt(a.workflow_generation||0,10)!==parseInt(r&&r.workflow_restart_count||0,10)) return false;
      if(isManager()) return true;
      return currentRole==="supervisor" && currentUserId() && String(a.owner_user_id||"")===currentUserId();
    }
    if(!r || !String(r.corrective_action||"").trim() || !r.assigned_user_id) return false;
    return canEditStep(r,4);
  }
  function actionEvidenceUploadKey(reportId,correctiveActionId){
    return String(reportId)+":"+(correctiveActionId?String(correctiveActionId):"legacy");
  }
  async function removeActionEvidence(r,attachment,correctiveAction){
    if(!r||!attachment||!attachment.id) return {ok:false,error:"ATTACHMENT_REQUIRED"};
    if(!currentSession||!currentSession.access_token) return {ok:false,error:"AUTH_REQUIRED"};
    try{
      var body={action:"remove",reportId:String(r.id),attachmentId:String(attachment.id)};
      if(correctiveAction&&correctiveAction.id) body.correctiveActionId=String(correctiveAction.id);
      var resp=await fetch(SUPA_URL+"/functions/v1/manage-action-evidence",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:JSON.stringify(body)
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok) return {ok:false,error:data.error||("HTTP_"+resp.status),detail:data.detail||""};
      return data||{ok:true,removed:true};
    }catch(ex){
      console.error("remove evidence",ex);
      return {ok:false,error:"NETWORK_ERROR",detail:(ex&&ex.message)||""};
    }
  }
  async function uploadActionEvidenceFiles(r,files,correctiveAction){
    files=Array.prototype.slice.call(files||[]);
    if(!files.length) return {ok:0,failed:0};
    if(files.length>5) throw new Error("Choose no more than 5 evidence files at a time.");
    for(var i=0;i<files.length;i++) if(files[i].size>10*1024*1024) throw new Error("Each evidence file must be 10 MB or smaller.");
    if(!currentSession||!currentSession.access_token) throw new Error("Please sign in again before adding evidence.");

    var key=actionEvidenceUploadKey(r.id,correctiveAction&&correctiveAction.id);
    var task=(async function(){
      var form=new FormData();
      form.append("action","upload");
      form.append("reportId",String(r.id));
      if(correctiveAction&&correctiveAction.id) form.append("correctiveActionId",String(correctiveAction.id));
      files.forEach(function(f){form.append("files",f,f.name||"evidence");});
      var resp=await fetch(SUPA_URL+"/functions/v1/manage-action-evidence",{
        method:"POST",
        headers:{"Authorization":"Bearer "+currentSession.access_token,"apikey":SUPA_KEY},
        body:form
      });
      var data=await resp.json().catch(function(){return {};});
      if(!resp.ok && !(data&&data.addedCount)) throw new Error(data&&data.error?data.error:("Evidence upload failed ("+resp.status+")"));
      await refreshReportAttachments(r.id);
      return {ok:Number(data&&data.addedCount||0),failed:Number(data&&data.failedCount||0)};
    })();
    actionEvidenceUploads[key]=task;
    try{ return await task; }
    finally{ if(actionEvidenceUploads[key]===task) delete actionEvidenceUploads[key]; }
  }
  async function waitForActionEvidenceUpload(reportId,correctiveActionId){
    var task=actionEvidenceUploads[actionEvidenceUploadKey(reportId,correctiveActionId)];
    return task ? await task : {ok:0,failed:0};
  }
  async function refreshAllActionEvidencePanels(r,auditEl){
    var root=$("incidentBody");
    var panels=root?Array.prototype.slice.call(root.querySelectorAll("[data-action-evidence]")):[];
    if(!panels.length) return;
    for(var i=0;i<panels.length;i++){
      var actionId=panels[i].getAttribute("data-corrective-action-id")||"";
      var action=actionId?actionPlanState.actions.find(function(x){return String(x.id||"")===String(actionId);}):null;
      await renderActionEvidence(r,panels[i],auditEl,action||null);
    }
  }
  async function renderActionEvidence(r,el,auditEl,correctiveAction,options){
    if(!el) return;

    var allEvidence=(attByReport[r.id]||[]).filter(isActionEvidence);
    var arr=[], priorEvidence=[];

    if(correctiveAction&&correctiveAction.id){
      arr=allEvidence.filter(function(a){
        return String(a.corrective_action_id||"")===String(correctiveAction.id);
      });
    } else {
      // Legacy fallback: only show unlinked corrective-action evidence here.
      var legacyEvidence=allEvidence.filter(function(a){return !a.corrective_action_id;});
      var resetAt=workflowResetBoundaryMs(r);
      arr=legacyEvidence.filter(function(a){ if(!resetAt) return true; var t=new Date(a.created_at||0).getTime(); return !isNaN(t)&&t>=resetAt; });
      priorEvidence=legacyEvidence.filter(function(a){ if(!resetAt) return false; var t=new Date(a.created_at||0).getTime(); return !isNaN(t)&&t<resetAt; });
    }

    var canManage=canManageActionEvidence(r,correctiveAction||null) && !(options&&options.readOnly);
    var countLabel=arr.length+(arr.length===1?" file":" files");
    var heading=correctiveAction&&correctiveAction.action_number
      ? "Corrective Action #"+correctiveAction.action_number+" evidence"
      : "Corrective-action evidence";
    var emptyLabel=correctiveAction
      ? "No evidence uploaded for this corrective action."
      : "No corrective-action evidence uploaded in the current workflow.";

    el.innerHTML=
      '<div class="evidence-head"><div><b>'+esc(heading)+'</b><span>Photos or files that show what was fixed. Evidence stays with this corrective action throughout completion and verification.</span></div><span class="evidence-count">'+countLabel+'</span></div>'+
      '<div class="evidence-files" data-evidence-files>'+(arr.length?'<span class="evidence-empty">Loading evidence…</span>':'<span class="evidence-empty">'+esc(emptyLabel)+'</span>')+'</div>'+
      (priorEvidence.length?'<details class="evidence-history"><summary>Earlier workflow evidence ('+priorEvidence.length+')</summary><div class="evidence-files" data-prior-evidence-files><span class="evidence-empty">Loading preserved evidence…</span></div></details>':'')+
      (canManage?'<div class="evidence-upload"><input class="evidence-file-input" type="file" multiple accept="image/*,.pdf,.doc,.docx"><button class="evidence-pick" type="button">Add evidence</button><span class="evidence-selected">Files save automatically after selection.</span><div class="evidence-help">Up to 5 files at a time, 10 MB each. Remove is available for mistakes; every removal is recorded in Activity.</div></div>':'');

    async function renderEvidenceFiles(items,target){
      if(!target||!items.length) return;
      try{
        var paths=items.map(function(a){return a.storage_path;});
        var signed=await sb.storage.from("report-attachments").createSignedUrls(paths,3600);
        if(signed.error) throw signed.error;
        target.innerHTML="";
        (signed.data||[]).forEach(function(d,i){
          var attachment=items[i]; if(!d||d.error||!d.signedUrl) return;
          var item=document.createElement("div"); item.className="evidence-item";
          var isImg=String(attachment.mime_type||"").indexOf("image/")===0;
          var link=document.createElement("a"); link.href=d.signedUrl; link.target="_blank"; link.rel="noopener"; link.title=attachment.file_name||"Evidence";
          if(isImg){
            link.className="evidence-thumb";
            var img=document.createElement("img"); img.src=d.signedUrl; img.loading="lazy"; img.alt=attachment.file_name||"Corrective-action evidence"; link.appendChild(img);
          } else {
            link.className="evidence-file";
            link.innerHTML='<b>FILE</b><span></span>';
            link.querySelector("span").textContent=attachment.file_name||"Evidence file";
          }
          item.appendChild(link);

          if(canManage){
            var actions=document.createElement("div"); actions.className="evidence-actions";

            var replace=document.createElement("button");
            replace.type="button"; replace.className="evidence-replace"; replace.textContent="Replace";
            replace.setAttribute("aria-label","Replace "+(attachment.file_name||"evidence file"));
            replace.addEventListener("click",function(){
              var chooser=document.createElement("input");
              chooser.type="file"; chooser.accept="image/*,.pdf,.doc,.docx"; chooser.style.display="none";
              document.body.appendChild(chooser);
              chooser.addEventListener("change",async function(){
                var f=chooser.files&&chooser.files[0]; if(!f){chooser.remove();return;}
                replace.disabled=true; remove.disabled=true; replace.textContent="Replacing…";
                try{
                  var uploadResult=await uploadActionEvidenceFiles(r,[f],correctiveAction||null);
                  if(!uploadResult.ok) throw new Error("The replacement file could not be saved, so the original evidence was kept.");
                  var removeResult=await removeActionEvidence(r,attachment,correctiveAction||null);
                  if(!removeResult||removeResult.ok===false) throw new Error("The replacement was saved, but the original file could not be removed. You can remove it separately.");
                  await refreshReportAttachments(r.id);
                  loadAudit(r.id,auditEl);
                  if(el.isConnected) await renderActionEvidence(r,el,auditEl,correctiveAction||null);
                  var replaceRoot=$("incidentBody");
                  var replacePanels=replaceRoot?Array.prototype.slice.call(replaceRoot.querySelectorAll('[data-action-evidence][data-corrective-action-id="'+String(correctiveAction&&correctiveAction.id||"")+'"]')):[];
                  for(var rpi=0;rpi<replacePanels.length;rpi++){
                    if(replacePanels[rpi]!==el && replacePanels[rpi].isConnected){
                      await renderActionEvidence(r,replacePanels[rpi],auditEl,correctiveAction||null);
                    }
                  }
                  toast("Evidence replaced","ok");
                }catch(ex){
                  console.error(ex);
                  toast(ex&&ex.message?ex.message:"Could not replace the evidence file.","err");
                  if(replace.isConnected){replace.disabled=false;replace.textContent="Replace";}
                  if(remove.isConnected) remove.disabled=false;
                }finally{chooser.remove();}
              },{once:true});
              chooser.click();
            });

            var remove=document.createElement("button");
            remove.type="button"; remove.className="evidence-remove"; remove.textContent="Remove";
            remove.setAttribute("aria-label","Remove "+(attachment.file_name||"evidence file"));
            remove.addEventListener("click",async function(){
              var fileName=attachment.file_name||"this evidence file";
              if(!window.confirm('Remove "'+fileName+'"?\n\nThis permanently removes the file from the record. The Activity timeline will keep a record that it was removed.')) return;
              replace.disabled=true; remove.disabled=true; remove.textContent="Removing…";
              try{
                await waitForActionEvidenceUpload(r.id,correctiveAction&&correctiveAction.id);
                var result=await removeActionEvidence(r,attachment,correctiveAction||null);
                if(!result||result.ok===false){
                  var msg=result&&result.error==="NOT_AUTHORIZED"?"You do not have permission to remove this evidence.":"Could not remove the evidence file.";
                  throw new Error(msg);
                }
                await refreshReportAttachments(r.id);
                loadAudit(r.id,auditEl);
                if(el.isConnected) await renderActionEvidence(r,el,auditEl,correctiveAction||null);
                var removeRoot=$("incidentBody");
                var removePanels=removeRoot?Array.prototype.slice.call(removeRoot.querySelectorAll('[data-action-evidence][data-corrective-action-id="'+String(correctiveAction&&correctiveAction.id||"")+'"]')):[];
                for(var rmi=0;rmi<removePanels.length;rmi++){
                  if(removePanels[rmi]!==el && removePanels[rmi].isConnected){
                    await renderActionEvidence(r,removePanels[rmi],auditEl,correctiveAction||null);
                  }
                }
                toast("Evidence removed","ok");
              }catch(ex){
                console.error(ex);
                toast(ex&&ex.message?ex.message:"Could not remove the evidence file.","err");
                if(remove.isConnected){remove.disabled=false;remove.textContent="Remove";}
                if(replace.isConnected) replace.disabled=false;
              }
            });

            actions.appendChild(replace);
            actions.appendChild(remove);
            item.appendChild(actions);
          }

          target.appendChild(item);
        });
        if(!target.children.length) target.innerHTML='<span class="evidence-empty">Evidence is saved, but the preview could not be loaded.</span>';
      }catch(ex){
        console.error(ex);
        target.innerHTML='<span class="evidence-empty">Evidence is saved, but the preview could not be loaded.</span>';
      }
    }

    var filesEl=el.querySelector("[data-evidence-files]");
    if(arr.length) await renderEvidenceFiles(arr,filesEl);

    var priorEl=el.querySelector("[data-prior-evidence-files]");
    if(priorEvidence.length) await renderEvidenceFiles(priorEvidence,priorEl);

    if(!canManage) return;

    var input=el.querySelector(".evidence-file-input");
    var pick=el.querySelector(".evidence-pick");
    var selected=el.querySelector(".evidence-selected");
    if(!input||!pick||!selected) return;

    pick.addEventListener("click",function(){ if(!pick.disabled) input.click(); });
    input.addEventListener("change",async function(){
      var files=Array.prototype.slice.call(input.files||[]);
      if(!files.length) return;
      if(files.length>5){ toast("Choose no more than 5 evidence files at a time.","err"); input.value=""; return; }
      for(var i=0;i<files.length;i++){
        if(files[i].size>10*1024*1024){ toast("Each evidence file must be 10 MB or smaller.","err"); input.value=""; return; }
      }

      pick.disabled=true;
      pick.textContent="Uploading…";
      selected.textContent="Saving "+files.length+" evidence file"+(files.length===1?"":"s")+"…";

      try{
        var result=await uploadActionEvidenceFiles(r,files,correctiveAction||null);
        if(result.ok) toast(result.ok+" evidence file"+(result.ok===1?"":"s")+" saved","ok");
        if(result.failed) toast(result.failed+" evidence file"+(result.failed===1?"":"s")+" could not be saved. Please add it again.","err");
        loadAudit(r.id,auditEl);
        // Refresh the panel the user is looking at immediately.
        if(el.isConnected) await renderActionEvidence(r,el,auditEl,correctiveAction||null);
        // Then keep the matching Step 4 / Step 5 view in sync.
        var root=$("incidentBody");
        var others=root?Array.prototype.slice.call(root.querySelectorAll('[data-action-evidence][data-corrective-action-id="'+String(correctiveAction&&correctiveAction.id||"")+'"]')):[];
        for(var oi=0;oi<others.length;oi++){
          if(others[oi]!==el && others[oi].isConnected){
            await renderActionEvidence(r,others[oi],auditEl,correctiveAction||null);
          }
        }
      }catch(ex){
        console.error(ex);
        toast(ex&&ex.message?ex.message:"Could not save corrective-action evidence.","err");
        pick.disabled=false;
        pick.textContent="Add evidence";
        selected.textContent="Evidence was not saved. Choose the file again.";
        input.value="";
      }
    });
  }

  function auditActor(email){
    if(!email) return "System";
    var low=String(email).toLowerCase();
    for(var i=0;i<allProfiles.length;i++){ if(String(allProfiles[i].email||"").toLowerCase()===low) return profileName(allProfiles[i]); }
    return email;
  }
  function auditAssignee(v){
    if(!v) return "Unassigned";
    var p=profileById[String(v)]; return p?profileName(p):"Assigned user";
  }
  function fmtChange(a){
    if(a.field==="status") return "Report status: "+(STATUS[a.old_value]?STATUS[a.old_value].l:(a.old_value||"—"))+" → "+(STATUS[a.new_value]?STATUS[a.new_value].l:(a.new_value||"—"));
    if(a.field==="priority") return "Priority: "+(a.old_value||"—")+" → "+(a.new_value||"—");
    if(a.field==="responsible_person") return "Responsible person / crew: "+(a.old_value||"—")+" → "+(a.new_value||"—");
    if(a.field==="due_date") return "Due date: "+(a.old_value?shortDate(a.old_value):"—")+" → "+(a.new_value?shortDate(a.new_value):"—");
    if(a.field==="assigned_user_id") return "Corrective-action owner: "+auditAssignee(a.old_value)+" → "+auditAssignee(a.new_value);
    if(a.field==="investigator_user_id") return "Case owner / investigator: "+auditAssignee(a.old_value)+" → "+auditAssignee(a.new_value);
    if(a.field==="verifier_user_id") return "Verification owner: "+auditAssignee(a.old_value)+" → "+auditAssignee(a.new_value);
    if(a.field==="action_status") return "Corrective-action status: "+actionLabel(a.old_value)+" → "+actionLabel(a.new_value);
    if(a.field==="action_completed_at") return a.new_value?"Corrective action submitted as complete":"Completion submission cleared";
    if(a.field==="action_verified_at") return a.new_value?"Corrective action verified":"Verification cleared";
    if(a.field==="action_completion_note") return "Completion note updated";
    if(a.field==="action_verification_note") return "Verification / change-request note updated";
    if(a.field==="investigation_findings") return "Investigation findings updated";
    if(a.field==="root_cause") return "Why it happened updated";
    if(a.field==="corrective_action") return "Corrective action updated";
    if(a.field==="corrective_control_type") return "Control type: "+(controlTypeLabel(a.old_value)||a.old_value||"—")+" → "+(controlTypeLabel(a.new_value)||a.new_value||"—");
    if(a.field==="calosha_screening_status") return "Cal/OSHA screening: "+caloshaScreenLabel(a.old_value)+" → "+caloshaScreenLabel(a.new_value);
    if(a.field==="calosha_awareness_at") return a.new_value?"RBH awareness time recorded":"RBH awareness time cleared";
    if(a.field==="closed_at") return a.new_value?"Closure timestamp recorded":"Closure timestamp cleared";
    if(a.field==="workflow_restart_count") return "Workflow restart count: "+(a.old_value||"0")+" → "+(a.new_value||"0");
    if(a.field==="last_workflow_restart_at") return a.new_value?"Workflow restart timestamp recorded":"Workflow restart timestamp cleared";
    if(a.field==="reopen_count") return "Reopen count: "+(a.old_value||"0")+" → "+(a.new_value||"0");
    if(a.field==="reopen_workflow_step") return a.new_value?("Reopened workflow advanced to Step "+a.new_value):"Reopened workflow cycle completed";
    if(a.field==="last_reopened_at") return a.new_value?"Reopen timestamp recorded":"Reopen timestamp cleared";
    if(a.field==="last_reopen_from_status") return "Previous resolved status preserved: "+(STATUS[a.new_value]?STATUS[a.new_value].l:(a.new_value||"—"));
    if(a.field==="last_reopen_reason_code"||a.field==="last_reopen_reason") return "Reopen reason documented";
    return (a.field||"Record field")+" updated";
  }
  function auditGroupTitle(rows){
    var fields=rows.map(function(a){return a.field;});
    var actionRow=rows.find(function(a){return a.field==="action_status";});
    if(actionRow){
      if(actionRow.new_value==="awaiting_verification") return "Corrective action submitted for verification";
      if(actionRow.new_value==="verified") return "Corrective action verified";
      if(actionRow.new_value==="changes_requested") return "Changes requested on corrective action";
      if(actionRow.new_value==="in_progress") return "Corrective action moved into progress";
    }
    var statusRow=rows.find(function(a){return a.field==="status";});
    if(statusRow){
      if(statusRow.new_value==="closed") return "Report closed";
      if(statusRow.new_value==="no_action") return "Report closed — no action required";
      if(statusRow.new_value==="duplicate") return "Report closed — duplicate";
      if((statusRow.old_value==="closed"||statusRow.old_value==="no_action"||statusRow.old_value==="duplicate") && (statusRow.new_value==="new"||statusRow.new_value==="under_review"||statusRow.new_value==="corrective_action")) return "Record reopened";
      return "Report status updated";
    }
    if(fields.indexOf("investigator_user_id")>=0) return "Investigator assignment updated";
    if(fields.indexOf("verifier_user_id")>=0) return "Verification owner updated";
    if(fields.some(function(f){return ["corrective_action","corrective_control_type","assigned_user_id","responsible_person","due_date","priority"].indexOf(f)>=0;})) return "Corrective-action plan updated";
    if(fields.indexOf("calosha_screening_status")>=0 || fields.indexOf("calosha_awareness_at")>=0) return "Regulatory screening updated";
    if(fields.indexOf("investigation_findings")>=0 || fields.indexOf("root_cause")>=0) return "Investigation updated";
    if(fields.indexOf("action_completion_note")>=0) return "Completion note saved";
    if(fields.indexOf("action_verification_note")>=0) return "Verification note saved";
    return rows.length>1?"Record updated":fmtChange(rows[0]);
  }
  function timelineKind(title, rows){
    var t=String(title||"").toLowerCase();
    if(t.indexOf("workflow restarted")>=0 || t.indexOf("record reopened")>=0) return "restart";
    if(t.indexOf("evidence")>=0) return "evidence";
    if(t.indexOf("closed")>=0 || t.indexOf("verified")>=0) return "close";
    if(t.indexOf("corrective")>=0 || (rows&&rows.some(function(a){return String(a.field||"").indexOf("action_")===0;}))) return "action";
    if(t.indexOf("note")>=0) return "note";
    return "update";
  }
  function timelineMarker(kind){ return kind==="submit"?"IN":kind==="restart"?"RS":kind==="evidence"?"EV":kind==="note"?"NT":kind==="close"?"OK":kind==="action"?"CA":"UP"; }
  function groupAuditRows(rows){
    var sorted=rows.slice().sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);});
    var groups=[];
    sorted.forEach(function(a){
      var last=groups[groups.length-1], actor=String(a.actor_email||"system").toLowerCase(), at=new Date(a.created_at).getTime();
      if(last && last.actor===actor && Math.abs(last.at-at)<=2200){ last.rows.push(a); if(at>last.at){last.at=at;last.created_at=a.created_at;} }
      else groups.push({actor:actor,at:at,created_at:a.created_at,rows:[a]});
    });
    return groups;
  }
  async function loadAudit(reportId, el){
    if(!el) return; el.innerHTML='<div class="notes-empty">Loading activity…</div>';
    try{
      var results=await Promise.all([
        sb.from("report_audit").select("*").eq("report_id",reportId).order("created_at",{ascending:false}),
        sb.from("report_notes").select("*").eq("report_id",reportId).order("created_at",{ascending:false}),
        sb.from("report_corrective_action_audit").select("*").eq("report_id",reportId).order("created_at",{ascending:false})
      ]);
      if(results[0].error) throw results[0].error;
      if(results[1].error) throw results[1].error;
      if(results[2].error) throw results[2].error;
      var audits=results[0].data||[], notes=results[1].data||[], actionAudits=results[2].data||[], events=[];
      groupAuditRows(audits).forEach(function(g){
        var title=auditGroupTitle(g.rows);
        events.push({kind:timelineKind(title,g.rows),title:title,created_at:g.created_at,actor:auditActor(g.rows[0].actor_email),changes:g.rows.map(fmtChange)});
      });
      notes.forEach(function(n){
        var title=String(n.title||"Note added"), system=title.indexOf("[System]")===0;
        if(system) title=title.replace(/^\[System\]\s*/,"");
        var lowTitle=title.toLowerCase();
        var kind=(lowTitle.indexOf("workflow restarted")>=0||lowTitle.indexOf("record reopened")>=0)?"restart":(lowTitle.indexOf("evidence")>=0?"evidence":(lowTitle.indexOf("closed without corrective action")>=0?"close":"note"));
        events.push({kind:kind,title:system?title:("Note added — "+title),created_at:n.created_at,actor:auditActor(n.author_email),detail:n.body||""});
      });
      var report=allReports.find(function(r){return String(r.id)===String(reportId);});
      if(report){
        var who=report.reporter_name||"Anonymous reporter";
        var detail=[report.report_type||"Safety report",report.job_site||""].filter(Boolean).join(" · ");
        events.push({kind:"submit",title:"Report submitted",created_at:report.created_at,actor:who,detail:detail});
      }
      events.sort(function(a,b){return new Date(b.created_at)-new Date(a.created_at);});
      if(!events.length){ el.innerHTML='<div class="notes-empty">No activity recorded yet.</div>'; return; }
      el.innerHTML=""; var box=document.createElement("div"); box.className="timeline";
      events.forEach(function(ev){
        var item=document.createElement("div"); item.className="tl-item "+(ev.kind||"update");
        var marker=document.createElement("div"); marker.className="tl-marker"; marker.textContent=timelineMarker(ev.kind);
        var card=document.createElement("div"); card.className="tl-card";
        var title=document.createElement("div"); title.className="tl-title"; title.textContent=ev.title;
        var meta=document.createElement("div"); meta.className="tl-meta"; meta.textContent=fmtDate(ev.created_at)+" · "+(ev.actor||"System");
        card.appendChild(title); card.appendChild(meta);
        if(ev.detail){ var det=document.createElement("div"); det.className="tl-detail"; det.textContent=ev.detail; card.appendChild(det); }
        if(ev.changes && ev.changes.length){
          var changes=document.createElement("div"); changes.className="tl-changes";
          ev.changes.forEach(function(c){ var row=document.createElement("div"); row.className="tl-change"; row.textContent=c; changes.appendChild(row); });
          card.appendChild(changes);
        }
        item.appendChild(marker); item.appendChild(card); box.appendChild(item);
      });
      el.appendChild(box);
    }catch(ex){ console.error(ex); el.innerHTML='<div class="notes-empty">Could not load activity.</div>'; }
  }


  /* ================= App polish: toasts, home, chips, chart, theme ================= */
  var overdueOnly=false, injuryOnly=false;

  function toast(msg, kind){
    var wrap=document.getElementById("toasts"); if(!wrap) return;
    var t=document.createElement("div"); t.className="toast "+(kind==="err"?"err":"ok"); t.textContent=msg;
    wrap.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add("show"); });
    setTimeout(function(){ t.classList.remove("show"); setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); },250); },3000);
  }

  function shortDate(v){ if(!v) return ""; try{ return new Date(v).toLocaleDateString(); }catch(e){ return v; } }

  function setActiveChip(chip){ document.querySelectorAll(".chip").forEach(function(c){ c.classList.toggle("active", c.getAttribute("data-chip")===chip); }); }
  function setQuickFilter(chip){
    overdueOnly=false; injuryOnly=false; var sf=$("statusFilter");
    if(chip==="overdue"){ overdueOnly=true; if(sf) sf.value="all"; }
    else if(chip==="injuries"){ injuryOnly=true; if(sf) sf.value="all"; }
    else if(chip==="open"){ if(sf) sf.value="open"; }
    else if(chip==="new"){ if(sf) sf.value="new"; }
    else { if(sf) sf.value="all"; }
    setActiveChip(chip); applyFilters();
  }
  function goToRecords(chip){ setQuickFilter(chip); showView("records"); }

  function updateNavCounts(){
    var el=$("navOpenCount"); if(!el) return;
    var open=0; allReports.forEach(function(r){ if(r.status!=="closed"&&r.status!=="no_action"&&r.status!=="duplicate") open++; });
    el.textContent=open>0?String(open):"";
  }

  function renderHomeGreeting(){ var el=$("homeGreeting"); if(!el) return; var h=new Date().getHours(); var g=h<12?"Good morning":(h<18?"Good afternoon":"Good evening"); el.textContent=g+" \u2014 RBH Safety"; }

  function renderHomeStats(){
    var el=$("homeStats"); if(!el) return;
    var open=0,nw=0,inj=0,ov=0,verify=0;
    allReports.forEach(function(r){ if(r.status!=="closed"&&r.status!=="no_action"&&r.status!=="duplicate") open++; if(r.status==="new") nw++; if(r.involves_injury) inj++; if(isOverdue(r)) ov++; if(r.action_status==="awaiting_verification") verify++; });
    function tile(n,k,f,al){ return '<button class="hs'+(al&&n>0?" alert":"")+'" data-filter="'+f+'" type="button"><div class="hs-n">'+n+'</div><div class="hs-k">'+k+'</div></button>'; }
    el.innerHTML=tile(open,"Open","open")+tile(nw,"New","new")+tile(ov,"Overdue","overdue",true)+tile(verify,"To verify","actions",true)+tile(inj,"Injuries","injuries",true);
    el.querySelectorAll(".hs").forEach(function(b){ b.addEventListener("click", function(){ var f=b.getAttribute("data-filter"); if(f==="actions") showView("actions"); else goToRecords(f); }); });
  }

  async function renderHomeActivity(){
    var el=$("homeActivity"); if(!el) return;
    el.innerHTML='<div class="notes-empty">Loading…</div>';
    var events=[], map={};
    allReports.forEach(function(r){ map[r.id]=r.ref_no; });
    allReports.slice(0,25).forEach(function(r){ events.push({ when:r.created_at, kind:"report", text:"New report #"+r.ref_no+" \u2014 "+(r.report_type||"Report") }); });
    try{
      var res=await sb.from("report_audit").select("*").order("created_at",{ascending:false}).limit(20);
      (res.data||[]).forEach(function(a){ events.push({ when:a.created_at, kind:"change", text:"#"+(map[a.report_id]||"?")+"  "+fmtChange(a), who:a.actor_email }); });
    }catch(e){ console.error(e); }
    events.sort(function(a,b){ return new Date(b.when)-new Date(a.when); });
    events=events.slice(0,10);
    if(!events.length){ el.innerHTML='<div class="notes-empty">No activity yet.</div>'; return; }
    el.innerHTML="";
    events.forEach(function(ev){
      var d=document.createElement("div"); d.className="act-row";
      d.innerHTML='<span class="act-dot '+(ev.kind==="report"?"d-new":"d-chg")+'"></span><div class="act-main"><div class="act-t"></div><div class="act-m"></div></div>';
      d.querySelector(".act-t").textContent=ev.text;
      d.querySelector(".act-m").textContent=fmtDate(ev.when)+(ev.who?(" \u00b7 "+ev.who):"");
      el.appendChild(d);
    });
  }

  function monthChartHtml(){
    var now=new Date(), buckets=[], idx={};
    for(var i=5;i>=0;i--){ var d=new Date(now.getFullYear(), now.getMonth()-i, 1); var key=d.getFullYear()+"-"+d.getMonth(); buckets.push({key:key,label:d.toLocaleDateString(undefined,{month:"short"}),n:0}); idx[key]=buckets.length-1; }
    allReports.forEach(function(r){ if(!r.created_at) return; var d=new Date(r.created_at); var key=d.getFullYear()+"-"+d.getMonth(); if(key in idx) buckets[idx[key]].n++; });
    var max=1; buckets.forEach(function(b){ if(b.n>max) max=b.n; });
    var bars=buckets.map(function(b){ var h=b.n?Math.max(Math.round(b.n/max*100),6):2; return '<div class="mc-col"><div class="mc-v">'+b.n+'</div><div class="mc-bar" style="height:'+h+'%"></div><div class="mc-x">'+b.label+'</div></div>'; }).join("");
    return '<div class="mc"><div class="mc-title">Reports over the last 6 months</div><div class="mc-bars">'+bars+'</div></div>';
  }

  /* chips / sort / links wiring */
  document.querySelectorAll(".chip").forEach(function(c){ c.addEventListener("click", function(){ setQuickFilter(c.getAttribute("data-chip")); }); });
  var _sortSel=$("sortBy"); if(_sortSel) _sortSel.addEventListener("change", applyFilters);
  document.querySelectorAll(".hp-link").forEach(function(b){ b.addEventListener("click", function(){ showView(b.getAttribute("data-view")||"records"); }); });

})();
