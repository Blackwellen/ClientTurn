-- 0082_private_reply_due_work: let the sweep find workspaces that have
-- commenters waiting, not only ones with a connection state machine running.
--
-- `social_businesses_with_due_work` (0072) answers "which workspaces have a
-- `social_connection_states` row due". That was the whole of social outreach
-- when it was written. It is not any more: 0081 added private replies, which
-- have no connection state at all — there is no invitation and no acceptance,
-- so no row is ever created in that table for a commenter.
--
-- The consequence was silent and total. A workspace whose entire Meta strategy
-- is "answer the people who comment on our ads" — which is the commonest one,
-- and the one the product is best at — would have had due work forever and been
-- swept never, because the only query that fans out jobs could not see it.
--
-- The seven-day window makes this worse than an ordinary scheduling gap: the
-- work does not merely wait, it expires.

create or replace function public.social_businesses_with_due_work(
  p_limit integer default 200
)
returns table (business_id uuid, due_count integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with connection_work as (
    select s.business_id, count(*)::int as due_count
      from public.social_connection_states s
     where s.next_action_at is not null
       and s.next_action_at <= now()
       and s.parked_reason is null
       and s.state not in ('DECLINED','BLOCKED')
     group by s.business_id
  ),
  -- Commenters we may still answer. The predicate mirrors
  -- `dueForPrivateReply` exactly, including the seven-day window measured from
  -- the comment's own timestamp: a workspace whose commenters have all expired
  -- has nothing due and must not have a job queued for it every five minutes
  -- for ever.
  private_reply_work as (
    select p.business_id, count(*)::int as due_count
      from public.prospects p
     where p.social_platform in ('FACEBOOK','INSTAGRAM')
       and p.social_comment_id is not null
       and p.private_reply_sent_at is null
       and p.outreach_eligibility = 'ELIGIBLE'
       and p.social_commented_at > now() - interval '7 days'
     group by p.business_id
  )
  select
    coalesce(c.business_id, r.business_id) as business_id,
    (coalesce(c.due_count, 0) + coalesce(r.due_count, 0))::int as due_count
    from connection_work c
    full outer join private_reply_work r on r.business_id = c.business_id
   order by 2 desc
   limit p_limit;
$fn$;

-- Unchanged from 0072: the sweeper runs as the service role, and a member has
-- no business enumerating other workspaces' due counts.
revoke all on function public.social_businesses_with_due_work(integer)
  from public, anon, authenticated;
