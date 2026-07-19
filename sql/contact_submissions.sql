-- Contact form submissions. Run in the Supabase SQL editor.
--
-- Replaces Formspree (js/main.js's form handler posted to a placeholder
-- form ID that was never replaced with a real one - the entire site's
-- lead-generation path, including every "Request This Item"/"Request a
-- Firearm" link that funnels into contact.html, silently/visibly failed
-- until this). POST /api/contact (src/api/contact.js) now writes here AND
-- sends a real email via Cloudflare Email Routing (see wrangler.jsonc's
-- send_email binding) - the row is a durable backup in case the email
-- ever bounces, gets buried in spam, or Email Routing has a bad day.

create table contact_submissions (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text not null,
  email       text not null,
  phone       text,
  subject     text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);

-- Same is_admin() pattern as orders/builds - this is customer contact
-- info, admin-only, not public/anon readable.
alter table contact_submissions enable row level security;

create policy "Admin read contact submissions"
  on contact_submissions for select
  to authenticated
  using (is_admin());
