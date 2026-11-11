-- Preserve existing reservations. Owners receive only a status flag, never guest identities.
alter table public.items add column if not exists reserved boolean not null default false;
alter table public.reservations add column if not exists receipt_key uuid not null default gen_random_uuid();
create unique index if not exists reservations_receipt_key_idx on public.reservations(receipt_key);

create or replace function public.enforce_item_reservation_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.reserved := exists(select 1 from public.reservations r where r.item_id = new.id);
  return new;
end;
$$;
revoke all on function public.enforce_item_reservation_flag() from public, anon, authenticated;
drop trigger if exists enforce_item_reservation_flag on public.items;
create trigger enforce_item_reservation_flag before insert or update on public.items
for each row execute function public.enforce_item_reservation_flag();

create or replace function public.refresh_item_reservation_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if tg_op = 'DELETE' then target := old.item_id; else target := new.item_id; end if;
  update public.items set reserved = exists(select 1 from public.reservations r where r.item_id = target) where id = target;
  return null;
end;
$$;
revoke all on function public.refresh_item_reservation_flag() from public, anon, authenticated;
drop trigger if exists refresh_item_reservation_flag on public.reservations;
create trigger refresh_item_reservation_flag after insert or delete on public.reservations
for each row execute function public.refresh_item_reservation_flag();
update public.items i set reserved = exists(select 1 from public.reservations r where r.item_id = i.id);

create or replace function public.get_shared_list(p_slug text, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.lists;
begin
  select * into l from public.lists where share_slug = p_slug;
  if not found then return null; end if;
  return jsonb_build_object('name', l.name, 'emoji', l.emoji, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.name, 'price', i.price, 'url', i.url,
      'image_url', i.image_url, 'note', i.note, 'fulfilled', i.fulfilled,
      'reserved', r.item_id is not null,
      'reserved_by', null,
      'mine', coalesce(r.guest_token = p_token, false)
    ) order by i.created_at desc)
    from public.items i left join public.reservations r on r.item_id = i.id
    where i.list_id = l.id), '[]'::jsonb));
end;
$$;
revoke all on function public.get_shared_list(text, uuid) from public;
grant execute on function public.get_shared_list(text, uuid) to anon, authenticated;

create or replace function public.reserve_item(p_item uuid, p_name text, p_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare taken_by uuid;
begin
  if p_token is null then raise exception 'A browser reservation token is required'; end if;
  -- Serialize against fulfillment and concurrent reservations for this item.
  perform 1 from public.items where id = p_item and not fulfilled for update;
  if not found then raise exception 'Item not available'; end if;
  insert into public.reservations(item_id, guest_name, guest_token)
    values(p_item, left(coalesce(nullif(trim(p_name), ''), 'Guest'), 40), p_token)
    on conflict (item_id) do nothing;
  select guest_token into taken_by from public.reservations where item_id = p_item;
  if taken_by is distinct from p_token then raise exception 'Already reserved'; end if;
  -- Retrying the same successful request is safe and preserves the first reservation.
end;
$$;
revoke all on function public.reserve_item(uuid, text, uuid) from public;
grant execute on function public.reserve_item(uuid, text, uuid) to anon, authenticated;

create or replace function public.cancel_reservation(p_item uuid, p_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null then raise exception 'A browser reservation token is required'; end if;
  perform 1 from public.items where id = p_item for update;
  delete from public.reservations where item_id = p_item and guest_token = p_token;
  if not found and exists(select 1 from public.reservations where item_id = p_item) then
    raise exception 'This reservation belongs to another guest' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.cancel_reservation(uuid, uuid) from public;
grant execute on function public.cancel_reservation(uuid, uuid) to anon, authenticated;

-- A receipt key grants access to exactly one reservation. Never return guest_token or guest_name.
-- The key goes into a URL fragment, which is not sent in HTTP URLs or Referer headers.
create or replace function public.get_reservation_receipt(p_item uuid, p_token uuid default null, p_key uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('item_id', i.id, 'name', i.name, 'price', i.price,
    'url', i.url, 'fulfilled', i.fulfilled, 'list_name', l.name,
    'share_slug', l.share_slug, 'receipt_key', r.receipt_key)
  from public.reservations r join public.items i on i.id = r.item_id
    join public.lists l on l.id = i.list_id
  where r.item_id = p_item and (r.guest_token = p_token or r.receipt_key = p_key);
$$;
revoke all on function public.get_reservation_receipt(uuid, uuid, uuid) from public;
grant execute on function public.get_reservation_receipt(uuid, uuid, uuid) to anon, authenticated;

create or replace function public.cancel_reservation_receipt(p_item uuid, p_key uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_key is null then raise exception 'A reservation receipt is required'; end if;
  perform 1 from public.items where id = p_item for update;
  delete from public.reservations where item_id = p_item and receipt_key = p_key;
  if not found and exists(select 1 from public.reservations where item_id = p_item) then
    raise exception 'Invalid reservation receipt' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.cancel_reservation_receipt(uuid, uuid) from public;
grant execute on function public.cancel_reservation_receipt(uuid, uuid) to anon, authenticated;
