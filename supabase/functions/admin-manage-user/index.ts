// RBH Safety - Admin User Management V1
//
// Secure Admin-only user lifecycle endpoint.
//
// Supported actions:
//   password_reset  -> sends a Supabase recovery email
//   set_role        -> changes RBH app_role
//   set_active      -> activates/deactivates RBH dashboard access
//   delete_access   -> soft-deletes Supabase Auth access while preserving
//                      the public.profiles row and RBH historical identity
//
// Required existing secrets:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//
// No Brevo secret is required. Password reset uses the project's configured
// Supabase Auth email delivery.
//
// Security:
//   - authenticated active Admin only
//   - same organization only
//   - cannot demote/deactivate/delete yourself
//   - cannot remove the last active Admin
//   - all successful actions are written to public.admin_user_events

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_ROLES = new Set([
  "admin",
  "safety_manager",
  "supervisor",
  "read_only",
]);

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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizedOrg(profile: any) {
  return profile?.current_organization_id || profile?.organization_id || null;
}

function safeName(profile: any) {
  return String(profile?.full_name || profile?.email || "RBH user");
}

function sameOriginRedirect(req: Request, raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return "";

  try {
    const target = new URL(value);
    if (!["http:", "https:"].includes(target.protocol)) return "";

    const requestOrigin = String(req.headers.get("origin") || "").trim();
    if (requestOrigin) {
      const origin = new URL(requestOrigin);
      if (target.origin !== origin.origin) return "";
    }

    return target.toString();
  } catch {
    return "";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authHeader)) {
    return json({ error: "AUTH_REQUIRED" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "SUPABASE_ENV_MISSING" }, 503);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const action = String(body?.action || "").trim().toLowerCase();
  const targetUserId = String(body?.targetUserId || "").trim();

  if (
    !["password_reset", "set_role", "set_active", "delete_access"].includes(
      action,
    )
  ) {
    return json({ error: "INVALID_ACTION" }, 400);
  }
  if (!isUuid(targetUserId)) {
    return json({ error: "INVALID_TARGET_USER_ID" }, 400);
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  const anon = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: userData, error: userError } = await anon.auth.getUser(token);
  if (userError || !userData?.user) {
    return json({ error: "INVALID_SESSION" }, 401);
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: caller, error: callerError } = await service
    .from("profiles")
    .select(
      "id,email,full_name,app_role,is_active,organization_id,current_organization_id,access_deleted_at",
    )
    .eq("id", userData.user.id)
    .maybeSingle();

  if (callerError || !caller || caller.is_active === false) {
    return json({ error: "ACTIVE_PROFILE_REQUIRED" }, 403);
  }
  if (caller.access_deleted_at) {
    return json({ error: "ADMIN_ACCESS_REMOVED" }, 403);
  }
  if (String(caller.app_role || "") !== "admin") {
    return json({ error: "ADMIN_REQUIRED" }, 403);
  }

  const callerOrgId = normalizedOrg(caller);
  if (!callerOrgId) {
    return json({ error: "ADMIN_ORGANIZATION_REQUIRED" }, 403);
  }

  const { data: target, error: targetError } = await service
    .from("profiles")
    .select(
      "id,email,full_name,app_role,is_active,organization_id,current_organization_id,access_deleted_at,access_deleted_by,access_deletion_reason,last_active",
    )
    .eq("id", targetUserId)
    .maybeSingle();

  if (targetError || !target) {
    return json({ error: "TARGET_PROFILE_NOT_FOUND" }, 404);
  }

  const targetOrgId = normalizedOrg(target);
  if (
    !targetOrgId ||
    String(targetOrgId) !== String(callerOrgId)
  ) {
    return json({ error: "ORGANIZATION_MISMATCH" }, 403);
  }

  const isSelf = String(caller.id) === String(target.id);

  async function countOtherActiveAdmins() {
    const { data, error } = await service
      .from("profiles")
      .select("id,app_role,is_active,access_deleted_at,organization_id,current_organization_id")
      .eq("app_role", "admin")
      .eq("is_active", true)
      .neq("id", target.id);

    if (error) throw error;

    return (data || []).filter((p: any) =>
      !p.access_deleted_at &&
      String(normalizedOrg(p) || "") === String(callerOrgId)
    ).length;
  }

  async function ensureNotLastAdmin() {
    if (
      String(target.app_role || "") === "admin" &&
      target.is_active !== false &&
      !target.access_deleted_at
    ) {
      const otherAdmins = await countOtherActiveAdmins();
      if (otherAdmins < 1) {
        throw new Error("LAST_ACTIVE_ADMIN_REQUIRED");
      }
    }
  }

  async function writeAudit(
    eventType: string,
    values: {
      oldRole?: string | null;
      newRole?: string | null;
      oldActive?: boolean | null;
      newActive?: boolean | null;
      detail?: Record<string, unknown>;
    } = {},
  ) {
    const { error } = await service.from("admin_user_events").insert({
      organization_id: callerOrgId,
      actor_user_id: caller.id,
      target_user_id: target.id,
      event_type: eventType,
      target_name_snapshot: safeName(target),
      target_email_snapshot: target.email || null,
      old_role:
        values.oldRole === undefined
          ? target.app_role || null
          : values.oldRole,
      new_role:
        values.newRole === undefined
          ? target.app_role || null
          : values.newRole,
      old_active:
        values.oldActive === undefined
          ? target.is_active !== false
          : values.oldActive,
      new_active:
        values.newActive === undefined
          ? target.is_active !== false
          : values.newActive,
      detail: values.detail || {},
    });

    if (error) {
      console.error("Admin audit insert failed", eventType, error);
      throw new Error("ADMIN_AUDIT_WRITE_FAILED");
    }
  }

  // -------------------------------------------------------------------------
  // PASSWORD RESET
  // -------------------------------------------------------------------------
  if (action === "password_reset") {
    if (target.access_deleted_at) {
      return json({ error: "USER_ACCESS_DELETED" }, 409);
    }
    if (target.is_active === false) {
      return json({ error: "USER_INACTIVE" }, 409);
    }

    const email = String(target.email || "").trim().toLowerCase();
    if (!email) {
      return json({ error: "TARGET_EMAIL_REQUIRED" }, 409);
    }

    const redirectTo = sameOriginRedirect(req, body?.redirectTo);
    if (!redirectTo) {
      return json({ error: "INVALID_RESET_REDIRECT" }, 400);
    }

    const { error: resetError } = await anon.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (resetError) {
      console.error("Password reset failed", resetError);
      return json(
        {
          error: "PASSWORD_RESET_SEND_FAILED",
          detail: resetError.message,
        },
        502,
      );
    }

    try {
      await writeAudit("password_reset_sent", {
        detail: {
          redirect_to: redirectTo,
        },
      });
    } catch (err) {
      return json({
        ok: true,
        sent: true,
        auditWarning:
          err instanceof Error ? err.message : String(err),
      });
    }

    return json({
      ok: true,
      sent: true,
      targetUserId: target.id,
      email,
    });
  }

  // -------------------------------------------------------------------------
  // SET ROLE
  // -------------------------------------------------------------------------
  if (action === "set_role") {
    const nextRole = String(body?.role || "").trim().toLowerCase();

    if (!ALLOWED_ROLES.has(nextRole)) {
      return json({ error: "INVALID_ROLE" }, 400);
    }
    if (target.access_deleted_at) {
      return json({ error: "USER_ACCESS_DELETED" }, 409);
    }
    if (isSelf && nextRole !== String(target.app_role || "")) {
      return json({ error: "CANNOT_CHANGE_OWN_ROLE" }, 409);
    }

    const oldRole = String(target.app_role || "read_only");
    if (nextRole === oldRole) {
      return json({
        ok: true,
        changed: false,
        targetUserId: target.id,
        role: oldRole,
      });
    }

    if (oldRole === "admin" && nextRole !== "admin") {
      try {
        await ensureNotLastAdmin();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "LAST_ACTIVE_ADMIN_REQUIRED") {
          return json({ error: msg }, 409);
        }
        return json({ error: "ADMIN_COUNT_CHECK_FAILED", detail: msg }, 503);
      }
    }

    const { error: updateError } = await service
      .from("profiles")
      .update({ app_role: nextRole })
      .eq("id", target.id);

    if (updateError) {
      return json(
        { error: "ROLE_UPDATE_FAILED", detail: updateError.message },
        500,
      );
    }

    try {
      await writeAudit("role_changed", {
        oldRole,
        newRole: nextRole,
      });
    } catch (err) {
      return json({
        ok: true,
        changed: true,
        targetUserId: target.id,
        role: nextRole,
        auditWarning:
          err instanceof Error ? err.message : String(err),
      });
    }

    return json({
      ok: true,
      changed: true,
      targetUserId: target.id,
      role: nextRole,
    });
  }

  // -------------------------------------------------------------------------
  // ACTIVATE / DEACTIVATE
  // -------------------------------------------------------------------------
  if (action === "set_active") {
    const nextActive = body?.active === true;

    if (target.access_deleted_at) {
      return json({ error: "USER_ACCESS_DELETED" }, 409);
    }
    if (isSelf && !nextActive) {
      return json({ error: "CANNOT_DEACTIVATE_SELF" }, 409);
    }

    const oldActive = target.is_active !== false;
    if (nextActive === oldActive) {
      return json({
        ok: true,
        changed: false,
        targetUserId: target.id,
        active: oldActive,
      });
    }

    if (!nextActive && String(target.app_role || "") === "admin") {
      try {
        await ensureNotLastAdmin();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "LAST_ACTIVE_ADMIN_REQUIRED") {
          return json({ error: msg }, 409);
        }
        return json({ error: "ADMIN_COUNT_CHECK_FAILED", detail: msg }, 503);
      }
    }

    const { error: updateError } = await service
      .from("profiles")
      .update({ is_active: nextActive })
      .eq("id", target.id);

    if (updateError) {
      return json(
        {
          error: nextActive
            ? "ACTIVATION_FAILED"
            : "DEACTIVATION_FAILED",
          detail: updateError.message,
        },
        500,
      );
    }

    try {
      await writeAudit(nextActive ? "activated" : "deactivated", {
        oldActive,
        newActive: nextActive,
      });
    } catch (err) {
      return json({
        ok: true,
        changed: true,
        targetUserId: target.id,
        active: nextActive,
        auditWarning:
          err instanceof Error ? err.message : String(err),
      });
    }

    return json({
      ok: true,
      changed: true,
      targetUserId: target.id,
      active: nextActive,
    });
  }

  // -------------------------------------------------------------------------
  // DELETE LOGIN ACCESS, PRESERVE RBH HISTORY
  // -------------------------------------------------------------------------
  if (action === "delete_access") {
    if (target.access_deleted_at) {
      return json({
        ok: true,
        changed: false,
        alreadyDeleted: true,
        targetUserId: target.id,
      });
    }
    if (isSelf) {
      return json({ error: "CANNOT_DELETE_SELF" }, 409);
    }

    if (String(target.app_role || "") === "admin") {
      try {
        await ensureNotLastAdmin();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "LAST_ACTIVE_ADMIN_REQUIRED") {
          return json({ error: msg }, 409);
        }
        return json({ error: "ADMIN_COUNT_CHECK_FAILED", detail: msg }, 503);
      }
    }

    const reason = String(body?.reason || "").trim().slice(0, 500);
    const removedAt = new Date().toISOString();
    const priorActive = target.is_active !== false;

    // Mark the retained RBH identity first. If Auth removal fails, roll this
    // change back so the Admin page never claims an account was removed when
    // it was not.
    const { error: profileMarkError } = await service
      .from("profiles")
      .update({
        is_active: false,
        access_deleted_at: removedAt,
        access_deleted_by: caller.id,
        access_deletion_reason: reason || null,
      })
      .eq("id", target.id);

    if (profileMarkError) {
      return json(
        {
          error: "PROFILE_DELETE_MARK_FAILED",
          detail: profileMarkError.message,
        },
        500,
      );
    }

    const { error: deleteError } = await service.auth.admin.deleteUser(
      target.id,
      true, // soft delete: disables Auth access while retaining Auth data
    );

    if (deleteError) {
      console.error("Auth soft-delete failed", deleteError);

      const { error: rollbackError } = await service
        .from("profiles")
        .update({
          is_active: priorActive,
          access_deleted_at: null,
          access_deleted_by: null,
          access_deletion_reason: null,
        })
        .eq("id", target.id);

      if (rollbackError) {
        console.error("Profile rollback failed", rollbackError);
      }

      return json(
        {
          error: "AUTH_DELETE_FAILED",
          detail: deleteError.message,
          rollbackFailed: !!rollbackError,
        },
        502,
      );
    }

    try {
      await writeAudit("user_access_deleted", {
        oldActive: priorActive,
        newActive: false,
        detail: {
          reason: reason || null,
          auth_delete_mode: "soft",
          history_retained: true,
        },
      });
    } catch (err) {
      return json({
        ok: true,
        changed: true,
        deleted: true,
        historyRetained: true,
        targetUserId: target.id,
        auditWarning:
          err instanceof Error ? err.message : String(err),
      });
    }

    return json({
      ok: true,
      changed: true,
      deleted: true,
      historyRetained: true,
      targetUserId: target.id,
    });
  }

  return json({ error: "UNHANDLED_ACTION" }, 500);
});
