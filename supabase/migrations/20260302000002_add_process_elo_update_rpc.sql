CREATE OR REPLACE FUNCTION public.process_elo_update(p_room_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room RECORD;
  v_submissions RECORD;
  v_participants RECORD;
  v_profile_a RECORD;
  v_profile_b RECORD;
  v_winner_user_id UUID;
  v_is_draw BOOLEAN := false;
  v_rating_a INTEGER;
  v_rating_b INTEGER;
  v_expected_a NUMERIC;
  v_expected_b NUMERIC;
  v_score_a NUMERIC;
  v_score_b NUMERIC;
  v_k_a INTEGER;
  v_k_b INTEGER;
  v_new_rating_a INTEGER;
  v_new_rating_b INTEGER;
  v_start_time TIMESTAMP WITH TIME ZONE;
  v_end_time TIMESTAMP WITH TIME ZONE;
  v_duration_seconds INTEGER;
BEGIN
  SELECT *
  INTO v_room
  FROM public.debate_rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_not_found');
  END IF;

  IF v_room.mode <> 'ranked' OR v_room.is_ai_opponent THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_ranked_hvh');
  END IF;

  SELECT
    count(*) AS submission_count,
    bool_or(submitted_result = 'win') AS has_win,
    bool_or(submitted_result = 'loss') AS has_loss,
    bool_and(submitted_result = 'draw') AS all_draw,
    max(CASE WHEN submitted_result = 'win' THEN user_id ELSE NULL END) AS winner_user_id
  INTO v_submissions
  FROM public.match_result_submissions
  WHERE room_id = p_room_id;

  IF coalesce(v_submissions.submission_count, 0) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_enough_submissions');
  END IF;

  IF NOT ((v_submissions.has_win AND v_submissions.has_loss) OR v_submissions.all_draw) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'inconsistent_results');
  END IF;

  SELECT
    count(*) AS participant_count,
    max(CASE WHEN rn = 1 THEN user_id END) AS user_a_id,
    max(CASE WHEN rn = 2 THEN user_id END) AS user_b_id
  INTO v_participants
  FROM (
    SELECT user_id, row_number() OVER (ORDER BY id) AS rn
    FROM public.debate_participants
    WHERE room_id = p_room_id
      AND is_ai = false
      AND user_id IS NOT NULL
  ) q;

  IF coalesce(v_participants.participant_count, 0) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'participants_not_found');
  END IF;

  SELECT * INTO v_profile_a FROM public.profiles WHERE user_id = v_participants.user_a_id;
  SELECT * INTO v_profile_b FROM public.profiles WHERE user_id = v_participants.user_b_id;

  IF v_profile_a.id IS NULL OR v_profile_b.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'profiles_not_found');
  END IF;

  v_is_draw := coalesce(v_submissions.all_draw, false);
  v_winner_user_id := CASE WHEN v_is_draw THEN NULL ELSE v_submissions.winner_user_id END;

  v_rating_a := coalesce((v_profile_a.elo_by_format ->> v_room.format)::INTEGER, 1200);
  v_rating_b := coalesce((v_profile_b.elo_by_format ->> v_room.format)::INTEGER, 1200);

  v_expected_a := 1 / (1 + power(10, (v_rating_b - v_rating_a) / 400.0));
  v_expected_b := 1 / (1 + power(10, (v_rating_a - v_rating_b) / 400.0));

  IF v_is_draw THEN
    v_score_a := 0.5;
    v_score_b := 0.5;
  ELSIF v_winner_user_id = v_profile_a.user_id THEN
    v_score_a := 1;
    v_score_b := 0;
  ELSE
    v_score_a := 0;
    v_score_b := 1;
  END IF;

  v_k_a := CASE WHEN v_rating_a < 1200 THEN 40 WHEN v_rating_a < 2000 THEN 20 ELSE 10 END;
  v_k_b := CASE WHEN v_rating_b < 1200 THEN 40 WHEN v_rating_b < 2000 THEN 20 ELSE 10 END;

  v_new_rating_a := round(v_rating_a + v_k_a * (v_score_a - v_expected_a));
  v_new_rating_b := round(v_rating_b + v_k_b * (v_score_b - v_expected_b));

  UPDATE public.profiles
  SET
    elo_by_format = jsonb_set(coalesce(elo_by_format, '{}'::jsonb), ARRAY[v_room.format::TEXT], to_jsonb(v_new_rating_a), true),
    total_debates = coalesce(total_debates, 0) + 1,
    total_wins = CASE WHEN v_score_a = 1 THEN coalesce(total_wins, 0) + 1 ELSE coalesce(total_wins, 0) END,
    current_streak = CASE WHEN v_score_a = 1 THEN coalesce(current_streak, 0) + 1 ELSE 0 END
  WHERE id = v_profile_a.id;

  UPDATE public.profiles
  SET
    elo_by_format = jsonb_set(coalesce(elo_by_format, '{}'::jsonb), ARRAY[v_room.format::TEXT], to_jsonb(v_new_rating_b), true),
    total_debates = coalesce(total_debates, 0) + 1,
    total_wins = CASE WHEN v_score_b = 1 THEN coalesce(total_wins, 0) + 1 ELSE coalesce(total_wins, 0) END,
    current_streak = CASE WHEN v_score_b = 1 THEN coalesce(current_streak, 0) + 1 ELSE 0 END
  WHERE id = v_profile_b.id;

  v_start_time := coalesce(v_room.started_at, v_room.created_at);
  v_end_time := coalesce(v_room.ended_at, now());
  v_duration_seconds := greatest(0, floor(extract(epoch from (v_end_time - v_start_time)))::INTEGER);

  INSERT INTO public.match_history (
    room_id,
    user_a_id,
    user_b_id,
    format,
    mode,
    winner_user_id,
    is_draw,
    rating_before_a,
    rating_after_a,
    rating_before_b,
    rating_after_b,
    duration_seconds
  )
  VALUES (
    p_room_id,
    v_profile_a.user_id,
    v_profile_b.user_id,
    v_room.format,
    v_room.mode,
    v_winner_user_id,
    v_is_draw,
    v_rating_a,
    v_new_rating_a,
    v_rating_b,
    v_new_rating_b,
    v_duration_seconds
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'ratingChangeA', v_new_rating_a - v_rating_a,
    'ratingChangeB', v_new_rating_b - v_rating_b
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_elo_update(UUID) TO authenticated;
