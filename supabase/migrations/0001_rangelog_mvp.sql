-- RangeLog MVP schema. Every table is owned by auth.uid(); service-role access is server-only.
create extension if not exists pgcrypto;

-- players: 토너먼트를 넘어 재사용되는 전역 관측 대상.
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  nickname text,
  avatar text,
  description text,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  first_observed_tournament_id uuid
);

-- tournaments: 실제 참가한 한 번의 이벤트.
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  default_seat_count integer not null check (default_seat_count between 2 and 10),
  status text not null default 'active' check (status in ('active', 'completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- table_sessions: 한 토너먼트에서 같은 테이블에 연속 체류한 구간.
create table if not exists public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  seat_count integer not null check (seat_count between 2 and 10),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

-- seat_assignments: 물리 좌석 번호와 Player의 착석 이력.
create table if not exists public.seat_assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  table_session_id uuid not null references public.table_sessions(id) on delete cascade,
  seat_no integer not null,
  player_id uuid references public.players(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (table_session_id, seat_no, started_at)
);

-- hands: draft/completed를 공통 보관하고 revision으로 조건부 갱신한다.
create table if not exists public.hands (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  table_session_id uuid not null references public.table_sessions(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  draft_kind text not null default 'new' check (draft_kind in ('new', 'edit')),
  original_hand_id uuid references public.hands(id) on delete set null,
  button_seat integer not null,
  current_street text not null default 'preflop',
  action_complete boolean not null default false,
  blind_snapshot jsonb not null,
  board jsonb not null default '{"flop":[null,null,null],"turn":[null],"river":[null]}'::jsonb,
  pot_checkpoints jsonb not null default '[]'::jsonb,
  revision bigint not null default 0,
  mutation_id uuid,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- hand_participants: 핸드 시작 시점의 플레이어·좌석·홀카드 스냅샷.
create table if not exists public.hand_participants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  hand_id uuid not null references public.hands(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  seat_no integer not null,
  position text not null,
  hole_cards jsonb not null default '[null,null]'::jsonb
);

-- hand_actions: 시간순 관측 행동. inferred=true는 생략 행동의 상태 기반 추론.
create table if not exists public.hand_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  hand_id uuid not null references public.hands(id) on delete cascade,
  participant_id uuid not null references public.hand_participants(id) on delete cascade,
  street text not null check (street in ('preflop', 'flop', 'turn', 'river')),
  kind text not null check (kind in ('fold', 'check', 'call', 'bet', 'raise')),
  is_all_in boolean not null default false,
  inferred boolean not null default false,
  sequence integer not null,
  percentage numeric,
  amount_bb numeric,
  amount_source text check (amount_source in ('percentage', 'bb', 'unknown')),
  created_at timestamptz not null default now(),
  unique (hand_id, sequence)
);

create index if not exists hands_owner_updated_idx on public.hands(owner_id, updated_at desc);
create index if not exists hands_owner_status_idx on public.hands(owner_id, status);
create index if not exists actions_hand_sequence_idx on public.hand_actions(hand_id, sequence);

alter table public.players enable row level security;
alter table public.tournaments enable row level security;
alter table public.table_sessions enable row level security;
alter table public.seat_assignments enable row level security;
alter table public.hands enable row level security;
alter table public.hand_participants enable row level security;
alter table public.hand_actions enable row level security;

-- RLS 정책: 모든 CRUD에서 auth.uid()와 행 소유자(owner_id)를 일치시킨다.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['players','tournaments','table_sessions','seat_assignments','hands','hand_participants','hand_actions'] loop
    execute format('drop policy if exists owner_select on public.%I', table_name);
    execute format('drop policy if exists owner_insert on public.%I', table_name);
    execute format('drop policy if exists owner_update on public.%I', table_name);
    execute format('drop policy if exists owner_delete on public.%I', table_name);
    execute format('create policy owner_select on public.%I for select using (owner_id = auth.uid())', table_name);
    execute format('create policy owner_insert on public.%I for insert with check (owner_id = auth.uid())', table_name);
    execute format('create policy owner_update on public.%I for update using (owner_id = auth.uid()) with check (owner_id = auth.uid())', table_name);
    execute format('create policy owner_delete on public.%I for delete using (owner_id = auth.uid())', table_name);
  end loop;
end $$;

-- 참조 무결성 RLS: 자식 행의 owner_id만 바꾸어 다른 계정의 핸드에 연결할 수 없게 한다.
drop policy if exists owner_insert on public.table_sessions;
drop policy if exists owner_update on public.table_sessions;
create policy owner_insert on public.table_sessions for insert with check (
  owner_id = auth.uid() and exists (select 1 from public.tournaments t where t.id = tournament_id and t.owner_id = auth.uid())
);
create policy owner_update on public.table_sessions for update using (
  owner_id = auth.uid() and exists (select 1 from public.tournaments t where t.id = tournament_id and t.owner_id = auth.uid())
) with check (
  owner_id = auth.uid() and exists (select 1 from public.tournaments t where t.id = tournament_id and t.owner_id = auth.uid())
);

drop policy if exists owner_insert on public.seat_assignments;
drop policy if exists owner_update on public.seat_assignments;
create policy owner_insert on public.seat_assignments for insert with check (
  owner_id = auth.uid() and exists (select 1 from public.table_sessions s where s.id = table_session_id and s.owner_id = auth.uid())
);
create policy owner_update on public.seat_assignments for update using (
  owner_id = auth.uid() and exists (select 1 from public.table_sessions s where s.id = table_session_id and s.owner_id = auth.uid())
) with check (
  owner_id = auth.uid() and exists (select 1 from public.table_sessions s where s.id = table_session_id and s.owner_id = auth.uid())
);

drop policy if exists owner_insert on public.hands;
drop policy if exists owner_update on public.hands;
create policy owner_insert on public.hands for insert with check (
  owner_id = auth.uid()
  and exists (select 1 from public.tournaments t where t.id = tournament_id and t.owner_id = auth.uid())
  and exists (select 1 from public.table_sessions s where s.id = table_session_id and s.owner_id = auth.uid())
);
create policy owner_update on public.hands for update using (
  owner_id = auth.uid()
  and exists (select 1 from public.tournaments t where t.id = tournament_id and t.owner_id = auth.uid())
  and exists (select 1 from public.table_sessions s where s.id = table_session_id and s.owner_id = auth.uid())
) with check (
  owner_id = auth.uid()
  and exists (select 1 from public.tournaments t where t.id = tournament_id and t.owner_id = auth.uid())
  and exists (select 1 from public.table_sessions s where s.id = table_session_id and s.owner_id = auth.uid())
);

drop policy if exists owner_insert on public.hand_participants;
drop policy if exists owner_update on public.hand_participants;
create policy owner_insert on public.hand_participants for insert with check (
  owner_id = auth.uid()
  and exists (select 1 from public.hands h where h.id = hand_id and h.owner_id = auth.uid())
  and exists (select 1 from public.players p where p.id = player_id and p.owner_id = auth.uid())
);
create policy owner_update on public.hand_participants for update using (
  owner_id = auth.uid() and exists (select 1 from public.hands h where h.id = hand_id and h.owner_id = auth.uid())
) with check (
  owner_id = auth.uid()
  and exists (select 1 from public.hands h where h.id = hand_id and h.owner_id = auth.uid())
  and exists (select 1 from public.players p where p.id = player_id and p.owner_id = auth.uid())
);

drop policy if exists owner_insert on public.hand_actions;
drop policy if exists owner_update on public.hand_actions;
create policy owner_insert on public.hand_actions for insert with check (
  owner_id = auth.uid()
  and exists (select 1 from public.hands h where h.id = hand_id and h.owner_id = auth.uid())
  and exists (select 1 from public.hand_participants p where p.id = participant_id and p.hand_id = hand_id and p.owner_id = auth.uid())
);
create policy owner_update on public.hand_actions for update using (
  owner_id = auth.uid() and exists (select 1 from public.hands h where h.id = hand_id and h.owner_id = auth.uid())
) with check (
  owner_id = auth.uid()
  and exists (select 1 from public.hands h where h.id = hand_id and h.owner_id = auth.uid())
  and exists (select 1 from public.hand_participants p where p.id = participant_id and p.hand_id = hand_id and p.owner_id = auth.uid())
);

-- 핸드 스냅샷 RPC: 소유권·revision·자식 액션 교체를 하나의 트랜잭션으로 처리한다.
create or replace function public.sync_hand_snapshot(
  p_hand jsonb,
  p_expected_revision bigint,
  p_mutation_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hand_id uuid := (p_hand->>'id')::uuid;
  v_existing public.hands%rowtype;
  v_revision bigint := coalesce((p_hand->>'revision')::bigint, 0);
  v_participant jsonb;
  v_action jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_existing from public.hands
    where id = v_hand_id and owner_id = auth.uid()
    for update;

  if found and v_existing.mutation_id = p_mutation_id then
    return jsonb_build_object('hand_id', v_hand_id, 'revision', v_existing.revision, 'idempotent', true);
  end if;
  if found and v_existing.revision <> p_expected_revision then
    raise exception 'REVISION_CONFLICT';
  end if;
  if (p_hand->>'status') = 'completed' and coalesce((p_hand->>'actionComplete')::boolean, false) = false then
    raise exception 'COMPLETED_HAND_NOT_FINISHED';
  end if;

  if found then
    update public.hands set
      tournament_id = (p_hand->>'tournamentId')::uuid,
      table_session_id = (p_hand->>'tableSessionId')::uuid,
      status = p_hand->>'status',
      draft_kind = p_hand->>'draftKind',
      original_hand_id = nullif(p_hand->>'originalHandId', '')::uuid,
      button_seat = (p_hand->>'buttonSeat')::integer,
      current_street = p_hand->>'currentStreet',
      action_complete = coalesce((p_hand->>'actionComplete')::boolean, false),
      blind_snapshot = p_hand->'blindSnapshot',
      board = p_hand->'board',
      pot_checkpoints = coalesce(p_hand->'potCheckpoints', '[]'::jsonb),
      revision = v_revision,
      mutation_id = p_mutation_id,
      updated_at = coalesce((p_hand->>'updatedAt')::timestamptz, now())
    where id = v_hand_id and owner_id = auth.uid();
  else
    insert into public.hands (
      id, owner_id, tournament_id, table_session_id, status, draft_kind, original_hand_id,
      button_seat, current_street, action_complete, blind_snapshot, board, pot_checkpoints,
      revision, mutation_id, started_at, updated_at
    ) values (
      v_hand_id, auth.uid(), (p_hand->>'tournamentId')::uuid, (p_hand->>'tableSessionId')::uuid,
      p_hand->>'status', p_hand->>'draftKind', nullif(p_hand->>'originalHandId', '')::uuid,
      (p_hand->>'buttonSeat')::integer, p_hand->>'currentStreet', coalesce((p_hand->>'actionComplete')::boolean, false),
      p_hand->'blindSnapshot', p_hand->'board', coalesce(p_hand->'potCheckpoints', '[]'::jsonb),
      v_revision, p_mutation_id, coalesce((p_hand->>'startedAt')::timestamptz, now()), coalesce((p_hand->>'updatedAt')::timestamptz, now())
    );
  end if;

  delete from public.hand_actions where hand_id = v_hand_id and owner_id = auth.uid();
  delete from public.hand_participants where hand_id = v_hand_id and owner_id = auth.uid();

  for v_participant in select * from jsonb_array_elements(coalesce(p_hand->'participants', '[]'::jsonb)) loop
    insert into public.hand_participants (id, owner_id, hand_id, player_id, seat_no, position, hole_cards)
    values (
      (v_participant->>'id')::uuid, auth.uid(), v_hand_id, (v_participant->>'playerId')::uuid,
      (v_participant->>'seatNo')::integer, v_participant->>'position', coalesce(v_participant->'holeCards', '[null,null]'::jsonb)
    );
  end loop;

  for v_action in select * from jsonb_array_elements(coalesce(p_hand->'actions', '[]'::jsonb)) loop
    insert into public.hand_actions (
      id, owner_id, hand_id, participant_id, street, kind, is_all_in, inferred, sequence,
      percentage, amount_bb, amount_source, created_at
    ) values (
      (v_action->>'id')::uuid, auth.uid(), v_hand_id, (v_action->>'participantId')::uuid,
      v_action->>'street', v_action->>'kind', coalesce((v_action->>'isAllIn')::boolean, false),
      coalesce((v_action->>'inferred')::boolean, false), (v_action->>'sequence')::integer,
      (v_action->>'percentage')::numeric, (v_action->>'amountBB')::numeric, v_action->>'amountSource',
      coalesce((v_action->>'createdAt')::timestamptz, now())
    );
  end loop;

  return jsonb_build_object('hand_id', v_hand_id, 'revision', v_revision, 'idempotent', false);
end;
$$;

-- 완료/편집 원자성은 다음 RPC 경계에서 소유권·revision·mutation_id를 함께 검증한다.
-- MVP 클라이언트는 현재 이 SQL 스키마와 동일한 Hand 스냅샷을 IndexedDB에 먼저 보관한다.
