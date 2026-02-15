import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
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
type DebatePhase = 
  | 'setup' 
  | 'prep' 
  | 'prop_constructive'  // Proposition constructive (could be user OR AI)
  | 'opp_constructive'   // Opposition constructive
  | 'prop_rebuttal'      // Proposition rebuttal
  | 'opp_rebuttal'       // Opposition rebuttal
  | 'prop_closing'       // Proposition closing
  | 'opp_closing'        // Opposition closing
  | 'transition'
  | 'debate_complete'    // Debate finished, waiting for user to request judgement
  | 'analyzing' 
  | 'feedback' 
  | 'results';

interface Message {
  id: string;
  sender: 'user' | 'ai' | 'system';
  text: string;
  timestamp: Date;
  isProgressive?: boolean;
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

interface PlayDebateProps {
  topic: string;
  format: DebateFormat;
  onExit: () => void;
}

const PlayDebate = ({ topic, format: initialFormat, onExit }: PlayDebateProps) => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [phase, setPhase] = useState<DebatePhase>('setup');
  const [timeLeft, setTimeLeft] = useState(60);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [aiTyping, setAiTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<DebateFeedback | null>(null);
  const [userArguments, setUserArguments] = useState<string[]>([]);
  const [aiArguments, setAiArguments] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Enhanced state for debate flow
  const [userSide, setUserSide] = useState<'proposition' | 'opposition'>('proposition');
  const [debateFormat, setDebateFormat] = useState<DebateFormat>(initialFormat);
  const [transitionMode, setTransitionMode] = useState<TransitionMode>('both');
  const [aiVoiceGender, setAiVoiceGender] = useState<AIVoiceGender>('male');
  const [showTransition, setShowTransition] = useState(false);
  const [nextPhaseAfterTransition, setNextPhaseAfterTransition] = useState<DebatePhase | null>(null);
  const [showNotesPanel, setShowNotesPanel] = useState(true);

  // Notes state
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesActiveTab, setNotesActiveTab] = useState<'arguments' | 'rebuttals' | 'examples'>('arguments');
  const [notesCurrentNote, setNotesCurrentNote] = useState('');
  const [notesCurrentColor, setNotesCurrentColor] = useState<'default' | 'red' | 'yellow' | 'green' | 'blue'>('default');
  const [notesCurrentTags, setNotesCurrentTags] = useState<string[]>([]);

  // AI Speech hook for TTS and progressive text
  const aiSpeech = useAISpeech({
    onComplete: () => {
      console.log('[PlayDebate] AI speech complete');
    },
    onError: (error) => {
      console.error('[PlayDebate] AI speech error:', error);
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
      console.error('[PlayDebate] Voice error:', err);
    }
  });

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, aiSpeech.displayedText]);

  // Determine if current phase is for user or AI based on side
  const isUserPhase = useCallback((currentPhase: DebatePhase): boolean => {
    if (userSide === 'proposition') {
      return currentPhase.startsWith('prop_');
    } else {
      return currentPhase.startsWith('opp_');
    }
  }, [userSide]);

  const isAIPhase = useCallback((currentPhase: DebatePhase): boolean => {
    if (userSide === 'proposition') {
      return currentPhase.startsWith('opp_');
    } else {
      return currentPhase.startsWith('prop_');
    }
  }, [userSide]);

  // Get the next phase in debate order
  const getNextPhase = useCallback((currentPhase: DebatePhase): DebatePhase | null => {
    const phaseOrder: DebatePhase[] = [
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
    return null;
  }, []);

  // Get speech type from phase
  const getSpeechType = useCallback((currentPhase: DebatePhase): 'opening' | 'rebuttal' | 'closing' => {
    if (currentPhase.includes('constructive')) return 'opening';
    if (currentPhase.includes('rebuttal')) return 'rebuttal';
    return 'closing';
  }, []);

  // Get current speech time based on format and phase
  const getCurrentSpeechTime = useCallback((currentPhase?: DebatePhase) => {
    const checkPhase = currentPhase || phase;
    const config = DEBATE_FORMATS[debateFormat];
    if (checkPhase.includes('constructive')) {
      return config.constructiveTime;
    }
    return config.rebuttalTime;
  }, [debateFormat, phase]);

  // Auto-submit on timer expiry
  const handleAutoSubmit = useCallback(() => {
    if (userInput.trim()) {
      const message = userInput.trim();
      addMessage('user', message);
      setUserArguments(prev => [...prev, message]);
      setUserInput('');
      toast.info('Time expired! Your argument was automatically submitted.');
    }
  }, [userInput]);

  // Timer logic with auto-submit
  useEffect(() => {
    if (!isTimerRunning || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setIsTimerRunning(false);
          handleAutoSubmit();
          handlePhaseEnd();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isTimerRunning, timeLeft, handleAutoSubmit]);

  const callDebateAI = useCallback(async (
    type: 'opponent_response' | 'generate_feedback',
    phaseType: 'opening' | 'rebuttal' | 'closing',
    speechDurationSeconds?: number
  ) => {
    console.log('[PlayDebate] Calling debate AI:', type, phaseType);
    
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
        console.error('[PlayDebate] Edge function error:', error);
        throw error;
      }

      return data;
    } catch (err) {
      console.error('[PlayDebate] AI call failed:', err);
      throw err;
    }
  }, [topic, userSide, userArguments, aiArguments, messages]);

  // Get AI response and deliver with TTS
  const getAIResponseWithSpeech = useCallback(async (phaseType: 'opening' | 'rebuttal' | 'closing') => {
    setAiTyping(true);
    const speechDuration = getCurrentSpeechTime();
    
    try {
      const data = await callDebateAI('opponent_response', phaseType, speechDuration);
      
      if (data?.response) {
        const aiResponse = data.response;
        setAiArguments(prev => [...prev, aiResponse]);
        
        const messageId = Date.now().toString();
        setMessages(prev => [...prev, {
          id: messageId,
          sender: 'ai',
          text: '',
          timestamp: new Date(),
          isProgressive: true,
        }]);

        setAiTyping(false);
        await aiSpeech.startSpeech(aiResponse, speechDuration, aiVoiceGender);
        
        await new Promise<void>((resolve) => {
          const checkComplete = setInterval(() => {
            if (!aiSpeech.isSpeaking) {
              clearInterval(checkComplete);
              setMessages(prev => prev.map(m => 
                m.id === messageId 
                  ? { ...m, text: aiResponse, isProgressive: false }
                  : m
              ));
              resolve();
            } else {
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
      console.error('[PlayDebate] Failed to get AI response:', err);
      setAiTyping(false);
      const aiSide = userSide === 'proposition' ? 'opposition' : 'proposition';
      const fallbackResponses = {
        opening: `As the ${aiSide}, I firmly oppose this motion. The evidence suggests that the costs of this proposal far outweigh any potential benefits.`,
        rebuttal: "My opponent's argument relies on idealistic assumptions that don't hold up in practice.",
        closing: "In weighing this debate, consider that my side has provided concrete evidence while the opposition relied on theoretical benefits."
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
      console.error('[PlayDebate] Failed to generate feedback:', err);
      setFeedback({
        overallScore: 72,
        verdict: 'close',
        summary: "You presented solid arguments but could strengthen your evidence base.",
        categories: [
          { name: 'Argumentation', score: 75, feedback: "Your logical structure was clear.", strengths: ["Clear thesis"], improvements: ["Add more warrants"] },
          { name: 'Evidence', score: 68, feedback: "Arguments would benefit from citations.", strengths: ["Good examples"], improvements: ["Cite sources"] },
          { name: 'Rebuttal', score: 70, feedback: "You engaged with opponent arguments.", strengths: ["Acknowledged points"], improvements: ["Be more direct"] },
          { name: 'Delivery', score: 78, feedback: "Your communication was clear.", strengths: ["Good pacing"], improvements: ["Vary emphasis"] },
          { name: 'Strategy', score: 72, feedback: "Good time management.", strengths: ["Covered main points"], improvements: ["Prioritize strongest arguments"] }
        ],
        keyMoments: [],
        researchSuggestions: ["Research debate frameworks", "Study similar motions"]
      });
      setPhase('feedback');
    } finally {
      setIsLoading(false);
    }
  }, [callDebateAI]);

  const showTransitionScreen = useCallback((nextPhase: DebatePhase) => {
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
    
    if (isAIPhase(nextPhase)) {
      setPhase(nextPhase);
      const aiSideLabel = userSide === 'proposition' ? 'Opposition' : 'Proposition';
      addSystemMessage(`${aiSideLabel} (AI) is presenting their ${speechType}...`);
      
      await getAIResponseWithSpeech(speechType);

      const followingPhase = getNextPhase(nextPhase);
      
      if (followingPhase) {
        setTimeout(() => {
          showTransitionScreen(followingPhase);
        }, 1500);
      } else {
        addSystemMessage("The debate has concluded. Take your time to review the arguments.");
        setTimeout(() => {
          setPhase('debate_complete');
        }, 2000);
      }
    } else {
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
    showTransitionScreen
  ]);

  const handlePhaseEnd = useCallback(async () => {
    const nextPhase = getNextPhase(phase);
    
    if (nextPhase) {
      const currentSpeaker = isUserPhase(phase) ? 'Your' : "AI's";
      addSystemMessage(`${currentSpeaker} time is up! Preparing for the next speech...`);
      showTransitionScreen(nextPhase);
    } else {
      addSystemMessage("Debate complete! Review your arguments, then click 'Hear Judgement' when ready.");
      setPhase('debate_complete');
    }
  }, [phase, getNextPhase, isUserPhase, showTransitionScreen]);

  const addMessage = (sender: 'user' | 'ai' | 'system', text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), sender, text, timestamp: new Date() },
    ]);
  };

  const addSystemMessage = (text: string) => {
    addMessage('system', text);
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
    
    if (config.audioEnabled) {
      aiSpeech.enableAudio();
      aiSpeech.setVolume(config.audioVolume);
      aiSpeech.setIsMuted(false);
    } else {
      aiSpeech.setIsMuted(true);
    }
    
    setPhase('prep');
  };

  // Start debate after prep
  const startDebate = useCallback(() => {
    const config = DEBATE_FORMATS[debateFormat];
    setUserArguments([]);
    setAiArguments([]);
    
    addSystemMessage(`The motion is: "${topic}"`);
    
    if (userSide === 'proposition') {
      setPhase('prop_constructive');
      setTimeLeft(config.constructiveTime);
      setIsTimerRunning(true);
      addSystemMessage(`You are PROPOSITION (arguing FOR). You speak first. You have ${formatTime(config.constructiveTime)} for your opening statement.`);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setPhase('prop_constructive');
      addSystemMessage(`You are OPPOSITION (arguing AGAINST). The AI speaks first as Proposition.`);
      setTimeout(async () => {
        await getAIResponseWithSpeech('opening');
        setTimeout(() => {
          showTransitionScreen('opp_constructive');
        }, 2000);
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

  const isDebatePhase = phase.includes('constructive') || phase.includes('rebuttal') || phase.includes('closing');
  const isCurrentlyUserSpeaking = isDebatePhase && isUserPhase(phase) && isTimerRunning;
  const isCurrentlyAISpeaking = isDebatePhase && isAIPhase(phase) && aiSpeech.isSpeaking;

  const getPhaseLabel = () => {
    const speechType = getSpeechType(phase);
    const side = phase.startsWith('prop_') ? 'Proposition' : 'Opposition';
    const speaker = isUserPhase(phase) ? 'You' : 'AI';
    return `${side} (${speaker}) - ${speechType.charAt(0).toUpperCase() + speechType.slice(1)}`;
  };

  const getTransitionNextSpeaker = (): 'user' | 'ai' => {
    if (!nextPhaseAfterTransition) return 'user';
    return isUserPhase(nextPhaseAfterTransition) ? 'user' : 'ai';
  };

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
      {/* Transition Countdown Overlay */}
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
            <span className="px-2 py-1 rounded bg-primary/20 text-primary text-xs font-medium">
              AI DEBATE
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
            {isCurrentlyUserSpeaking && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted">
                <Clock className={`w-4 h-4 ${timeLeft <= 10 ? 'text-destructive' : 'text-muted-foreground'}`} />
                <span className={`font-mono font-bold ${timeLeft <= 10 ? 'text-destructive' : ''}`}>
                  {formatTime(timeLeft)}
                </span>
              </div>
            )}
            
            {isCurrentlyAISpeaking && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/20">
                <Volume2 className="w-4 h-4 text-accent animate-pulse" />
                <span className="text-sm font-medium text-accent">AI Speaking</span>
                <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-background/50">
                  <Clock className={`w-4 h-4 ${aiSpeech.speechTimeRemaining <= 10 ? 'text-destructive' : 'text-accent'}`} />
                  <span className={`font-mono font-bold ${aiSpeech.speechTimeRemaining <= 10 ? 'text-destructive' : 'text-accent'}`}>
                    {formatTime(aiSpeech.speechTimeRemaining)}
                  </span>
                </div>
                <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-accent"
                    style={{ width: `${aiSpeech.progress}%` }}
                  />
                </div>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={onExit}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Exit
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <AnimatePresence mode="wait">
          {/* Setup Phase */}
          {phase === 'setup' && (
            <DebateSetup
              topic={topic}
              onStart={handleSetupComplete}
              onBack={onExit}
            />
          )}

          {/* Prep Phase */}
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

          {/* Debate Phase */}
          {isDebatePhase && (
            <motion.div
              key="debate"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-5xl flex gap-4"
            >
              <div className="flex-1">
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

                <div className="glass-card p-4 h-[50vh] overflow-y-auto mb-4">
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
                            msg.sender === 'user' ? 'bg-primary/20' : 'bg-accent/20'
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
                          {msg.isProgressive ? aiSpeech.displayedText || '...' : msg.text}
                        </div>
                      </motion.div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {isCurrentlyUserSpeaking && (
                  <div className="glass-card p-4">
                    <div className="flex gap-2">
                      <input
                        ref={inputRef}
                        type="text"
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        placeholder="Type your argument here..."
                        className="flex-1 px-4 py-2 rounded-lg bg-muted border border-border focus:border-primary focus:outline-none"
                        disabled={!isTimerRunning}
                      />
                      {voiceSupported && (
                        <Button
                          variant={isRecording ? 'destructive' : 'outline'}
                          size="icon"
                          onClick={toggleRecording}
                        >
                          {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                        </Button>
                      )}
                      <Button onClick={handleSendMessage} disabled={!userInput.trim()}>
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      Submit your argument before the timer runs out
                    </p>
                  </div>
                )}

                {aiTyping && (
                  <div className="text-center py-4">
                    <Loader2 className="w-6 h-6 mx-auto animate-spin text-accent" />
                    <p className="text-sm text-muted-foreground mt-2">AI is preparing response...</p>
                  </div>
                )}

                {isCurrentlyAISpeaking && !aiTyping && (
                  <div className="text-center py-4 text-muted-foreground">
                    <Volume2 className="w-6 h-6 mx-auto mb-2 animate-pulse text-accent" />
                    <p className="text-sm">AI opponent is speaking. Listen and prepare your response...</p>
                  </div>
                )}
              </div>

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

          {/* Debate Complete Phase */}
          {phase === 'debate_complete' && (
            <motion.div
              key="debate-complete"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-6xl flex gap-6"
            >
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
                            msg.sender === 'user' ? 'bg-primary/20' : 'bg-accent/20'
                          }`}>
                            {msg.sender === 'user' ? (
                              <User className="w-4 h-4 text-primary" />
                            ) : (
                              <Bot className="w-4 h-4 text-accent" />
                            )}
                          </div>
                          <div className={`rounded-lg p-3 max-w-[85%] ${
                            msg.sender === 'user' ? 'bg-primary/10' : 'bg-accent/10'
                          }`}>
                            <p className="text-sm">{msg.text}</p>
                          </div>
                        </>
                      )}
                    </motion.div>
                  ))}
                </div>

                <div className="flex justify-center gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      const transcriptLines = messages
                        .filter(msg => msg.sender !== 'system')
                        .map(msg => {
                          const speaker = msg.sender === 'user' 
                            ? `[You - ${userSide === 'proposition' ? 'Proposition' : 'Opposition'}]`
                            : `[AI - ${userSide === 'proposition' ? 'Opposition' : 'Proposition'}]`;
                          return `${speaker}\n${msg.text}\n`;
                        })
                        .join('\n');
                      
                      const fullTranscript = `DEBATE TRANSCRIPT\n================\nMotion: "${topic}"\nYour Side: ${userSide === 'proposition' ? 'Proposition' : 'Opposition'}\nDate: ${new Date().toLocaleDateString()}\n\n${transcriptLines}`;
                      
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
                  <strong className="text-foreground">Your Progress:</strong> This debate has been recorded to your profile.
                </p>
                <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                  <li>• Try human vs human matchmaking next</li>
                  <li>• Practice different formats to improve</li>
                  <li>• Review your ELO progression in profile</li>
                </ul>
              </div>

              <div className="space-y-3">
                <Button onClick={onExit} className="w-full bg-gradient-to-r from-primary to-secondary">
                  Find Another Debate
                  <ArrowRight className="w-4 h-4 ml-2" />
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

export default PlayDebate;
