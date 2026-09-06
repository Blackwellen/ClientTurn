-- Promotion preserves provenance and conversation history, with one row lock
-- preventing duplicate leads when two reviewers click at the same time.
create function public.promote_reviewed_prospect(p_business_id uuid,p_prospect_id uuid,p_user_id uuid)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.prospects; result_id uuid;
begin
 select * into p from public.prospects where id=p_prospect_id and business_id=p_business_id for update;
 if not found then raise exception 'Prospect not found'; end if;
 if p.promoted_to_lead_id is not null then return p.promoted_to_lead_id; end if;
 if p.outreach_eligibility='SUPPRESSED' or p.status='SUPPRESSED' then raise exception 'Suppressed prospects cannot be promoted'; end if;
 if p.replied_at is null then raise exception 'Record engagement before promoting a cold prospect'; end if;
 insert into public.leads(business_id,first_name,last_name,email,phone,status,agent_id,automation_active)
 values(p.business_id,p.first_name,p.last_name,p.email,p.phone_e164,'new',p.agent_id,false) returning id into result_id;
 update public.prospects set status='CONVERTED',promoted_to_lead_id=result_id,promoted_at=now(),approved_by=p_user_id,approved_at=now() where id=p.id;
 update public.conversations set lead_id=result_id where business_id=p.business_id and prospect_id=p.id;
 update public.messages set lead_id=result_id where business_id=p.business_id and prospect_id=p.id;
 return result_id;
end $$;
revoke all on function public.promote_reviewed_prospect(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.promote_reviewed_prospect(uuid,uuid,uuid) to service_role;
