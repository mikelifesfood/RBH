-- TeamWorkt Safety / RBH organization-scoped RPC hardening.
-- Applied live 2026-11-14 to RBH project; incremental patch, NOT fresh-install schema.
-- The source below is read from deployed functions, not reconstructed from memory.
-- Do not apply to uninitialized projects.
-- No credentials, tokens, user identifiers, or stored secret values are embedded.

-- rbh_acknowledge_notification
CREATE OR REPLACE FUNCTION public.rbh_acknowledge_notification(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_user uuid := auth.uid();
  v_rows integer := 0;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.rbh_current_user_active() then
    raise exception 'ACTIVE_PROFILE_REQUIRED';
  end if;

  update public.report_user_notifications n
     set acknowledged_at = coalesce(n.acknowledged_at, now()),
         acknowledged_by_user_id = coalesce(n.acknowledged_by_user_id, v_user)
   where n.id = p_notification_id
     and n.recipient_user_id = v_user
     and n.organization_id = public.rbh_current_organization_id()
     and n.resolved_at is null;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

-- rbh_add_action_evidence
CREATE OR REPLACE FUNCTION public.rbh_add_action_evidence(p_report_id text, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'storage'
AS $function$
DECLARE
 v_report_id uuid;
 v_org_id uuid;
 v_email text;
BEGIN
 IF NOT public.rbh_can_add_action_evidence(p_report_id) THEN
   RAISE EXCEPTION 'EVIDENCE_UPLOAD_NOT_AUTHORIZED';
 END IF;
 IF p_storage_path IS NULL
    OR split_part(p_storage_path,'/',1)<>'corrective-evidence'
    OR split_part(p_storage_path,'/',2)<>p_report_id
    OR length(split_part(p_storage_path,'/',3))=0
    OR length(coalesce(p_file_name,''))>255
    OR p_size_bytes IS NULL OR p_size_bytes<1 OR p_size_bytes>10485760
 THEN
   RAISE EXCEPTION 'INVALID_EVIDENCE_PATH';
 END IF;

 SELECT r.id,r.organization_id INTO v_report_id,v_org_id
 FROM public.reports r
 WHERE r.id::text=p_report_id
 AND r.organization_id=public.rbh_current_organization_id()
 LIMIT 1;
 IF NOT FOUND OR v_org_id IS NULL THEN
   RAISE EXCEPTION 'REPORT_ORGANIZATION_MISMATCH';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM storage.objects o
   WHERE o.bucket_id='report-attachments' AND o.name=p_storage_path
 ) THEN
   RAISE EXCEPTION 'UPLOADED_EVIDENCE_NOT_FOUND';
 END IF;
 IF EXISTS (SELECT 1 FROM public.report_attachments a WHERE a.storage_path=p_storage_path) THEN
   RAISE EXCEPTION 'EVIDENCE_ALREADY_REGISTERED';
 END IF;

 INSERT INTO public.report_attachments
 (report_id,organization_id,storage_path,file_name,mime_type,size_bytes)
 VALUES (v_report_id,v_org_id,p_storage_path,p_file_name,p_mime_type,p_size_bytes);

 v_email:=coalesce(auth.jwt()->>'email','system');
 INSERT INTO public.report_notes
 (report_id,organization_id,title,body,author_email)
 VALUES (v_report_id,v_org_id,'[System] Corrective action evidence uploaded',
         coalesce(nullif(p_file_name,''),'Evidence file'),v_email);
 RETURN jsonb_build_object('ok',true,'storage_path',p_storage_path);
END;
$function$;

-- rbh_can_add_action_evidence
CREATE OR REPLACE FUNCTION public.rbh_can_add_action_evidence(p_report_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
  select
    auth.uid() is not null
    and public.rbh_current_user_active()
    and exists (
      select 1
      from public.reports r
      where r.id::text = p_report_id
        and r.organization_id is not null
        and r.organization_id = public.rbh_current_organization_id()
        and coalesce(r.status, 'new') not in ('closed','no_action','duplicate')
        and coalesce(r.action_status, 'not_started') <> 'verified'
        and (
          public.rbh_current_app_role() in ('admin','safety_manager')
          or (
            public.rbh_current_app_role() = 'supervisor'
            and r.assigned_user_id = auth.uid()
          )
        )
    );
$function$;

-- rbh_mark_notification_viewed
CREATE OR REPLACE FUNCTION public.rbh_mark_notification_viewed(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_user uuid := auth.uid();
  v_rows integer := 0;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.rbh_current_user_active() then
    raise exception 'ACTIVE_PROFILE_REQUIRED';
  end if;

  update public.report_user_notifications n
     set viewed_at = coalesce(n.viewed_at, now())
   where n.id = p_notification_id
     and n.recipient_user_id = v_user
     and n.organization_id = public.rbh_current_organization_id();

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

-- rbh_restart_workflow
CREATE OR REPLACE FUNCTION public.rbh_restart_workflow(p_report_id uuid, p_reason_code text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
  v_report public.reports%rowtype;
  v_actor_role text;
  v_actor_active boolean;
  v_actor_email text;
  v_now timestamptz := now();
  v_prior_step integer;
  v_reason_label text;
  v_snapshot jsonb;
  v_child_total integer := 0;
  v_child_cycle_active integer := 0;
  v_child_open integer := 0;
  v_child_awaiting integer := 0;
  v_child_verified integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select p.app_role, coalesce(p.is_active, true), p.email
    into v_actor_role, v_actor_active, v_actor_email
  from public.profiles p
  where p.id = auth.uid();

  if not found or not v_actor_active or v_actor_role not in ('admin','safety_manager') then
    raise exception 'Only an Admin or Safety Manager can restart a workflow';
  end if;

  if p_reason_code not in (
      'incorrect_investigation','incorrect_action','wrong_assignment',
      'new_information','incorrect_data','other'
    ) then
    raise exception 'Choose a valid restart reason';
  end if;

  if nullif(btrim(coalesce(p_reason,'')), '') is null then
    raise exception 'A restart explanation is required';
  end if;

  select *
    into v_report
  from public.reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report not found';
  end if;

  if v_report.organization_id is null
     or v_report.organization_id is distinct from public.rbh_current_organization_id() then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if v_report.status in ('closed','no_action','duplicate') then
    raise exception 'Closed records cannot be restarted. Use a separate reopen process if reopening is later enabled.';
  end if;

  select
    count(*),
    count(*) filter (
      where a.activated_at is not null
        and a.activation_reopen_count = coalesce(v_report.reopen_count, 0)
    ),
    count(*) filter (
      where a.activated_at is not null
        and a.activation_reopen_count = coalesce(v_report.reopen_count, 0)
        and a.status in ('not_started','in_progress','changes_requested')
    ),
    count(*) filter (
      where a.activated_at is not null
        and a.activation_reopen_count = coalesce(v_report.reopen_count, 0)
        and a.status = 'awaiting_verification'
    ),
    count(*) filter (
      where a.activated_at is not null
        and a.activation_reopen_count = coalesce(v_report.reopen_count, 0)
        and a.status = 'verified'
    )
  into
    v_child_total,
    v_child_cycle_active,
    v_child_open,
    v_child_awaiting,
    v_child_verified
  from public.report_corrective_actions a
  where a.report_id = p_report_id
    and a.workflow_generation = coalesce(v_report.workflow_restart_count, 0)
    and a.retired_at is null;

  if v_child_total > 0 then
    v_prior_step := case
      when v_child_cycle_active = 0 then 3
      when v_child_open > 0 then 4
      when v_child_awaiting > 0 then 5
      when v_child_verified = v_child_total
           and v_child_cycle_active = v_child_total then 6
      else 4
    end;
  else
    v_prior_step := case
      when v_report.action_status = 'verified' then 6
      when v_report.action_status = 'awaiting_verification' then 5
      when v_report.action_status in ('in_progress','changes_requested')
           or v_report.action_completion_note is not null then 4
      when v_report.corrective_action is not null
           or v_report.assigned_user_id is not null
           or v_report.responsible_person is not null
           or v_report.due_date is not null
           or v_report.priority is not null then 3
      when v_report.root_cause is not null or v_report.status = 'under_review' then 2
      else 1
    end;
  end if;

  v_reason_label := case p_reason_code
    when 'incorrect_investigation' then 'Incorrect investigation path'
    when 'incorrect_action' then 'Incorrect corrective action'
    when 'wrong_assignment' then 'Wrong assignment'
    when 'new_information' then 'New information received'
    when 'incorrect_data' then 'Incorrect data entered'
    else 'Other'
  end;

  v_snapshot := jsonb_build_object(
    'captured_at', v_now,
    'prior_step', v_prior_step,
    'status', v_report.status,
    'action_status', v_report.action_status,
    'root_cause', v_report.root_cause,
    'corrective_action', v_report.corrective_action,
    'assigned_user_id', v_report.assigned_user_id,
    'responsible_person', v_report.responsible_person,
    'due_date', v_report.due_date,
    'priority', v_report.priority,
    'action_completion_note', v_report.action_completion_note,
    'action_completed_at', v_report.action_completed_at,
    'action_completed_by', v_report.action_completed_by,
    'action_verification_note', v_report.action_verification_note,
    'action_verified_at', v_report.action_verified_at,
    'action_verified_by', v_report.action_verified_by,
    'calosha_screening_status', v_report.calosha_screening_status,
    'calosha_awareness_at', v_report.calosha_awareness_at,
    'corrective_actions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'workflow_generation', a.workflow_generation,
          'action_number', a.action_number,
          'description', a.description,
          'control_type', a.control_type,
          'owner_user_id', a.owner_user_id,
          'due_date', a.due_date,
          'priority', a.priority,
          'status', a.status,
          'completion_note', a.completion_note,
          'completed_at', a.completed_at,
          'completed_by', a.completed_by,
          'verifier_user_id', a.verifier_user_id,
          'verification_note', a.verification_note,
          'verified_at', a.verified_at,
          'verified_by', a.verified_by,
          'activated_at', a.activated_at,
          'activation_reopen_count', a.activation_reopen_count,
          'retired_at', a.retired_at
        )
        order by a.action_number
      )
      from public.report_corrective_actions a
      where a.report_id = p_report_id
        and a.workflow_generation = coalesce(v_report.workflow_restart_count, 0)
    ), '[]'::jsonb),
    'corrective_action_evidence', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'corrective_action_id', a.corrective_action_id,
          'storage_path', a.storage_path,
          'file_name', a.file_name,
          'mime_type', a.mime_type,
          'size_bytes', a.size_bytes,
          'created_at', a.created_at
        ) order by a.created_at
      )
      from public.report_attachments a
      where a.report_id = p_report_id
        and a.storage_path like 'corrective-evidence/%'
    ), '[]'::jsonb)
  );

  insert into public.report_workflow_restarts (
    report_id, restarted_at, restarted_by, restarted_by_email,
    reason_code, reason, prior_step, prior_status, prior_action_status, snapshot
  ) values (
    p_report_id, v_now, auth.uid(), coalesce(v_actor_email, auth.jwt() ->> 'email'),
    p_reason_code, btrim(p_reason), v_prior_step, v_report.status, v_report.action_status, v_snapshot
  );

  -- System note is visible in Activity Timeline but hidden from normal Notes.
  insert into public.report_notes (report_id, organization_id, title, body, author_email)
  values (
    p_report_id,
    v_report.organization_id,
    '[System] Workflow restarted — ' || v_reason_label,
    'Reason: ' || btrim(p_reason) || E'\nPrevious workflow had reached Step ' || v_prior_step ||
      '. The original report, original attachments, regulatory screening/awareness time, notes, audit history, and prior corrective-action evidence were preserved.',
    coalesce(v_actor_email, auth.jwt() ->> 'email')
  );

  update public.reports
  set
    status = 'new',
    closed_at = null,
    root_cause = null,
    corrective_action = null,
    assigned_user_id = null,
    responsible_person = null,
    due_date = null,
    priority = null,
    action_status = 'not_started',
    action_completion_note = null,
    action_completed_at = null,
    action_completed_by = null,
    action_verification_note = null,
    action_verified_at = null,
    action_verified_by = null,
    workflow_restart_count = coalesce(workflow_restart_count,0) + 1,
    last_workflow_restart_at = v_now
  where id = p_report_id;

  return jsonb_build_object(
    'report_id', p_report_id,
    'restarted_at', v_now,
    'prior_step', v_prior_step,
    'restart_count', coalesce(v_report.workflow_restart_count,0) + 1,
    'regulatory_screening_preserved', true,
    'original_report_preserved', true
  );
end;
$function$;

-- rbh_submit_feedback
CREATE OR REPLACE FUNCTION public.rbh_submit_feedback(p_feedback_type text, p_subject text, p_message text, p_page_context text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
 v_uid uuid:=auth.uid();
 v_org uuid;
 v_type text:=lower(btrim(coalesce(p_feedback_type,'suggestion')));
 v_subject text:=nullif(btrim(p_subject),'');
 v_message text:=nullif(btrim(p_message),'');
 v_id uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
 SELECT coalesce(p.current_organization_id,p.organization_id)
 INTO v_org
 FROM public.profiles p
 WHERE p.id=v_uid AND p.is_active=true;
 IF v_org IS NULL THEN RAISE EXCEPTION 'ACTIVE_ORGANIZATION_REQUIRED'; END IF;
 IF v_type NOT IN ('suggestion','problem','question','other') THEN
   RAISE EXCEPTION 'INVALID_FEEDBACK_TYPE';
 END IF;
 IF v_subject IS NULL THEN RAISE EXCEPTION 'SUBJECT_REQUIRED'; END IF;
 IF v_message IS NULL THEN RAISE EXCEPTION 'MESSAGE_REQUIRED'; END IF;
 IF char_length(v_subject)>160 THEN RAISE EXCEPTION 'SUBJECT_TOO_LONG'; END IF;
 IF char_length(v_message)>4000 THEN RAISE EXCEPTION 'MESSAGE_TOO_LONG'; END IF;

 INSERT INTO public.app_feedback
 (organization_id,user_id,user_email,feedback_type,subject,message,page_context,app_version,status)
 VALUES
 (v_org,v_uid,
 coalesce(auth.jwt()->>'email',(select p.email from public.profiles p where p.id=v_uid)),
 v_type,v_subject,v_message,
 nullif(btrim(p_page_context),''),nullif(btrim(p_app_version),''),'new')
 RETURNING id INTO v_id;
 RETURN v_id;
END;
$function$;
