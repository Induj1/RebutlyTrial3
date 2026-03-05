-- ============================================
-- REBUTLY.AI - COMPLETE DATABASE SCHEMA
-- For cloning into a NEW Supabase project
-- ============================================

-- ENUM types
CREATE TYPE public.debate_format AS ENUM ('BP', 'AP', 'LD', 'PF', 'WSDC');
CREATE TYPE public.match_mode AS ENUM ('ranked', 'unranked');
CREATE TYPE public.region_preference AS ENUM ('local', 'national', 'global');
CREATE TYPE public.opponent_type AS ENUM ('human_only', 'ai_only', 'human_then_ai');
CREATE TYPE public.queue_status AS ENUM ('waiting', 'matched', 'cancelled', 'expired');
CREATE TYPE public.room_status AS ENUM ('reserved', 'live', 'completed', 'abandoned');
CREATE TYPE public.invite_status AS ENUM ('active', 'consumed', 'expired');
CREATE TYPE public.match_result AS ENUM ('win', 'loss', 'draw');
CREATE TYPE public.debate_role AS ENUM ('proposition', 'opposition', 'government', 'opening_government', 'closing_government', 'opening_opposition', 'closing_opposition', 'affirmative', 'negative');
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- ============================================
-- TABLES
-- ============================================

CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    elo_by_format JSONB NOT NULL DEFAULT '{"BP": 1200, "AP": 1200, "LD": 1200, "PF": 1200, "WSDC": 1200}'::jsonb,
    region TEXT DEFAULT 'global',
    age_bracket TEXT,
    total_debates INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.match_queue_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    format debate_format NOT NULL,
    mode match_mode NOT NULL,
    region region_preference NOT NULL DEFAULT 'global',
    opponent_type opponent_type NOT NULL DEFAULT 'human_then_ai',
    elo INTEGER NOT NULL DEFAULT 1200,
    age_bracket TEXT,
    topic TEXT,
    status queue_status NOT NULL DEFAULT 'waiting',
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_heartbeat_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    matched_at TIMESTAMP WITH TIME ZONE,
    matched_with_user_id UUID REFERENCES auth.users(id),
    room_id UUID
);
CREATE INDEX idx_queue_matching ON public.match_queue_entries (format, mode, status, elo, joined_at) WHERE status = 'waiting';
CREATE INDEX idx_queue_user ON public.match_queue_entries (user_id, status);
CREATE INDEX idx_queue_heartbeat ON public.match_queue_entries (last_heartbeat_at) WHERE status = 'waiting';
CREATE UNIQUE INDEX one_active_queue_per_user_waiting ON public.match_queue_entries (user_id) WHERE status = 'waiting'::queue_status;
ALTER TABLE public.match_queue_entries ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.debate_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    format debate_format NOT NULL,
    mode match_mode NOT NULL,
    region region_preference NOT NULL DEFAULT 'global',
    status room_status NOT NULL DEFAULT 'reserved',
    is_ai_opponent BOOLEAN NOT NULL DEFAULT false,
    ai_model TEXT,
    ai_difficulty TEXT,
    is_private BOOLEAN NOT NULL DEFAULT false,
    topic TEXT,
    hvh_format TEXT NOT NULL DEFAULT 'standard',
    current_phase TEXT NOT NULL DEFAULT 'waiting',
    timer_state JSONB DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    ended_reason TEXT,
    reserved_until TIMESTAMP WITH TIME ZONE
);
CREATE INDEX idx_rooms_status ON public.debate_rooms (status);
ALTER TABLE public.debate_rooms ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.debate_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.debate_rooms(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    is_ai BOOLEAN NOT NULL DEFAULT false,
    role debate_role,
    speaking_order INTEGER,
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    connected_at TIMESTAMP WITH TIME ZONE,
    disconnected_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT unique_participant UNIQUE (room_id, user_id)
);
CREATE INDEX idx_participants_room ON public.debate_participants (room_id);
CREATE INDEX idx_participants_user ON public.debate_participants (user_id);
ALTER TABLE public.debate_participants ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.match_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.debate_rooms(id),
    user_a_id UUID REFERENCES auth.users(id) NOT NULL,
    user_b_id UUID REFERENCES auth.users(id),
    format debate_format NOT NULL,
    mode match_mode NOT NULL,
    played_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    winner_user_id UUID REFERENCES auth.users(id),
    is_draw BOOLEAN DEFAULT false,
    rating_before_a INTEGER,
    rating_after_a INTEGER,
    rating_before_b INTEGER,
    rating_after_b INTEGER,
    duration_seconds INTEGER
);
CREATE INDEX idx_history_user_a ON public.match_history (user_a_id);
CREATE INDEX idx_history_user_b ON public.match_history (user_b_id);
CREATE INDEX idx_history_played ON public.match_history (played_at DESC);
ALTER TABLE public.match_history ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.match_result_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.debate_rooms(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    submitted_result match_result NOT NULL,
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT unique_submission UNIQUE (room_id, user_id)
);
CREATE INDEX idx_submissions_room ON public.match_result_submissions (room_id);
ALTER TABLE public.match_result_submissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_code TEXT NOT NULL UNIQUE,
    room_id UUID REFERENCES public.debate_rooms(id) ON DELETE CASCADE NOT NULL,
    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '30 minutes'),
    consumed_at TIMESTAMP WITH TIME ZONE,
    consumed_by_user_id UUID REFERENCES auth.users(id),
    status invite_status NOT NULL DEFAULT 'active'
);
CREATE INDEX idx_invites_code ON public.invites (invite_code) WHERE status = 'active';
CREATE INDEX idx_invites_room ON public.invites (room_id);
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    action TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT unique_rate_limit UNIQUE (user_id, action, window_start)
);
CREATE INDEX idx_rate_limits_user ON public.rate_limits (user_id, action, window_start);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- ============================================
-- REALTIME
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_queue_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.debate_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.debate_participants;

-- ============================================
-- FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

CREATE OR REPLACE FUNCTION public.is_room_participant(_room_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.debate_participants WHERE room_id = _room_id AND user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS TEXT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (user_id, username, display_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
    );
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_timer_state(p_room_id uuid, p_timer_state jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN UPDATE debate_rooms SET timer_state = p_timer_state WHERE id = p_room_id; END;
$$;

CREATE OR REPLACE FUNCTION public.get_timer_state(p_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_state jsonb;
BEGIN SELECT timer_state INTO v_state FROM debate_rooms WHERE id = p_room_id; RETURN v_state; END;
$$;

-- ============================================
-- RLS POLICIES
-- ============================================

-- Profiles
CREATE POLICY "Users can view profiles based on visibility" ON public.profiles FOR SELECT USING (auth.uid() IS NOT NULL OR is_public = true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- User roles
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- Match queue
CREATE POLICY "Users can view own queue entries" ON public.match_queue_entries FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users can insert own queue entries" ON public.match_queue_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own queue entries" ON public.match_queue_entries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own queue entries" ON public.match_queue_entries FOR DELETE USING (auth.uid() = user_id);

-- Debate rooms
CREATE POLICY "Participants can view rooms" ON public.debate_rooms FOR SELECT USING (public.is_room_participant(id, auth.uid()) OR public.is_admin());
CREATE POLICY "Authenticated users can create rooms" ON public.debate_rooms FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "System can update rooms" ON public.debate_rooms FOR UPDATE USING (public.is_room_participant(id, auth.uid()) OR public.is_admin());

-- Debate participants
CREATE POLICY "Participants can view room participants" ON public.debate_participants FOR SELECT USING (public.is_room_participant(room_id, auth.uid()) OR public.is_admin());
CREATE POLICY "Authenticated users can join rooms" ON public.debate_participants FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR is_ai = true);
CREATE POLICY "Participants can update own connection" ON public.debate_participants FOR UPDATE USING (auth.uid() = user_id);

-- Match history
CREATE POLICY "Users can view own match history" ON public.match_history FOR SELECT USING (auth.uid() = user_a_id OR auth.uid() = user_b_id OR public.is_admin());
CREATE POLICY "Match history insert via service role only" ON public.match_history FOR INSERT TO authenticated WITH CHECK (false);

-- Match result submissions
CREATE POLICY "Users can view own submissions" ON public.match_result_submissions FOR SELECT USING (auth.uid() = user_id OR public.is_room_participant(room_id, auth.uid()) OR public.is_admin());
CREATE POLICY "Users can insert own submissions" ON public.match_result_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Invites
CREATE POLICY "Users can view related invites" ON public.invites FOR SELECT USING (auth.uid() = created_by_user_id OR status = 'active' OR public.is_admin());
CREATE POLICY "Users can create invites" ON public.invites FOR INSERT WITH CHECK (auth.uid() = created_by_user_id);
CREATE POLICY "Users can update own invites" ON public.invites FOR UPDATE USING (auth.uid() = created_by_user_id OR status = 'active');

-- Rate limits
CREATE POLICY "System can manage rate limits" ON public.rate_limits FOR ALL USING (public.is_admin());
CREATE POLICY "Users can view own rate limits" ON public.rate_limits FOR SELECT USING (auth.uid() = user_id);

