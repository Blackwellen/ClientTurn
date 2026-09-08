-- 0076_lead_notes_api_author: let a note record that the API wrote it.
--
-- `lead_notes.author_kind` enumerates the callers that can add a note, and it
-- was written before the public API existed. Adding `API` to the service
-- layer's caller kinds without extending it meant `lead.add_note` succeeded for
-- a person, Copilot, an agent and an MCP client, and failed with a constraint
-- violation for a customer's own software — surfacing as an unexplained
-- "that note could not be saved".
--
-- Found by the live end-to-end run rather than by review, which is the argument
-- for having one: a check constraint enumerating a union type in application
-- code will drift the moment the union gains a member, and nothing in
-- TypeScript can see it.
alter table public.lead_notes
  drop constraint if exists lead_notes_author_kind_check;

alter table public.lead_notes
  add constraint lead_notes_author_kind_check
  check (author_kind in ('UI','COPILOT','AGENT','MCP','API','SYSTEM'));
