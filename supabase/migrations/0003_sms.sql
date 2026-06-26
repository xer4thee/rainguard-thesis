-- RainGuard — SMS notifications: registered PH mobile numbers + opt-in.
-- Adds the contact column the Alerts feature needs and a safe self-service RPC so a
-- user can set their OWN number without being able to change their role/status.
-- Apply via MCP apply_migration or the Supabase dashboard SQL Editor.

-- ============ COLUMNS ============
alter table public.profiles add column if not exists phone       text;
alter table public.profiles add column if not exists sms_opt_in  boolean not null default true;

-- Stored numbers are normalised to E.164 PH mobile form (+639XXXXXXXXX).
do $$ begin
  alter table public.profiles
    add constraint profiles_phone_ph_format
    check (phone is null or phone ~ '^\+639[0-9]{9}$');
exception when duplicate_object then null; end $$;

-- ============ PH PHONE NORMALISER ============
-- Accepts 09XXXXXXXXX / 639XXXXXXXXX / 9XXXXXXXXX (any spacing/dashes) and returns
-- +639XXXXXXXXX, or NULL when the input isn't a valid PH mobile number.
create or replace function public.normalize_ph_phone(raw text)
returns text language plpgsql immutable as $$
declare d text;
begin
  if raw is null or btrim(raw) = '' then return null; end if;
  d := regexp_replace(raw, '[^0-9]', '', 'g');               -- digits only
  if    length(d) = 11 and left(d, 2) = '09'  then d := '63' || substr(d, 2);
  elsif length(d) = 12 and left(d, 3) = '639' then d := d;
  elsif length(d) = 10 and left(d, 1) = '9'   then d := '63' || d;
  else  return null;
  end if;
  if d ~ '^639[0-9]{9}$' then return '+' || d; else return null; end if;
end; $$;

-- ============ SIGNUP TRIGGER (now also stores phone) ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, email, role, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'user'),
    public.normalize_ph_phone(new.raw_user_meta_data->>'phone')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- ============ SELF-SERVICE CONTACT UPDATE ============
-- SECURITY DEFINER so a user can update only their own phone + sms_opt_in. It never
-- touches role/status, so there's no privilege-escalation surface (unlike a blanket
-- "update own profile" RLS policy, which couldn't restrict columns).
create or replace function public.update_my_contact(p_phone text, p_sms_opt_in boolean)
returns text language plpgsql security definer set search_path = public as $$
declare normalised text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  normalised := public.normalize_ph_phone(p_phone);
  if p_phone is not null and btrim(p_phone) <> '' and normalised is null then
    raise exception 'invalid PH mobile number (use 09XXXXXXXXX)';
  end if;
  update public.profiles
     set phone      = normalised,
         sms_opt_in = coalesce(p_sms_opt_in, true)
   where id = auth.uid();
  return normalised;
end; $$;

grant execute on function public.update_my_contact(text, boolean) to authenticated;
grant execute on function public.normalize_ph_phone(text)        to authenticated;
