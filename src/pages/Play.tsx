import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  Bot,
  Users,
  Globe,
  ArrowLeft,
  X,
  Loader2,
  Crown,
  Swords,
  Clock,
  Timer,
  Hourglass,
  Lock,
  Search,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/browserClient';
import logo from '@/assets/rebutly-logo.png';
import PlayDebate from './PlayDebate';

// Demo formats (playable)
type PlayableFormat = 'rapid' | 'standard' | 'extended';
// Advanced formats (coming soon)
type AdvancedFormat = 'BP' | 'AP' | 'LD' | 'PF' | 'WSDC';
type MatchMode = 'ranked' | 'unranked';

const PLAYABLE_FORMATS: { value: PlayableFormat; label: string; description: string; icon: React.ElementType }[] = [
  { value: 'rapid', label: '1-Minute Rapid Fire', description: '30s prep, 1min speeches', icon: Zap },
  { value: 'standard', label: '3-Minute Standard', description: '1min prep, 3min speeches', icon: Timer },
  { value: 'extended', label: '7-Minute Extended', description: '15min prep, 7min speeches', icon: Hourglass },
];

const ADVANCED_FORMATS: { value: AdvancedFormat; label: string; description: string }[] = [
  { value: 'BP', label: 'British Parliamentary', description: '4 teams, 8 speakers' },
  { value: 'AP', label: 'Asian Parliamentary', description: '2 teams, 6 speakers' },
  { value: 'LD', label: 'Lincoln-Douglas', description: '1v1 value debate' },
  { value: 'PF', label: 'Public Forum', description: '2v2 current events' },
  { value: 'WSDC', label: 'World Schools', description: '3v3 international style' },
];

const modes: { value: MatchMode; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'ranked', label: 'Ranked', icon: Crown, description: 'ELO rating on the line' },
  { value: 'unranked', label: 'Casual', icon: Swords, description: 'Practice without pressure' },
];

const SAMPLE_TOPICS = [
  "This House believes that social media does more harm than good",
  "This House would ban the use of facial recognition technology by governments",
  "This House believes that space exploration is a waste of resources",
  "This House would implement a universal basic income",
  "This House believes artificial intelligence poses an existential threat to humanity",
  "This House would abolish standardized testing in schools",
];

const HUMAN_SEARCH_TIMEOUT = 30; // 30 seconds for human matchmaking

const Play = () => {
  const navigate = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();

  // Matchmaking state
  const [format, setFormat] = useState<PlayableFormat>('standard');
  const [mode, setMode] = useState<MatchMode>('unranked');
  const [topic, setTopic] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchTime, setSearchTime] = useState(0);
  const [queueEntryId, setQueueEntryId] = useState<string | null>(null);

  // AI debate state
  const [showAIDebate, setShowAIDebate] = useState(false);

  // Refs for cleanup
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const triggerMatchmaking = useCallback(async (entryId: string) => {
    const { data: fnData, error: fnError } = await supabase.functions.invoke('matchmaking-worker', {
      body: { entryId },
    });

    if (!fnError && fnData?.matchFound && fnData?.roomId) {
      return fnData;
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('attempt_matchmaking', {
      p_entry_id: entryId,
    });

    if (rpcError) {
      throw rpcError;
    }

    return rpcData as { matchFound?: boolean; roomId?: string } | null;
  }, []);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/demo', { replace: true });
    }
  }, [user, authLoading, navigate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearInterval(searchTimerRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, []);

  // Handle AI fallback when human search times out
  const handleAIFallback = useCallback(async () => {
    console.log('Human search timed out, falling back to AI...');
    
    // Cleanup timers & realtime first
    if (searchTimerRef.current) clearInterval(searchTimerRef.current);
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    // Delete the queue entry (cleaner than update to avoid constraint issues)
    if (queueEntryId) {
      await supabase
        .from('match_queue_entries')
        .delete()
        .eq('id', queueEntryId)
        .eq('status', 'waiting');
    }

    setIsSearching(false);
    setSearchTime(0);
    setQueueEntryId(null);
    toast.info('No human opponent found. Starting AI debate...');
    
    // Start AI debate with same settings
    setShowAIDebate(true);
  }, [queueEntryId]);

  // Send heartbeat to keep queue entry alive
  const sendHeartbeat = useCallback(async (entryId: string) => {
    try {
      await supabase
        .from('match_queue_entries')
        .update({ last_heartbeat_at: new Date().toISOString() })
        .eq('id', entryId)
        .eq('status', 'waiting'); // Only update if still waiting
    } catch (err) {
      console.error('Heartbeat failed:', err);
    }
  }, []);

  const handleStartAIDebate = () => {
    const debateTopic = topic.trim() || SAMPLE_TOPICS[Math.floor(Math.random() * SAMPLE_TOPICS.length)];
    if (!topic.trim()) {
      setTopic(debateTopic);
    }
    setShowAIDebate(true);
  };

  const handleFindHumanMatch = async () => {
    if (!user) return;

    setIsSearching(true);
    setSearchTime(0);

    try {
      // Get user's ELO for the format
      const formatKey = format === 'rapid' ? 'LD' : format === 'extended' ? 'WSDC' : 'AP';
      const elo = (profile?.elo_by_format as Record<string, number>)?.[formatKey] || 1200;

      // Cancel ALL existing waiting entries for this user first (atomic delete approach)
      // Using delete is cleaner than update to avoid constraint conflicts
      await supabase
        .from('match_queue_entries')
        .delete()
        .eq('user_id', user.id)
        .eq('status', 'waiting');

      // Map format to DB format
      const dbFormat = format === 'rapid' ? 'LD' : format === 'extended' ? 'WSDC' : 'AP';
      
      // Use provided topic or generate a random one
      const debateTopic = topic.trim() || SAMPLE_TOPICS[Math.floor(Math.random() * SAMPLE_TOPICS.length)];
      if (!topic.trim()) {
        setTopic(debateTopic);
      }
      
      // Create queue entry - GLOBAL matchmaking (no region)
      const { data: entry, error } = await supabase
        .from('match_queue_entries')
        .insert({
          user_id: user.id,
          format: dbFormat,
          mode,
          region: 'global', // Always global
          opponent_type: 'human_then_ai',
          elo,
          status: 'waiting',
          topic: debateTopic, // Include topic for matchmaking
        })
        .select()
        .single();

      if (error) {
        console.error('Insert queue entry error:', error);
        throw error;
      }

      setQueueEntryId(entry.id);
      console.log('Queue entry created:', entry.id);

      // Start search timer with AI fallback at 30 seconds
      searchTimerRef.current = setInterval(() => {
        setSearchTime(prev => {
          const newTime = prev + 1;
          if (newTime >= HUMAN_SEARCH_TIMEOUT) {
            handleAIFallback();
          }
          return newTime;
        });
      }, 1000);

      // Start heartbeat every 5 seconds
      heartbeatRef.current = setInterval(() => {
        sendHeartbeat(entry.id);
      }, 5000);

      // Subscribe to queue entry updates for match notification via Realtime
      channelRef.current = supabase
        .channel(`queue-${entry.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'match_queue_entries',
            filter: `id=eq.${entry.id}`,
          },
          (payload) => {
            const updated = payload.new as any;
            console.log('Queue entry updated via realtime:', updated.status, updated.room_id);
            
            if (updated.status === 'matched' && updated.room_id) {
              // Cleanup
              if (searchTimerRef.current) clearInterval(searchTimerRef.current);
              if (heartbeatRef.current) clearInterval(heartbeatRef.current);
              if (channelRef.current) supabase.removeChannel(channelRef.current);
              
              setIsSearching(false);
              setSearchTime(0);
              setQueueEntryId(null);
              toast.success('Match found!');
              navigate(`/room/${updated.room_id}`);
            }
          }
        )
        .subscribe((status) => {
          console.log('Realtime subscription status:', status);
        });

      // Trigger matchmaking via edge function, fallback to DB RPC when edge routes are unavailable
      const matchResult = await triggerMatchmaking(entry.id);
      console.log('Matchmaking result:', matchResult);

      // If immediate match found by worker, handle it
      if (matchResult?.matchFound && matchResult?.roomId) {
        // Cleanup
        if (searchTimerRef.current) clearInterval(searchTimerRef.current);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        if (channelRef.current) supabase.removeChannel(channelRef.current);
        
        setIsSearching(false);
        setSearchTime(0);
        setQueueEntryId(null);
        toast.success('Match found!');
        navigate(`/room/${matchResult.roomId}`);
        return;
      }

      // Otherwise timer continues and fallback to AI after 30s

    } catch (err) {
      console.error('Error joining queue:', err);
      toast.error('Failed to search for match');
      setIsSearching(false);
      setSearchTime(0);
    }
  };

  const handleCancelSearch = async () => {
    // Cleanup timers & realtime first
    if (searchTimerRef.current) clearInterval(searchTimerRef.current);
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    // Delete the waiting queue entry (cleaner than update)
    if (queueEntryId) {
      await supabase
        .from('match_queue_entries')
        .delete()
        .eq('id', queueEntryId)
        .eq('status', 'waiting');
    }

    setIsSearching(false);
    setSearchTime(0);
    setQueueEntryId(null);
    toast.info('Search cancelled');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show AI debate screen if active
  if (showAIDebate) {
    return (
      <PlayDebate 
        topic={topic || SAMPLE_TOPICS[Math.floor(Math.random() * SAMPLE_TOPICS.length)]}
        format={format}
        onExit={() => {
          setShowAIDebate(false);
          setTopic('');
        }}
      />
    );
  }

  const currentElo = (profile?.elo_by_format as Record<string, number>)?.['standard'] || 1200;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="Rebutly.AI" className="w-8 h-8 rounded-lg" />
            <span className="font-display font-bold text-lg">
              Rebutly<span className="text-primary">.AI</span>
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Your ELO</p>
              <p className="font-display font-bold text-primary">{currentElo}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Match Settings */}
          <div className="space-y-6">
            <div>
              <h1 className="font-display text-3xl font-bold mb-2">Start a Debate</h1>
              <p className="text-muted-foreground">Configure your match settings</p>
            </div>

            {/* Topic Input */}
            <div className="glass-card p-6">
              <Label className="text-lg font-semibold mb-4 block">Debate Topic / Motion</Label>
              <Textarea
                placeholder="Enter your debate topic or motion..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="mb-3"
                rows={3}
              />
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setTopic(SAMPLE_TOPICS[Math.floor(Math.random() * SAMPLE_TOPICS.length)])}
              >
                Random Topic
              </Button>
            </div>

            {/* Format Selection */}
            <div className="glass-card p-6">
              <Label className="text-lg font-semibold mb-4 block">Debate Format</Label>
              <RadioGroup value={format} onValueChange={(v) => setFormat(v as PlayableFormat)}>
                <div className="grid gap-3">
                  {/* Playable formats */}
                  {PLAYABLE_FORMATS.map((f) => {
                    const Icon = f.icon;
                    return (
                      <label
                        key={f.value}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                          format === f.value
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-muted-foreground'
                        }`}
                      >
                        <RadioGroupItem value={f.value} />
                        <Icon className={`w-5 h-5 ${format === f.value ? 'text-primary' : 'text-muted-foreground'}`} />
                        <div className="flex-1">
                          <span className="font-medium">{f.label}</span>
                          <p className="text-xs text-muted-foreground">{f.description}</p>
                        </div>
                      </label>
                    );
                  })}
                  
                  {/* Advanced formats - disabled */}
                  <div className="mt-2 pt-2 border-t border-border">
                    <p className="text-xs text-muted-foreground mb-2">Advanced Formats</p>
                    {ADVANCED_FORMATS.map((f) => (
                      <div
                        key={f.value}
                        className="flex items-center gap-3 p-3 rounded-lg border border-border opacity-50 cursor-not-allowed mb-2"
                      >
                        <Lock className="w-4 h-4 text-muted-foreground" />
                        <div className="flex-1">
                          <span className="font-medium">{f.label}</span>
                          <span className="text-xs text-muted-foreground ml-2">({f.value})</span>
                          <p className="text-xs text-muted-foreground">{f.description}</p>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-muted text-xs text-muted-foreground">
                          🔒 Coming Soon
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </RadioGroup>
            </div>

            {/* Mode Selection (for human matches) */}
            <div className="glass-card p-6">
              <Label className="text-lg font-semibold mb-4 block">Match Mode</Label>
              <div className="grid grid-cols-2 gap-3">
                {modes.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-all ${
                      mode === m.value
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-muted-foreground'
                    }`}
                  >
                    <m.icon className={`w-6 h-6 ${mode === m.value ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="font-medium">{m.label}</span>
                    <span className="text-xs text-muted-foreground">{m.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Global matchmaking info */}
            <div className="flex items-center gap-2 px-4 py-3 bg-muted/50 rounded-lg">
              <Globe className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">
                Global matchmaking • Fastest queue times
              </span>
            </div>
          </div>

          {/* Action Panel */}
          <div className="lg:sticky lg:top-8 h-fit">
            <div className="glass-card p-6 space-y-6">
              {/* Summary */}
              <div>
                <h2 className="font-display text-xl font-bold mb-4">Match Summary</h2>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Format</span>
                    <span className="font-medium">{PLAYABLE_FORMATS.find(f => f.value === format)?.label}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mode</span>
                    <span className="font-medium capitalize">{mode}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Region</span>
                    <span className="font-medium flex items-center gap-1">
                      <Globe className="w-3 h-3" /> Global
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Topic</span>
                    <span className="font-medium text-right max-w-[60%] truncate">
                      {topic || 'Random'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Your ELO</span>
                    <span className="font-medium text-primary">{currentElo}</span>
                  </div>
                </div>
              </div>

              {/* Actions - Human matchmaking is PRIMARY */}
              <div className="space-y-3">
                <Button
                  onClick={handleFindHumanMatch}
                  disabled={isSearching}
                  className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-primary to-secondary"
                >
                  <Users className="w-5 h-5 mr-2" />
                  Find a Match
                </Button>

                <Button
                  variant="outline"
                  onClick={handleStartAIDebate}
                  disabled={isSearching}
                  className="w-full h-12"
                >
                  <Bot className="w-4 h-4 mr-2" />
                  Debate vs AI
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Human matchmaking searches for 30 seconds, then auto-falls back to AI
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Searching Overlay */}
      <AnimatePresence>
        {isSearching && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/95 backdrop-blur-md z-50 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card p-8 max-w-md w-full mx-4 text-center"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                className="w-20 h-20 mx-auto mb-6 rounded-full border-4 border-primary/30 border-t-primary"
              />
              
              <h2 className="font-display text-2xl font-bold mb-2">Finding Opponent</h2>
              <p className="text-muted-foreground mb-6">
                Searching for a worthy opponent...
              </p>
              
              {/* Timer */}
              <div className="mb-6">
                <div className="text-4xl font-mono font-bold text-primary mb-2">
                  {Math.floor((HUMAN_SEARCH_TIMEOUT - searchTime) / 60)}:{((HUMAN_SEARCH_TIMEOUT - searchTime) % 60).toString().padStart(2, '0')}
                </div>
                <p className="text-xs text-muted-foreground">
                  Auto-fallback to AI in {HUMAN_SEARCH_TIMEOUT - searchTime}s
                </p>
                <div className="w-full h-2 bg-muted rounded-full mt-2 overflow-hidden">
                  <motion.div 
                    className="h-full bg-primary"
                    initial={{ width: '0%' }}
                    animate={{ width: `${(searchTime / HUMAN_SEARCH_TIMEOUT) * 100}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
              
              {/* Match details */}
              <div className="text-sm text-muted-foreground space-y-1 mb-6">
                <p>Format: <span className="text-foreground">{PLAYABLE_FORMATS.find(f => f.value === format)?.label}</span></p>
                <p>Mode: <span className="text-foreground capitalize">{mode}</span></p>
                <p className="flex items-center justify-center gap-1">
                  Region: <Globe className="w-3 h-3" /> <span className="text-foreground">Global</span>
                </p>
              </div>
              
              <Button
                variant="outline"
                onClick={handleCancelSearch}
                className="gap-2"
              >
                <X className="w-4 h-4" />
                Cancel Search
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Play;
