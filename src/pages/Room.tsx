import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Phone,
  MessageSquare,
  Settings,
  Users,
  Bot,
  ArrowLeft,
  Trophy,
  Clock,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/browserClient';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import logo from '@/assets/rebutly-logo.png';

type RoomStatus = 'reserved' | 'live' | 'completed' | 'abandoned';
type MatchResult = 'win' | 'loss' | 'draw';
type DebateFormat = 'BP' | 'AP' | 'LD' | 'PF' | 'WSDC';
type MatchMode = 'ranked' | 'unranked';

interface Room {
  id: string;
  format: DebateFormat;
  mode: MatchMode;
  status: RoomStatus;
  is_ai_opponent: boolean;
  ai_model: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

interface Participant {
  id: string;
  room_id: string;
  user_id: string | null;
  is_ai: boolean;
  role: string | null;
  connected_at: string | null;
  profile?: {
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    elo_by_format: Record<string, number>;
  };
}

const Room = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile: currentUserProfile } = useAuth();

  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [submittedResult, setSubmittedResult] = useState<MatchResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch room data
  useEffect(() => {
    if (!id) return;

    const fetchRoom = async () => {
      try {
        const { data: roomData, error: roomError } = await supabase
          .from('debate_rooms')
          .select('*')
          .eq('id', id)
          .single();

        if (roomError) throw roomError;
        
        // Redirect to live room for human vs human matches
        if (!roomData.is_ai_opponent) {
          navigate(`/room/${id}/live`, { replace: true });
          return;
        }
        
        setRoom(roomData as Room);

        // Fetch participants
        const { data: participantsData, error: participantsError } = await supabase
          .from('debate_participants')
          .select('*')
          .eq('room_id', id);

        if (participantsError) throw participantsError;
        
        // Fetch profiles for human participants
        const humanParticipants = participantsData.filter(p => p.user_id);
        const userIds = humanParticipants.map(p => p.user_id).filter(Boolean);
        
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

        // Check if current user is a participant
        const isParticipant = participantsData.some(p => p.user_id === user?.id);
        if (!isParticipant && !roomData.is_ai_opponent) {
          setError('You are not a participant in this debate');
        }

        // Update connection status
        if (user) {
          await supabase
            .from('debate_participants')
            .update({ connected_at: new Date().toISOString() })
            .eq('room_id', id)
            .eq('user_id', user.id);

          // If both participants connected and room is reserved, make it live
          if (roomData.status === 'reserved') {
            const allConnected = participantsData.every(p => p.is_ai || p.connected_at);
            if (allConnected) {
              await supabase
                .from('debate_rooms')
                .update({ status: 'live', started_at: new Date().toISOString() })
                .eq('id', id);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching room:', err);
        setError('Failed to load room');
      } finally {
        setLoading(false);
      }
    };

    fetchRoom();
  }, [id, user, navigate]);

  // Subscribe to room changes
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`room-${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'debate_rooms',
          filter: `id=eq.${id}`,
        },
        (payload) => {
          setRoom(payload.new as Room);
          if ((payload.new as Room).status === 'completed') {
            navigate(`/room/${id}/results`);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'debate_participants',
          filter: `room_id=eq.${id}`,
        },
        async () => {
          // Refetch participants
          const { data: participantsData } = await supabase
            .from('debate_participants')
            .select('*')
            .eq('room_id', id);
          
          if (participantsData) {
            const userIds = participantsData.filter(p => p.user_id).map(p => p.user_id);
            let profilesMap: Record<string, any> = {};
            
            if (userIds.length > 0) {
              const { data: profiles } = await supabase
                .from('profiles')
                .select('user_id, username, display_name, avatar_url, elo_by_format')
                .in('user_id', userIds as string[]);
              
              if (profiles) {
                profilesMap = profiles.reduce((acc, p) => ({ ...acc, [p.user_id]: p }), {});
              }
            }
            
            const participantsWithProfiles = participantsData.map(p => ({
              ...p,
              profile: p.user_id ? profilesMap[p.user_id] : undefined,
            }));
            setParticipants(participantsWithProfiles as Participant[]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, navigate]);

  // Timer for live room
  useEffect(() => {
    if (room?.status !== 'live' || !room.started_at) return;

    const startTime = new Date(room.started_at).getTime();
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [room?.status, room?.started_at]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSubmitResult = async (result: MatchResult) => {
    if (!user || !id) return;

    setIsSubmitting(true);
    try {
      await supabase.from('match_result_submissions').insert({
        room_id: id,
        user_id: user.id,
        submitted_result: result,
      });

      setSubmittedResult(result);
      toast.success('Result submitted. Waiting for opponent...');

      // Check if both players submitted
      const { data: submissions } = await supabase
        .from('match_result_submissions')
        .select('*')
        .eq('room_id', id);

      if (submissions && submissions.length >= 2) {
        // Check if results are consistent
        const results = submissions.map(s => s.submitted_result);
        const isConsistent = 
          (results.includes('win') && results.includes('loss')) ||
          (results.every(r => r === 'draw'));

        if (isConsistent) {
          // Update room to completed
          await supabase
            .from('debate_rooms')
            .update({
              status: 'completed',
              ended_at: new Date().toISOString(),
              ended_reason: 'completed',
            })
            .eq('id', id);

          // Trigger ELO update via edge function
          if (room?.mode === 'ranked' && !room?.is_ai_opponent) {
            const { error: eloFnError } = await supabase.functions.invoke('update-elo', {
              body: { roomId: id },
            });

            // Fallback path when edge routes are unavailable
            if (eloFnError) {
              const { error: eloRpcError } = await supabase.rpc('process_elo_update', {
                p_room_id: id,
              });
              if (eloRpcError) {
                console.error('ELO fallback RPC failed:', eloRpcError);
              }
            }
          }

          navigate(`/room/${id}/results`);
        } else {
          toast.error('Results conflict. Please discuss with your opponent.');
        }
      }
    } catch (err) {
      console.error('Error submitting result:', err);
      toast.error('Failed to submit result');
    } finally {
      setIsSubmitting(false);
      setShowResultModal(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (!user || !id) return;

    try {
      await supabase
        .from('debate_participants')
        .update({ disconnected_at: new Date().toISOString() })
        .eq('room_id', id)
        .eq('user_id', user.id);

      // If room is live and opponent is human, mark as abandoned
      if (room?.status === 'live' && !room?.is_ai_opponent) {
        await supabase
          .from('debate_rooms')
          .update({
            status: 'abandoned',
            ended_at: new Date().toISOString(),
            ended_reason: 'disconnect',
          })
          .eq('id', id);
      }

      navigate('/play');
    } catch (err) {
      console.error('Error leaving room:', err);
    }
  };

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

  if (error || !room) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="glass-card p-8 max-w-md text-center">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="font-display text-xl font-bold mb-2">Room Not Found</h1>
          <p className="text-muted-foreground mb-6">{error || 'This room does not exist or has expired.'}</p>
          <Button onClick={() => navigate('/play')}>
            Back to Play
          </Button>
        </div>
      </div>
    );
  }

  const opponent = participants.find(p => p.user_id !== user?.id || p.is_ai);
  const currentPlayer = participants.find(p => p.user_id === user?.id);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2">
              <img src={logo} alt="Rebutly.AI" className="w-8 h-8 rounded-lg" />
            </Link>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded bg-primary/20 text-primary text-sm font-medium">
                {room.format}
              </span>
              <span className="px-2 py-1 rounded bg-muted text-muted-foreground text-sm capitalize">
                {room.mode}
              </span>
              {room.is_ai_opponent && (
                <span className="px-2 py-1 rounded bg-accent/20 text-accent text-sm flex items-center gap-1">
                  <Bot className="w-3 h-3" /> AI Match
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Timer */}
            <div className="flex items-center gap-2 text-lg font-mono">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className={room.status === 'live' ? 'text-success' : 'text-muted-foreground'}>
                {formatTime(elapsedTime)}
              </span>
            </div>

            {/* Status indicator */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                room.status === 'live' ? 'bg-success animate-pulse' :
                room.status === 'reserved' ? 'bg-warning animate-pulse' :
                'bg-muted-foreground'
              }`} />
              <span className="text-sm capitalize">{room.status}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4">
        <div className="max-w-7xl mx-auto h-full">
          {/* Waiting for opponent */}
          {room.status === 'reserved' && (
            <div className="h-full flex items-center justify-center">
              <div className="glass-card p-8 text-center max-w-md">
                <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                <h2 className="font-display text-xl font-bold mb-2">Waiting for opponent...</h2>
                <p className="text-muted-foreground mb-4">
                  The debate will begin when your opponent connects
                </p>
                <div className="flex items-center justify-center gap-4">
                  {participants.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${
                        p.connected_at ? 'bg-success' : 'bg-muted-foreground animate-pulse'
                      }`} />
                      <span className="text-sm">
                        {p.is_ai ? 'AI Opponent' : p.profile?.display_name || 'Player ' + (i + 1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Live debate */}
          {room.status === 'live' && (
            <div className="grid lg:grid-cols-3 gap-4 h-full">
              {/* Video area */}
              <div className="lg:col-span-2 space-y-4">
                <div className="grid grid-cols-2 gap-4 h-[60vh]">
                  {/* Opponent video */}
                  <div className="relative rounded-xl overflow-hidden bg-card border border-border">
                    <div className="absolute inset-0 flex items-center justify-center">
                      {opponent?.is_ai ? (
                        <div className="text-center">
                          <Bot className="w-16 h-16 text-primary mx-auto mb-2" />
                          <p className="font-display font-bold">AI Opponent</p>
                          <p className="text-sm text-muted-foreground">{room.ai_model}</p>
                        </div>
                      ) : (
                        <div className="text-center">
                          <Users className="w-16 h-16 text-muted-foreground mx-auto mb-2" />
                          <p className="font-display font-bold">
                            {opponent?.profile?.display_name || 'Opponent'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            ELO: {opponent?.profile?.elo_by_format?.[room.format] || 1200}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-background/80 text-xs">
                      {opponent?.role || 'Opposition'}
                    </div>
                  </div>

                  {/* Your video */}
                  <div className="relative rounded-xl overflow-hidden bg-card border border-border">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <Users className="w-16 h-16 text-primary mx-auto mb-2" />
                        <p className="font-display font-bold">You</p>
                        <p className="text-sm text-muted-foreground">
                          ELO: {currentUserProfile?.elo_by_format?.[room.format] || 1200}
                        </p>
                      </div>
                    </div>
                    <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-background/80 text-xs">
                      {currentPlayer?.role || 'Proposition'}
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant={micEnabled ? 'outline' : 'destructive'}
                    size="icon"
                    onClick={() => setMicEnabled(!micEnabled)}
                    className="w-12 h-12 rounded-full"
                  >
                    {micEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                  </Button>
                  <Button
                    variant={videoEnabled ? 'outline' : 'secondary'}
                    size="icon"
                    onClick={() => setVideoEnabled(!videoEnabled)}
                    className="w-12 h-12 rounded-full"
                  >
                    {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={handleLeaveRoom}
                    className="w-12 h-12 rounded-full"
                  >
                    <Phone className="w-5 h-5 rotate-[135deg]" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="w-12 h-12 rounded-full"
                  >
                    <MessageSquare className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="w-12 h-12 rounded-full"
                  >
                    <Settings className="w-5 h-5" />
                  </Button>
                </div>
              </div>

              {/* Side panel */}
              <div className="space-y-4">
                {/* Match controls */}
                <div className="glass-card p-4">
                  <h3 className="font-display font-bold mb-3">Match Controls</h3>
                  <Button
                    onClick={() => setShowResultModal(true)}
                    className="w-full bg-gradient-to-r from-primary to-secondary"
                    disabled={submittedResult !== null}
                  >
                    <Trophy className="w-4 h-4 mr-2" />
                    {submittedResult ? 'Result Submitted' : 'End Match'}
                  </Button>
                  {submittedResult && (
                    <p className="text-sm text-muted-foreground mt-2 text-center">
                      You submitted: {submittedResult}
                    </p>
                  )}
                </div>

                {/* Participants */}
                <div className="glass-card p-4">
                  <h3 className="font-display font-bold mb-3">Participants</h3>
                  <div className="space-y-3">
                    {participants.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                          {p.is_ai ? (
                            <Bot className="w-5 h-5 text-white" />
                          ) : (
                            <span className="text-white font-bold">
                              {(p.profile?.display_name || 'U')[0].toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-sm">
                            {p.is_ai ? 'AI Opponent' : p.profile?.display_name || 'Unknown'}
                          </p>
                          <p className="text-xs text-muted-foreground capitalize">{p.role}</p>
                        </div>
                        <div className={`w-2 h-2 rounded-full ${
                          p.is_ai || p.connected_at ? 'bg-success' : 'bg-muted-foreground'
                        }`} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Result submission modal */}
      <AnimatePresence>
        {showResultModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowResultModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="font-display text-xl font-bold mb-4">Submit Match Result</h2>
              <p className="text-muted-foreground mb-6">
                Select the outcome of this debate. Both players must submit consistent results.
              </p>

              <div className="grid grid-cols-3 gap-3 mb-6">
                <Button
                  variant="outline"
                  onClick={() => handleSubmitResult('win')}
                  disabled={isSubmitting}
                  className="flex flex-col items-center gap-2 h-auto py-4 hover:border-success hover:text-success"
                >
                  <CheckCircle className="w-6 h-6" />
                  <span>I Won</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleSubmitResult('loss')}
                  disabled={isSubmitting}
                  className="flex flex-col items-center gap-2 h-auto py-4 hover:border-destructive hover:text-destructive"
                >
                  <XCircle className="w-6 h-6" />
                  <span>I Lost</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleSubmitResult('draw')}
                  disabled={isSubmitting}
                  className="flex flex-col items-center gap-2 h-auto py-4 hover:border-warning hover:text-warning"
                >
                  <Trophy className="w-6 h-6" />
                  <span>Draw</span>
                </Button>
              </div>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setShowResultModal(false)}
              >
                Cancel
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Room;
