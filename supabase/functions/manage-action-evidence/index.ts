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

import { createClient } from "npm:@supabase/supabase-js@2";

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
  if (!["upload", "remove"].includes(action)) return json({ error: "INVALID_ACTION" }, 400);
  if (correctiveActionId && !isUuid(correctiveActionId)) {
    return json({ error: "INVALID_CORRECTIVE_ACTION_ID" }, 400);
  }
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
      "id,ref_no,organization_id,assigned_user_id,corrective_action,action_status,action_completed_at,status,workflow_restart_count",
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
  };

  async function loadCorrectiveAction(id: string): Promise<CorrectiveActionRow | null> {
    if (!id) return null;

    const { data, error } = await service
      .from("report_corrective_actions")
      .select(
        "id,report_id,organization_id,workflow_generation,action_number,description,owner_user_id,status,activated_at,retired_at",
      )
      .eq("id", id)
      .eq("report_id", reportId)
      .maybeSingle();

    if (error || !data) return null;
    return data as CorrectiveActionRow;
  }

  function authorizeSpecificAction(row: CorrectiveActionRow) {
    if (!report || !caller) return "NOT_AUTHORIZED";
    if (String(row.organization_id || "") !== String(report.organization_id || "")) {
      return "ORGANIZATION_MISMATCH";
    }
    if (Number(row.workflow_generation || 0) !== Number(report.workflow_restart_count || 0)) {
      return "CORRECTIVE_ACTION_NOT_CURRENT_GENERATION";
    }
    if (row.retired_at) return "CORRECTIVE_ACTION_RETIRED";
    if (!row.activated_at) return "CORRECTIVE_ACTION_NOT_ACTIVATED";

    const assignedOwner =
      ["admin","safety_manager","supervisor"].includes(role) &&
      String(row.owner_user_id || "") === String(caller.id);

    if (!assignedOwner) return "NOT_AUTHORIZED";
    return "";
  }

  function authorizeLegacyReportEvidence() {
    if (!report || !caller) return "NOT_AUTHORIZED";
    const assignedOwner =
      ["admin","safety_manager","supervisor"].includes(role) &&
      String(report.assigned_user_id || "") === String(caller.id);

    if (!assignedOwner) return "NOT_AUTHORIZED";

    if (!String(report.corrective_action || "").trim() || !report.assigned_user_id) {
      return "ACTION_PLAN_REQUIRED";
    }

    return "";
  }

  if (action === "upload") {
    if (!files.length) return json({ error: "NO_FILES" }, 400);
    if (files.length > 5) return json({ error: "TOO_MANY_FILES" }, 400);

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

    const added: Array<{
      id: string;
      fileName: string;
      storagePath: string;
      correctiveActionId: string | null;
    }> = [];
    const failed: Array<{ fileName: string; error: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const path = correctiveAction
        ? `corrective-evidence/${report.id}/${correctiveAction.id}/${Date.now()}_${i}_${safeName(file.name)}`
        : `corrective-evidence/${report.id}/${Date.now()}_${i}_${safeName(file.name)}`;

      try {
        const { error: storageError } = await service.storage
          .from("report-attachments")
          .upload(path, file, {
            contentType: file.type || undefined,
            upsert: false,
          });

        if (storageError) throw storageError;

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

        const { data: attachment, error: metadataError } = await service
          .from("report_attachments")
          .insert(insertRow)
          .select("id,file_name,storage_path,corrective_action_id")
          .single();

        if (metadataError) {
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