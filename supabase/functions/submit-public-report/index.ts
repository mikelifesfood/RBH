// TeamWorkt Safety Build 7 -- staged public Turnstile-verifying intake.
// Only active after TURNSTILE_ENFORCE=true and credentials configured.
const API_BASE=Deno.env.get("SUPABASE_URL")||"";
const SERVICE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const SITE_KEY=Deno.env.get("TURNSTILE_SITE_KEY")||"";
const SECRET_KEY=Deno.env.get("TURNSTILE_SECRET_KEY")||"";
const ENABLED=Deno.env.get("TURNSTILE_ENFORCE")==="true";
const EXPECTED_HOST=Deno.env.get("TURNSTILE_ALLOWED_HOSTNAME")||"mikelifesfood.github.io";
const EXPECTED_ORIGIN=Deno.env.get("TURNSTILE_ALLOWED_ORIGIN")||"https://mikelifesfood.github.io";
const ACTION="rbh_public_report";
const READY=ENABLED&&!!SITE_KEY&&!!SECRET_KEY&&!!SERVICE_KEY&&!!API_BASE;
const headers={
  "access-control-allow-origin":EXPECTED_ORIGIN,
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"authorization,apikey,content-type,x-client-info",
  "access-control-max-age":"600","vary":"Origin","cache-control":"no-store"
};
function reply(status,body,extra={}){
  return new Response(JSON.stringify(body),{status,headers:{...headers,"content-type":"application/json;charset=utf-8",...extra}});
}
function failure(status,code,more={}){return reply(status,{ok:false,code,...more});}
function allowed(req){const origin=req.headers.get("origin");return !origin||origin===EXPECTED_ORIGIN;}
function getIp(req){
  // CF-Connecting-IP preferred. Forwarded fallback may be untrusted.
  // Global quotas plus verified Turnstile are essential even if IP is spoofed.
  const raw=req.headers.get("cf-connecting-ip")||
    req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown";
  const ip=raw.trim().slice(0,64);
  return /^[0-9a-fA-F:.]{3,64}$/.test(ip)?ip:"unknown";
}
async function digest(value){
  const bytes=new TextEncoder().encode(SECRET_KEY+"|"+value);
  const result=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(result)].map(v=>v.toString(16).padStart(2,"0")).join("").slice(0,32);
}
async function rpc(name,args){
  if(!SERVICE_KEY||!API_BASE)throw Error("SERVICE_NOT_CONFIGURED");
  const res=await fetch(API_BASE.replace(/\/$/,"")+"/rest/v1/rpc/"+name,{
    method:"POST",headers:{"apikey":SERVICE_KEY,"authorization":"Bearer "+SERVICE_KEY,
      "content-type":"application/json","accept":"application/json"},
    body:JSON.stringify(args)
  });
  const text=await res.text();
  if(!res.ok){
    let parsed={};try{parsed=JSON.parse(text)}catch{}
    throw Error(String(parsed.message||parsed.code||"RPC_ERROR"));
  }
  try{return text?JSON.parse(text):null}catch{throw Error("INVALID_DATABASE_RESPONSE")}
}
function isUuid(value){
  return typeof value==="string"&&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
async function verify(token,ip){
  const data={secret:SECRET_KEY,response:token,idempotency_key:crypto.randomUUID()};
  if(ip!=="unknown")data.remoteip=ip;
  const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),8000);
  try{
    const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify(data),signal:ctrl.signal});
    if(!response.ok)throw Error("SITEVERIFY_UNAVAILABLE");
    const status=await response.json();
    if(!status.success||status.hostname!==EXPECTED_HOST||status.action!==ACTION)return false;
    const age=Date.now()-Date.parse(status.challenge_ts||"");
    if(!Number.isFinite(age)||age< -60000||age>300000)return false;
    return true;
  }finally{clearTimeout(timeout)}
}
Deno.serve(async req=>{
  if(!allowed(req))return failure(403,"ORIGIN_NOT_ALLOWED");
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(req.method==="GET")return reply(200,{mode:READY?"protected":ENABLED?"not_ready":"legacy",
    sitekey:READY?SITE_KEY:null,action:ACTION,ready:READY});
  if(req.method!=="POST")return failure(405,"METHOD_NOT_ALLOWED");
  if(!READY)return failure(503,"PROTECTION_NOT_CONFIGURED",{retryable:true});
  if(Number(req.headers.get("content-length")||0)>72000)return failure(413,"PAYLOAD_TOO_LARGE");
  let data;try{data=await req.json()}catch{return failure(400,"INVALID_JSON")}
  if(!data||typeof data!=="object"||Array.isArray(data))return failure(400,"INVALID_REQUEST");
  const payload=data.payload,token=data.turnstile_token;
  if(!payload||typeof payload!=="object"||Array.isArray(payload)||
     JSON.stringify(payload).length>65536||!isUuid(payload.client_submission_key))
    return failure(400,"INVALID_REPORT_PAYLOAD");
  if(typeof token!=="string"||token.length<10||token.length>2048)
    return failure(400,"VERIFICATION_REQUIRED");
  try{
    // Idempotent replay: a lost response must not require redemption of a
    // second challenge to receive the original report reference.
    const previous=await rpc("rbh_public_intake_receipt",{p_payload:payload});
    if(previous&&previous.id&&previous.ref_no)return reply(200,{...previous,ok:true});
    const ip=getIp(req),identity=await digest(ip),now=Date.now();
    await rpc("rbh_guard_public_intake",{p_buckets:[
      {key:"global:ten:"+Math.floor(now/600000),max:300},
      {key:"ip:"+identity+":ten:"+Math.floor(now/600000),max:15},
      {key:"ip:"+identity+":hour:"+Math.floor(now/3600000),max:40}
    ]});
    if(!await verify(token,ip))return failure(403,"VERIFICATION_FAILED",{retryable:true});
    const result=await rpc("submit_report",{payload});
    if(!result?.id||!result?.ref_no)throw Error("INVALID_REPORT_RECEIPT");
    return reply(200,{...result,ok:true});
  }catch(e){
    const msg=String(e instanceof Error?e.message:e);
    if(msg.includes("INTAKE_RATE_LIMITED"))return failure(429,"RATE_LIMITED",{retryable:true});
    if(msg.includes("SUBMISSION_KEY_PAYLOAD_MISMATCH"))return failure(409,"SUBMISSION_KEY_PAYLOAD_MISMATCH");
    if(/INVALID_REPORT|REPORT_FIELD|INVALID_OR_INACTIVE_SITE_CODE|INVALID_OBSERVED/.test(msg))
      return failure(400,"INVALID_REPORT",{detail:msg.slice(0,120)});
    console.warn("Protected intake unavailable (without logging report or token)",msg.slice(0,90));
    return failure(503,"TEMPORARILY_UNAVAILABLE",{retryable:true});
  }
});
