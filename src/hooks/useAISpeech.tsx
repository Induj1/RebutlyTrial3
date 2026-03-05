import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';

interface UseAISpeechOptions {
  onWordSpoken?: (wordIndex: number, currentText: string) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
  wordsPerMinute?: number; // Fallback speech rate when TTS not available
}

interface UseAISpeechReturn {
  isSpeaking: boolean;
  currentWord: number;
  displayedText: string;
  progress: number;
  startSpeech: (text: string, durationSeconds: number, voiceGender?: 'male' | 'female') => Promise<void>;
  stopSpeech: () => void;
  isLoading: boolean;
  hasTTS: boolean;
  // Audio controls
  volume: number;
  setVolume: (volume: number) => void;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
  // Audio enable for browser autoplay restrictions
  audioEnabled: boolean;
  enableAudio: () => void;
  // Timer tracking for AI speech
  speechTimeRemaining: number;
  speechTotalTime: number;
}

// Try to use Web Speech API as fallback
const useSpeechSynthesisFallback = () => {
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesLoadedRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
      
      // Wait for voices to load
      const loadVoices = () => {
        const voices = synthRef.current?.getVoices() || [];
        voicesLoadedRef.current = voices.length > 0;
      };
      
      loadVoices();
      synthRef.current.onvoiceschanged = loadVoices;
    }
    
    return () => {
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  const speak = useCallback((text: string, voiceGender: 'male' | 'female', rate: number = 1.2): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!synthRef.current) {
        reject(new Error('Speech synthesis not available'));
        return;
      }

      synthRef.current.cancel(); // Stop any current speech
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.pitch = voiceGender === 'female' ? 1.1 : 0.9;
      utterance.volume = 1;
      
      // Try to find a matching voice
      const voices = synthRef.current.getVoices();
      const preferredVoice = voices.find(v => 
        v.lang.startsWith('en') && 
        ((voiceGender === 'female' && v.name.toLowerCase().includes('female')) ||
         (voiceGender === 'male' && v.name.toLowerCase().includes('male')) ||
         v.name.toLowerCase().includes(voiceGender))
      ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
      
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
      
      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(e);
      utteranceRef.current = utterance;
      
      synthRef.current.speak(utterance);
    });
  }, []);

  const stop = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
  }, []);

  return { speak, stop, isAvailable: !!synthRef.current };
};

export function useAISpeech(options: UseAISpeechOptions = {}): UseAISpeechReturn {
  const { wordsPerMinute = 150 } = options;
  
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentWord, setCurrentWord] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [progress, setProgress] = useState(0);
  const [hasTTS, setHasTTS] = useState(true);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMutedState] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [speechTimeRemaining, setSpeechTimeRemaining] = useState(0);
  const [speechTotalTime, setSpeechTotalTime] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wordsRef = useRef<string[]>([]);
  const timerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const isSpeakingRef = useRef<boolean>(false);
  
  const webSpeech = useSpeechSynthesisFallback();

  // Update audio volume when volume or muted changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      webSpeech.stop();
    };
  }, []);

  const setVolume = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : clampedVolume;
    }
  }, [isMuted]);

  const setIsMuted = useCallback((muted: boolean) => {
    setIsMutedState(muted);
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume]);

  const enableAudio = useCallback(() => {
    // Create a silent audio context to unlock audio
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContext.resume().then(() => {
        setAudioEnabled(true);
        console.log('[useAISpeech] Audio enabled by user interaction');
      });
    } catch (e) {
      console.error('[useAISpeech] Failed to enable audio context:', e);
    }
    setAudioEnabled(true);
  }, []);

  const stopSpeech = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    webSpeech.stop();
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    setProgress(100);
    setSpeechTimeRemaining(0);
    options.onComplete?.();
  }, [options, webSpeech]);

  const startProgressiveText = useCallback((
    words: string[], 
    durationMs: number,
    hasAudio: boolean
  ) => {
    wordsRef.current = words;
    startTimeRef.current = Date.now();
    durationRef.current = durationMs;
    
    setCurrentWord(0);
    setDisplayedText('');
    setProgress(0);
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    
    // Set up countdown timer
    const durationSeconds = Math.ceil(durationMs / 1000);
    setSpeechTotalTime(durationSeconds);
    setSpeechTimeRemaining(durationSeconds);
    
    // Countdown timer (updates every second)
    countdownRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      setSpeechTimeRemaining(remaining);
      
      if (remaining <= 0) {
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      }
    }, 100);

    const totalWords = words.length;
    const msPerWord = durationMs / totalWords;

    let wordIndex = 0;
    
    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const progressPercent = Math.min((elapsed / durationMs) * 100, 100);
      setProgress(progressPercent);

      // Calculate which word we should be at based on elapsed time
      const targetWordIndex = Math.min(
        Math.floor(elapsed / msPerWord),
        totalWords - 1
      );

      if (targetWordIndex > wordIndex) {
        wordIndex = targetWordIndex;
        const currentText = words.slice(0, wordIndex + 1).join(' ');
        setCurrentWord(wordIndex);
        setDisplayedText(currentText);
        options.onWordSpoken?.(wordIndex, currentText);
      }

      // Check if we've reached the end
      if (elapsed >= durationMs) {
        // Show full text
        setDisplayedText(words.join(' '));
        setCurrentWord(totalWords - 1);
        stopSpeech();
      }
    }, 50); // Update every 50ms for smooth progress

  }, [options, stopSpeech]);

  const startSpeech = useCallback(async (text: string, durationSeconds: number, voiceGender: 'male' | 'female' = 'male') => {
    if (isSpeaking) {
      stopSpeech();
    }

    // Strip asterisks and markdown formatting that shouldn't be pronounced
    const cleanedText = text
      .replace(/\*\*/g, '') // Remove bold markers **
      .replace(/\*/g, '')   // Remove single asterisks
      .replace(/_/g, '')    // Remove underscores (italic markers)
      .replace(/`/g, '');   // Remove backticks

    const words = cleanedText.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) {
      options.onError?.('No text to speak');
      return;
    }

    setIsLoading(true);
    const durationMs = durationSeconds * 1000;

    try {
      // Try to get TTS audio (use proxy in dev to avoid CORS when Supabase origins can't be changed)
      console.log('[useAISpeech] Requesting TTS for', words.length, 'words, voice:', voiceGender);
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const ttsUrl =
        import.meta.env.DEV && typeof window !== 'undefined' && supabaseUrl?.includes('supabase.co')
          ? `${window.location.origin}/api/supabase-functions/functions/v1/elevenlabs-tts`
          : `${supabaseUrl}/functions/v1/elevenlabs-tts`;

      const response = await fetch(ttsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ text: cleanedText, voiceGender }),
      });

      const data = await response.json();

      if (data.audioContent && data.success) {
        console.log('[useAISpeech] TTS audio received from ElevenLabs');
        setHasTTS(true);
        
        // Create audio element with data URI
        const audioUrl = `data:audio/mpeg;base64,${data.audioContent}`;
        const audio = new Audio(audioUrl);
        audio.volume = isMuted ? 0 : volume;
        audioRef.current = audio;

        // Start progressive text display timed to speech duration
        audio.onloadedmetadata = () => {
          const audioDuration = audio.duration * 1000; // Convert to ms
          // Use shorter of allocated time or actual audio duration
          const effectiveDuration = Math.min(audioDuration, durationMs);
          startProgressiveText(words, effectiveDuration, true);
        };

        audio.onended = () => {
          // Only stop if still speaking (might have been stopped manually)
          if (isSpeakingRef.current) {
            setDisplayedText(text);
            stopSpeech();
          }
        };

        audio.onerror = async (e) => {
          console.error('[useAISpeech] Audio playback error:', e);
          toast.error('AI audio failed. Showing text only.');
          // Fall back to text-only mode
          startProgressiveText(words, durationMs, false);
        };

        try {
          await audio.play();
        } catch (playError) {
          console.error('[useAISpeech] Audio play blocked:', playError);
          // Try Web Speech API as fallback
          if (webSpeech.isAvailable && audioEnabled) {
            console.log('[useAISpeech] Trying Web Speech API fallback');
            startProgressiveText(words, durationMs, true);
            webSpeech.speak(cleanedText, voiceGender, 1.2).catch(e => {
              console.error('[useAISpeech] Web Speech fallback failed:', e);
            });
          } else {
            toast.error('AI audio blocked. Click "Enable AI Audio" to allow audio playback.');
            startProgressiveText(words, durationMs, false);
          }
        }
      } else {
        // TTS not available from ElevenLabs, try Web Speech API
        console.log('[useAISpeech] ElevenLabs TTS not available, trying Web Speech API');
        
        if (webSpeech.isAvailable && audioEnabled) {
          setHasTTS(true);
          startProgressiveText(words, durationMs, true);
          webSpeech.speak(cleanedText, voiceGender, 1.2).catch(e => {
            console.error('[useAISpeech] Web Speech fallback failed:', e);
            toast.error('AI audio failed. Showing text only.');
          });
        } else {
          setHasTTS(false);
          if (!audioEnabled) {
            toast.info('Enable AI audio to hear the opponent speak.', {
              duration: 4000,
            });
          } else {
            toast.error('AI audio unavailable. Showing text only.');
          }
          startProgressiveText(words, durationMs, false);
        }
      }

    } catch (error) {
      console.error('[useAISpeech] Error:', error);
      setHasTTS(false);
      toast.error('AI audio failed. Showing text only.');
      // Fall back to text-only progressive display
      startProgressiveText(words, durationMs, false);
    } finally {
      setIsLoading(false);
    }
  }, [isSpeaking, options, startProgressiveText, stopSpeech, volume, isMuted, webSpeech, audioEnabled]);

  return {
    isSpeaking,
    currentWord,
    displayedText,
    progress,
    startSpeech,
    stopSpeech,
    isLoading,
    hasTTS,
    volume,
    setVolume,
    isMuted,
    setIsMuted,
    audioEnabled,
    enableAudio,
    speechTimeRemaining,
    speechTotalTime,
  };
}
