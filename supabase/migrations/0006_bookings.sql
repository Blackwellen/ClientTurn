-- 0006_bookings

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  provider text not null default 'manual'
    check (provider in ('calendly', 'google_calendar', 'manual')),
  external_event_id text,
  booking_url text,
  reschedule_url text,
  cancel_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  assigned_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index bookings_external_event_idx
  on public.bookings (provider, external_event_id)
  where external_event_id is not null;

create index bookings_business_starts_idx on public.bookings (business_id, starts_at);
create index bookings_lead_idx on public.bookings (lead_id);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();
