import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/browserClient';

interface UseVoiceInputOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

interface UseVoiceInputReturn {
  isRecording: boolean;
  isSupported: boolean;
  transcript: string;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  error: string | null;
}

export const useVoiceInput = (options: UseVoiceInputOptions = {}): UseVoiceInputReturn => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const useWebSpeechAPI = useRef(true);

  // Check for Web Speech API support
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition && !navigator.mediaDevices?.getUserMedia) {
      setIsSupported(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    console.log('[useVoiceInput] Stopping recording');
    
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    console.log('[useVoiceInput] Starting recording');
    setError(null);
    setTranscript('');

    // Try Web Speech API first (works without API key)
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition && useWebSpeechAPI.current) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        
        recognition.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcriptPart = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcriptPart + ' ';
            } else {
              interimTranscript += transcriptPart;
            }
          }
          
          const currentTranscript = finalTranscript || interimTranscript;
          setTranscript(prev => {
            const newTranscript = finalTranscript ? prev + finalTranscript : prev;
            return newTranscript || interimTranscript;
          });
          
          if (finalTranscript) {
            options.onTranscript?.(finalTranscript.trim(), true);
          } else if (interimTranscript) {
            options.onTranscript?.(interimTranscript, false);
          }
        };
        
        recognition.onerror = (event: any) => {
          console.error('[useVoiceInput] Speech recognition error:', event.error);
          if (event.error === 'not-allowed') {
            setError('Microphone access denied. Please allow microphone access.');
            options.onError?.('Microphone access denied');
          } else if (event.error !== 'aborted') {
            setError(`Speech recognition error: ${event.error}`);
            options.onError?.(event.error);
          }
          setIsRecording(false);
        };
        
        recognition.onend = () => {
          console.log('[useVoiceInput] Speech recognition ended');
          if (isRecording) {
            // Restart if still supposed to be recording
            try {
              recognition.start();
            } catch (e) {
              console.log('[useVoiceInput] Could not restart recognition');
              setIsRecording(false);
            }
          }
        };
        
        recognitionRef.current = recognition;
        recognition.start();
        setIsRecording(true);
        console.log('[useVoiceInput] Web Speech API started');
        return;
      } catch (err) {
        console.error('[useVoiceInput] Web Speech API failed:', err);
        useWebSpeechAPI.current = false;
      }
    }

    // Fallback: Try ElevenLabs if Web Speech API not available
    try {
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke('elevenlabs-scribe-token');
      
      if (tokenError || tokenData?.fallback || tokenData?.error) {
        console.log('[useVoiceInput] ElevenLabs not available, using basic recording');
        // Just record without transcription
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          }
        });
        
        streamRef.current = stream;
        setIsRecording(true);
        setError('Voice transcription not available. Type your arguments instead.');
        options.onError?.('Transcription not available');
        return;
      }
      
      // ElevenLabs token available - would use their SDK here
      console.log('[useVoiceInput] ElevenLabs token received');
      setError('ElevenLabs integration pending. Use text input for now.');
      
    } catch (err) {
      console.error('[useVoiceInput] Failed to start recording:', err);
      setError('Could not access microphone');
      options.onError?.('Could not access microphone');
    }
  }, [options, isRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  return {
    isRecording,
    isSupported,
    transcript,
    startRecording,
    stopRecording,
    error,
  };
};
