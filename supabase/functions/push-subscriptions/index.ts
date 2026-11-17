// RBH signed-in, per-device push subscription management. No push delivery here.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Cache-Control":"no-store"};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,"Content-Type":"application/json"}});
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("");
const safeEndpoint=(value:unknown)=>{
  if(typeof value!=="string"||value.length>2048)return false;
  try {
    const u=new URL(value);
    if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||u.hostname.endsWith("."))return false;
    const h=u.hostname.toLowerCase();
    return h==="fcm.googleapis.com"||h==="updates.push.services.mozilla.com"||h==="web.push.apple.com"||
      h==="api.push.apple.com"||h==="android.googleapis.com"||h.endsWith(".push.apple.com");
  }catch{return false;}
};
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!serviceKey)return reply({error:"SERVICE_NOT_CONFIGURED"},503);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return reply({error:"AUTH_REQUIRED"},401);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const verified=await auth.auth.getUser(token);
  if(verified.error||!verified.data.user||verified.data.user.is_anonymous)return reply({error:"AUTH_REQUIRED"},401);
  const user=verified.data.user;
  // getUser verified the JWT; the session claim binds this device to an actual session.
  let sessionId="";
  try{
    const payload=token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    sessionId=String(JSON.parse(atob(payload+"=".repeat((4-payload.length%4)%4))).session_id||"");
  }catch{}
  if(!/^[a-f0-9-]{36}$/i.test(sessionId))return reply({error:"VALID_SESSION_REQUIRED"},401);
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:profile,error:profileError}=await service.from("profiles")
    .select("id,organization_id,current_organization_id,is_active,access_deleted_at")
    .eq("id",user.id).maybeSingle();
  if(profileError||!profile||profile.is_active!==true||profile.access_deleted_at)return reply({error:"ACTIVE_ACCOUNT_REQUIRED"},403);
  const org=profile.current_organization_id||profile.organization_id;
  if(!org)return reply({error:"COMPANY_REQUIRED"},403);
  const {data:company}=await service.from("organizations").select("id,status").eq("id",org).maybeSingle();
  if(!company||company.status&&["inactive","suspended","deleted"].includes(String(company.status).toLowerCase()))return reply({error:"COMPANY_INACTIVE"},403);
  let body:Record<string,unknown>;
  try{body=await req.json();if(!body||typeof body!=="object"||Array.isArray(body))throw Error();}catch{return reply({error:"INVALID_JSON"},400);}
  const action=body.action;
  if(action==="status"){
    const {data,error}=await service.from("user_push_subscriptions").select("endpoint_sha256,auth_session_id")
      .eq("user_id",user.id).eq("organization_id",org).is("disabled_at",null);
    if(error)return reply({error:"DEVICE_STATUS_UNAVAILABLE"},503);
    let deviceRegistered=false;
    if(typeof body.endpoint==="string"&&safeEndpoint(body.endpoint)){
      const hash=hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body.endpoint)));
      deviceRegistered=(data||[]).some(x=>x.endpoint_sha256===hash&&x.auth_session_id===sessionId);
    }
    return reply({configured:!!Deno.env.get("VAPID_PUBLIC_KEY"),publicKey:Deno.env.get("VAPID_PUBLIC_KEY")||null,activeDevices:(data||[]).length,deviceRegistered});
  }
  if(action==="disable_all"){
    const {error}=await service.from("user_push_subscriptions")
      .update({disabled_at:new Date().toISOString(),updated_at:new Date().toISOString()})
      .eq("user_id",user.id).is("disabled_at",null);
    return error?reply({error:"ALL_DEVICES_DISABLE_FAILED"},503):reply({ok:true});
  }
  if(action==="register"||action==="disable"){
    if(!safeEndpoint(body.endpoint))return reply({error:"INVALID_PUSH_ENDPOINT"},400);
    const endpoint=String(body.endpoint);
    const sha=hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(endpoint)));
    if(action==="disable"){
      const {error}=await service.from("user_push_subscriptions")
        .update({disabled_at:new Date().toISOString(),updated_at:new Date().toISOString()})
        .eq("endpoint_sha256",sha).eq("user_id",user.id).eq("organization_id",org);
      return error?reply({error:"DEVICE_DISABLE_FAILED"},503):reply({ok:true});
    }
    const keys=body.subscription&&typeof body.subscription==="object"?body.subscription as Record<string,unknown>:{};
    // Subscription keys must come directly from browser PushSubscription.toJSON().
    const p256dh=typeof keys?.p256dh==="string"?keys.p256dh:"";
    const authSecret=typeof keys?.auth==="string"?keys.auth:"";
    if(!/^[A-Za-z0-9_-]{50,150}$/.test(p256dh)||!/^[A-Za-z0-9_-]{12,100}$/.test(authSecret))return reply({error:"INVALID_PUSH_KEYS"},400);
    const {data:existing,error:lookupError}=await service.from("user_push_subscriptions").select("id,user_id,organization_id")
      .eq("endpoint_sha256",sha).maybeSingle();
    if(lookupError)return reply({error:"DEVICE_LOOKUP_FAILED"},503);
    if(existing&&(existing.user_id!==user.id||existing.organization_id!==org))
      return reply({error:"DEVICE_BELONGS_TO_ANOTHER_ACCOUNT"},409);
    const row={organization_id:org,user_id:user.id,auth_session_id:sessionId,endpoint,endpoint_sha256:sha,p256dh,auth_secret:authSecret,
      enabled_at:new Date().toISOString(),disabled_at:null,updated_at:new Date().toISOString(),failure_count:0};
    const result=existing
      ?await service.from("user_push_subscriptions").update(row).eq("id",existing.id).eq("user_id",user.id)
      :await service.from("user_push_subscriptions").insert(row);
    return result.error?reply({error:"DEVICE_REGISTRATION_FAILED"},503):reply({ok:true});
  }
  return reply({error:"UNKNOWN_ACTION"},400);
});
