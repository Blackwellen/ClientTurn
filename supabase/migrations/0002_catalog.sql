-- 0002_catalog: services and deterministic qualification configuration

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  average_value numeric(12,2),
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index services_business_idx on public.services (business_id, active, position);

create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- ------------------------------------------------ qualification_questions
create table public.qualification_questions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_id uuid references public.services(id) on delete cascade,
  question_text text not null,
  help_text text,
  response_type text not null
    check (response_type in ('text', 'yes_no', 'single_choice', 'number', 'postcode', 'timing')),
  required boolean not null default true,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index qualification_questions_business_idx
  on public.qualification_questions (business_id, active, position);

create trigger qualification_questions_set_updated_at
  before update on public.qualification_questions
  for each row execute function public.set_updated_at();

-- -------------------------------------------------- qualification_options
create table public.qualification_options (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  question_id uuid not null references public.qualification_questions(id) on delete cascade,
  label text not null,
  value text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index qualification_options_question_idx
  on public.qualification_options (question_id, position);

-- ---------------------------------------------------- qualification_rules
-- Deterministic only. operator + comparison_value produce an explicit result.
create table public.qualification_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  question_id uuid references public.qualification_questions(id) on delete cascade,
  rule_type text not null default 'answer'
    check (rule_type in ('answer', 'service_active', 'postcode_area')),
  operator text not null
    check (operator in ('equals', 'not_equals', 'in', 'not_in', 'gte', 'lte',
                        'prefix_in', 'prefix_not_in', 'is_present')),
  comparison_value jsonb not null default '[]'::jsonb,
  result text not null default 'pass'
    check (result in ('pass', 'hard_fail', 'review')),
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index qualification_rules_business_idx
  on public.qualification_rules (business_id, active, priority);

create trigger qualification_rules_set_updated_at
  before update on public.qualification_rules
  for each row execute function public.set_updated_at();
