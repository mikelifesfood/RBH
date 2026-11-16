// RBH Safety: Admin-only, self-addressed test of the weekly Safety Pulse email.
// No company release flag or scheduler is modified. Sending requires an explicit
// click from the signed-in Admin; never accepts a caller-supplied destination.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const BREVO_KEY=Deno.env.get("BREVO_API_KEY")||"";
const FROM_EMAIL=Deno.env.get("MAIL_FROM_EMAIL")||"";
const FROM_NAME=Deno.env.get("MAIL_FROM_NAME")||"RBH Safety";
const DASHBOARD_URL=Deno.env.get("DASHBOARD_URL")||"https://mikelifesfood.github.io/RBH/dashboard.html";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info"};
function respond(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});}
function esc(value:unknown){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]||ch));}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return respond({error:"METHOD_NOT_ALLOWED"},405);
 // This isolated test endpoint is authenticated even if the platform's JWT
 // gateway does not validate the token: getUser always verifies it.
 const bearer=req.headers.get("Authorization")||"";
 const token=/^Bearer\s+\S+$/i.test(bearer)?bearer.replace(/^Bearer\s+/i,"").trim():"";
 if(!token)return respond({error:"AUTH_REQUIRED"},401);
 if(!SUPABASE_URL||!ANON_KEY||!SERVICE_KEY)return respond({error:"CONFIGURATION_REQUIRED"},503);
 let body:Record<string,unknown>;
 try{body=await req.json();}catch{return respond({error:"INVALID_JSON"},400);}
 if(body?.action!=="send_test"||body?.confirm!==true)return respond({error:"EXPLICIT_TEST_CONFIRMATION_REQUIRED"},400);
 // Do not honor any supplied recipient, organization, role, or digest stats.
 if("email" in body||"recipient" in body||"organization_id" in body)return respond({error:"DESTINATION_OVERRIDE_FORBIDDEN"},400);
 const auth=createClient(SUPABASE_URL,ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},
  global:{headers:{Authorization:"Bearer "+token}}});
 const {data:identity,error:identityError}=await auth.auth.getUser(token);
 if(identityError||!identity.user||!identity.user.email)return respond({error:"INVALID_SESSION"},401);
 const user=identity.user;
 const svc=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:profile,error:profileError}=await svc.from("profiles")
 .select("id,email,app_role,is_active,access_deleted_at,organization_id,current_organization_id")
 .eq("id",user.id).maybeSingle();
 if(profileError||!profile||profile.is_active!==true||profile.access_deleted_at||
  profile.app_role!=="admin"||
  String(profile.email||"").trim().toLowerCase()!==String(user.email).trim().toLowerCase())
   return respond({error:"ADMIN_REQUIRED"},403);
 const orgId=String(profile.current_organization_id||profile.organization_id||"");
 if(!orgId)return respond({error:"COMPANY_REQUIRED"},403);
 const {data:company,error:companyError}=await svc.from("organizations").select("name").eq("id",orgId).maybeSingle();
 if(companyError||!company)return respond({error:"COMPANY_NOT_FOUND"},404);
 // The authenticated user's preview RPC remains company-scoped and does not
 // require the company's weekly digest preference to be enabled.
 const {data:d,error:previewError}=await auth.rpc("rbh_preview_safety_pulse_digest");
 if(previewError||!d)return respond({error:"PREVIEW_FAILED"},503);
 const {data:settings,error:settingsError}=await svc.from("safety_pulse_digest_settings")
 .select("delivery_ready").eq("organization_id",orgId).maybeSingle();
 if(settingsError)return respond({error:"SETTING_CHECK_FAILED"},503);
 // TEST ONLY: Live scheduling remains gated off, even if the company opted in.
 // A separate release is required for the production weekly worker.
 if(!BREVO_KEY||!FROM_EMAIL)return respond({error:"TEST_EMAIL_NOT_CONFIGURED"},503);
 const bucket=new Date(Math.floor(Date.now()/600000)*600000).toISOString();
 const address=String(user.email).trim().toLowerCase();
 const {data:claim,error:claimError}=await svc.from("safety_pulse_digest_test_deliveries").insert({
  organization_id:orgId,recipient_user_id:user.id,recipient_email:address,window_start:bucket,status:"claimed"
 }).select("id").single();
 if(claimError){
  if(claimError.code==="23505")return respond({error:"TEST_COOLDOWN",message:"A test was already requested in this 10-minute window."},429);
  return respond({error:"AUDIT_CLAIM_FAILED"},503);
 }
 const n=(k:string)=>Number(d[k]||0).toLocaleString("en-US");
 const fields:[string,string][]=[
  ["Overdue corrective actions","overdue_actions"],
  ["Waiting for verification","awaiting_review"],
  ["New reports last week","new_reports"],
  ["Reports closed last week","closed_reports"],
  ["Corrective actions completed last week","completed_actions"]
 ];
 const brand=String(company.name||"Your company");
 const period=String(d.period_start||"")+" – "+String(d.period_end||"");
 const htmlRows=fields.map(([label,k])=>'<tr><td style="padding:12px 6px;border-bottom:1px solid #e3e8ed">'+esc(label)+'</td><td style="padding:12px 6px;text-align:right;border-bottom:1px solid #e3e8ed"><b>'+n(k)+'</b></td></tr>').join("");
 const html='<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222">'+
 '<div style="background:#a51930;color:white;padding:15px 20px;font-weight:bold">RBH Safety · TEST EMAIL</div>'+
 '<div style="padding:20px;border:1px solid #e3e8ed"><h2 style="margin-top:0">Weekly Safety Pulse</h2>'+
 '<p>'+esc(brand)+'<br><span style="color:#667085">Reporting week: '+esc(period)+'</span></p>'+
 '<table role="presentation" style="width:100%;border-collapse:collapse">'+htmlRows+'</table>'+
 '<p style="margin-top:22px"><a style="color:#a51930;font-weight:bold" href="'+esc(DASHBOARD_URL)+'">View safety dashboard</a></p>'+
 '<p style="font-size:12px;color:#667085">TEST ONLY. Sent to your signed-in Admin account. This does not turn on weekly email delivery. No individual incident details are included.</p></div></div>';
 const textRows=fields.map(([label,k])=>label+": "+n(k)).join("\n");
 const textBody="RBH SAFETY · TEST EMAIL\nWeekly Safety Pulse\n"+brand+"\nReporting week: "+period+"\n\n"+textRows+
 "\n\nView safety dashboard: "+DASHBOARD_URL+
 "\n\nTEST ONLY: No weekly sending was enabled.";
 try{
  const response=await fetch("https://api.brevo.com/v3/smtp/email",{
   method:"POST",
   headers:{"api-key":BREVO_KEY,"content-type":"application/json","accept":"application/json"},
   body:JSON.stringify({sender:{name:FROM_NAME,email:FROM_EMAIL},
    to:[{email:address}],subject:"[TEST] Weekly Safety Pulse | "+brand,
    htmlContent:html,textContent:textBody,tags:["safety-pulse-test"]})
  });
  const provider=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error("BREVO_HTTP_"+response.status);
  const {error:auditError}=await svc.from("safety_pulse_digest_test_deliveries").update({
   status:"sent",sent_at:new Date().toISOString(),provider_message_id:provider.messageId||provider.id||null
  }).eq("id",claim.id);
  if(auditError)console.error("Test digest audit update",auditError);
  return respond({ok:true,recipient:address,providerAccepted:true,deliveryLogRecorded:!auditError,
    period_start:d.period_start,period_end:d.period_end});
 }catch(err){
  const error=err instanceof Error?err.message:String(err);
  console.error("Digest test email failed",error);
  await svc.from("safety_pulse_digest_test_deliveries").update({status:"failed",error_message:error.slice(0,180)})
   .eq("id",claim.id);
  return respond({error:"TEST_SEND_FAILED"},502);
 }
});
