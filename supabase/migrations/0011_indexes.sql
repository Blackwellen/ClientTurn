-- 0011_indexes: query indexes required by Bible §15.5
-- (Indexes that enforce correctness live alongside their tables.)

create index leads_business_created_idx
  on public.leads (business_id, created_at desc);

create index leads_business_status_created_idx
  on public.leads (business_id, status, created_at desc);

create index leads_business_assignee_idx
  on public.leads (business_id, assigned_user_id, status);

create index leads_attention_idx
  on public.leads (business_id, created_at desc)
  where needs_attention;

create index leads_phone_idx
  on public.leads (business_id, phone_normalized);

create index messages_conversation_idx
  on public.messages (business_id, conversation_id, created_at);

create index messages_due_idx
  on public.messages (scheduled_for)
  where status = 'QUEUED';

create index conversations_business_idx
  on public.conversations (business_id, last_message_at desc);
