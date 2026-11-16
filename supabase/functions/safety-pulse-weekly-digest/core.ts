// Pure weekly digest scheduling and recipient eligibility helpers.
// Keep deterministic tests in tests/digest-scheduler-readiness.test.mjs.
export type DigestPerson={
 id:string;email:string|null;full_name:string|null;app_role:string;is_active:boolean;
 access_deleted_at:string|null;organization_id:string|null;current_organization_id:string|null;
};
export function isScheduledWindow(timezone:string,now:Date,day=1,hour=8,minute=0):boolean {
 if(!timezone || !Number.isFinite(now.getTime()) || minute!==0 || hour<0 || hour>23 || day<0 || day>6)
   return false;
 const p=new Intl.DateTimeFormat("en-US",{
   timeZone:timezone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
 }).formatToParts(now);
 const part=(type:string)=>p.find(x=>x.type===type)?.value||"";
 const weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(part("weekday"));
 // UTC scheduler executes at 00/15/30/45. Accept first 15 local minutes,
 // then rely on the database unique key for missed/duplicate invocations.
 return weekday===day && Number(part("hour"))===hour &&
   Number(part("minute"))>=minute && Number(part("minute"))<minute+15;
}
export function eligibleRecipient(p:DigestPerson,orgId:string):boolean {
 return !!orgId && ["admin","safety_manager"].includes(p.app_role) &&
   p.is_active===true && !p.access_deleted_at &&
   String(p.current_organization_id||p.organization_id||"")===orgId &&
   !!String(p.email||"").trim();
}
