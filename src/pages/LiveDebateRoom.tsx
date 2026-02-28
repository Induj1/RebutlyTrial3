import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Phone,
  ArrowLeft,
  Trophy,
  Clock,
  Loader2,
  User,
  Download,
  MessageSquare,
  Target,
  XCircle,
  CheckCircle,
  Lightbulb,
  BookOpen,
  AlertCircle,
  Play,
  Users,
  Volume2,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/browserClient';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { connect, type Room as TwilioRoom } from 'twilio-video';
import logo from '@/assets/rebutly-logo.png';
import { DebateNotes, type Note } from '@/components/DebateNotes';
import { TransitionCountdown, type TransitionMode } from '@/components/TransitionCountdown';
import { PrepTimer } from '@/components/PrepTimer';
import { useVoiceInput } from '@/hooks/useVoiceInput';

// ============================================================================
// TYPES
// ============================================================================

type RoomStatus = 'reserved' | 'live' | 'completed' | 'abandoned';
type HvHFormat = 'rapid' | 'standard' | 'extended';

type DebatePhase = 
  | 'loading'
  | 'waiting_for_opponent'
  | 'setup'           // Both connected, waiting for video setup
  | 'prep'            // Preparation time
  | 'prop_constructive'
  | 'opp_constructive'
  | 'prop_rebuttal'
  | 'opp_rebuttal'
  | 'prop_closing'
  | 'opp_closing'
  | 'transition'
  | 'debate_complete'
  | 'judging'
  | 'results';

interface Room {
  id: string;
  format: string;
  mode: string;
  status: RoomStatus;
  is_ai_opponent: boolean;
  topic: string | null;
  hvh_format: HvHFormat | null;
  current_phase: string | null;
  created_at: string;
  started_at: string | null;
}

interface Participant {
  id: string;
  room_id: string;
  user_id: string | null;
  is_ai: boolean;
  role: string | null;
  speaking_order: number | null;
  connected_at: string | null;
  profile?: {
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    elo_by_format: Record<string, number>;
  };
}

interface TranscriptEntry {
  id: string;
  speaker: 'you' | 'opponent' | 'system';
  text: string;
  timestamp: Date;
  phase: DebatePhase;
}

interface FeedbackCategory {
  name: string;
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
}

interface KeyMoment {
  type: 'strength' | 'missed_opportunity' | 'effective_rebuttal' | 'weak_argument';
  description: string;
  suggestion: string;
}

interface DebateFeedback {
  overallScore: number;
  verdict: 'win' | 'loss' | 'close';
  summary: string;
  categories: FeedbackCategory[];
  keyMoments: KeyMoment[];
  researchSuggestions: string[];
}

interface PhaseChangePayload {
  userId?: string;
  phase: DebatePhase;
  timestamp?: number;
  startedAt?: number;
  duration?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const FORMAT_TIMES: Record<HvHFormat, { prep: number; constructive: number; rebuttal: number; closing: number }> = {
  'rapid': { prep: 30, constructive: 60, rebuttal: 60, closing: 60 },
  'standard': { prep: 60, constructive: 180, rebuttal: 120, closing: 90 },
  'extended': { prep: 900, constructive: 420, rebuttal: 240, closing: 180 },
};

const SPEECH_PHASES: DebatePhase[] = [
  'prop_constructive',
  'opp_constructive',
  'prop_rebuttal',
  'opp_rebuttal',
  'prop_closing',
  'opp_closing',
];

const DEFAULT_TOPIC = "This House believes that social media does more harm than good";

// ============================================================================
// COMPONENT
// ============================================================================

const LiveDebateRoom = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile: currentUserProfile } = useAuth();

  // Room state
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Debate state
  const [phase, setPhase] = useState<DebatePhase>('loading');
  const [timeLeft, setTimeLeft] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [hvhFormat, setHvhFormat] = useState<HvHFormat>('standard');
  
  // Transition state
  const [transitionMode, setTransitionMode] = useState<TransitionMode>('both');
  const [showTransition, setShowTransition] = useState(false);
  const [nextPhaseAfterTransition, setNextPhaseAfterTransition] = useState<DebatePhase | null>(null);
  
  // Transcript
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentSpeechText, setCurrentSpeechText] = useState('');
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  
  // Media state
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [signalingReady, setSignalingReady] = useState(false);
  const [webRTCConnected, setWebRTCConnected] = useState(false);
  
  // Media refs
  const twilioRoomRef = useRef<TwilioRoom | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const signalingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastStartedPhaseRef = useRef<string | null>(null);
  const phaseRef = useRef<DebatePhase>('loading');
  const isHostRef = useRef(false);
  const hostUserIdRef = useRef<string | null>(null);
  
  // Notes
  const [notes, setNotes] = useState<Note[]>([]);
  const [showNotesPanel, setShowNotesPanel] = useState(true);
  const [notesActiveTab, setNotesActiveTab] = useState<'arguments' | 'rebuttals' | 'examples'>('arguments');
  const [notesCurrentNote, setNotesCurrentNote] = useState('');
  const [notesCurrentColor, setNotesCurrentColor] = useState<'default' | 'red' | 'yellow' | 'green' | 'blue'>('default');
  const [notesCurrentTags, setNotesCurrentTags] = useState<string[]>([]);
  
  // Results
  const [feedback, setFeedback] = useState<DebateFeedback | null>(null);
  const [userPrediction, setUserPrediction] = useState<'win' | 'loss' | null>(null);
  const [showPredictionModal, setShowPredictionModal] = useState(false);

  // Voice input
  const { 
    isRecording,
    isSupported: voiceSupported,
    startRecording,
    stopRecording,
  } = useVoiceInput({
    onTranscript: (text, isFinal) => {
      if (text.trim()) {
        setCurrentSpeechText(text);
        if (isFinal) {
          addTranscriptEntry('you', text.trim());
          setCurrentSpeechText('');
          broadcastTranscript(text.trim());
        }
      }
    },
    onError: (err) => console.error('[LiveDebateRoom] Voice error:', err)
  });

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================
  
  const topic = room?.topic || DEFAULT_TOPIC;
  const opponent = participants.find(p => p.user_id !== user?.id);
  const currentPlayer = participants.find(p => p.user_id === user?.id);
  const userRole = currentPlayer?.role || 'proposition';
  const hostUserId = useMemo(() => {
    const userIds = participants
      .filter(p => p.user_id)
      .map(p => p.user_id!)
      .sort();
    return userIds[0] ?? null;
  }, [participants]);
  const isHost = !!user?.id && user.id === hostUserId;
  
  const isUserProposition = 
    userRole === 'proposition' || 
    userRole === 'affirmative' || 
    userRole.includes('gov');
  
  const isUserTurn = isUserProposition 
    ? phase.startsWith('prop_') 
    : phase.startsWith('opp_');

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    hostUserIdRef.current = hostUserId;
  }, [hostUserId]);

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getSpeechTime = useCallback((phaseToCheck: DebatePhase): number => {
    const times = FORMAT_TIMES[hvhFormat];
    if (phaseToCheck.includes('constructive')) return times.constructive;
    if (phaseToCheck.includes('rebuttal')) return times.rebuttal;
    if (phaseToCheck.includes('closing')) return times.closing;
    return times.constructive;
  }, [hvhFormat]);

  const getNextPhase = useCallback((currentPhase: DebatePhase): DebatePhase | null => {
    const currentIndex = SPEECH_PHASES.indexOf(currentPhase);
    if (currentIndex >= 0 && currentIndex < SPEECH_PHASES.length - 1) {
      return SPEECH_PHASES[currentIndex + 1];
    }
    return null;
  }, []);

  const getSpeechLabel = (p: DebatePhase): string => {
    const speaker = p.startsWith('prop_') ? 'Proposition' : 'Opposition';
    const type = p.includes('constructive') ? 'Constructive' : 
                 p.includes('rebuttal') ? 'Rebuttal' : 'Closing';
    return `${speaker} ${type}`;
  };

  const addTranscriptEntry = useCallback((speaker: 'you' | 'opponent' | 'system', text: string, entryPhase?: DebatePhase) => {
    const entry: TranscriptEntry = {
      id: `${Date.now()}-${Math.random()}`,
      speaker,
      text,
      timestamp: new Date(),
      phase: entryPhase ?? phaseRef.current,
    };
    setTranscript(prev => [...prev, entry]);
  }, []);

  // ============================================================================
  // BROADCAST FUNCTIONS
  // ============================================================================

  const broadcastTranscript = useCallback((text: string) => {
    if (!id || !signalingChannelRef.current) return;
    signalingChannelRef.current.send({
      type: 'broadcast',
      event: 'transcript',
      payload: { userId: user?.id, text, phase: phaseRef.current, timestamp: new Date().toISOString() },
    });
  }, [id, user?.id]);

  const broadcastPhaseChange = useCallback((newPhase: DebatePhase, startedAt: number, duration: number) => {
    if (!id || !signalingChannelRef.current) return;
    signalingChannelRef.current.send({
      type: 'broadcast',
      event: 'phase_change',
      payload: { userId: user?.id, phase: newPhase, timestamp: Date.now(), startedAt, duration },
    });
  }, [id, user?.id]);

  const broadcastReady = useCallback(() => {
    if (!id || !signalingChannelRef.current) return;
    signalingChannelRef.current.send({
      type: 'broadcast',
      event: 'user_ready',
      payload: { userId: user?.id },
    });
  }, [id, user?.id]);

  const setLocalVideoElement = useCallback((node: HTMLVideoElement | null) => {
    localVideoRef.current = node;
    if (node && localStream) {
      node.srcObject = localStream;
      node.play().catch(() => {});
    }
  }, [localStream]);

  const setRemoteVideoElement = useCallback((node: HTMLVideoElement | null) => {
    remoteVideoRef.current = node;
    if (node && remoteStream) {
      node.srcObject = remoteStream;
      node.play().catch(() => {});
    }
  }, [remoteStream]);

  const setRemoteAudioElement = useCallback((node: HTMLAudioElement | null) => {
    remoteAudioRef.current = node;
    if (node && remoteStream) {
      node.srcObject = remoteStream;
      node.play().catch(() => {});
    }
  }, [remoteStream]);

  const initializeTwilioVideo = useCallback(async () => {
    if (!id || !user) return null;

    try {
      const existingRoom = twilioRoomRef.current;
      if (existingRoom) {
        existingRoom.disconnect();
        twilioRoomRef.current = null;
      }

      const roomName = `debate-room-${id}`;
      const { data, error } = await supabase.functions.invoke('twilio-video-token', {
        body: {
          roomName,
          identity: user.id,
        },
      });

      if (error || !data?.token) {
        console.error('[LiveDebateRoom] Failed to fetch Twilio video token:', error);
        toast.error('Unable to initialize Twilio video. Please try again.');
        return null;
      }

      const room = await connect(data.token, {
        name: roomName,
        audio: { echoCancellation: true, noiseSuppression: true },
        video: true,
      });
      twilioRoomRef.current = room;

      const syncLocalMedia = () => {
        const tracks = Array.from(room.localParticipant.tracks.values())
          .map(publication => publication.track?.mediaStreamTrack)
          .filter((track): track is MediaStreamTrack => !!track);
        const stream = tracks.length ? new MediaStream(tracks) : null;
        setLocalStream(stream);
      };

      const syncRemoteMedia = () => {
        const tracks: MediaStreamTrack[] = [];
        room.participants.forEach(participant => {
          participant.tracks.forEach(publication => {
            const track = publication.track?.mediaStreamTrack;
            if (track) tracks.push(track);
          });
        });
        setRemoteStream(tracks.length ? new MediaStream(tracks) : null);
        setWebRTCConnected(tracks.length > 0);
      };

      room.on('participantConnected', syncRemoteMedia);
      room.on('participantDisconnected', syncRemoteMedia);
      room.on('trackSubscribed', syncRemoteMedia);
      room.on('trackUnsubscribed', syncRemoteMedia);
      room.on('trackPublished', syncRemoteMedia);
      room.on('trackUnpublished', syncRemoteMedia);
      room.on('disconnected', () => {
        setRemoteStream(null);
        setWebRTCConnected(false);
      });

      syncLocalMedia();
      syncRemoteMedia();
      setMediaReady(true);
      return room;
    } catch (err: any) {
      console.error('[LiveDebateRoom] Media error:', err);
      toast.error(err.name === 'NotAllowedError' 
        ? 'Camera/microphone access denied' 
        : 'Failed to join Twilio room');
      return null;
    }
  }, [id, user]);

  // ============================================================================
  // PHASE MANAGEMENT
  // ============================================================================

  const startPhase = useCallback((
    newPhase: DebatePhase,
    options?: { startedAt?: number; duration?: number; broadcast?: boolean }
  ) => {
    const duration = options?.duration ?? getSpeechTime(newPhase);
    const startedAt = options?.startedAt ?? Date.now();
    const phaseKey = `${newPhase}:${startedAt}`;
    if (lastStartedPhaseRef.current === phaseKey) {
      return;
    }
    lastStartedPhaseRef.current = phaseKey;

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const remainingTime = Math.max(0, duration - elapsedSeconds);

    setPhase(newPhase);
    setTimeLeft(remainingTime);
    setIsTimerRunning(remainingTime > 0);
    
    addTranscriptEntry('system', `${getSpeechLabel(newPhase)} begins`);
    
    // Start recording if it's user's turn
    const isNextUserTurn = isUserProposition 
      ? newPhase.startsWith('prop_') 
      : newPhase.startsWith('opp_');
    
    if (isNextUserTurn && remainingTime > 0 && micEnabled && voiceSupported) {
      startRecording();
    }
    
    if (options?.broadcast !== false) {
      broadcastPhaseChange(newPhase, startedAt, duration);
    }
  }, [getSpeechTime, addTranscriptEntry, isUserProposition, micEnabled, voiceSupported, startRecording, broadcastPhaseChange]);

  const handleTransitionComplete = useCallback(() => {
    setShowTransition(false);
    if (nextPhaseAfterTransition) {
      if (isHost) {
        startPhase(nextPhaseAfterTransition);
      }
      setNextPhaseAfterTransition(null);
    }
  }, [nextPhaseAfterTransition, startPhase, isHost]);

  const handlePhaseEnd = useCallback(() => {
    if (isRecording) stopRecording();
    setIsTimerRunning(false);
    if (!isHost) return;
    
    const nextPhase = getNextPhase(phase);
    
    if (nextPhase) {
      setNextPhaseAfterTransition(nextPhase);
      setShowTransition(true);
    } else {
      setPhase('debate_complete');
      addTranscriptEntry('system', 'Debate complete!');
      broadcastPhaseChange('debate_complete', Date.now(), 0);
      setShowPredictionModal(true);
    }
  }, [phase, getNextPhase, isRecording, stopRecording, addTranscriptEntry, isHost, broadcastPhaseChange]);

  const handlePrepComplete = useCallback(() => {
    if (!isHost) return;
    addTranscriptEntry('system', `Motion: "${topic}"`);
    addTranscriptEntry('system', `You are arguing ${isUserProposition ? 'FOR (Proposition)' : 'AGAINST (Opposition)'}`);
    setNextPhaseAfterTransition('prop_constructive');
    setShowTransition(true);
  }, [topic, isUserProposition, addTranscriptEntry, isHost]);

  const handleConnectAndStart = useCallback(async () => {
    if (!signalingReady) {
      toast.error('Signaling channel is not ready yet. Please try again in a second.');
      return;
    }
    const twilioRoom = await initializeTwilioVideo();
    if (twilioRoom) {
      broadcastReady();
      // Move to prep phase
      setPhase('prep');
    }
  }, [initializeTwilioVideo, broadcastReady, signalingReady]);

  // ============================================================================
  // AI JUDGMENT
  // ============================================================================

  const requestAIJudgment = useCallback(async () => {
    setShowPredictionModal(false);
    setPhase('judging');
    
    try {
      const userArgs = transcript.filter(t => t.speaker === 'you').map(t => t.text);
      const oppArgs = transcript.filter(t => t.speaker === 'opponent').map(t => t.text);
      
      const { data, error } = await supabase.functions.invoke('debate-ai', {
        body: {
          type: 'generate_feedback',
          topic,
          userSide: isUserProposition ? 'proposition' : 'opposition',
          phase: 'closing',
          userArguments: userArgs,
          aiArguments: oppArgs,
          conversationHistory: transcript
            .filter(t => t.speaker !== 'system')
            .map(t => ({
              role: t.speaker === 'you' ? 'user' : 'assistant',
              content: t.text,
            })),
        },
      });
      
      if (error) throw error;
      setFeedback(data);
      setPhase('results');
    } catch (err) {
      console.error('[LiveDebateRoom] AI judgment error:', err);
      toast.error('Failed to get AI judgment');
      setPhase('results');
    }
  }, [transcript, topic, isUserProposition]);

  const downloadTranscript = useCallback(() => {
    const text = transcript
      .map(t => `[${t.speaker.toUpperCase()}] ${t.text}`)
      .join('\n\n');
    
    const blob = new Blob([`Debate Transcript\nTopic: ${topic}\n\n${text}`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debate-${id}-transcript.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transcript, topic, id]);

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, currentSpeechText]);

  // Attach streams even when video elements mount after tracks are already available
  useEffect(() => {
    if (localVideoRef.current && localStream && localVideoRef.current.srcObject !== localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream, phase]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream && remoteVideoRef.current.srcObject !== remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [remoteStream, phase]);

  useEffect(() => {
    if (remoteAudioRef.current && remoteStream && remoteAudioRef.current.srcObject !== remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream, phase]);

  // Timer
  useEffect(() => {
    if (!isTimerRunning) return;
    
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          handlePhaseEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isTimerRunning, handlePhaseEnd]);

  // Fetch room data and set up realtime
  useEffect(() => {
    if (!id || !user) return;

    const fetchRoom = async () => {
      try {
        // Fetch room
        const { data: roomData, error: roomError } = await supabase
          .from('debate_rooms')
          .select('*')
          .eq('id', id)
          .single();

        if (roomError) throw roomError;
        setRoom(roomData as Room);
        setHvhFormat((roomData.hvh_format as HvHFormat) || 'standard');

        // Fetch participants with profiles
        const { data: participantsData, error: participantsError } = await supabase
          .from('debate_participants')
          .select('*')
          .eq('room_id', id);

        if (participantsError) throw participantsError;
        
        // Fetch profiles
        const userIds = participantsData.filter(p => p.user_id).map(p => p.user_id);
        let profilesMap: Record<string, any> = {};
        
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('user_id, username, display_name, avatar_url, elo_by_format')
            .in('user_id', userIds);
          
          if (profiles) {
            profilesMap = profiles.reduce((acc, p) => ({ ...acc, [p.user_id]: p }), {});
          }
        }
        
        const participantsWithProfiles = participantsData.map(p => ({
          ...p,
          profile: p.user_id ? profilesMap[p.user_id] : undefined,
        }));
        
        setParticipants(participantsWithProfiles as Participant[]);

        // Mark as connected
        await supabase
          .from('debate_participants')
          .update({ connected_at: new Date().toISOString() })
          .eq('room_id', id)
          .eq('user_id', user.id);

        // Check if both connected
        const { data: freshParticipants } = await supabase
          .from('debate_participants')
          .select('*')
          .eq('room_id', id);

        const humanParticipants = freshParticipants?.filter(p => p.user_id) || [];
        const allConnected = humanParticipants.every(p => p.connected_at);

        if (allConnected && humanParticipants.length >= 2) {
          // Update room to live
          await supabase
            .from('debate_rooms')
            .update({ status: 'live', started_at: new Date().toISOString() })
            .eq('id', id);
          
          setPhase('setup');
        } else if (roomData.status === 'live') {
          setPhase('setup');
        } else {
          setPhase('waiting_for_opponent');
        }

        setLoading(false);
      } catch (err) {
        console.error('Error fetching room:', err);
        setError('Failed to load room');
        setLoading(false);
      }
    };

    fetchRoom();

    // Cleanup
    return () => {
      localStream?.getTracks().forEach(track => track.stop());
      twilioRoomRef.current?.disconnect();
      twilioRoomRef.current = null;
      if (isRecording) stopRecording();
    };
  }, [id, user]);

  // Realtime signaling channel
  useEffect(() => {
    if (!id || !user) return;

    const channel = supabase.channel(`room-${id}`)
      .on('broadcast', { event: 'transcript' }, ({ payload }) => {
        if (payload.userId !== user.id) {
          addTranscriptEntry('opponent', payload.text, payload.phase);
        }
      })
      .on('broadcast', { event: 'user_ready' }, () => {})
      .on('broadcast', { event: 'phase_change' }, ({ payload }) => {
        const phasePayload = payload as PhaseChangePayload;
        if (
          phasePayload.userId &&
          phasePayload.userId !== user.id &&
          phasePayload.userId === hostUserIdRef.current
        ) {
          if (phasePayload.phase === 'debate_complete') {
            setPhase('debate_complete');
            setIsTimerRunning(false);
            setShowTransition(false);
            setNextPhaseAfterTransition(null);
            setShowPredictionModal(true);
            return;
          }
          if (!SPEECH_PHASES.includes(phasePayload.phase)) return;
          startPhase(phasePayload.phase, {
            startedAt: phasePayload.startedAt,
            duration: phasePayload.duration,
            broadcast: false,
          });
          setShowTransition(false);
          setNextPhaseAfterTransition(null);
        }
      })
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'debate_participants',
          filter: `room_id=eq.${id}`,
        },
        async () => {
          // Re-check if all connected
          const { data: freshParticipants } = await supabase
            .from('debate_participants')
            .select('*')
            .eq('room_id', id);

          if (freshParticipants) {
            const humanParticipants = freshParticipants.filter(p => p.user_id);
            const allConnected = humanParticipants.every(p => p.connected_at);
            
            if (allConnected && humanParticipants.length >= 2 && phase === 'waiting_for_opponent') {
              await supabase
                .from('debate_rooms')
                .update({ status: 'live', started_at: new Date().toISOString() })
                .eq('id', id)
                .eq('status', 'reserved');
              
              setPhase('setup');
              toast.success('Opponent connected!');
            }
          }
        }
      )
      .subscribe((status) => {
        setSignalingReady(status === 'SUBSCRIBED');
      });

    signalingChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      signalingChannelRef.current = null;
      setSignalingReady(false);
    };
  }, [id, user, addTranscriptEntry, startPhase]);

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Joining debate room...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Error</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => navigate('/play')}>Back to Matchmaking</Button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Rebutly.AI" className="w-8 h-8 rounded-lg" />
          </Link>
          <div>
            <h1 className="font-semibold text-sm">Live Debate</h1>
            <p className="text-xs text-muted-foreground capitalize">{hvhFormat} Format</p>
            <p className="text-xs text-muted-foreground max-w-[50vw] truncate">Motion: {topic}</p>
          </div>
        </div>
        
        {/* Timer */}
        {SPEECH_PHASES.includes(phase) && (
          <div className="flex items-center gap-2 bg-muted px-4 py-2 rounded-full">
            <Clock className="w-4 h-4 text-primary" />
            <span className={`font-mono text-lg font-bold ${timeLeft <= 10 ? 'text-destructive' : 'text-foreground'}`}>
              {formatTime(timeLeft)}
            </span>
          </div>
        )}
        
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/play')}>
            <Phone className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </header>

      {/* Waiting for Opponent */}
      {phase === 'waiting_for_opponent' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
              <Users className="w-10 h-10 text-muted-foreground animate-pulse" />
            </div>
            <h2 className="font-display text-2xl font-bold mb-2">Waiting for Opponent</h2>
            <p className="text-muted-foreground mb-4">They're on their way...</p>
            <p className="text-sm text-muted-foreground">Topic: {topic}</p>
          </div>
        </div>
      )}

      {/* Setup Phase */}
      {phase === 'setup' && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="glass-card p-8 max-w-md w-full text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center">
              <Video className="w-10 h-10 text-primary" />
            </div>
            
            <h2 className="font-display text-2xl font-bold mb-2">Ready to Debate?</h2>
            <p className="text-muted-foreground mb-6">
              Your opponent is here! Connect your camera and microphone to begin.
            </p>
            
            <div className="bg-muted/50 rounded-lg p-4 mb-6 text-left">
              <p className="text-sm font-medium mb-2">Motion:</p>
              <p className="text-sm text-muted-foreground">{topic}</p>
              <p className="text-sm font-medium mt-3 mb-1">Your Side:</p>
              <p className={`text-sm font-bold ${isUserProposition ? 'text-green-500' : 'text-red-500'}`}>
                {isUserProposition ? 'PROPOSITION (For)' : 'OPPOSITION (Against)'}
              </p>
            </div>
            
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Transition alerts:</p>
              <div className="flex gap-2 justify-center">
                {(['tick', 'auto', 'both'] as const).map(mode => (
                  <Button
                    key={mode}
                    variant={transitionMode === mode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTransitionMode(mode)}
                  >
                    {mode === 'auto' && <Volume2 className="w-4 h-4 mr-1" />}
                    {mode === 'tick' && <MessageSquare className="w-4 h-4 mr-1" />}
                    {mode === 'both' && <Play className="w-4 h-4 mr-1" />}
                    {mode === 'tick' ? 'Confirm' : mode === 'auto' ? 'Auto' : 'Both'}
                  </Button>
                ))}
              </div>
            </div>
            
            <Button 
              onClick={handleConnectAndStart}
              className="w-full mt-6 bg-gradient-to-r from-primary to-secondary"
              size="lg"
              disabled={!signalingReady}
            >
              <Video className="w-5 h-5 mr-2" />
              {signalingReady ? 'Connect & Start Debate' : 'Preparing connection...'}
            </Button>
          </div>
        </div>
      )}

      {/* Prep Phase */}
      {phase === 'prep' && (
        <div className="flex-1 flex items-center justify-center p-4">
          <PrepTimer
            totalSeconds={FORMAT_TIMES[hvhFormat].prep}
            topic={topic}
            userSide={isUserProposition ? 'proposition' : 'opposition'}
            onComplete={handlePrepComplete}
            onSkip={handlePrepComplete}
          />
        </div>
      )}

      {/* Active Debate */}
      {SPEECH_PHASES.includes(phase) && (
        <div className="flex-1 flex">
          <audio ref={setRemoteAudioElement} autoPlay playsInline />
          {/* Main content */}
          <div className="flex-1 flex flex-col">
            {/* Video feeds */}
            <div className="flex-1 grid grid-cols-2 gap-2 p-2">
              {/* Local video */}
              <div className="relative bg-muted rounded-lg overflow-hidden">
                <video
                  ref={setLocalVideoElement}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white">
                  You ({isUserProposition ? 'Prop' : 'Opp'})
                </div>
                {isUserTurn && (
                  <div className="absolute top-2 right-2 bg-green-500 px-2 py-1 rounded text-xs text-white font-bold animate-pulse">
                    YOUR TURN
                  </div>
                )}
              </div>
              
              {/* Remote video */}
              <div className="relative bg-muted rounded-lg overflow-hidden">
                {remoteStream ? (
                  <video
                    ref={setRemoteVideoElement}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <User className="w-16 h-16 text-muted-foreground" />
                  </div>
                )}
                <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white">
                  {opponent?.profile?.display_name || 'Opponent'} ({!isUserProposition ? 'Prop' : 'Opp'})
                </div>
                {!isUserTurn && (
                  <div className="absolute top-2 right-2 bg-blue-500 px-2 py-1 rounded text-xs text-white font-bold animate-pulse">
                    SPEAKING
                  </div>
                )}
              </div>
            </div>
            
            {/* Current speech info */}
            <div className="px-4 py-2 bg-muted/50 text-center">
              <p className="text-sm font-medium">{getSpeechLabel(phase)}</p>
              {currentSpeechText && (
                <p className="text-xs text-muted-foreground mt-1 italic">"{currentSpeechText}..."</p>
              )}
            </div>

            {/* Live transcript feed */}
            <div className="px-4 py-3 border-t border-border bg-background">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">Live Transcript</p>
                <p className="text-xs text-muted-foreground">Full debate log</p>
              </div>
              <div className="h-40 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                {transcript.map((entry) => (
                  <div key={entry.id} className="text-sm">
                    <span className={`font-semibold ${
                      entry.speaker === 'you'
                        ? 'text-primary'
                        : entry.speaker === 'opponent'
                          ? 'text-accent'
                          : 'text-muted-foreground'
                    }`}>
                      {entry.speaker === 'you' ? 'You' : entry.speaker === 'opponent' ? 'Opponent' : 'System'}:
                    </span>{' '}
                    <span className={entry.speaker === 'system' ? 'text-muted-foreground italic' : 'text-foreground'}>
                      {entry.text}
                    </span>
                  </div>
                ))}
                {currentSpeechText && (
                  <div className="text-sm italic text-primary/90">
                    <span className="font-semibold">You (live):</span> {currentSpeechText}
                  </div>
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>
            
            {/* Controls */}
            <div className="p-4 border-t border-border flex items-center justify-center gap-4">
              <Button
                variant={micEnabled ? 'default' : 'destructive'}
                size="icon"
                onClick={() => {
                  setMicEnabled(!micEnabled);
                  localStream?.getAudioTracks().forEach(t => t.enabled = !micEnabled);
                }}
              >
                {micEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </Button>
              <Button
                variant={videoEnabled ? 'default' : 'destructive'}
                size="icon"
                onClick={() => {
                  setVideoEnabled(!videoEnabled);
                  localStream?.getVideoTracks().forEach(t => t.enabled = !videoEnabled);
                }}
              >
                {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowNotesPanel(!showNotesPanel)}
              >
                <MessageSquare className="w-5 h-5" />
              </Button>
            </div>
          </div>
          
          {/* Notes panel */}
          {showNotesPanel && (
            <div className="w-80 border-l border-border overflow-hidden">
              <DebateNotes
                notes={notes}
                onNotesChange={setNotes}
                activeTab={notesActiveTab}
                onActiveTabChange={setNotesActiveTab}
                currentNote={notesCurrentNote}
                onCurrentNoteChange={setNotesCurrentNote}
                currentColor={notesCurrentColor}
                onCurrentColorChange={setNotesCurrentColor}
                currentTags={notesCurrentTags}
                onCurrentTagsChange={setNotesCurrentTags}
              />
            </div>
          )}
        </div>
      )}

      {/* Transition */}
      {showTransition && nextPhaseAfterTransition && (
        <TransitionCountdown
          isVisible={showTransition}
          nextSpeaker={isUserProposition ? (nextPhaseAfterTransition.startsWith('prop_') ? 'user' : 'opponent') : (nextPhaseAfterTransition.startsWith('opp_') ? 'user' : 'opponent')}
          nextPhase={nextPhaseAfterTransition.includes('constructive') ? 'constructive' : nextPhaseAfterTransition.includes('rebuttal') ? 'rebuttal' : 'closing'}
          onComplete={handleTransitionComplete}
          mode={transitionMode}
        />
      )}

      {/* Debate Complete */}
      {phase === 'debate_complete' && !showPredictionModal && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
            <h2 className="text-xl font-bold">Debate Complete!</h2>
            <p className="text-muted-foreground">Preparing AI judgment...</p>
          </div>
        </div>
      )}

      {/* Prediction Modal */}
      <AnimatePresence>
        {showPredictionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/95 z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="glass-card p-8 max-w-md w-full text-center"
            >
              <h2 className="font-display text-2xl font-bold mb-2">Before the Results...</h2>
              <p className="text-muted-foreground mb-6">How do you think you did?</p>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <Button
                  variant="outline"
                  onClick={() => {
                    setUserPrediction('win');
                    requestAIJudgment();
                  }}
                  className="flex flex-col items-center gap-2 py-6 hover:bg-green-500/10 hover:border-green-500"
                >
                  <Trophy className="w-8 h-8 text-yellow-500" />
                  <span>I Think I Won</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setUserPrediction('loss');
                    requestAIJudgment();
                  }}
                  className="flex flex-col items-center gap-2 py-6 hover:bg-red-500/10 hover:border-red-500"
                >
                  <XCircle className="w-8 h-8 text-red-500" />
                  <span>I Think I Lost</span>
                </Button>
              </div>
              
              <Button variant="ghost" onClick={() => requestAIJudgment()} className="w-full">
                Skip Prediction
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Judging */}
      {phase === 'judging' && (
        <div className="fixed inset-0 bg-background z-50 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-16 h-16 animate-spin text-primary mx-auto mb-4" />
            <h2 className="font-display text-2xl font-bold mb-2">AI Judge Analyzing...</h2>
            <p className="text-muted-foreground">Evaluating arguments and generating feedback</p>
          </div>
        </div>
      )}

      {/* Results */}
      <AnimatePresence>
        {phase === 'results' && feedback && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background z-50 overflow-y-auto p-4"
          >
            <div className="max-w-3xl mx-auto py-8">
              <div className="glass-card p-6">
                {/* Header */}
                <div className="text-center mb-6 pb-6 border-b border-border">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', delay: 0.2 }}
                    className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-4 ${
                      feedback.verdict === 'win' ? 'bg-green-500/20' :
                      feedback.verdict === 'loss' ? 'bg-red-500/20' : 'bg-yellow-500/20'
                    }`}
                  >
                    {feedback.verdict === 'win' ? (
                      <Trophy className="w-10 h-10 text-green-500" />
                    ) : feedback.verdict === 'loss' ? (
                      <XCircle className="w-10 h-10 text-red-500" />
                    ) : (
                      <Target className="w-10 h-10 text-yellow-500" />
                    )}
                  </motion.div>
                  
                  <h2 className="font-display text-3xl font-bold mb-2">
                    {feedback.verdict === 'win' ? 'Victory!' :
                     feedback.verdict === 'loss' ? 'Defeat' : 'Close Debate'}
                  </h2>
                  
                  <div className="text-4xl font-bold text-primary mb-4">
                    {feedback.overallScore}/100
                  </div>
                  
                  <p className="text-muted-foreground max-w-lg mx-auto">{feedback.summary}</p>
                  
                  {userPrediction && (
                    <div className="mt-4 p-3 rounded-lg bg-muted/50">
                      <p className="text-sm">
                        Your prediction: {' '}
                        <span className={userPrediction === feedback.verdict ? 'text-green-500' : 'text-red-500'}>
                          {userPrediction === 'win' ? 'Win' : 'Loss'}
                        </span>
                        {userPrediction === feedback.verdict ? ' ✓ Correct!' : ' ✗ Incorrect'}
                      </p>
                    </div>
                  )}
                </div>

                {/* Categories */}
                <div className="space-y-4 mb-6">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    Performance Breakdown
                  </h3>
                  {feedback.categories.map((cat, i) => (
                    <div key={i} className="bg-muted/30 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">{cat.name}</span>
                        <span className={`font-bold ${
                          cat.score >= 80 ? 'text-green-500' :
                          cat.score >= 60 ? 'text-yellow-500' : 'text-red-500'
                        }`}>
                          {cat.score}/100
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{cat.feedback}</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-green-500 font-medium">Strengths:</span>
                          <ul className="list-disc list-inside text-muted-foreground">
                            {cat.strengths.map((s, j) => <li key={j}>{s}</li>)}
                          </ul>
                        </div>
                        <div>
                          <span className="text-yellow-500 font-medium">Improve:</span>
                          <ul className="list-disc list-inside text-muted-foreground">
                            {cat.improvements.map((s, j) => <li key={j}>{s}</li>)}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Key Moments */}
                {feedback.keyMoments.length > 0 && (
                  <div className="mb-6">
                    <h3 className="font-semibold flex items-center gap-2 mb-3">
                      <Lightbulb className="w-5 h-5" />
                      Key Moments
                    </h3>
                    <div className="space-y-2">
                      {feedback.keyMoments.map((moment, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-muted/20 rounded-lg">
                          {moment.type === 'strength' ? <CheckCircle className="w-4 h-4 text-green-500 mt-0.5" /> :
                           moment.type === 'effective_rebuttal' ? <Target className="w-4 h-4 text-primary mt-0.5" /> :
                           moment.type === 'missed_opportunity' ? <Lightbulb className="w-4 h-4 text-yellow-500 mt-0.5" /> :
                           <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />}
                          <div>
                            <p className="text-sm font-medium">{moment.description}</p>
                            <p className="text-xs text-muted-foreground">{moment.suggestion}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Research Suggestions */}
                {feedback.researchSuggestions.length > 0 && (
                  <div className="mb-6">
                    <h3 className="font-semibold flex items-center gap-2 mb-3">
                      <BookOpen className="w-5 h-5" />
                      Research Suggestions
                    </h3>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                      {feedback.researchSuggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}

                {/* Actions */}
                <div className="space-y-3">
                  <Button variant="outline" onClick={downloadTranscript} className="w-full">
                    <Download className="w-4 h-4 mr-2" />
                    Download Transcript
                  </Button>
                  <Button onClick={() => navigate('/play')} className="w-full bg-gradient-to-r from-primary to-secondary">
                    Find Another Debate
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results without feedback (fallback) */}
      {phase === 'results' && !feedback && (
        <div className="fixed inset-0 bg-background z-50 flex items-center justify-center p-4">
          <div className="glass-card p-8 max-w-md text-center">
            <Trophy className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
            <h2 className="font-display text-2xl font-bold mb-2">Debate Complete!</h2>
            <p className="text-muted-foreground mb-6">Thanks for debating!</p>
            <div className="space-y-3">
              <Button variant="outline" onClick={downloadTranscript} className="w-full">
                <Download className="w-4 h-4 mr-2" />
                Download Transcript
              </Button>
              <Button onClick={() => navigate('/play')} className="w-full">
                Back to Matchmaking
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveDebateRoom;
