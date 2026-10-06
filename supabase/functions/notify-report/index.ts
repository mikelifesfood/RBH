// RBH Safety - New Report Notification (Brevo) V2
// Build 46: dynamic recipients from public.profiles.
//
// Triggered by reports_notify (pg_net) on public.reports INSERT.
// Recipients are resolved at send time from the report's organization:
//   active Admin + Safety Manager users with an email address.
//
// NOTIFY_TO is intentionally no longer used. Adding/removing/changing a manager
// in the dashboard database automatically changes the recipient group.
//
// Secrets / environment:
//   BREVO_API_KEY
//   MAIL_FROM_EMAIL
//   MAIL_FROM_NAME
//   WEBHOOK_SECRET
//   DASHBOARD_URL
//   LOGO_URL
// Supabase automatically provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const BREVO_API_KEY  = Deno.env.get("BREVO_API_KEY") ?? "";
const FROM_EMAIL     = Deno.env.get("MAIL_FROM_EMAIL") ?? "";
const FROM_NAME      = Deno.env.get("MAIL_FROM_NAME") ?? "RBH Safety";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const DASHBOARD_URL  = Deno.env.get("DASHBOARD_URL") ?? "";
const LOGO_URL       = Deno.env.get("LOGO_URL") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function row(label: string, value?: string): string {
  if (!value) return "";
  return `<tr><td style="padding:6px 12px;color:#6c6862;font:600 13px system-ui,sans-serif;white-space:nowrap;vertical-align:top">${esc(label)}</td>` +
    `<td style="padding:6px 12px;color:#161616;font:400 14px system-ui,sans-serif">${esc(value).replace(/\n/g, "<br>")}</td></tr>`;
}
function dashboardLink(base: string, reportId: string): string {
  if (!base) return "";
  try {
    const u = new URL(base);
    if (reportId) u.searchParams.set("report", reportId);
    return u.toString();
  } catch {
    return reportId ? `${base}${base.includes("?") ? "&" : "?"}report=${encodeURIComponent(reportId)}` : base;
  }
}
async function reserveEvent(service: any, rec: any, recipient: any) {
  const eventKey = `new-report/${rec.id}/${recipient.id}`;
  const { data: existing, error: existingError } = await service
    .from("report_notification_events")
    .select("id,status,provider_message_id,created_at")
    .eq("event_key", eventKey)
    .maybeSingle();
  if (existingError) throw new Error(`NOTIFICATION_LOG_UNAVAILABLE:${existingError.message}`);
  if (existing?.status === "sent") return { duplicate: true, eventId: existing.id, messageId: existing.provider_message_id || null };
  if (existing?.status === "sending") {
    const ageMs = Date.now() - new Date(existing.created_at).getTime();
    if (Number.isFinite(ageMs) && ageMs < 10 * 60 * 1000) return { inProgress: true, eventId: existing.id };
  }
  if (existing?.id) {
    const { error } = await service.from("report_notification_events").update({
      status: "sending", provider: "brevo", error_message: null, updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    if (error) throw new Error(`NOTIFICATION_LOG_UPDATE_FAILED:${error.message}`);
    return { eventId: existing.id };
  }
  const { data: created, error } = await service.from("report_notification_events").insert({
    organization_id: rec.organization_id,
    report_id: rec.id,
    notification_type: "new_report",
    recipient_user_id: recipient.id,
    recipient_email: String(recipient.email).trim(),
    event_key: eventKey,
    provider: "brevo",
    status: "sending",
  }).select("id").single();
  if (error) {
    if (String(error.code || "") === "23505") return { inProgress: true };
    throw new Error(`NOTIFICATION_LOG_INSERT_FAILED:${error.message}`);
  }
  return { eventId: created.id };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET)
      return new Response("Unauthorized", { status: 401 });

    const body = await req.json().catch(() => ({}));
    if (body?.type && body.type !== "INSERT") return new Response("ignored", { status: 200 });
    const rec = body?.record ?? {};
    if (!rec?.id || !rec?.organization_id) return new Response("Missing report/organization", { status: 400 });

    if (!BREVO_API_KEY) return new Response("Missing BREVO_API_KEY", { status: 500 });
    if (!FROM_EMAIL) return new Response("Missing MAIL_FROM_EMAIL", { status: 500 });
    if (!SUPABASE_URL || !SERVICE_ROLE) return new Response("Missing Supabase service environment", { status: 500 });

    const service = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profiles, error: profileError } = await service
      .from("profiles")
      .select("id,email,full_name,app_role,is_active,organization_id")
      .eq("organization_id", rec.organization_id)
      .in("app_role", ["admin", "safety_manager"]);
    if (profileError) return new Response(`Recipient lookup failed: ${profileError.message}`, { status: 503 });

    const recipients = (profiles || []).filter((p: any) => p.is_active !== false && String(p.email || "").trim());
    if (!recipients.length) {
      console.error("New report has no active Admin/Safety Manager recipients", rec.id, rec.organization_id);
      return new Response("No active Admin/Safety Manager recipients", { status: 503 });
    }

    const injury = rec.involves_injury === true || rec.involves_injury === "true";
    const urgent = /critical|serious/i.test(rec.potential_severity ?? "");
    const ref = rec.ref_no != null ? `#${rec.ref_no}` : "";
    const subject = `${injury ? "🚑 INJURY — " : ""}${urgent ? "⚠️ " : ""}[RBH Safety] ${rec.report_type ?? "New report"} ${ref}`.trim();
    const reporter = (rec.reporter_name ?? "").trim() || "Anonymous";
    const submitted = rec.created_at ? new Date(rec.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) : "";
    const langLabel = rec.language === "es" ? "Spanish" : rec.language === "en" ? "English" : (rec.language ?? "");
    const recordUrl = dashboardLink(DASHBOARD_URL, String(rec.id));

    const rowsHtml =
      row("Reference", ref) + row("Submitted", submitted) + row("Involves injury", injury ? "Yes" : "") + row("Type", rec.report_type) +
      row("Hazard", rec.hazard_category) + row("Potential severity", rec.potential_severity) +
      row("Description", rec.description) + row("Involved / witnesses", rec.people_involved) +
      row("Immediate action", rec.immediate_action) + row("Suggested fix", rec.suggested_fix) +
      row("Job site", rec.job_site) + row("Location on site", rec.site_location) +
      row("Reported by", reporter) + row("Role", rec.reporter_role) +
      row("Contact", rec.reporter_contact) + row("Form language", langLabel);

    const logoBlock = LOGO_URL
      ? `<img src="${esc(LOGO_URL)}" alt="RBH Insulation" height="44" style="display:block;height:44px;width:auto;border:0">`
      : `<span style="color:#141414;font:800 20px system-ui,sans-serif">RBH <span style="color:#b01e28">Insulation</span></span>`;

    const cta = recordUrl
      ? `<div style="padding:4px 12px 8px"><a href="${esc(recordUrl)}" style="background:#b01e28;color:#ffffff;text-decoration:none;font:700 15px system-ui,sans-serif;padding:12px 22px;border-radius:8px;display:inline-block">Open report &rarr;</a></div>`
      : "";

    const html = `<div style="max-width:640px;margin:0 auto;border:1px solid #e5e1db;border-radius:12px;overflow:hidden;font-family:system-ui,sans-serif">
      <div style="background:#ffffff;border-bottom:3px solid #b01e28;padding:16px 20px">${logoBlock}
        <div style="margin-top:8px;font:700 12px system-ui,sans-serif;color:#6c6862;letter-spacing:.4px;text-transform:uppercase">New Safety &amp; Near-Miss Report</div>
      </div>
      ${urgent ? `<div style="background:#b01e28;color:#fff;padding:8px 20px;font:700 13px system-ui,sans-serif">High potential severity &mdash; please review promptly</div>` : ""}
      ${injury ? `<div style="background:#7a1018;color:#fff;padding:10px 20px;font:700 13px system-ui,sans-serif">INJURY REPORTED &mdash; ensure this is handled per company procedure. For a qualifying serious injury, illness, or death, follow company procedure and report to Cal/OSHA immediately, as soon as practically possible, and no later than 8 hours after the employer knows or, with diligent inquiry, would have known.</div>` : ""}
      <div style="padding:14px 8px">
        <table style="border-collapse:collapse;width:100%">${rowsHtml}</table>
        ${cta}
        <p style="margin:14px 12px 0;color:#6c6862;font:400 12.5px system-ui,sans-serif">Any photos submitted with this report are viewable in the dashboard. Automated notification from the RBH safety reporting form.</p>
      </div>
    </div>`;

    const text = [subject, "", injury && "*** INJURY REPORTED — qualifying serious injuries, illnesses, or deaths must be reported to Cal/OSHA immediately, as soon as practically possible, and no later than 8 hours after the employer knows or, with diligent inquiry, would have known. ***", submitted && `Submitted: ${submitted}`, rec.report_type && `Type: ${rec.report_type}`,
      rec.hazard_category && `Hazard: ${rec.hazard_category}`, rec.potential_severity && `Potential severity: ${rec.potential_severity}`,
      rec.description && `\nDescription:\n${rec.description}`, rec.people_involved && `\nInvolved/witnesses: ${rec.people_involved}`,
      rec.immediate_action && `Immediate action: ${rec.immediate_action}`, rec.suggested_fix && `Suggested fix: ${rec.suggested_fix}`,
      `\nReported by: ${reporter}`, rec.reporter_role && `Role: ${rec.reporter_role}`, rec.reporter_contact && `Contact: ${rec.reporter_contact}`,
      recordUrl && `\nOpen report: ${recordUrl}`
    ].filter(Boolean).join("\n");

    let sentCount = 0, duplicateCount = 0, failedCount = 0;
    const failures: any[] = [];
    for (const recipient of recipients) {
      let reservation: any;
      try { reservation = await reserveEvent(service, rec, recipient); }
      catch (e) { failedCount++; failures.push({ recipient: recipient.email, error: String(e) }); continue; }
      if (reservation.duplicate) { duplicateCount++; continue; }
      if (reservation.inProgress || !reservation.eventId) continue;

      try {
        const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", "accept": "application/json" },
          body: JSON.stringify({
            sender: { name: FROM_NAME, email: FROM_EMAIL },
            to: [{ email: String(recipient.email).trim(), name: recipient.full_name || undefined }],
            subject, htmlContent: html, textContent: text, tags: ["rbh-new-report"],
          }),
        });
        const providerData = await resp.json().catch(async () => ({ raw: await resp.text().catch(() => "") }));
        if (!resp.ok) throw new Error(providerData?.message || providerData?.code || providerData?.raw || `BREVO_${resp.status}`);
        const messageId = providerData?.messageId || providerData?.id || null;
        await service.from("report_notification_events").update({
          status: "sent", provider_message_id: messageId, sent_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString(),
        }).eq("id", reservation.eventId);
        sentCount++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failedCount++;
        failures.push({ recipient: recipient.email, error: message });
        await service.from("report_notification_events").update({
          status: "failed", error_message: message.slice(0, 1000), updated_at: new Date().toISOString(),
        }).eq("id", reservation.eventId);
      }
    }

    const result = { ok: failedCount === 0, recipientCount: recipients.length, sentCount, duplicateCount, failedCount, failures: failures.slice(0, 5) };
    return new Response(JSON.stringify(result), {
      status: failedCount > 0 && sentCount === 0 && duplicateCount === 0 ? 502 : 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(`Error: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
});
