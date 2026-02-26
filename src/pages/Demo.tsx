import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  User,
  Mic,
  MicOff,
  Clock,
  Send,
  ArrowLeft,
  Trophy,
  Download,
  Sparkles,
  Volume2,
  VolumeX,
  RotateCcw,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Lightbulb,
  Target,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/browserClient';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useAISpeech } from '@/hooks/useAISpeech';
import { useAuth } from '@/hooks/useAuth';
import logo from '@/assets/rebutly-logo.png';
import { DebateSetup, type DebateFormat, type TransitionMode, type AIVoiceGender, DEBATE_FORMATS } from '@/components/DebateSetup';
import { DebateNotes, type Note } from '@/components/DebateNotes';
import { TransitionCountdown } from '@/components/TransitionCountdown';
import { PrepTimer } from '@/components/PrepTimer';

// Debate phases - order follows standard debate logic
// Proposition ALWAYS speaks first, regardless of whether user or AI
type DemoPhase = 
  | 'intro' 
  | 'topic' 
  | 'setup' 
  | 'prep' 
  | 'prop_constructive'  // Proposition constructive (could be user OR AI)
  | 'opp_constructive'   // Opposition constructive
  | 'prop_rebuttal'      // Proposition rebuttal
  | 'opp_rebuttal'       // Opposition rebuttal
  | 'prop_closing'       // Proposition closing
  | 'opp_closing'        // Opposition closing
  | 'transition'
  | 'debate_complete'    // NEW: Debate finished, waiting for user to request judgement
  | 'analyzing' 
  | 'feedback' 
  | 'results';

interface Message {
  id: string;
  sender: 'user' | 'ai' | 'system';
  text: string;
  timestamp: Date;
  isProgressive?: boolean; // For AI messages being spoken
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

const DEMO_TOPICS = [
  "This House believes that social media does more harm than good",
  "This House would ban the use of facial recognition technology by governments",
  "This House believes that space exploration is a waste of resources",
  "This House would implement a universal basic income",
  "This House believes artificial intelligence poses an existential threat to humanity",
  "This House would abolish standardized testing in schools",
];

const Demo = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  
  // Redirect authenticated users to /play
  useEffect(() => {
    if (!authLoading && user) {
      navigate('/play', { replace: true });
    }
  }, [user, authLoading, navigate]);

  const [phase, setPhase] = useState<DemoPhase>('intro');
  const [topic, setTopic] = useState('');
  const [timeLeft, setTimeLeft] = useState(60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [aiTyping, setAiTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<DebateFeedback | null>(null);
  const [userArguments, setUserArguments] = useState<string[]>([]);
  const [aiArguments, setAiArguments] = useState<string[]>([]);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const userInputRef = useRef('');
  const handlePhaseEndRef = useRef<() => void | Promise<void>>(() => {});

  // Enhanced state for debate flow
  const [userSide, setUserSide] = useState<'proposition' | 'opposition'>('proposition');
  const [debateFormat, setDebateFormat] = useState<DebateFormat>('standard');
  const [transitionMode, setTransitionMode] = useState<TransitionMode>('both');
  const [aiVoiceGender, setAiVoiceGender] = useState<AIVoiceGender>('male');
  const [showTransition, setShowTransition] = useState(false);
  const [nextPhaseAfterTransition, setNextPhaseAfterTransition] = useState<DemoPhase | null>(null);
  const [showNotesPanel, setShowNotesPanel] = useState(true);

  // Notes state - LIFTED to Demo component for persistence across phases
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesActiveTab, setNotesActiveTab] = useState<'arguments' | 'rebuttals' | 'examples'>('arguments');
  const [notesCurrentNote, setNotesCurrentNote] = useState('');
  const [notesCurrentColor, setNotesCurrentColor] = useState<'default' | 'red' | 'yellow' | 'green' | 'blue'>('default');
  const [notesCurrentTags, setNotesCurrentTags] = useState<string[]>([]);

  // AI Speech hook for TTS and progressive text
  const aiSpeech = useAISpeech({
    onComplete: () => {
      console.log('[Demo] AI speech complete');
    },
    onError: (error) => {
      console.error('[Demo] AI speech error:', error);
    },
  });

  // Voice input hook
  const { 
    isRecording, 
    isSupported: voiceSupported,
    transcript,
    startRecording, 
    stopRecording,
    error: voiceError 
  } = useVoiceInput({
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        setUserInput(prev => prev + ' ' + text.trim());
      }
    },
    onError: (err) => {
      console.error('[Demo] Voice error:', err);
    }
  });

  const handleMessageScroll = useCallback(() => {
    const container = messageListRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }, []);

  // Auto-scroll only when already near the bottom
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, aiSpeech.displayedText]);

  // Determine if current phase is for user or AI based on side
  const isUserPhase = useCallback((currentPhase: DemoPhase): boolean => {
    // User speaks in phases matching their side
    if (userSide === 'proposition') {
      return currentPhase.startsWith('prop_');
    } else {
      return currentPhase.startsWith('opp_');
    }
  }, [userSide]);

  const isAIPhase = useCallback((currentPhase: DemoPhase): boolean => {
    // AI speaks in phases NOT matching user's side
    if (userSide === 'proposition') {
      return currentPhase.startsWith('opp_');
    } else {
      return currentPhase.startsWith('prop_');
    }
  }, [userSide]);

  // Get the next phase in debate order
  const getNextPhase = useCallback((currentPhase: DemoPhase): DemoPhase | null => {
    const phaseOrder: DemoPhase[] = [
      'prop_constructive',
      'opp_constructive', 
      'prop_rebuttal',
      'opp_rebuttal',
      'prop_closing',
      'opp_closing',
    ];
    const currentIndex = phaseOrder.indexOf(currentPhase);
    if (currentIndex >= 0 && currentIndex < phaseOrder.length - 1) {
      return phaseOrder[currentIndex + 1];
    }
    return null; // End of debate
  }, []);

  // Get speech type from phase
  const getSpeechType = useCallback((currentPhase: DemoPhase): 'opening' | 'rebuttal' | 'closing' => {
    if (currentPhase.includes('constructive')) return 'opening';
    if (currentPhase.includes('rebuttal')) return 'rebuttal';
    return 'closing';
  }, []);

  // Get current speech time based on format and phase
  const getCurrentSpeechTime = useCallback((currentPhase?: DemoPhase) => {
    const checkPhase = currentPhase || phase;
    const config = DEBATE_FORMATS[debateFormat];
    if (checkPhase.includes('constructive')) {
      return config.constructiveTime;
    }
    return config.rebuttalTime;
  }, [debateFormat, phase]);

  useEffect(() => {
    userInputRef.current = userInput;
  }, [userInput]);

  // Auto-submit using a ref so typing does not reset timer behavior.
  const autoSubmitCurrentInput = useCallback(() => {
    const message = userInputRef.current.trim();
    if (!message) return;

    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), sender: 'user', text: message, timestamp: new Date() },
    ]);
    setUserArguments(prev => [...prev, message]);
    userInputRef.current = '';
    setUserInput('');
    toast.info('Time expired! Your argument was automatically submitted.');
  }, []);

  // Timer logic with auto-submit
  useEffect(() => {
    if (!isTimerRunning) return;

    const timer = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setIsTimerRunning(false);
          autoSubmitCurrentInput();
          void handlePhaseEndRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isTimerRunning, autoSubmitCurrentInput]);

  const callDebateAI = useCallback(async (
    type: 'opponent_response' | 'generate_feedback',
    phaseType: 'opening' | 'rebuttal' | 'closing',
    speechDurationSeconds?: number
  ) => {
    console.log('[Demo] Calling debate AI:', type, phaseType);
    
    try {
      const { data, error } = await supabase.functions.invoke('debate-ai', {
        body: {
          type,
          topic,
          userSide,
          phase: phaseType,
          userArguments,
          aiArguments,
          speechDurationSeconds,
          conversationHistory: messages
            .filter(m => m.sender !== 'system')
            .map(m => ({
              role: m.sender === 'user' ? 'user' : 'assistant',
              content: m.text
            }))
        }
      });

      if (error) {
        console.error('[Demo] Edge function error:', error);
        throw error;
      }

      return data;
    } catch (err) {
      console.error('[Demo] AI call failed:', err);
      throw err;
    }
  }, [topic, userSide, userArguments, aiArguments, messages]);

  // Get AI response and deliver with TTS
  const getAIResponseWithSpeech = useCallback(async (phaseType: 'opening' | 'rebuttal' | 'closing') => {
    setAiTyping(true);
    
    // Get speech duration based on format for word limiting
    const speechDuration = getCurrentSpeechTime();
    
    try {
      const data = await callDebateAI('opponent_response', phaseType, speechDuration);
      
      if (data?.response) {
        const aiResponse = data.response;
        setAiArguments(prev => [...prev, aiResponse]);
        
        // Add message as progressive (will update as speech progresses)
        const messageId = Date.now().toString();
        setMessages(prev => [...prev, {
          id: messageId,
          sender: 'ai',
          text: '', // Start empty, will fill progressively
          timestamp: new Date(),
          isProgressive: true,
        }]);

        setAiTyping(false);
        
        // Start TTS with progressive text display
        await aiSpeech.startSpeech(aiResponse, speechDuration, aiVoiceGender);
        
        // Wait for speech to complete before returning
        await new Promise<void>((resolve) => {
          const checkComplete = setInterval(() => {
            if (!aiSpeech.isSpeaking) {
              clearInterval(checkComplete);
              // Ensure full text is shown
              setMessages(prev => prev.map(m => 
                m.id === messageId 
                  ? { ...m, text: aiResponse, isProgressive: false }
                  : m
              ));
              resolve();
            } else {
              // Update message as speech progresses
              setMessages(prev => prev.map(m => 
                m.id === messageId && m.isProgressive
                  ? { ...m, text: aiSpeech.displayedText }
                  : m
              ));
            }
          }, 100);
        });

      } else {
        throw new Error('No response from AI');
      }
    } catch (err) {
      console.error('[Demo] Failed to get AI response:', err);
      setAiTyping(false);
      // Fallback response
      const aiSide = userSide === 'proposition' ? 'opposition' : 'proposition';
      const fallbackResponses = {
        opening: `As the ${aiSide}, I firmly oppose this motion. The evidence suggests that the costs of this proposal far outweigh any potential benefits. Let me explain why this matters for real people.`,
        rebuttal: "My opponent's argument relies on idealistic assumptions that don't hold up in practice. The studies they might cite often ignore critical confounding factors. When we look at real-world implementations, we see a different picture entirely.",
        closing: "In weighing this debate, consider that my side has provided concrete evidence while the opposition relied on theoretical benefits. The risks are too great, and the proposed solutions are unproven."
      };
      addMessage('ai', fallbackResponses[phaseType]);
      setAiArguments(prev => [...prev, fallbackResponses[phaseType]]);
    }
  }, [callDebateAI, userSide, aiSpeech, getCurrentSpeechTime, aiVoiceGender]);

  const generateFeedback = useCallback(async () => {
    setPhase('analyzing');
    setIsLoading(true);
    
    try {
      const data = await callDebateAI('generate_feedback', 'closing');
      
      if (data && data.type === 'feedback') {
        setFeedback(data as DebateFeedback);
        setPhase('feedback');
      } else {
        throw new Error('Invalid feedback response');
      }
    } catch (err) {
      console.error('[Demo] Failed to generate feedback:', err);
      // Fallback feedback
      setFeedback({
        overallScore: 72,
        verdict: 'close',
        summary: "You presented solid arguments but could strengthen your evidence base. Focus on preemptively addressing counterarguments and citing specific sources.",
        categories: [
          {
            name: 'Argumentation',
            score: 75,
            feedback: "Your logical structure was clear, but some claims needed stronger warrants.",
            strengths: ["Clear thesis statement", "Good use of examples"],
            improvements: ["Add more warrants to support claims", "Strengthen logical connections"]
          },
          {
            name: 'Evidence',
            score: 68,
            feedback: "Arguments would benefit from specific citations.",
            strengths: ["Attempted to use examples"],
            improvements: ["Cite specific studies or statistics", "Reference expert sources"]
          },
          {
            name: 'Rebuttal',
            score: 70,
            feedback: "You engaged with opponent arguments but could be more direct.",
            strengths: ["Acknowledged opponent points"],
            improvements: ["Be more direct in refutations", "Preempt obvious counterarguments"]
          },
          {
            name: 'Delivery',
            score: 78,
            feedback: "Your communication was clear. Work on varying emphasis.",
            strengths: ["Clear expression", "Good pacing"],
            improvements: ["Use signposting", "Emphasize key impact statements"]
          },
          {
            name: 'Strategy',
            score: 72,
            feedback: "Good time management overall.",
            strengths: ["Covered main points within time"],
            improvements: ["Prioritize strongest arguments", "Build to a powerful closing"]
          }
        ],
        keyMoments: [
          {
            type: 'strength',
            description: "Your opening clearly established your position.",
            suggestion: "Continue creating strong frameworks."
          },
          {
            type: 'missed_opportunity',
            description: "When the opponent raised concerns, a counter-example would have helped.",
            suggestion: "Keep 2-3 strong examples ready for common objections."
          }
        ],
        researchSuggestions: [
          "Look up recent meta-analyses on this topic",
          "Study how this issue has played out in different countries",
          "Research common debate frameworks"
        ]
      });
      setPhase('feedback');
    } finally {
      setIsLoading(false);
    }
  }, [callDebateAI]);

  const showTransitionScreen = useCallback((nextPhase: DemoPhase) => {
    setNextPhaseAfterTransition(nextPhase);
    setShowTransition(true);
  }, []);

  const handleTransitionComplete = useCallback(async () => {
    setShowTransition(false);
    
    if (!nextPhaseAfterTransition) return;

    const nextPhase = nextPhaseAfterTransition;
    const config = DEBATE_FORMATS[debateFormat];
    const speechType = getSpeechType(nextPhase);
    const speechTime = getCurrentSpeechTime(nextPhase);
    
    // Check if next phase is for AI or User
    if (isAIPhase(nextPhase)) {
      // AI's turn to speak
      setPhase(nextPhase);
      const aiSideLabel = userSide === 'proposition' ? 'Opposition' : 'Proposition';
      addSystemMessage(`${aiSideLabel} (AI) is presenting their ${speechType}...`);
      
      await getAIResponseWithSpeech(speechType);

      // After AI finishes speaking, check what's next
      const followingPhase = getNextPhase(nextPhase);
      
      if (followingPhase) {
        // Pause before transitioning to next phase
        setTimeout(() => {
          showTransitionScreen(followingPhase);
        }, 1500);
      } else {
        // End of debate - enter "Debate Complete" state, do NOT auto-start judgement
        addSystemMessage("The debate has concluded. Take your time to review the arguments.");
        setTimeout(() => {
          setPhase('debate_complete');
        }, 2000);
      }
    } else {
      // User's turn to speak
      setPhase(nextPhase);
      setTimeLeft(speechTime);
      setIsTimerRunning(true);
      
      const userSideLabel = userSide === 'proposition' ? 'Proposition' : 'Opposition';
      addSystemMessage(`${userSideLabel} (You) - ${speechType}! You have ${formatTime(speechTime)}.`);
      inputRef.current?.focus();
    }
    
    setNextPhaseAfterTransition(null);
  }, [
    nextPhaseAfterTransition, 
    debateFormat, 
    getSpeechType, 
    getCurrentSpeechTime, 
    isAIPhase, 
    userSide, 
    getAIResponseWithSpeech, 
    getNextPhase, 
    showTransitionScreen, 
    generateFeedback
  ]);

  const handlePhaseEnd = useCallback(async () => {
    const nextPhase = getNextPhase(phase);
    
    if (nextPhase) {
      const currentSpeaker = isUserPhase(phase) ? 'Your' : "AI's";
      addSystemMessage(`${currentSpeaker} time is up! Preparing for the next speech...`);
      showTransitionScreen(nextPhase);
    } else {
      // End of debate - enter "Debate Complete" state, do NOT auto-start judgement
      addSystemMessage("Debate complete! Review your arguments, then click 'Hear Judgement' when ready.");
      setPhase('debate_complete');
    }
  }, [phase, getNextPhase, isUserPhase, showTransitionScreen]);

  useEffect(() => {
    handlePhaseEndRef.current = handlePhaseEnd;
  }, [handlePhaseEnd]);

  const addMessage = (sender: 'user' | 'ai' | 'system', text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), sender, text, timestamp: new Date() },
    ]);
  };

  const addSystemMessage = (text: string) => {
    addMessage('system', text);
  };

  const startDemo = () => {
    const randomTopic = DEMO_TOPICS[Math.floor(Math.random() * DEMO_TOPICS.length)];
    setTopic(randomTopic);
    setPhase('topic');
  };

  const handleSetupComplete = (config: {
    side: 'proposition' | 'opposition';
    format: DebateFormat;
    transitionMode: TransitionMode;
    aiVoiceGender: AIVoiceGender;
    audioEnabled: boolean;
    audioVolume: number;
  }) => {
    setUserSide(config.side);
    setDebateFormat(config.format);
    setTransitionMode(config.transitionMode);
    setAiVoiceGender(config.aiVoiceGender);
    
    // Apply audio settings from configuration
    if (config.audioEnabled) {
      aiSpeech.enableAudio();
      aiSpeech.setVolume(config.audioVolume);
      aiSpeech.setIsMuted(false);
    } else {
      aiSpeech.setIsMuted(true);
    }
    
    setPhase('prep');
  };

  // Start debate after prep - Proposition ALWAYS speaks first
  const startDebate = useCallback(() => {
    const config = DEBATE_FORMATS[debateFormat];
    setUserArguments([]);
    setAiArguments([]);
    
    addSystemMessage(`The motion is: "${topic}"`);
    
    // Proposition always speaks first - this is the critical logic
    if (userSide === 'proposition') {
      // User is Proposition, user speaks first
      setPhase('prop_constructive');
      setTimeLeft(config.constructiveTime);
      setIsTimerRunning(true);
      addSystemMessage(`You are PROPOSITION (arguing FOR). You speak first. You have ${formatTime(config.constructiveTime)} for your opening statement.`);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // User is Opposition, AI (as Proposition) speaks first
      setPhase('prop_constructive');
      addSystemMessage(`You are OPPOSITION (arguing AGAINST). The AI speaks first as Proposition.`);
      // Start AI speech - ensure it completes before showing transition
      setTimeout(async () => {
        await getAIResponseWithSpeech('opening');
        // After AI finishes speaking, wait a moment then show transition
        // The await above ensures AI speech completes
        setTimeout(() => {
          showTransitionScreen('opp_constructive');
        }, 2000); // Give 2 seconds to process before transition
      }, 500);
    }
  }, [debateFormat, topic, userSide, getAIResponseWithSpeech, showTransitionScreen]);

  const handleSendMessage = () => {
    if (!userInput.trim()) return;
    
    const message = userInput.trim();
    addMessage('user', message);
    setUserArguments(prev => [...prev, message]);
    setUserInput('');
    
    if (!isTimerRunning) {
      toast.info('Argument recorded! The timer has ended.');
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
      if (voiceError) {
        toast.error(voiceError);
      }
    }
  };

  const restartDemo = () => {
    setPhase('intro');
    setTopic('');
    setTimeLeft(60);
    setIsTimerRunning(false);
    setMessages([]);
    setUserInput('');
    setAiTyping(false);
    setFeedback(null);
    setUserArguments([]);
    setAiArguments([]);
    setShowTransition(false);
    setNextPhaseAfterTransition(null);
    aiSpeech.stopSpeech();
    // Reset notes
    setNotes([]);
    setNotesActiveTab('arguments');
    setNotesCurrentNote('');
    setNotesCurrentColor('default');
    setNotesCurrentTags([]);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getVerdictIcon = (verdict: string) => {
    switch (verdict) {
      case 'win': return <Trophy className="w-8 h-8 text-warning" />;
      case 'loss': return <XCircle className="w-8 h-8 text-destructive" />;
      default: return <Target className="w-8 h-8 text-primary" />;
    }
  };

  const getVerdictText = (verdict: string) => {
    switch (verdict) {
      case 'win': return 'Victory!';
      case 'loss': return 'Defeat';
      default: return 'Close Debate';
    }
  };

  const getMomentIcon = (type: string) => {
    switch (type) {
      case 'strength': return <CheckCircle className="w-4 h-4 text-success" />;
      case 'effective_rebuttal': return <Target className="w-4 h-4 text-primary" />;
      case 'missed_opportunity': return <Lightbulb className="w-4 h-4 text-warning" />;
      case 'weak_argument': return <AlertCircle className="w-4 h-4 text-destructive" />;
      default: return <Lightbulb className="w-4 h-4" />;
    }
  };

  // Check if we're in a debate phase
  const isDebatePhase = phase.includes('constructive') || phase.includes('rebuttal') || phase.includes('closing');
  const isCurrentlyUserSpeaking = isDebatePhase && isUserPhase(phase) && isTimerRunning;
  const isCurrentlyAISpeaking = isDebatePhase && isAIPhase(phase) && aiSpeech.isSpeaking;

  // Get phase label for display
  const getPhaseLabel = () => {
    const speechType = getSpeechType(phase);
    const side = phase.startsWith('prop_') ? 'Proposition' : 'Opposition';
    const speaker = isUserPhase(phase) ? 'You' : 'AI';
    return `${side} (${speaker}) - ${speechType.charAt(0).toUpperCase() + speechType.slice(1)}`;
  };

  // Transition next speaker label
  const getTransitionNextSpeaker = (): 'user' | 'ai' => {
    if (!nextPhaseAfterTransition) return 'user';
    return isUserPhase(nextPhaseAfterTransition) ? 'user' : 'ai';
  };

  // Common props for DebateNotes
  const notesProps = {
    notes,
    onNotesChange: setNotes,
    activeTab: notesActiveTab,
    onActiveTabChange: setNotesActiveTab,
    currentNote: notesCurrentNote,
    onCurrentNoteChange: setNotesCurrentNote,
    currentColor: notesCurrentColor,
    onCurrentColorChange: setNotesCurrentColor,
    currentTags: notesCurrentTags,
    onCurrentTagsChange: setNotesCurrentTags,
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Transition Countdown Overlay - ONLY show when not AI speaking */}
      <TransitionCountdown
        isVisible={showTransition && !aiSpeech.isSpeaking}
        mode={transitionMode}
        onComplete={handleTransitionComplete}
        nextSpeaker={getTransitionNextSpeaker()}
        nextPhase={nextPhaseAfterTransition ? getSpeechType(nextPhaseAfterTransition) : ''}
      />

      {/* Header */}
      <header className="border-b border-border px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-2">
              <img src={logo} alt="Rebutly.AI" className="w-8 h-8 rounded-lg" />
              <span className="font-display font-bold">
                Rebutly<span className="text-primary">.AI</span>
              </span>
            </Link>
            <span className="px-2 py-1 rounded bg-warning/20 text-warning text-xs font-medium">
              DEMO MODE
            </span>
            {(phase === 'setup' || phase === 'prep' || isDebatePhase) && (
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                userSide === 'proposition' 
                  ? 'bg-success/20 text-success' 
                  : 'bg-destructive/20 text-destructive'
              }`}>
                {userSide.toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {(phase === 'setup' || phase === 'prep' || isDebatePhase) && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted">
                {aiSpeech.isMuted || aiSpeech.volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Volume2 className="w-4 h-4 text-muted-foreground" />
                )}
                <Slider
                  value={[Math.round(aiSpeech.volume * 100)]}
                  onValueChange={([v]) => {
                    const normalizedVolume = v / 100;
                    aiSpeech.setVolume(normalizedVolume);
                    aiSpeech.setIsMuted(v === 0);
                  }}
                  max={100}
                  min={0}
                  step={5}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground w-9 text-right">
                  {Math.round(aiSpeech.volume * 100)}%
                </span>
              </div>
            )}
            
            {/* User speaking timer */}
            {isCurrentlyUserSpeaking && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted">
                <Clock className={`w-4 h-4 ${timeLeft <= 10 ? 'text-destructive' : 'text-muted-foreground'}`} />
                <span className={`font-mono font-bold ${timeLeft <= 10 ? 'text-destructive' : ''}`}>
                  {formatTime(timeLeft)}
                </span>
              </div>
            )}
            
            {/* AI speaking timer + controls */}
            {isCurrentlyAISpeaking && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/20">
                <Volume2 className="w-4 h-4 text-accent animate-pulse" />
                <span className="text-sm font-medium text-accent">AI Speaking</span>
                
                {/* Timer countdown - same style as user timer */}
                <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-background/50">
                  <Clock className={`w-4 h-4 ${aiSpeech.speechTimeRemaining <= 10 ? 'text-destructive' : 'text-accent'}`} />
                  <span className={`font-mono font-bold ${aiSpeech.speechTimeRemaining <= 10 ? 'text-destructive' : 'text-accent'}`}>
                    {formatTime(aiSpeech.speechTimeRemaining)}
                  </span>
                </div>
                
                {/* Progress bar */}
                <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-accent"
                    style={{ width: `${aiSpeech.progress}%` }}
                  />
                </div>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Exit Demo
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <AnimatePresence mode="wait">
          {/* Intro Phase */}
          {phase === 'intro' && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-card p-8 max-w-lg text-center"
            >
              <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-6">
                <Bot className="w-10 h-10 text-primary" />
              </div>
              <h1 className="font-display text-2xl font-bold mb-2">AI Debate Arena</h1>
              <p className="text-muted-foreground mb-6">
                Debate against an AI opponent with realistic speech delivery, 
                proper debate order, and structured feedback.
              </p>
              <div className="bg-muted/50 rounded-lg p-4 mb-6 text-left text-sm">
                <p className="font-medium mb-2">What's included:</p>
                <ul className="text-muted-foreground space-y-1">
                  <li>• <strong>Realistic order:</strong> Proposition always speaks first</li>
                  <li>• <strong>AI voice:</strong> Choose male or female voice</li>
                  <li>• <strong>Paced transitions:</strong> Countdown between speeches</li>
                  <li>• <strong>Persistent notes:</strong> Available throughout the debate</li>
                  <li>• <strong>Audio controls:</strong> Mute/volume for AI speech</li>
                </ul>
              </div>
              <div className="space-y-3">
                <Button onClick={startDemo} className="w-full bg-gradient-to-r from-primary to-secondary">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Start AI Debate
                </Button>
                <p className="text-xs text-muted-foreground">
                  No sign-up required. Full experience available after registration.
                </p>
              </div>
            </motion.div>
          )}

          {/* Topic Reveal Phase */}
          {phase === 'topic' && (
            <motion.div
              key="topic"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="glass-card p-8 max-w-lg text-center"
            >
              <div className="mb-6">
                <span className="text-sm text-muted-foreground uppercase tracking-wider">Today's Motion</span>
              </div>
              <motion.h2
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="font-display text-xl md:text-2xl font-bold mb-6 text-primary"
              >
                "{topic}"
              </motion.h2>
              <Button onClick={() => setPhase('setup')} className="w-full">
                Configure Debate
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </motion.div>
          )}

          {/* Setup Phase */}
          {phase === 'setup' && (
            <DebateSetup
              topic={topic}
              onStart={handleSetupComplete}
              onBack={() => setPhase('topic')}
            />
          )}

          {/* Prep Phase - Notes panel visible */}
          {phase === 'prep' && (
            <div className="flex gap-4 w-full max-w-5xl">
              <div className="flex-1">
                <PrepTimer
                  totalSeconds={DEBATE_FORMATS[debateFormat].prepTime}
                  topic={topic}
                  userSide={userSide}
                  onComplete={startDebate}
                  onSkip={startDebate}
                />
              </div>
              <div className="w-80">
                <DebateNotes
                  isRecording={isRecording}
                  onStartRecording={startRecording}
                  onStopRecording={stopRecording}
                  voiceSupported={voiceSupported}
                  currentPhase="Preparation"
                  debateTopic={topic}
                  userSide={userSide}
                  {...notesProps}
                />
              </div>
            </div>
          )}

          {/* Debate Phase - Notes panel ALWAYS visible */}
          {isDebatePhase && (
            <motion.div
              key="debate"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-5xl flex gap-4"
            >
              {/* Main debate area */}
              <div className="flex-1">
                {/* Phase indicator */}
                <div className="text-center mb-4 flex items-center justify-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    isUserPhase(phase) 
                      ? 'bg-primary/20 text-primary' 
                      : 'bg-accent/20 text-accent'
                  }`}>
                    {getPhaseLabel()}
                  </span>
                  {isRecording && (
                    <span className="px-2 py-1 rounded-full bg-destructive/20 text-destructive text-xs font-medium animate-pulse">
                      Recording...
                    </span>
                  )}
                </div>

                {/* Messages area */}
                <div
                  ref={messageListRef}
                  onScroll={handleMessageScroll}
                  className="glass-card p-4 h-[50vh] overflow-y-auto mb-4"
                >
                  <div className="space-y-4">
                    {messages.map((msg) => (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-3 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}
                      >
                        {msg.sender !== 'system' && (
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            msg.sender === 'user' 
                              ? 'bg-primary/20' 
                              : 'bg-accent/20'
                          }`}>
                            {msg.sender === 'user' ? (
                              <User className="w-4 h-4 text-primary" />
                            ) : (
                              <Bot className="w-4 h-4 text-accent" />
                            )}
                          </div>
                        )}
                        <div className={`max-w-[80%] ${
                          msg.sender === 'system' 
                            ? 'w-full text-center text-sm text-muted-foreground italic' 
                            : `rounded-lg p-3 ${
                                msg.sender === 'user' 
                                  ? 'bg-primary/20 text-foreground' 
                                  : 'bg-muted text-foreground'
                              }`
                        }`}>
                          {msg.isProgressive && aiSpeech.isSpeaking ? (
                            <span>
                              {aiSpeech.displayedText}
                              <span className="inline-block w-1 h-4 bg-accent ml-1 animate-pulse" />
                            </span>
                          ) : (
                            msg.text
                          )}
                        </div>
                      </motion.div>
                    ))}
                    
                    {aiTyping && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex gap-3"
                      >
                        <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                          <Bot className="w-4 h-4 text-accent" />
                        </div>
                        <div className="bg-muted rounded-lg p-3">
                          <div className="flex gap-1">
                            <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                            <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                            <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                          </div>
                        </div>
                      </motion.div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Input area - only show when user is speaking */}
                {isCurrentlyUserSpeaking && (
                  <div className="flex gap-2">
                    <Button
                      variant={isRecording ? 'destructive' : 'outline'}
                      size="icon"
                      onClick={toggleRecording}
                      className="flex-shrink-0"
                      disabled={!voiceSupported}
                      title={voiceSupported ? (isRecording ? 'Stop recording' : 'Start voice input') : 'Voice input not supported'}
                    >
                      {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </Button>
                    <input
                      ref={inputRef}
                      type="text"
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder={isRecording ? "Listening... speak your argument" : "Type or speak your argument..."}
                      className="flex-1 px-4 py-2 rounded-lg bg-muted border border-border focus:border-primary focus:outline-none"
                    />
                    <Button onClick={handleSendMessage} disabled={!userInput.trim()}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                {/* Show message when AI is speaking */}
                {isCurrentlyAISpeaking && !aiTyping && (
                  <div className="text-center py-4 text-muted-foreground">
                    <Volume2 className="w-6 h-6 mx-auto mb-2 animate-pulse text-accent" />
                    <p className="text-sm">AI opponent is speaking. Listen and prepare your response...</p>
                  </div>
                )}
              </div>

              {/* Notes panel - ALWAYS visible during debate with PERSISTENT state */}
              <div className="w-80 hidden lg:block">
                <DebateNotes
                  isRecording={false}
                  voiceSupported={voiceSupported}
                  currentPhase={getPhaseLabel()}
                  debateTopic={topic}
                  userSide={userSide}
                  {...notesProps}
                />
              </div>
            </motion.div>
          )}

          {/* Debate Complete Phase - waiting for user to request judgement */}
          {phase === 'debate_complete' && (
            <motion.div
              key="debate-complete"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-6xl flex gap-6"
            >
              {/* Main content - transcript review */}
              <div className="flex-1 glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-success" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-bold">Debate Complete</h2>
                    <p className="text-sm text-muted-foreground">Review the arguments, then hear the judgement when ready.</p>
                  </div>
                </div>

                {/* Scrollable transcript */}
                <div className="h-[350px] overflow-y-auto space-y-3 pr-2 mb-6 border rounded-lg p-4 bg-muted/20">
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex gap-3 ${msg.sender === 'system' ? 'justify-center' : ''}`}
                    >
                      {msg.sender === 'system' ? (
                        <p className="text-xs text-muted-foreground italic bg-muted/50 px-3 py-1 rounded-full">
                          {msg.text}
                        </p>
                      ) : (
                        <>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            msg.sender === 'user' 
                              ? 'bg-primary/20' 
                              : 'bg-accent/20'
                          }`}>
                            {msg.sender === 'user' ? (
                              <User className="w-4 h-4 text-primary" />
                            ) : (
                              <Bot className="w-4 h-4 text-accent" />
                            )}
                          </div>
                          <div className={`rounded-lg p-3 max-w-[85%] ${
                            msg.sender === 'user'
                              ? 'bg-primary/10'
                              : 'bg-accent/10'
                          }`}>
                            <p className="text-sm">{msg.text}</p>
                          </div>
                        </>
                      )}
                    </motion.div>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="flex justify-center gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      // Generate transcript text
                      const transcriptLines = messages
                        .filter(msg => msg.sender !== 'system')
                        .map(msg => {
                          const speaker = msg.sender === 'user' 
                            ? `[You - ${userSide === 'proposition' ? 'Proposition' : 'Opposition'}]`
                            : `[AI - ${userSide === 'proposition' ? 'Opposition' : 'Proposition'}]`;
                          return `${speaker}\n${msg.text}\n`;
                        })
                        .join('\n');
                      
                      const fullTranscript = `DEBATE TRANSCRIPT
================
Motion: "${topic}"
Your Side: ${userSide === 'proposition' ? 'Proposition' : 'Opposition'}
Date: ${new Date().toLocaleDateString()}

${transcriptLines}`;
                      
                      // Create and download file
                      const blob = new Blob([fullTranscript], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `debate-transcript-${new Date().toISOString().slice(0, 10)}.txt`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      
                      toast.success('Transcript downloaded!');
                    }}
                  >
                    <Download className="w-5 h-5 mr-2" />
                    Download Transcript
                  </Button>
                  <Button
                    size="lg"
                    onClick={() => {
                      addSystemMessage("Analyzing your debate performance...");
                      generateFeedback();
                    }}
                    className="bg-gradient-to-r from-primary to-accent hover:opacity-90"
                  >
                    <Trophy className="w-5 h-5 mr-2" />
                    Hear Judgement
                  </Button>
                </div>
              </div>

              {/* Notes panel - still visible */}
              {showNotesPanel && (
                <div className="w-80 flex-shrink-0">
                  <DebateNotes
                    debateTopic={topic}
                    userSide={userSide}
                    {...notesProps}
                  />
                </div>
              )}
            </motion.div>
          )}

          {/* Analyzing Phase */}
          {phase === 'analyzing' && (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="glass-card p-8 max-w-lg text-center"
            >
              <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
              <h2 className="font-display text-xl font-bold mb-2">Analyzing Your Performance</h2>
              <p className="text-muted-foreground">
                Reviewing your arguments, evaluating evidence quality, 
                and preparing personalized feedback...
              </p>
            </motion.div>
          )}

          {/* Feedback Phase */}
          {phase === 'feedback' && feedback && (
            <motion.div
              key="feedback"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-card p-6 max-w-2xl max-h-[80vh] overflow-y-auto"
            >
              {/* Header with verdict */}
              <div className="text-center mb-6 pb-6 border-b border-border">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', delay: 0.2 }}
                  className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center mb-4"
                >
                  {getVerdictIcon(feedback.verdict)}
                </motion.div>
                <h2 className="font-display text-2xl font-bold mb-1">{getVerdictText(feedback.verdict)}</h2>
                <div className="text-4xl font-display font-bold text-primary mb-2">
                  {feedback.overallScore}<span className="text-lg text-muted-foreground">/100</span>
                </div>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">{feedback.summary}</p>
              </div>

              {/* Category Scores */}
              <div className="mb-6">
                <h3 className="font-medium mb-4 flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Performance Breakdown
                </h3>
                <div className="space-y-4">
                  {feedback.categories.map((cat, i) => (
                    <motion.div
                      key={cat.name}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="bg-muted/50 rounded-lg p-4"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-medium">{cat.name}</span>
                        <span className={`font-bold ${
                          cat.score >= 80 ? 'text-success' : 
                          cat.score >= 70 ? 'text-warning' : 
                          'text-destructive'
                        }`}>
                          {cat.score}/100
                        </span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-3">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${cat.score}%` }}
                          transition={{ delay: i * 0.1 + 0.3, duration: 0.5 }}
                          className={`h-full rounded-full ${
                            cat.score >= 80 ? 'bg-success' : 
                            cat.score >= 70 ? 'bg-warning' : 
                            'bg-destructive'
                          }`}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{cat.feedback}</p>
                      
                      {cat.strengths.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-success mb-1">Strengths:</p>
                          <ul className="text-xs text-muted-foreground space-y-0.5">
                            {cat.strengths.map((s, j) => (
                              <li key={j} className="flex items-start gap-1">
                                <CheckCircle className="w-3 h-3 text-success mt-0.5 flex-shrink-0" />
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {cat.improvements.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-warning mb-1">To Improve:</p>
                          <ul className="text-xs text-muted-foreground space-y-0.5">
                            {cat.improvements.map((imp, j) => (
                              <li key={j} className="flex items-start gap-1">
                                <ArrowRight className="w-3 h-3 text-warning mt-0.5 flex-shrink-0" />
                                {imp}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Key Moments */}
              {feedback.keyMoments.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-medium mb-4 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-warning" />
                    Key Moments
                  </h3>
                  <div className="space-y-3">
                    {feedback.keyMoments.map((moment, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.5 + i * 0.1 }}
                        className="bg-muted/30 rounded-lg p-3 border-l-2 border-l-primary/50"
                      >
                        <div className="flex items-start gap-2">
                          {getMomentIcon(moment.type)}
                          <div>
                            <p className="text-sm font-medium capitalize">{moment.type.replace('_', ' ')}</p>
                            <p className="text-xs text-muted-foreground mt-1">{moment.description}</p>
                            <p className="text-xs text-primary mt-1">{moment.suggestion}</p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Research Suggestions */}
              {feedback.researchSuggestions.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-medium mb-3 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-accent" />
                    Recommended Research
                  </h3>
                  <ul className="space-y-2">
                    {feedback.researchSuggestions.map((suggestion, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-accent">•</span>
                        {suggestion}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Button onClick={() => setPhase('results')} className="w-full">
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </motion.div>
          )}

          {/* Results Phase */}
          {phase === 'results' && (
            <motion.div
              key="results"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="glass-card p-8 max-w-lg text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', delay: 0.2 }}
                className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center mb-6"
              >
                <Trophy className="w-12 h-12 text-warning" />
              </motion.div>

              <h1 className="font-display text-3xl font-bold mb-2">Great Debate!</h1>
              <p className="text-muted-foreground mb-6">
                You competed as {userSide}. Your final score:
              </p>

              <div className="text-5xl font-display font-bold text-primary mb-6">
                {feedback?.overallScore || 75}<span className="text-2xl text-muted-foreground">/100</span>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 mb-6 text-left">
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">What's next?</strong> Sign up for free to:
                </p>
                <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                  <li>• Debate real opponents worldwide</li>
                  <li>• Track your progress and ELO rating</li>
                  <li>• Access all debate formats (BP, LD, PF, WSDC)</li>
                  <li>• Get even more detailed AI coaching</li>
                </ul>
              </div>

              <div className="space-y-3">
                <Button onClick={() => navigate('/auth')} className="w-full bg-gradient-to-r from-primary to-secondary">
                  Sign Up Free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button variant="outline" onClick={restartDemo} className="w-full">
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Try Another Topic
                </Button>
                <Button variant="ghost" onClick={() => navigate('/')} className="w-full">
                  Back to Home
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

export default Demo;
