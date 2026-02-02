import { useState, useRef, useEffect, useCallback } from "react";
import { useMeetings } from "@/hooks/use-meetings";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Mic,
  Square,
  ArrowLeft,
  Save,
  Loader2,
  FileText,
  CheckCircle2,
  Play,
  Trash2,
  AlertCircle,
  Phone,
  User,
  Calendar,
  MapPin,
  Heart,
  FilePlus,
} from "lucide-react";
import { format } from "date-fns";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// ── Audio Helpers ──

function downsample(
  buffer: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate === outputRate) return buffer;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const idx = Math.round(i * ratio);
    result[i] = buffer[Math.min(idx, buffer.length - 1)];
  }
  return result;
}

function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// ── Types ──

type Mode = "list" | "setup" | "recording" | "review";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "pl", label: "Polish" },
  { code: "ro", label: "Romanian" },
  { code: "hi", label: "Hindi / Punjabi" },
  { code: "zh", label: "Chinese (Mandarin)" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "tr", label: "Turkish" },
  { code: "nl", label: "Dutch" },
];

// ── Checklist Types ──

interface ChecklistItem {
  id: string;
  question: string;
  category: "critical" | "important" | "supplementary";
  fieldMapping?: string;
  isCustom: boolean;
}

interface ChecklistTemplate {
  id: number;
  name: string;
  description?: string;
  isDefault: boolean;
  items: ChecklistItem[];
}

const CATEGORY_CONFIG = {
  critical: { 
    label: "Critical", 
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-900/20",
    iconColor: "text-red-500",
  },
  important: { 
    label: "Important", 
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
    iconColor: "text-amber-500",
  },
  supplementary: { 
    label: "Supplementary", 
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    iconColor: "text-blue-500",
  },
};

// Helper to get nested value from object using dot notation
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

// ── Component ──

export default function XScribeMeetings() {
  const { data: meetings, isLoading } = useMeetings();
  const { data: cases } = useQuery<any[]>({ queryKey: ["/api/cases"] });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // State
  const [mode, setMode] = useState<Mode>("list");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [directorName, setDirectorName] = useState("");
  const [language, setLanguage] = useState("en");
  const [fullTranscript, setFullTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [editableTranscript, setEditableTranscript] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);

  // Fetch intake data when case is selected
  const { data: intakeData } = useQuery({
    queryKey: ["/api/cases", selectedCaseId, "intake"],
    queryFn: async () => {
      if (!selectedCaseId) return null;
      const res = await fetch(`/api/cases/${selectedCaseId}/intake`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedCaseId,
  });

  // Fetch the computed checklist for the selected case
  interface ComputedChecklistItem extends ChecklistItem {
    isCompleted: boolean;
    isManuallyCompleted: boolean;
  }
  
  interface ComputedChecklist {
    caseId: number;
    templateId: number;
    templateName: string;
    items: ComputedChecklistItem[];
    completedCount: number;
    totalItems: number;
    completedPercentage: number;
  }
  
  const { data: computedChecklist, refetch: refetchChecklist } = useQuery<ComputedChecklist | null>({
    queryKey: ["/api/cases", selectedCaseId, "checklist"],
    queryFn: async () => {
      if (!selectedCaseId) return null;
      const res = await fetch(`/api/cases/${selectedCaseId}/checklist`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedCaseId && mode === "review",
  });
  
  const toggleChecklistMutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiRequest("POST", `/api/cases/${selectedCaseId}/checklist/${itemId}/toggle`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "checklist"] });
    },
    onError: (error: any) => {
      toast({
        title: "Cannot toggle item",
        description: error?.message || "This item cannot be manually toggled",
        variant: "destructive",
      });
    },
  });

  // Document generation mutation
  const generateDocsMutation = useMutation({
    mutationFn: async (caseId: number) => {
      return apiRequest("POST", `/api/cases/${caseId}/generate-documents`, { 
        documentTypes: ["contract", "obituary", "service_program"] 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({
        title: "Documents generated",
        description: "Draft documents have been created and linked to the case.",
      });
    },
  });

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [fullTranscript, interimText]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRecording();
    };
  }, []);

  // ── Save Meeting ──

  const saveMutation = useMutation({
    mutationFn: async (data: {
      caseId?: number;
      directorName: string;
      language: string;
      transcript: string;
    }) => {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: data.caseId || null,
          directorName: data.directorName || "Unknown Director",
          language: LANGUAGES.find((l) => l.code === data.language)?.label || "English",
          transcript: data.transcript,
          summary: null,
          actionItems: [],
          status: "completed",
        }),
      });
      if (!res.ok) throw new Error("Failed to save meeting");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      toast({
        title: "Meeting saved",
        description: "The transcript has been saved successfully.",
      });
      resetState();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save meeting. Please try again.",
        variant: "destructive",
      });
    },
  });

  // ── Recording Controls ──

  const resetState = () => {
    setMode("list");
    setFullTranscript("");
    setInterimText("");
    setEditableTranscript("");
    setRecordingTime(0);
    setSelectedCaseId("");
    setDirectorName("");
    setLanguage("en");
    setIsConnecting(false);
  };

  const cleanupRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    processorRef.current?.disconnect();
    contextRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
    processorRef.current = null;
    contextRef.current = null;
    streamRef.current = null;
    wsRef.current = null;
  };

  const startRecording = async () => {
    setIsConnecting(true);

    try {
      // 1. Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // 2. Connect WebSocket to our server
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/deepgram`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "start", language }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "ready") {
          setIsConnecting(false);
          setMode("recording");

          // 3. Start capturing audio from microphone
          const context = new AudioContext();
          contextRef.current = context;
          const source = context.createMediaStreamSource(stream);
          const processor = context.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          processor.onaudioprocess = (e: AudioProcessingEvent) => {
            if (ws.readyState === WebSocket.OPEN) {
              const float32 = e.inputBuffer.getChannelData(0);
              const downsampled = downsample(float32, context.sampleRate, 16000);
              const pcm = floatTo16BitPCM(downsampled);
              ws.send(pcm);
            }
          };

          source.connect(processor);
          processor.connect(context.destination);

          // 4. Start recording timer
          timerRef.current = setInterval(() => {
            setRecordingTime((t) => t + 1);
          }, 1000);
        }

        if (data.type === "transcript") {
          if (data.speechFinal && data.isFinal) {
            setFullTranscript(data.fullTranscript);
            setInterimText("");
          } else {
            setInterimText(data.transcript);
          }
        }

        if (data.type === "stopped") {
          setFullTranscript(data.fullTranscript);
        }

        if (data.type === "error") {
          toast({
            title: "Transcription Error",
            description: data.message,
            variant: "destructive",
          });
          setIsConnecting(false);
        }
      };

      ws.onerror = () => {
        toast({
          title: "Connection Error",
          description:
            "Could not connect to the transcription service. Check that the server is running.",
          variant: "destructive",
        });
        setIsConnecting(false);
        cleanupRecording();
      };

      ws.onclose = () => {
        setIsConnecting(false);
      };
    } catch (err: any) {
      setIsConnecting(false);
      if (err.name === "NotAllowedError") {
        toast({
          title: "Microphone Access Denied",
          description:
            "Please allow microphone access in your browser to record meetings.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: err.message || "Failed to start recording.",
          variant: "destructive",
        });
      }
    }
  };

  const stopRecording = () => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop audio capture
    processorRef.current?.disconnect();
    contextRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    contextRef.current = null;
    streamRef.current = null;

    // Tell server to stop Deepgram
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }, 2000);
    }

    // Move to review mode
    setEditableTranscript(fullTranscript);
    setMode("review");
  };

  const handleSave = () => {
    saveMutation.mutate({
      caseId: selectedCaseId ? parseInt(selectedCaseId) : undefined,
      directorName,
      language,
      transcript: editableTranscript,
    });
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // ════════════════════════════════════════════
  // SETUP MODE — Choose case, language, director
  // ════════════════════════════════════════════

  if (mode === "setup") {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setMode("list")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <div>
            <h2 className="text-3xl font-display font-bold text-primary">
              New Recording
            </h2>
            <p className="text-muted-foreground mt-1">
              Set up before starting the meeting recording.
            </p>
          </div>
        </div>

        <Card className="max-w-xl">
          <CardContent className="p-6 space-y-5">
            {/* Case Selection */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Link to Case{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </label>
              <select
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
                className="w-full border border-input rounded-md p-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="select-case"
              >
                <option value="">No case selected</option>
                {cases?.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.deceasedName} — {c.religion || "N/A"} ({c.status})
                  </option>
                ))}
              </select>
            </div>

            {/* Pre-filled data from xLink (when case is selected) */}
            {intakeData && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 text-primary font-medium text-sm">
                  <Phone className="w-4 h-4" />
                  <span>Pre-filled from xLink Call</span>
                  <Badge variant="outline" className="ml-auto text-xs">
                    {intakeData.completedPercentage}% Complete
                  </Badge>
                </div>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {intakeData.intakeData?.callerInfo?.name && (
                    <div className="flex items-start gap-2">
                      <User className="w-4 h-4 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Caller</p>
                        <p className="font-medium">{intakeData.intakeData.callerInfo.name}</p>
                        {intakeData.intakeData.callerInfo.relationship && (
                          <p className="text-xs text-muted-foreground">{intakeData.intakeData.callerInfo.relationship}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {intakeData.intakeData?.deceasedInfo?.fullName && (
                    <div className="flex items-start gap-2">
                      <Heart className="w-4 h-4 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Deceased</p>
                        <p className="font-medium">{intakeData.intakeData.deceasedInfo.fullName}</p>
                      </div>
                    </div>
                  )}
                  {intakeData.intakeData?.servicePreferences?.religion && (
                    <div className="flex items-start gap-2">
                      <Calendar className="w-4 h-4 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Religion</p>
                        <p className="font-medium">{intakeData.intakeData.servicePreferences.religion}</p>
                      </div>
                    </div>
                  )}
                  {intakeData.intakeData?.servicePreferences?.burialOrCremation && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Preference</p>
                        <p className="font-medium capitalize">{intakeData.intakeData.servicePreferences.burialOrCremation}</p>
                      </div>
                    </div>
                  )}
                </div>

                {intakeData.missingFields?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-primary/10">
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {intakeData.missingFields.length} required field(s) still needed
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Director Name */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Director Name
              </label>
              <input
                type="text"
                value={directorName}
                onChange={(e) => setDirectorName(e.target.value)}
                placeholder="e.g. Sarah Jenkins"
                className="w-full border border-input rounded-md p-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Language */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Meeting Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full border border-input rounded-md p-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Start Button */}
            <Button
              className="w-full bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-200 py-6 text-base"
              onClick={startRecording}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Connecting to transcription service...
                </>
              ) : (
                <>
                  <Mic className="w-5 h-5 mr-2" />
                  Start Recording
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Your browser will ask for microphone permission. Audio is streamed
              for transcription only and is not stored.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ════════════════════════════════════════
  // RECORDING MODE — Live transcription
  // ════════════════════════════════════════

  if (mode === "recording") {
    return (
      <div className="space-y-6">
        {/* Header with recording indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-full px-4 py-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
              </span>
              <span className="text-red-700 font-semibold text-sm">
                RECORDING
              </span>
            </div>
            <span className="text-2xl font-mono font-bold text-foreground tabular-nums">
              {formatTime(recordingTime)}
            </span>
          </div>

          <Button
            onClick={stopRecording}
            variant="destructive"
            className="shadow-lg px-6 py-5"
          >
            <Square className="w-4 h-4 mr-2 fill-current" />
            Stop Recording
          </Button>
        </div>

        {/* Meeting info */}
        <div className="flex gap-3 text-sm text-muted-foreground">
          {directorName && (
            <Badge variant="outline" className="bg-secondary/50">
              Director: {directorName}
            </Badge>
          )}
          <Badge variant="outline" className="bg-secondary/50">
            {LANGUAGES.find((l) => l.code === language)?.label || "English"}
          </Badge>
          {selectedCaseId && cases && (
            <Badge variant="outline" className="bg-secondary/50">
              Case: {cases.find((c: any) => c.id === parseInt(selectedCaseId))?.deceasedName || "—"}
            </Badge>
          )}
        </div>

        {/* Live transcript area */}
        <Card className="shadow-sm border-border/60">
          <CardContent className="p-0">
            <div className="bg-muted/30 px-4 py-2 border-b border-border/60 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                Live Transcript
              </span>
              <span className="text-xs text-muted-foreground">
                Powered by Deepgram
              </span>
            </div>
            <div className="p-6 min-h-[400px] max-h-[60vh] overflow-y-auto font-mono text-sm leading-relaxed">
              {fullTranscript ? (
                <div className="space-y-2">
                  {fullTranscript.split("\n").map((line, i) => (
                    <p key={i} className="text-foreground">
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                !interimText && (
                  <p className="text-muted-foreground/50 italic">
                    Start speaking — your words will appear here in real
                    time...
                  </p>
                )
              )}

              {/* Interim (not yet confirmed) text */}
              {interimText && (
                <p className="text-muted-foreground/60 italic mt-2">
                  {interimText}
                </p>
              )}

              <div ref={transcriptEndRef} />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ════════════════════════════════════════
  // REVIEW MODE — Edit and save transcript
  // ════════════════════════════════════════

  if (mode === "review") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (
                confirm(
                  "Are you sure? The transcript will be lost if you go back."
                )
              ) {
                resetState();
              }
            }}
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Discard & Go Back
          </Button>
          <div>
            <h2 className="text-3xl font-display font-bold text-primary">
              Review Transcript
            </h2>
            <p className="text-muted-foreground mt-1">
              Recording: {formatTime(recordingTime)} •{" "}
              {LANGUAGES.find((l) => l.code === language)?.label || "English"}
            </p>
          </div>
        </div>

        {/* Meeting info */}
        <div className="flex gap-3 text-sm">
          {directorName && (
            <Badge variant="outline" className="bg-secondary/50">
              Director: {directorName}
            </Badge>
          )}
          {selectedCaseId && cases && (
            <Badge variant="outline" className="bg-secondary/50">
              Case:{" "}
              {cases.find((c: any) => c.id === parseInt(selectedCaseId))
                ?.deceasedName || "—"}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Editable transcript */}
          <Card className="shadow-sm lg:col-span-2">
            <CardContent className="p-6">
              <label className="block text-sm font-medium text-foreground mb-2">
                Transcript{" "}
                <span className="text-muted-foreground font-normal">
                  — you can edit before saving
                </span>
              </label>
              <textarea
                value={editableTranscript}
                onChange={(e) => setEditableTranscript(e.target.value)}
                rows={16}
                className="w-full border border-input rounded-md p-4 text-sm bg-background font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                placeholder="No transcript was captured..."
                data-testid="textarea-transcript"
              />
            </CardContent>
          </Card>

          {/* Computed Checklist with Toggle */}
          {selectedCaseId && computedChecklist && (
            <Card className="shadow-sm h-fit max-h-[600px] overflow-y-auto">
              <CardContent className="p-4">
                <h3 className="font-medium text-foreground mb-1 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  Meeting Checklist
                </h3>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-muted-foreground">{computedChecklist.templateName}</p>
                  <Badge variant="secondary" className="text-xs">
                    {computedChecklist.completedCount}/{computedChecklist.totalItems}
                  </Badge>
                </div>
                
                {/* Progress bar */}
                <div className="mb-4">
                  <div className="w-full bg-muted rounded-full h-2">
                    <div 
                      className="bg-primary h-2 rounded-full transition-all" 
                      style={{ width: `${computedChecklist.completedPercentage}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 text-right">{computedChecklist.completedPercentage}% complete</p>
                </div>
                
                {(["critical", "important", "supplementary"] as const).map(category => {
                  const config = CATEGORY_CONFIG[category];
                  const items = computedChecklist.items.filter(i => i.category === category);
                  if (items.length === 0) return null;
                  
                  const completedInCategory = items.filter(i => i.isCompleted).length;
                  
                  return (
                    <div key={category} className="mb-4">
                      <h4 className={`text-xs font-medium uppercase tracking-wider mb-2 flex items-center justify-between ${config.color}`}>
                        <span>{config.label}</span>
                        <span className="text-muted-foreground">{completedInCategory}/{items.length}</span>
                      </h4>
                      <div className="space-y-1">
                        {items.map(item => {
                          const isAutoCompleted = item.fieldMapping && item.isCompleted && !item.isManuallyCompleted;
                          const canToggle = !isAutoCompleted;
                          
                          return (
                            <button 
                              key={item.id}
                              onClick={() => canToggle && toggleChecklistMutation.mutate(item.id)}
                              disabled={toggleChecklistMutation.isPending || !canToggle}
                              className={`flex items-start gap-2 p-2 rounded text-sm w-full text-left transition-colors ${
                                item.isCompleted 
                                  ? "bg-green-50 dark:bg-green-900/20" 
                                  : `${config.bgColor}`
                              } ${canToggle ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
                              data-testid={`checklist-item-${item.id}`}
                            >
                              {item.isCompleted ? (
                                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                              ) : (
                                <div className={`w-4 h-4 border-2 rounded flex-shrink-0 mt-0.5 ${config.iconColor} border-current`} />
                              )}
                              <span className={`flex-1 ${item.isCompleted ? "text-green-700 dark:text-green-300" : "text-foreground"}`}>
                                {item.question}
                              </span>
                              {isAutoCompleted && (
                                <span className="text-xs text-muted-foreground">(auto)</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending || !editableTranscript.trim()}
            className="bg-primary text-white px-8 py-5"
            data-testid="button-save-meeting"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" /> Save Meeting
              </>
            )}
          </Button>

          {selectedCaseId && (
            <Button
              variant="outline"
              onClick={() => generateDocsMutation.mutate(parseInt(selectedCaseId))}
              disabled={generateDocsMutation.isPending || !editableTranscript.trim()}
              className="px-6 py-5"
              data-testid="button-generate-docs"
            >
              {generateDocsMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...
                </>
              ) : (
                <>
                  <FilePlus className="w-4 h-4 mr-2" /> Generate Documents
                </>
              )}
            </Button>
          )}

          <Button
            variant="outline"
            onClick={() => {
              if (
                confirm(
                  "Are you sure you want to discard this transcript?"
                )
              ) {
                resetState();
              }
            }}
            className="px-6 py-5"
          >
            <Trash2 className="w-4 h-4 mr-2" /> Discard
          </Button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════
  // LIST MODE — Existing meetings (default)
  // ════════════════════════════════════════

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-display font-bold text-primary">
            xScribe Meetings
          </h2>
          <p className="text-muted-foreground mt-1">
            Arrangement meeting transcripts, summaries, and action items.
          </p>
        </div>
        <Button
          className="bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-200"
          onClick={() => setMode("setup")}
        >
          <Mic className="w-4 h-4 mr-2" />
          Start New Recording
        </Button>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">
            Loading meetings...
          </div>
        ) : (
          meetings?.map((meeting: any) => (
            <Card
              key={meeting.id}
              className="shadow-sm hover:shadow-md transition-shadow border-border/60"
            >
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="min-w-[200px]">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 bg-blue-100 rounded-full">
                        <Mic className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">
                          Arrangement Meeting
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Director: {meeting.directorName || "Unknown"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <StatusBadge status={meeting.status || "processing"} />
                      <Badge
                        variant="outline"
                        className="text-xs bg-secondary/50 border-secondary"
                      >
                        {meeting.language || "English"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {meeting.createdAt
                        ? format(
                            new Date(meeting.createdAt),
                            "MMM d, yyyy • h:mm a"
                          )
                        : ""}
                    </p>
                  </div>

                  <div className="flex-1 space-y-4">
                    {meeting.summary ? (
                      <div>
                        <p className="text-sm font-medium text-primary mb-1">
                          Meeting Summary
                        </p>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {meeting.summary}
                        </p>
                      </div>
                    ) : meeting.transcript ? (
                      <div>
                        <p className="text-sm font-medium text-primary mb-1">
                          Transcript Preview
                        </p>
                        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                          {meeting.transcript}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm italic text-muted-foreground">
                        Processing transcript...
                      </p>
                    )}

                    {meeting.actionItems &&
                      Array.isArray(meeting.actionItems) &&
                      (meeting.actionItems as string[]).length > 0 && (
                        <div className="bg-green-50/50 p-3 rounded-lg border border-green-100">
                          <p className="text-sm font-medium text-green-800 mb-2 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4" /> Action Items
                          </p>
                          <ul className="space-y-1">
                            {(meeting.actionItems as string[]).map(
                              (item: string, idx: number) => (
                                <li
                                  key={idx}
                                  className="text-sm text-green-700/80 pl-2 border-l-2 border-green-200"
                                >
                                  {item}
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      )}
                  </div>

                  <div className="flex md:flex-col justify-end gap-2 min-w-[140px]">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-2"
                    >
                      <FileText className="w-4 h-4" /> Full Transcript
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2 text-primary"
                    >
                      <Play className="w-4 h-4" /> Listen
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {!isLoading && meetings?.length === 0 && (
          <div className="text-center py-20 bg-muted/10 rounded-xl border border-dashed border-border">
            <Mic className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium">No meetings recorded</h3>
            <p className="text-muted-foreground">
              Start a recording to generate transcripts and action items.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
