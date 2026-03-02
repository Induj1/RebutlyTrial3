import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/browserClient';
import { useAuth } from './useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export type DebateFormat = 'BP' | 'AP' | 'LD' | 'PF' | 'WSDC';
export type MatchMode = 'ranked' | 'unranked';
export type OpponentType = 'human_only' | 'ai_only' | 'human_then_ai';
export type QueueStatus = 'waiting' | 'matched' | 'cancelled' | 'expired';

interface MatchSettings {
  format: DebateFormat;
  mode: MatchMode;
  opponentType: OpponentType;
  ageBracket?: string;
}

interface QueueEntry {
  id: string;
  user_id: string;
  format: DebateFormat;
  mode: MatchMode;
  opponent_type: OpponentType;
  elo: number;
  status: QueueStatus;
  joined_at: string;
  matched_at: string | null;
  room_id: string | null;
}

interface UseMatchmakingReturn {
  isSearching: boolean;
  searchTime: number;
  queueEntry: QueueEntry | null;
  joinQueue: (settings: MatchSettings) => Promise<void>;
  cancelQueue: () => Promise<void>;
  error: string | null;
}

const AI_FALLBACK_TIMEOUT = 30000; // 30 seconds for human search
const HEARTBEAT_INTERVAL = 5000; // 5 seconds

export const useMatchmaking = (): UseMatchmakingReturn => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [isSearching, setIsSearching] = useState(false);
  const [searchTime, setSearchTime] = useState(0);
  const [queueEntry, setQueueEntry] = useState<QueueEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const aiFallbackRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const triggerMatchmaking = useCallback(async (entryId: string) => {
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke('matchmaking-worker', {
        body: { entryId },
      });

      if (!fnError && fnData?.matchFound && fnData?.roomId) {
        return fnData;
      }
    } catch (err) {
      // Edge Function may fail due to CORS, network, or gateway issues - fall back to RPC
      console.warn('[Matchmaking] Edge function unavailable, using RPC fallback:', err);
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('attempt_matchmaking', {
      p_entry_id: entryId,
    });

    if (rpcError) {
      throw rpcError;
    }

    return rpcData as { matchFound?: boolean; roomId?: string } | null;
  }, []);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (searchTimerRef.current) clearInterval(searchTimerRef.current);
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (aiFallbackRef.current) clearTimeout(aiFallbackRef.current);
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setSearchTime(0);
  }, []);

  // Send heartbeat to keep queue entry alive
  const sendHeartbeat = useCallback(async (entryId: string) => {
    try {
      await supabase
        .from('match_queue_entries')
        .update({ last_heartbeat_at: new Date().toISOString() })
        .eq('id', entryId)
        .eq('status', 'waiting'); // Only if still waiting
    } catch (err) {
      console.error('Heartbeat error:', err);
    }
  }, []);

  // Create AI match after timeout
  const createAIMatch = useCallback(async (entry: QueueEntry) => {
    if (!user) return;

    try {
      // Create debate room with AI opponent
      const { data: room, error: roomError } = await supabase
        .from('debate_rooms')
        .insert({
          format: entry.format,
          mode: entry.mode,
          region: 'global', // Always global
          status: 'live',
          is_ai_opponent: true,
          ai_model: 'rebutly-ai-v1',
          ai_difficulty: 'adaptive',
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (roomError) throw roomError;

      // Add human participant
      await supabase.from('debate_participants').insert({
        room_id: room.id,
        user_id: user.id,
        is_ai: false,
        role: entry.format === 'LD' ? 'affirmative' : 'proposition',
        speaking_order: 1,
        connected_at: new Date().toISOString(),
      });

      // Add AI participant
      await supabase.from('debate_participants').insert({
        room_id: room.id,
        user_id: null,
        is_ai: true,
        role: entry.format === 'LD' ? 'negative' : 'opposition',
        speaking_order: 2,
      });

      // Update queue entry
      await supabase
        .from('match_queue_entries')
        .update({
          status: 'matched',
          matched_at: new Date().toISOString(),
          room_id: room.id,
        })
        .eq('id', entry.id);

      cleanup();
      setIsSearching(false);
      toast.success('Matched with AI opponent!');
      navigate(`/room/${room.id}`);
    } catch (err) {
      console.error('Error creating AI match:', err);
      setError('Failed to create AI match');
    }
  }, [user, cleanup, navigate]);

  // Subscribe to queue entry changes
  const subscribeToQueue = useCallback((entryId: string) => {
    channelRef.current = supabase
      .channel(`queue-${entryId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'match_queue_entries',
          filter: `id=eq.${entryId}`,
        },
        (payload) => {
          const updated = payload.new as QueueEntry;
          setQueueEntry(updated);

          if (updated.status === 'matched' && updated.room_id) {
            cleanup();
            setIsSearching(false);
            toast.success('Match found!');
            navigate(`/room/${updated.room_id}`);
          }
        }
      )
      .subscribe();
  }, [cleanup, navigate]);

  // Join matchmaking queue
  const joinQueue = useCallback(async (settings: MatchSettings) => {
    if (!user || !profile) {
      setError('You must be logged in to join matchmaking');
      return;
    }

    setError(null);
    setIsSearching(true);

    try {
      // Get user's ELO for the selected format
      const elo = (profile.elo_by_format as Record<string, number>)?.[settings.format] || 1200;

      // Delete any existing waiting entries for this user (cleaner than update)
      await supabase
        .from('match_queue_entries')
        .delete()
        .eq('user_id', user.id)
        .eq('status', 'waiting');

      // Create new queue entry - GLOBAL matchmaking (no region)
      const { data: entry, error: insertError } = await supabase
        .from('match_queue_entries')
        .insert({
          user_id: user.id,
          format: settings.format,
          mode: settings.mode,
          region: 'global', // Always global
          opponent_type: settings.opponentType,
          elo,
          age_bracket: settings.ageBracket,
          status: 'waiting',
        })
        .select()
        .single();

      if (insertError) throw insertError;

      setQueueEntry(entry as QueueEntry);

      // Start search timer
      searchTimerRef.current = setInterval(() => {
        setSearchTime((prev) => prev + 1);
      }, 1000);

      // Start heartbeat
      heartbeatRef.current = setInterval(() => {
        sendHeartbeat(entry.id);
      }, HEARTBEAT_INTERVAL);

      // Subscribe to changes
      subscribeToQueue(entry.id);

      // Trigger matchmaking via edge function, fallback to DB RPC when edge routes are unavailable
      const matchResult = await triggerMatchmaking(entry.id);
      if (matchResult?.matchFound && matchResult?.roomId) {
        cleanup();
        setIsSearching(false);
        toast.success('Match found!');
        navigate(`/room/${matchResult.roomId}`);
        return;
      }

      // Set up AI fallback if enabled
      if (settings.opponentType === 'human_then_ai' || settings.opponentType === 'ai_only') {
        const timeout = settings.opponentType === 'ai_only' ? 0 : AI_FALLBACK_TIMEOUT;
        
        aiFallbackRef.current = setTimeout(async () => {
          // Check if still waiting
          const { data: currentEntry } = await supabase
            .from('match_queue_entries')
            .select('*')
            .eq('id', entry.id)
            .single();

          if (currentEntry && currentEntry.status === 'waiting') {
            await createAIMatch(currentEntry as QueueEntry);
          }
        }, timeout);
      }
    } catch (err) {
      console.error('Error joining queue:', err);
      setError('Failed to join matchmaking queue');
      setIsSearching(false);
      cleanup();
    }
  }, [user, profile, cleanup, sendHeartbeat, subscribeToQueue, createAIMatch, triggerMatchmaking, navigate]);

  // Cancel queue
  const cancelQueue = useCallback(async () => {
    // Cleanup first
    cleanup();
    
    // Delete the waiting queue entry (cleaner than update)
    if (queueEntry) {
      await supabase
        .from('match_queue_entries')
        .delete()
        .eq('id', queueEntry.id)
        .eq('status', 'waiting');
    }

    setIsSearching(false);
    setQueueEntry(null);
    toast.info('Search cancelled');
  }, [queueEntry, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isSearching,
    searchTime,
    queueEntry,
    joinQueue,
    cancelQueue,
    error,
  };
};
