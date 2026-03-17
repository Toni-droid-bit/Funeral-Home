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
  X,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { InlineEditField } from "@/components/inline-edit-field";

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
  const [showChecklistPrompt, setShowChecklistPrompt] = useState(true);
  const [isProcessingTranscript, setIsProcessingTranscript] = useState(false);
  const [isNewCase, setIsNewCase] = useState(false);
  const [newCaseName, setNewCaseName] = useState("");
  const [checklistInputs, setChecklistInputs] = useState<Record<string, string>>({});
  const [reviewMeetingId, setReviewMeetingId] = useState<number | null>(null);
  const [isSavingTranscript, setIsSavingTranscript] = useState(false);

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
    enabled: !!selectedCaseId && (mode === "review" || mode === "recording"),
    // Refresh every 5 seconds during recording — checklist updates in real time
    refetchInterval: mode === "recording" ? 5000 : false,
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

  const updateChecklistValueMutation = useMutation({
    mutationFn: async ({ itemId, value }: { itemId: string; value: string }) => {
      return apiRequest("POST", `/api/cases/${selectedCaseId}/checklist/${itemId}/update-value`, { value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "checklist"] });
    },
  });

  const handleChecklistInput = async (itemId: string, value: string) => {
    if (!selectedCaseId || !value.trim()) return;
    try {
      await apiRequest("POST", `/api/cases/${selectedCaseId}/checklist/${itemId}/update-value`, { value: value.trim() });
      await apiRequest("POST", `/api/cases/${selectedCaseId}/checklist/${itemId}/toggle`, {});
    } catch {
      // item may already be completed or have fieldMapping auto-completion
    }
    queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "checklist"] });
  };

  // Keep a ref to the latest transcript so the polling interval doesn't reset on every
  // new word (which would prevent it from ever firing during active speech).
  const fullTranscriptRef = useRef("");
  useEffect(() => {
    fullTranscriptRef.current = fullTranscript;
  }, [fullTranscript]);

  // Track in-flight state via ref to avoid stale closures inside the interval.
  const isProcessingRef = useRef(false);

  // Process transcript in real-time to update checklist
  const processTranscriptMutation = useMutation({
    mutationFn: async (transcript: string) => {
      console.log(`[xscribe] processTranscriptMutation firing — caseId=${selectedCaseId} transcript length=${transcript.length}`);
      return apiRequest("POST", `/api/cases/${selectedCaseId}/process-transcript`, {
        transcript
      });
    },
    onSuccess: () => {
      console.log(`[xscribe] processTranscriptMutation succeeded — invalidating checklist`);
      // Invalidate checklist, cases list, and individual case so name updates everywhere
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "checklist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases/:id", Number(selectedCaseId)] });
      refetchChecklist();
      isProcessingRef.current = false;
      setIsProcessingTranscript(false);
    },
    onError: (error: any) => {
      console.error("[xscribe] processTranscriptMutation failed:", error);
      isProcessingRef.current = false;
      setIsProcessingTranscript(false);
    },
  });

  // Extract data from transcript (manual trigger in review mode)
  const extractDataMutation = useMutation({
    mutationFn: async (transcript: string) => {
      return apiRequest("POST", `/api/cases/${selectedCaseId}/process-transcript`, { transcript });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "intake"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "checklist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      refetchChecklist();
      toast({ title: "Data extracted", description: "Checklist updated from transcript." });
    },
    onError: () => {
      toast({ title: "Extraction failed", description: "Could not parse transcript.", variant: "destructive" });
    },
  });

  // Auto-process transcript every 5 seconds during recording.
  // IMPORTANT: fullTranscript is read via ref so this interval is stable and does NOT
  // reset on every new word spoken (which would prevent it ever firing).
  useEffect(() => {
    if (mode !== "recording" || !selectedCaseId) return;

    const interval = setInterval(() => {
      const transcript = fullTranscriptRef.current;
      if (transcript && transcript.length > 50 && !isProcessingRef.current) {
        console.log(`[xscribe] polling tick — scheduling process-transcript (${transcript.length} chars)`);
        isProcessingRef.current = true;
        setIsProcessingTranscript(true);
        processTranscriptMutation.mutate(transcript);
      } else {
        console.log(`[xscribe] polling tick — skipped (length=${transcript?.length ?? 0} inFlight=${isProcessingRef.current})`);
      }
    }, 5000); // Every 5 seconds — stable interval, not reset by new words

    return () => clearInterval(interval);
  }, [mode, selectedCaseId]); // NOT fullTranscript — use ref above

  // Patch case intake data (for editable fields in list mode)
  const patchCaseMutation = useMutation({
    mutationFn: async ({ caseId, data }: { caseId: number; data: any }) => {
      return apiRequest("PATCH", `/api/cases/${caseId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    },
    onError: () => {
      toast({ title: "Save failed", description: "Could not save field.", variant: "destructive" });
    },
  });

  const makeIntakeSaver = (caseId: number, section: string, field: string) => async (value: string) => {
    await patchCaseMutation.mutateAsync({
      caseId,
      data: { intakeData: { [section]: { [field]: value } } },
    });
  };

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
    setShowChecklistPrompt(true);
    setIsNewCase(false);
    setNewCaseName("");
    setChecklistInputs({});
    setReviewMeetingId(null);
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

    // Process final transcript before moving to review
    if (selectedCaseId && fullTranscript) {
      processTranscriptMutation.mutate(fullTranscript);
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

  const handleStartRecording = async () => {
    if (isNewCase && newCaseName.trim()) {
      try {
        const res = await fetch("/api/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deceasedName: newCaseName.trim(), status: "active" }),
        });
        if (!res.ok) throw new Error("Failed to create case");
        const newCase = await res.json();
        setSelectedCaseId(String(newCase.id));
        queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      } catch {
        toast({ title: "Failed to create case", description: "Could not create the new case. Please try again.", variant: "destructive" });
        return;
      }
    }
    startRecording();
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Get incomplete checklist items
  const incompleteItems = computedChecklist?.items.filter(item => !item.isCompleted) || [];

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
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-foreground">
                  Link to Case{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-sm text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={isNewCase}
                    onChange={(e) => {
                      setIsNewCase(e.target.checked);
                      if (e.target.checked) setSelectedCaseId("");
                    }}
                    className="rounded"
                  />
                  New case
                </label>
              </div>
              {isNewCase ? (
                <input
                  type="text"
                  value={newCaseName}
                  onChange={(e) => setNewCaseName(e.target.value)}
                  placeholder="Deceased name (e.g. John Smith)"
                  className="w-full border border-input rounded-md p-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              ) : (
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
              )}
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
              onClick={handleStartRecording}
              disabled={isConnecting || (isNewCase && !newCaseName.trim())}
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
            {isProcessingTranscript && (
              <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                <Sparkles className="w-3 h-3 mr-1" />
                AI Processing...
              </Badge>
            )}
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Live transcript area */}
          <Card className="shadow-sm border-border/60 lg:col-span-2">
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

          {/* Checklist Panel - only show when case is selected */}
          {selectedCaseId && computedChecklist && showChecklistPrompt && (
            <Card className="shadow-lg border-amber-200 dark:border-amber-800 h-fit max-h-[80vh] flex flex-col">
              <CardContent className="p-4 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-foreground flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-500" />
                    Live Checklist
                    {isProcessingTranscript && (
                      <span className="text-xs text-muted-foreground animate-pulse">updating…</span>
                    )}
                  </h3>
                  <Button variant="ghost" size="icon" onClick={() => setShowChecklistPrompt(false)} className="h-6 w-6">
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                {/* Progress bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Overall progress</span>
                    <span className="font-semibold">{computedChecklist.completedCount}/{computedChecklist.totalItems} ({computedChecklist.completedPercentage}%)</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2.5">
                    <div
                      className="bg-green-500 h-2.5 rounded-full transition-all duration-700"
                      style={{ width: `${computedChecklist.completedPercentage}%` }}
                    />
                  </div>
                </div>

                {/* Critical items still missing — red alert */}
                {(() => {
                  const missingCritical = computedChecklist.items.filter(i => i.category === "critical" && !i.isCompleted);
                  if (missingCritical.length === 0) return (
                    <div className="mb-3 p-2 bg-green-50 dark:bg-green-900/20 rounded text-xs text-green-700 dark:text-green-300 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> All critical items captured!
                    </div>
                  );
                  return (
                    <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                      <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">
                        ⚠ {missingCritical.length} critical item{missingCritical.length !== 1 ? "s" : ""} still needed:
                      </p>
                      <ul className="space-y-0.5">
                        {missingCritical.map(i => (
                          <li key={i.id} className="text-xs text-red-600 dark:text-red-400">• {i.question}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {/* Only show critical + important items during recording to keep it focused */}
                <div className="space-y-1.5 overflow-y-auto flex-1">
                  {[...computedChecklist.items]
                    .filter(item => item.category !== "supplementary")
                    .sort((a, b) => {
                      // Incomplete items float to top, completed sink to bottom
                      if (a.isCompleted === b.isCompleted) return 0;
                      return a.isCompleted ? 1 : -1;
                    })
                    .map(item => {
                    const isCriticalMissing = item.category === "critical" && !item.isCompleted;
                    return (
                      <div
                        key={item.id}
                        className={`p-2 rounded text-sm transition-all duration-300 ${
                          item.isCompleted
                            ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                            : isCriticalMissing
                            ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                            : "bg-amber-50 dark:bg-amber-900/20"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {item.isCompleted ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                          ) : (
                            <div className={`w-3 h-3 border-2 rounded flex-shrink-0 mt-1 ${isCriticalMissing ? "border-red-500 text-red-500" : "border-amber-500 text-amber-500"} border-current`} />
                          )}
                          <span className={`flex-1 text-xs ${item.isCompleted ? "text-green-700 dark:text-green-300 line-through" : isCriticalMissing ? "text-red-700 dark:text-red-400 font-medium" : "text-foreground"}`}>
                            {item.question}
                          </span>
                        </div>
                        {!item.isCompleted && (
                          <input
                            type="text"
                            placeholder="Type answer to complete…"
                            value={checklistInputs[item.id] || ""}
                            onChange={(e) => setChecklistInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && e.currentTarget.value.trim()) {
                                handleChecklistInput(item.id, e.currentTarget.value.trim());
                              }
                            }}
                            onBlur={(e) => {
                              if (e.target.value.trim()) handleChecklistInput(item.id, e.target.value.trim());
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1.5 w-full px-2 py-1 text-xs border border-input rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Show message if no case selected */}
          {!selectedCaseId && (
            <Card className="shadow-sm border-border/60 h-fit">
              <CardContent className="p-4 text-center text-muted-foreground">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No case selected</p>
                <p className="text-xs mt-1">Link to a case in setup to see the checklist</p>
              </CardContent>
            </Card>
          )}
        </div>
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

        {/* Critical items missing banner */}
        {computedChecklist && (() => {
          const missingCritical = computedChecklist.items.filter(
            (item) => item.category === "critical" && !item.isCompleted
          );
          if (missingCritical.length === 0) return null;
          return (
            <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-red-700 dark:text-red-300">
                    {missingCritical.length} critical item{missingCritical.length !== 1 ? "s" : ""} still missing
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                    These must be answered before the family leaves:
                  </p>
                  <ul className="mt-2 space-y-1">
                    {missingCritical.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                        <div className="w-3 h-3 rounded-full border-2 border-red-500 flex-shrink-0" />
                        {item.question}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })()}

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
                            <div key={item.id} className={`p-2 rounded text-sm ${item.isCompleted ? "bg-green-50 dark:bg-green-900/20" : config.bgColor}`} data-testid={`checklist-item-${item.id}`}>
                              <button
                                onClick={() => canToggle && toggleChecklistMutation.mutate(item.id)}
                                disabled={toggleChecklistMutation.isPending || !canToggle}
                                className={`flex items-start gap-2 w-full text-left ${canToggle ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
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
                              {!item.isCompleted && (
                                <input
                                  type="text"
                                  placeholder="Type to complete..."
                                  value={checklistInputs[item.id] || ""}
                                  onChange={(e) => setChecklistInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && e.currentTarget.value.trim()) {
                                      handleChecklistInput(item.id, e.currentTarget.value.trim());
                                    }
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value.trim()) handleChecklistInput(item.id, e.target.value.trim());
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-1.5 w-full px-2 py-1 text-xs border border-input rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              )}
                            </div>
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
              onClick={async () => {
                if (isSavingTranscript || extractDataMutation.isPending) return;
                if (reviewMeetingId) {
                  setIsSavingTranscript(true);
                  try {
                    await apiRequest("PATCH", `/api/meetings/${reviewMeetingId}`, { transcript: editableTranscript });
                  } catch (e) {
                    console.error("Failed to save transcript:", e);
                  } finally {
                    setIsSavingTranscript(false);
                  }
                }
                extractDataMutation.mutate(editableTranscript);
              }}
              disabled={isSavingTranscript || extractDataMutation.isPending || !editableTranscript.trim()}
              className="px-6 py-5"
            >
              {(isSavingTranscript || extractDataMutation.isPending) ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isSavingTranscript ? "Saving..." : reviewMeetingId ? "Re-parsing..." : "Extracting..."}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" /> {reviewMeetingId ? "Save & Re-parse" : "Extract Data"}
                </>
              )}
            </Button>
          )}

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
              if (confirm("Are you sure you want to discard this transcript?")) {
                resetState();
              }
            }}
            className="px-6 py-5"
          >
            <Trash2 className="w-4 h-4 mr-2" /> Discard
          </Button>
        </div>

        {/* What's Next — missing critical items */}
        {selectedCaseId && computedChecklist && (() => {
          const missingCritical = computedChecklist.items.filter(i => i.category === "critical" && !i.isCompleted);
          const missingImportant = computedChecklist.items.filter(i => i.category === "important" && !i.isCompleted);
          if (missingCritical.length === 0 && missingImportant.length === 0) return (
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-300 font-semibold">
                <CheckCircle2 className="w-5 h-5" />
                All critical and important items have been captured!
              </div>
              <p className="text-sm text-green-600 dark:text-green-400 mt-1 ml-7">
                Save this meeting to preserve the transcript and update the case.
              </p>
            </div>
          );
          return (
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                What's Next
              </h3>
              {missingCritical.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-2">Still needed before the family leaves</p>
                  <ul className="space-y-1">
                    {missingCritical.map(i => (
                      <li key={i.id} className="text-sm text-foreground flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                        {i.question}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {missingImportant.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2">Follow up items</p>
                  <ul className="space-y-1">
                    {missingImportant.slice(0, 5).map(i => (
                      <li key={i.id} className="text-sm text-muted-foreground flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                        {i.question}
                      </li>
                    ))}
                    {missingImportant.length > 5 && (
                      <li className="text-xs text-muted-foreground pl-4">+{missingImportant.length - 5} more — see case checklist</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}
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

                    {/* Editable intake fields for linked case */}
                    {meeting.caseId && (() => {
                      const linkedCase = cases?.find((c: any) => c.id === meeting.caseId);
                      if (!linkedCase) return null;
                      const intake = linkedCase.intakeData || {};
                      return (
                        <div className="mt-2 p-3 rounded-lg bg-muted/20 border border-border/40">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Extracted Information</p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                            <InlineEditField
                              label="Deceased Name"
                              value={intake.deceasedInfo?.fullName || linkedCase.deceasedName}
                              onSave={makeIntakeSaver(linkedCase.id, "deceasedInfo", "fullName")}
                              placeholder="Not recorded"
                            />
                            <InlineEditField
                              label="Date of Death"
                              value={intake.deceasedInfo?.dateOfDeath}
                              onSave={makeIntakeSaver(linkedCase.id, "deceasedInfo", "dateOfDeath")}
                              placeholder="Not recorded"
                            />
                            <InlineEditField
                              label="Caller Name"
                              value={intake.callerInfo?.name}
                              onSave={makeIntakeSaver(linkedCase.id, "callerInfo", "name")}
                              placeholder="Not recorded"
                            />
                            <InlineEditField
                              label="Phone Number"
                              value={intake.callerInfo?.phone}
                              onSave={makeIntakeSaver(linkedCase.id, "callerInfo", "phone")}
                              placeholder="Not recorded"
                            />
                            <InlineEditField
                              label="Location"
                              value={intake.deceasedInfo?.currentLocation}
                              onSave={makeIntakeSaver(linkedCase.id, "deceasedInfo", "currentLocation")}
                              placeholder="Not recorded"
                            />
                            <InlineEditField
                              label="Religion"
                              value={intake.servicePreferences?.religion}
                              onSave={makeIntakeSaver(linkedCase.id, "servicePreferences", "religion")}
                              placeholder="Not specified"
                            />
                            <InlineEditField
                              label="Burial / Cremation"
                              value={intake.servicePreferences?.burialOrCremation}
                              onSave={makeIntakeSaver(linkedCase.id, "servicePreferences", "burialOrCremation")}
                              placeholder="Not decided"
                            />
                            <InlineEditField
                              label="Relationship"
                              value={intake.callerInfo?.relationship}
                              onSave={makeIntakeSaver(linkedCase.id, "callerInfo", "relationship")}
                              placeholder="Not recorded"
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="flex md:flex-col justify-end gap-2 min-w-[140px]">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-2"
                      onClick={() => {
                        setEditableTranscript(meeting.transcript || "");
                        setSelectedCaseId(meeting.caseId?.toString() || "");
                        setDirectorName(meeting.directorName || "");
                        setReviewMeetingId(meeting.id);
                        setMode("review");
                      }}
                      data-testid={`button-review-meeting-${meeting.id}`}
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
