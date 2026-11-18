// RBH Safety - Manage Corrective-Action Evidence V2
// Step 14D: action-specific corrective-action evidence.
//
// Backward compatible:
// - Existing report-level evidence requests without correctiveActionId still work.
// - New multi-action requests should include correctiveActionId.
// - Evidence remains manageable from the Complete step forward, including after
//   verification/closure, for an authorized manager or the specific action owner.
// - Restarted/retired historical actions cannot receive new action-specific evidence.
// - Removal always re-checks authorization against the attachment's linked action.
//
// Required existing secrets:
// SUPABASE_URL
// SUPABASE_ANON_KEY
// SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeName(name: string) {
  let value = String(name || "evidence").replace(/[^a-zA-Z0-9._-]/g, "_");
  if (value.length > 120) value = value.slice(-120);
  return value || "evidence";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authHeader)) return json({ error: "AUTH_REQUIRED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "SUPABASE_ENV_MISSING" }, 503);
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData?.user) return json({ error: "INVALID_SESSION" }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const contentType = req.headers.get("content-type") || "";

  let action = "";
  let reportId = "";
  let correctiveActionId = "";
  let attachmentId = "";
  let files: File[] = [];
  let clientEvidenceId = "";
  let expectedActionRevision = "";
  let expectedReportRevision = "";
  let expectedActionStatus = "";
  let expectedGeneration = "";
  let expectedReopenCount = "";

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ error: "INVALID_FORM_DATA" }, 400);
    }

    action = String(form.get("action") || "upload").trim().toLowerCase();
    reportId = String(form.get("reportId") || "").trim();
    correctiveActionId = String(
      form.get("correctiveActionId") || form.get("actionId") || "",
    ).trim();
    files = form.getAll("files").filter((v): v is File => v instanceof File);
    clientEvidenceId=String(form.get("clientEvidenceId")||"").trim();
    expectedActionRevision=String(form.get("expectedActionRevision")||"").trim();
    expectedReportRevision=String(form.get("expectedReportRevision")||"").trim();
    expectedActionStatus=String(form.get("expectedActionStatus")||"").trim();
    expectedGeneration=String(form.get("expectedGeneration")??"").trim();
    expectedReopenCount=String(form.get("expectedReopenCount")??"").trim();
  } else {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "INVALID_JSON" }, 400);
    }

    action = String(body?.action || "remove").trim().toLowerCase();
    reportId = String(body?.reportId || "").trim();
    correctiveActionId = String(
      body?.correctiveActionId || body?.actionId || "",
    ).trim();
    attachmentId = String(body?.attachmentId || "").trim();
  }

  if (!isUuid(reportId)) return json({ error: "INVALID_REPORT_ID" }, 400);
  if (!["upload", "remove", "capabilities"].includes(action)) return json({ error: "INVALID_ACTION" }, 400);
  if (correctiveActionId && !isUuid(correctiveActionId)) {
    return json({ error: "INVALID_CORRECTIVE_ACTION_ID" }, 400);
  }
  if (clientEvidenceId && (!isUuid(clientEvidenceId) || action !== "upload")) return json({ error: "INVALID_OFFLINE_EVIDENCE_ID" },400);
  if (action === "remove" && !isUuid(attachmentId)) {
    return json({ error: "INVALID_ATTACHMENT_ID" }, 400);
  }

  const { data: caller, error: callerError } = await service
    .from("profiles")
    .select("id,email,app_role,is_active,organization_id,current_organization_id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (callerError || !caller || caller.is_active === false) {
    return json({ error: "ACTIVE_PROFILE_REQUIRED" }, 403);
  }

  const callerOrgId = String(
    caller.current_organization_id || caller.organization_id || "",
  );

  const { data: report, error: reportError } = await service
    .from("reports")
    .select(
      "id,ref_no,organization_id,assigned_user_id,corrective_action,action_status,action_completed_at,status,workflow_restart_count,reopen_count,updated_at",
    )
    .eq("id", reportId)
    .maybeSingle();

  if (reportError || !report) return json({ error: "REPORT_NOT_FOUND" }, 404);

  if (!callerOrgId || callerOrgId !== String(report.organization_id || "")) {
    return json({ error: "ORGANIZATION_MISMATCH" }, 403);
  }

  const role = String(caller.app_role || "");
  const manager = role === "admin" || role === "safety_manager";

  type CorrectiveActionRow = {
    id: string;
    report_id: string;
    organization_id: string;
    workflow_generation: number;
    action_number: number;
    description: string | null;
    owner_user_id: string | null;
    status: string;
    activated_at: string | null;
    retired_at: string | null;
    activation_reopen_count: number | null;
    updated_at: string;
  };

  async function loadCorrectiveAction(id: string): Promise<CorrectiveActionRow | null> {
    if (!id) return null;

    const { data, error } = await service
      .from("report_corrective_actions")
      .select(
        "id,report_id,organization_id,workflow_generation,action_number,description,owner_user_id,status,activated_at,retired_at,activation_reopen_count,updated_at",
      )
      .eq("id", id)
      .eq("report_id", reportId)
      .maybeSingle();

    if (error || !data) return null;
    return data as CorrectiveActionRow;
  }

  function authorizeSpecificAction(row: CorrectiveActionRow) {
    if (String(row.organization_id || "") !== String(report.organization_id || "")) {
      return "ORGANIZATION_MISMATCH";
    }
    if (Number(row.workflow_generation || 0) !== Number(report.workflow_restart_count || 0)) {
      return "CORRECTIVE_ACTION_NOT_CURRENT_GENERATION";
    }
    if (row.retired_at) return "CORRECTIVE_ACTION_RETIRED";
    if (!row.activated_at) return "CORRECTIVE_ACTION_NOT_ACTIVATED";
    if (Number(row.activation_reopen_count||0)!==Number(report.reopen_count||0)) return "CORRECTIVE_ACTION_NOT_CURRENT_REOPEN_CYCLE";

    const assignedOwner =
      role === "supervisor" &&
      String(row.owner_user_id || "") === String(caller.id);

    if (!manager && !assignedOwner) return "NOT_AUTHORIZED";
    return "";
  }

  function authorizeLegacyReportEvidence() {
    const assignedOwner =
      role === "supervisor" &&
      String(report.assigned_user_id || "") === String(caller.id);

    if (!manager && !assignedOwner) return "NOT_AUTHORIZED";

    if (!String(report.corrective_action || "").trim() || !report.assigned_user_id) {
      return "ACTION_PLAN_REQUIRED";
    }

    return "";
  }

  async function staffOfflineEnabled() {
    const {data,error}=await service.from('staff_offline_settings')
      .select('enabled').eq('organization_id',callerOrgId).maybeSingle();
    return !error&&data?.enabled===true;
  }

  if (action === "capabilities") {
    if(!(await staffOfflineEnabled()))return json({error:"STAFF_OFFLINE_DISABLED"},403);
    // A side-effect-free handshake. Clients MUST require this exact protocol
    // version before calling offline upload fields; older live versions lacked
    // idempotency and must never process a retryable offline upload.
    if(!correctiveActionId) return json({error:"CORRECTIVE_ACTION_REQUIRED"},400);
    const actionRow=await loadCorrectiveAction(correctiveActionId);
    if(!actionRow)return json({error:"CORRECTIVE_ACTION_NOT_FOUND"},404);
    const denied=authorizeSpecificAction(actionRow);
    if(denied)return json({error:denied},403);
    return json({ok:true,offlineProtocolVersion:1,correctiveActionId,
      reportId:report.id,organizationId:report.organization_id});
  }

  if (action === "upload") {
    if (!files.length) return json({ error: "NO_FILES" }, 400);
    if (files.length > 5) return json({ error: "TOO_MANY_FILES" }, 400);
    if (clientEvidenceId && (files.length!==1 || !correctiveActionId)) return json({ error: "OFFLINE_SINGLE_ACTION_EVIDENCE_REQUIRED" },400);
    if (clientEvidenceId && !(await staffOfflineEnabled())) return json({error:"STAFF_OFFLINE_DISABLED"},403);

    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        return json({ error: "FILE_TOO_LARGE", fileName: file.name }, 400);
      }
    }

    let correctiveAction: CorrectiveActionRow | null = null;

    if (correctiveActionId) {
      correctiveAction = await loadCorrectiveAction(correctiveActionId);
      if (!correctiveAction) return json({ error: "CORRECTIVE_ACTION_NOT_FOUND" }, 404);

      const authError = authorizeSpecificAction(correctiveAction);
      if (authError) return json({ error: authError }, 403);
    } else {
      // Temporary backward-compatible path for the legacy Action #1 UI.
      const authError = authorizeLegacyReportEvidence();
      if (authError) return json({ error: authError }, authError === "ACTION_PLAN_REQUIRED" ? 409 : 403);
    }

    // Optional offline evidence mode: strict revision/generation checks and durable
    // idempotency key. Existing online and legacy upload behavior is unchanged.
    let offlineDigest = "";
    if (clientEvidenceId) {
      if (!correctiveAction) return json({ error:"OFFLINE_CORRECTIVE_ACTION_REQUIRED" },400);
      if (!expectedActionRevision || !expectedReportRevision || !expectedActionStatus ||
          !/^[0-9]+$/.test(expectedGeneration) || !/^[0-9]+$/.test(expectedReopenCount)) {
        return json({ error:"OFFLINE_REVISION_REQUIRED" },400);
      }
      const payload=await files[0].arrayBuffer();
      offlineDigest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",payload)))
        .map(x=>x.toString(16).padStart(2,"0")).join("");
      const {data: prior,error: priorError}=await service.from("report_attachments")
        .select("id,report_id,corrective_action_id,organization_id,file_name,size_bytes,storage_path,offline_evidence_sha256")
        .eq("organization_id",callerOrgId).eq("offline_uploaded_by",caller.id)
        .eq("offline_evidence_id",clientEvidenceId).maybeSingle();
      if(priorError)return json({error:"OFFLINE_EVIDENCE_LEDGER_UNAVAILABLE"},503);
      if(prior){
        if(prior.report_id!==report.id||prior.corrective_action_id!==correctiveAction.id||
          prior.offline_evidence_sha256!==offlineDigest||prior.file_name!==files[0].name||
          Number(prior.size_bytes)!==files[0].size) return json({error:"OFFLINE_EVIDENCE_ID_REUSED"},409);
        return json({ok:true,alreadyUploaded:true,offlineProtocolVersion:1,clientEvidenceId,addedCount:0,existingCount:1,failedCount:0,
          added:[{id:prior.id,fileName:prior.file_name,storagePath:prior.storage_path,
            correctiveActionId:correctiveAction.id}],correctiveActionId:correctiveAction.id});
      }
      if (String(correctiveAction.updated_at)!==expectedActionRevision ||
          String(report.updated_at)!==expectedReportRevision ||
          String(correctiveAction.status)!==expectedActionStatus ||
          Number(correctiveAction.workflow_generation)!==Number(expectedGeneration) ||
          Number(report.workflow_restart_count||0)!==Number(expectedGeneration) ||
          Number(report.reopen_count||0)!==Number(expectedReopenCount) ||
          ["closed","no_action","duplicate"].includes(String(report.status))) {
        return json({ error:"OFFLINE_CONFLICT_NEEDS_REVIEW" },409);
      }
    }

    const added: Array<{
      id: string;
      fileName: string;
      storagePath: string;
      correctiveActionId: string | null;
    }> = [];
    const failed: Array<{ fileName: string; error: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const path = clientEvidenceId && correctiveAction
        ? `corrective-evidence/${report.id}/${correctiveAction.id}/offline/${caller.id}/${clientEvidenceId}`
        : correctiveAction
        ? `corrective-evidence/${report.id}/${correctiveAction.id}/${Date.now()}_${i}_${safeName(file.name)}`
        : `corrective-evidence/${report.id}/${Date.now()}_${i}_${safeName(file.name)}`;

      try {
        const { error: storageError } = await service.storage
          .from("report-attachments")
          .upload(path, file, {
            contentType: file.type || undefined,
            upsert: false,
          });

        if (storageError) {
          if (!clientEvidenceId) throw storageError;
          // Recovery when Storage accepted the file but the response/metadata failed.
          // Never attach a remote object without verifying that its bytes match.
          const {data: remote,error: downloadError}=await service.storage.from("report-attachments").download(path);
          if(downloadError||!remote)throw storageError;
          const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await remote.arrayBuffer())))
            .map(x=>x.toString(16).padStart(2,"0")).join("");
          if(digest!==offlineDigest)return json({error:"OFFLINE_EVIDENCE_STORAGE_CONFLICT"},409);
        }

        const insertRow: Record<string, unknown> = {
          report_id: report.id,
          organization_id: report.organization_id,
          storage_path: path,
          file_name: file.name || "Evidence file",
          mime_type: file.type || null,
          size_bytes: file.size || null,
        };

        if (correctiveAction) {
          insertRow.corrective_action_id = correctiveAction.id;
        }
        if(clientEvidenceId){
          insertRow.offline_evidence_id=clientEvidenceId;
          insertRow.offline_evidence_sha256=offlineDigest;
          insertRow.offline_uploaded_by=caller.id;
        }

        const { data: attachment, error: metadataError } = await service
          .from("report_attachments")
          .insert(insertRow)
          .select("id,file_name,storage_path,corrective_action_id")
          .single();

        if (metadataError) {
          if(clientEvidenceId){
            // Avoid deleting an object that another concurrent retry may have
            // already registered. A fresh retry reconciles the metadata ledger.
            throw metadataError;
          }
          await service.storage
            .from("report-attachments")
            .remove([path])
            .catch(() => undefined);
          throw metadataError;
        }

        added.push({
          id: String(attachment.id),
          fileName: String(attachment.file_name),
          storagePath: String(attachment.storage_path),
          correctiveActionId: attachment.corrective_action_id
            ? String(attachment.corrective_action_id)
            : null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Evidence upload failed", file.name, message);
        failed.push({ fileName: file.name || "Evidence file", error: message });
      }
    }

    if (added.length) {
      const names = added.map((x) => x.fileName).join(", ");
      const actionLabel = correctiveAction
        ? `Corrective Action #${correctiveAction.action_number}`
        : "Corrective action";

      const { error: noteError } = await service.from("report_notes").insert({
        report_id: report.id,
        organization_id: report.organization_id,
        title: correctiveAction
          ? `[System] ${actionLabel} evidence added`
          : "[System] Corrective-action evidence added",
        body: `Added evidence file${added.length === 1 ? "" : "s"}${
          correctiveAction ? ` to ${actionLabel}` : ""
        }: ${names}`,
        author_email: caller.email || userData.user.email || null,
      });

      if (noteError) {
        console.error("Evidence upload audit note failed", noteError);
      }
    }

    return json(
      {
        ok: added.length > 0,
        added,
        failed,
        addedCount: added.length,
        failedCount: failed.length,
        correctiveActionId: correctiveAction?.id || null,
        actionNumber: correctiveAction?.action_number || null,
        ...(clientEvidenceId?{offlineProtocolVersion:1,clientEvidenceId}:{}) ,
      },
      added.length ? 200 : 502,
    );
  }

  // -------------------------------------------------------------------------
  // REMOVE
  // -------------------------------------------------------------------------

  const { data: attachment, error: attachmentError } = await service
    .from("report_attachments")
    .select(
      "id,report_id,organization_id,corrective_action_id,storage_path,file_name,mime_type,created_at",
    )
    .eq("id", attachmentId)
    .eq("report_id", reportId)
    .maybeSingle();

  if (attachmentError || !attachment) {
    return json({ error: "ATTACHMENT_NOT_FOUND" }, 404);
  }

  const linkedActionId = attachment.corrective_action_id
    ? String(attachment.corrective_action_id)
    : "";

  let linkedAction: CorrectiveActionRow | null = null;

  if (linkedActionId) {
    if (correctiveActionId && correctiveActionId !== linkedActionId) {
      return json({ error: "ATTACHMENT_CORRECTIVE_ACTION_MISMATCH" }, 409);
    }

    linkedAction = await loadCorrectiveAction(linkedActionId);
    if (!linkedAction) return json({ error: "CORRECTIVE_ACTION_NOT_FOUND" }, 404);

    const authError = authorizeSpecificAction(linkedAction);
    if (authError) return json({ error: authError }, 403);
  } else {
    // Legacy unlinked evidence retains the original report-level permission model.
    const authError = authorizeLegacyReportEvidence();
    if (authError) return json({ error: authError }, authError === "ACTION_PLAN_REQUIRED" ? 409 : 403);
  }

  const path = String(attachment.storage_path || "");
  if (!path.startsWith("corrective-evidence/")) {
    return json({ error: "NOT_CORRECTIVE_ACTION_EVIDENCE" }, 409);
  }

  const { error: storageError } = await service.storage
    .from("report-attachments")
    .remove([path]);

  if (storageError) {
    console.error("Evidence storage delete failed", storageError);
    return json(
      { error: "STORAGE_DELETE_FAILED", detail: storageError.message },
      502,
    );
  }

  const { error: metadataError } = await service
    .from("report_attachments")
    .delete()
    .eq("id", attachmentId)
    .eq("report_id", reportId);

  if (metadataError) {
    console.error("Evidence metadata delete failed", metadataError);
    return json(
      { error: "METADATA_DELETE_FAILED", detail: metadataError.message },
      500,
    );
  }

  const removedName = String(
    attachment.file_name || path.split("/").pop() || "Evidence file",
  );
  const actionLabel = linkedAction
    ? `Corrective Action #${linkedAction.action_number}`
    : "Corrective action";

  const { error: noteError } = await service.from("report_notes").insert({
    report_id: report.id,
    organization_id: report.organization_id,
    title: linkedAction
      ? `[System] ${actionLabel} evidence removed`
      : "[System] Corrective-action evidence removed",
    body: `Removed evidence file${
      linkedAction ? ` from ${actionLabel}` : ""
    }: ${removedName}`,
    author_email: caller.email || userData.user.email || null,
  });

  if (noteError) {
    console.error("Evidence removal audit note failed", noteError);
  }

  return json({
    ok: true,
    removed: true,
    attachmentId,
    fileName: removedName,
    correctiveActionId: linkedAction?.id || null,
    actionNumber: linkedAction?.action_number || null,
  });
});