import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useComputedChecklist } from "@/hooks/use-computed-checklist";
import { useTranscriptPolling } from "@/hooks/use-transcript-polling";
import { CATEGORY_CONFIG } from "@/constants/checklist-config";
import { formatTime } from "@/lib/format-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Mic,
  ArrowLeft,
  Loader2,
  Square,
  CheckCircle2,
  FileText,
  ClipboardList,
} from "lucide-react";
import type { Case } from "@shared/schema";
import type { ComputedChecklistItem } from "@/hooks/use-computed-checklist";

export default function CommunicationsRecord() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const caseId = params.get("caseId") || "";
  const isTempCase = params.get("isTempCase") === "true";

  const { toast } = useToast();

  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);

  const { data: cases = [] } = useQuery<Case[]>({ queryKey: ["/api/cases"] });

  const { data: checklist, isLoading: checklistLoading, refetch: refetchChecklist } =
    useComputedChecklist(caseId, true, isRecording);

  const caseName = (() => {
    const c = cases.find((c) => c.id === parseInt(caseId));
    if (isTempCase && (!c?.deceasedName || c.deceasedName === "Unknown (Pending)")) {
      return "Detecting name from transcript…";
    }
    return c?.deceasedName ? `Case: ${c.deceasedName}` : "Case: Selected";
  })();

  const cleanupAudio = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => cleanupAudio();
  }, [cleanupAudio]);

  // ── Mutations ──

  const reprocessMeetingMutation = useMutation({
    mutationFn: async (meetingId: number) =>
      apiRequest("POST", `/api/meetings/${meetingId}/reprocess`, {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      if (data?.caseId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/cases/:id", data.caseId.toString()],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/cases", data.caseId.toString(), "checklist"],
        });
      }
    },
  });

  const createMeetingMutation = useMutation({
    mutationFn: async (data: {
      caseId?: number | null;
      directorName: string;
      language: string;
      transcript: string;
    }) => apiRequest("POST", "/api/meetings", { ...data, status: "completed" }),
    onSuccess: async (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      toast({ title: "Meeting Saved", description: "Extracting intake data…" });
      if (data?.id) reprocessMeetingMutation.mutate(data.id);
      navigate(`/communications/review/meeting/${data.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error?.message || "Could not save meeting transcript",
        variant: "destructive",
      });
    },
  });

  const liveExtractMutation = useMutation({
    mutationFn: async ({ caseId, transcript }: { caseId: number; transcript: string }) =>
      apiRequest("POST", `/api/cases/${caseId}/live-extract`, { transcript }),
    onSuccess: () => {
      refetchChecklist();
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    },
    onError: (error: any) => {
      console.log("Live extraction skipped:", error?.message);
    },
  });

  useTranscriptPolling({
    transcript: liveTranscript,
    enabled: isRecording && !!caseId,
    onProcess: (transcript) =>
      liveExtractMutation.mutateAsync({ caseId: Number(caseId), transcript }),
  });

  // ── Recording ──

  const handleStartRecording = async () => {
    setIsConnecting(true);
    setLiveTranscript("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });
      streamRef.current = stream;

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/deepgram`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "start", language: "en" }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "ready") {
          setIsConnecting(false);
          setIsRecording(true);

          recordingTimerRef.current = window.setInterval(() => {
            setRecordingTime((prev) => prev + 1);
          }, 1000);

          const audioContext = new AudioContext({ sampleRate: 16000 });
          audioContextRef.current = audioContext;
          const source = audioContext.createMediaStreamSource(stream);
          const processor = audioContext.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          processor.onaudioprocess = (e) => {
            if (ws.readyState === WebSocket.OPEN) {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcm16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
              }
              ws.send(pcm16.buffer);
            }
          };

          source.connect(processor);
          processor.connect(audioContext.destination);
        }

        if (data.type === "transcript" && data.isFinal) {
          setLiveTranscript(data.fullTranscript);
        }
      };

      ws.onerror = () => {
        setIsConnecting(false);
        toast({
          title: "Connection Error",
          description: "Failed to connect to transcription service",
          variant: "destructive",
        });
        cleanupAudio();
        navigate("/communications");
      };
    } catch (error: any) {
      setIsConnecting(false);
      toast({
        title: "Microphone Error",
        description: error.message || "Failed to access microphone",
        variant: "destructive",
      });
      navigate("/communications");
    }
  };

  const handleStopRecording = () => {
    const finalTranscript = liveTranscript || "";
    cleanupAudio();
    setIsRecording(false);
    setIsConnecting(false);

    if (!finalTranscript) {
      toast({ title: "No transcript captured", description: "Nothing was recorded." });
      navigate("/communications");
      return;
    }

    createMeetingMutation.mutate({
      caseId: caseId ? parseInt(caseId) : null,
      directorName: "Unknown Director",
      language: "en",
      transcript: finalTranscript,
    });
  };

  const isSaving = createMeetingMutation.isPending;

  // ── Setup screen (before recording starts) ──

  if (!isRecording && !isConnecting) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/communications")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <div>
            <h2 className="text-3xl font-display font-bold text-primary">
              New Meeting Recording
            </h2>
            <p className="text-muted-foreground mt-1">{caseName}</p>
          </div>
        </div>

        <Card className="max-w-md">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-24 h-24 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
              <Mic className="w-12 h-12 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">Ready to Record</h3>
              <p className="text-sm text-muted-foreground">
                Click Start Recording to begin. Your browser will ask for microphone
                permission. Audio is streamed for transcription only and is not stored.
              </p>
            </div>
            <Button
              size="lg"
              className="w-full gap-2 bg-red-600 hover:bg-red-700 text-white py-6"
              onClick={handleStartRecording}
              data-testid="button-start-recording"
            >
              <Mic className="w-5 h-5" /> Start Recording
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Active recording screen ──

  const categoryConfig = CATEGORY_CONFIG;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/communications")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <div>
          <h2 className="text-3xl font-display font-bold text-primary">
            {isSaving ? "Saving Recording…" : "Recording Meeting"}
          </h2>
          <p className="text-muted-foreground mt-1">{caseName}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recording Controls */}
        <Card>
          <CardContent className="p-6 text-center">
            <div
              className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center mb-4 ${
                isSaving
                  ? "bg-blue-100 dark:bg-blue-900/30 animate-pulse"
                  : isRecording
                  ? "bg-red-100 dark:bg-red-900/30 animate-pulse"
                  : "bg-amber-100 dark:bg-amber-900/30 animate-pulse"
              }`}
            >
              {isSaving || isConnecting ? (
                <Loader2 className="w-12 h-12 text-amber-600 animate-spin" />
              ) : (
                <Mic className="w-12 h-12 text-red-600" />
              )}
            </div>

            <div className="text-3xl font-mono mb-4">{formatTime(recordingTime)}</div>

            <Button
              size="lg"
              variant="destructive"
              onClick={handleStopRecording}
              disabled={isConnecting || isSaving || !isRecording}
              className="gap-2"
              data-testid="button-stop-recording"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Saving…
                </>
              ) : isConnecting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Connecting…
                </>
              ) : (
                <>
                  <Square className="w-5 h-5" /> Stop Recording
                </>
              )}
            </Button>

            <p className="text-sm text-muted-foreground mt-3">
              {isSaving
                ? "Saving transcript…"
                : isConnecting
                ? "Connecting to microphone…"
                : "Recording in progress"}
            </p>
          </CardContent>
        </Card>

        {/* Checklist Panel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="w-5 h-5" />
              Meeting Checklist
            </CardTitle>
            {checklist && (
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${checklist.completedPercentage}%` }}
                  />
                </div>
                <span className="text-sm text-muted-foreground font-medium">
                  {checklist.completedPercentage}%
                </span>
              </div>
            )}
          </CardHeader>
          <CardContent className="max-h-[350px] overflow-y-auto">
            {checklistLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : checklist?.items && checklist.items.length > 0 ? (
              <div className="space-y-3">
                {["critical", "important", "supplementary"].map((category) => {
                  const rawItems = checklist.items.filter(
                    (item: ComputedChecklistItem) => item.category === category,
                  );
                  if (rawItems.length === 0) return null;
                  const items = [...rawItems].sort((a, b) => {
                    if (a.isCompleted === b.isCompleted) return 0;
                    return a.isCompleted ? 1 : -1;
                  });
                  const config = categoryConfig[category];
                  return (
                    <div key={category}>
                      <h4
                        className={`text-xs font-medium uppercase tracking-wide mb-1 ${config.iconColor}`}
                      >
                        {config.label}
                      </h4>
                      <div className="space-y-1">
                        {items.map((item: ComputedChecklistItem) => (
                          <div
                            key={item.id}
                            className={`flex items-center gap-2 p-2 rounded-md text-sm ${
                              item.isCompleted
                                ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                                : "bg-muted/50"
                            }`}
                          >
                            {item.isCompleted ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                            ) : (
                              <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
                            )}
                            <span className={item.isCompleted ? "line-through opacity-70" : ""}>
                              {item.question}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic py-4 text-center">
                No checklist items configured
              </p>
            )}
          </CardContent>
        </Card>

        {/* Live Transcript */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Live Transcript
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="min-h-[300px] max-h-[350px] overflow-y-auto p-3 bg-muted/50 rounded-md">
              {liveTranscript ? (
                <p className="text-sm whitespace-pre-wrap">{liveTranscript}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {isConnecting
                    ? "Waiting for connection…"
                    : isRecording
                    ? "Listening… speak to see transcription."
                    : "Transcript will appear here."}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
