CREATE OR REPLACE FUNCTION public.attempt_matchmaking(p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_candidate RECORD;
  v_room_id UUID;
  v_now TIMESTAMP WITH TIME ZONE := now();
  v_proposition_first BOOLEAN := random() < 0.5;
  v_updated_count INTEGER := 0;
BEGIN
  SELECT *
  INTO v_entry
  FROM public.match_queue_entries
  WHERE id = p_entry_id
    AND status = 'waiting'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matchFound', false, 'reason', 'entry_not_waiting');
  END IF;

  SELECT *
  INTO v_candidate
  FROM public.match_queue_entries
  WHERE status = 'waiting'
    AND id <> v_entry.id
    AND user_id <> v_entry.user_id
    AND format = v_entry.format
    AND mode = v_entry.mode
  ORDER BY abs(coalesce(elo, 1200) - coalesce(v_entry.elo, 1200)) ASC, joined_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matchFound', false, 'reason', 'no_candidate');
  END IF;

  INSERT INTO public.debate_rooms (
    format,
    mode,
    region,
    status,
    is_ai_opponent,
    topic,
    hvh_format,
    current_phase,
    started_at
  )
  VALUES (
    v_entry.format,
    v_entry.mode,
    'global',
    'reserved',
    false,
    coalesce(v_entry.topic, v_candidate.topic),
    'standard',
    'waiting',
    v_now
  )
  RETURNING id INTO v_room_id;

  INSERT INTO public.debate_participants (room_id, user_id, is_ai, role, speaking_order, connected_at)
  VALUES
    (
      v_room_id,
      v_entry.user_id,
      false,
      CASE WHEN v_proposition_first THEN 'proposition'::public.debate_role ELSE 'opposition'::public.debate_role END,
      CASE WHEN v_proposition_first THEN 1 ELSE 2 END,
      v_now
    ),
    (
      v_room_id,
      v_candidate.user_id,
      false,
      CASE WHEN v_proposition_first THEN 'opposition'::public.debate_role ELSE 'proposition'::public.debate_role END,
      CASE WHEN v_proposition_first THEN 2 ELSE 1 END,
      v_now
    );

  UPDATE public.match_queue_entries
  SET
    status = 'matched',
    matched_at = v_now,
    room_id = v_room_id,
    matched_with_user_id = v_candidate.user_id
  WHERE id = v_entry.id
    AND status = 'waiting';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('matchFound', false, 'reason', 'entry_race');
  END IF;

  UPDATE public.match_queue_entries
  SET
    status = 'matched',
    matched_at = v_now,
    room_id = v_room_id,
    matched_with_user_id = v_entry.user_id
  WHERE id = v_candidate.id
    AND status = 'waiting';

  RETURN jsonb_build_object('matchFound', true, 'roomId', v_room_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.attempt_matchmaking(UUID) TO authenticated;
