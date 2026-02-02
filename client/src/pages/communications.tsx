import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { MakeCallDialog } from "@/components/make-call-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Phone,
  Mic,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileText,
  PhoneIncoming,
  PhoneOutgoing,
  Play,
  Square,
  ChevronRight,
  ClipboardList,
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import type { Call, Meeting, Case, IntakeData } from "@shared/schema";

type Mode = "hub" | "recording" | "review";

// Type guard for IntakeData
function isIntakeData(data: unknown): data is IntakeData {
  return typeof data === "object" && data !== null;
}

interface ChecklistItemWithStatus {
  id: string;
  question: string;
  category: string;
  fieldMapping?: string;
  isCompleted: boolean;
  isManuallyCompleted: boolean;
}

interface ComputedChecklist {
  items: ChecklistItemWithStatus[];
  completedCount: number;
  totalItems: number;
  completedPercentage: number;
}

interface CommunicationItem {
  id: string;
  type: "call" | "meeting";
  title: string;
  subtitle: string;
  timestamp: Date;
  status: string;
  caseId: number | null;
  caseName?: string;
  summary?: string;
  direction?: string;
  originalData: Call | Meeting;
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "pl", label: "Polish" },
  { code: "es", label: "Spanish" },
  { code: "zh", label: "Chinese" },
];

export default function Communications() {
  const [mode, setMode] = useState<Mode>("hub");
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<CommunicationItem | null>(null);
  const [directorName, setDirectorName] = useState("");
  const [language, setLanguage] = useState("en");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [editableTranscript, setEditableTranscript] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const { toast } = useToast();

  // Audio recording refs
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);

  const { data: calls = [], isLoading: callsLoading } = useQuery<Call[]>({
    queryKey: ["/api/calls"],
  });

  const { data: meetings = [], isLoading: meetingsLoading } = useQuery<Meeting[]>({
    queryKey: ["/api/meetings"],
  });

  const { data: cases = [] } = useQuery<Case[]>({
    queryKey: ["/api/cases"],
  });

  const { data: checklist, refetch: refetchChecklist } = useQuery<ComputedChecklist>({
    queryKey: ["/api/cases", selectedCaseId, "checklist"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${selectedCaseId}/checklist`);
      if (!res.ok) throw new Error("Failed to fetch checklist");
      return res.json();
    },
    enabled: !!selectedCaseId && mode === "review",
  });

  // Fetch selected case details for extracted data display
  const { data: selectedCase } = useQuery<Case>({
    queryKey: ["/api/cases/:id", selectedCaseId],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${selectedCaseId}`);
      if (!res.ok) throw new Error("Failed to fetch case");
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

  const reprocessCallMutation = useMutation({
    mutationFn: async (callId: number) => {
      return apiRequest("POST", `/api/calls/${callId}/reprocess`, {});
    },
    onSuccess: (data: any) => {
      // If a new case was created, update the selected case ID
      if (data.caseId && data.caseId.toString() !== selectedCaseId) {
        setSelectedCaseId(data.caseId.toString());
      }
      queryClient.invalidateQueries({ queryKey: ["/api/cases/:id", selectedCaseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases/:id", data.caseId?.toString()] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "checklist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
      toast({
        title: "Call Reprocessed",
        description: data.message || "Intake data has been extracted from the call transcript.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Reprocess Failed",
        description: error?.message || "Could not extract data from transcript",
        variant: "destructive",
      });
    },
  });

  const reprocessMeetingMutation = useMutation({
    mutationFn: async (meetingId: number) => {
      return apiRequest("POST", `/api/meetings/${meetingId}/reprocess`, {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases/:id", selectedCaseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCaseId, "checklist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({
        title: "Meeting Reprocessed",
        description: data.message || "Intake data has been extracted from the meeting transcript.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Reprocess Failed",
        description: error?.message || "Could not extract data from transcript",
        variant: "destructive",
      });
    },
  });

  const isLoading = callsLoading || meetingsLoading;

  // Combine calls and meetings into unified timeline
  const communications: CommunicationItem[] = [
    ...calls.map((call): CommunicationItem => ({
      id: `call-${call.id}`,
      type: "call",
      title: call.callerName || call.callerPhone || "Unknown Caller",
      subtitle: call.direction === "inbound" ? "Incoming Call" : "Outgoing Call",
      timestamp: new Date(call.createdAt || Date.now()),
      status: call.status || "completed",
      caseId: call.caseId,
      caseName: cases.find(c => c.id === call.caseId)?.deceasedName,
      summary: call.summary || undefined,
      direction: call.direction || "inbound",
      originalData: call,
    })),
    ...meetings.map((meeting): CommunicationItem => ({
      id: `meeting-${meeting.id}`,
      type: "meeting",
      title: "Arrangement Meeting",
      subtitle: `Director: ${meeting.directorName}`,
      timestamp: new Date(meeting.createdAt || Date.now()),
      status: meeting.status || "completed",
      caseId: meeting.caseId,
      caseName: cases.find(c => c.id === meeting.caseId)?.deceasedName,
      summary: meeting.summary || undefined,
      originalData: meeting,
    })),
  ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // Get cases that need attention (have calls but no completed meeting, or low checklist completion)
  const casesNeedingAttention = cases.filter(c => {
    const hasCalls = calls.some(call => call.caseId === c.id);
    const hasCompletedMeeting = meetings.some(m => m.caseId === c.id && m.status === "completed");
    return hasCalls && !hasCompletedMeeting;
  });

  // Cleanup function for audio resources
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
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  const handleStartRecording = async () => {
    if (!selectedCaseId) {
      toast({
        title: "Select a case",
        description: "Please select a case before starting the recording",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);
    setLiveTranscript("");
    setMode("recording");

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        }
      });
      streamRef.current = stream;

      // Create WebSocket connection to Deepgram proxy
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/deepgram`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected, starting transcription...');
        ws.send(JSON.stringify({ type: 'start', language }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'ready') {
          console.log('Deepgram ready, starting audio capture');
          setIsConnecting(false);
          setIsRecording(true);
          
          // Start recording timer
          recordingTimerRef.current = window.setInterval(() => {
            setRecordingTime(prev => prev + 1);
          }, 1000);

          // Set up audio processing
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
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              ws.send(pcm16.buffer);
            }
          };

          source.connect(processor);
          processor.connect(audioContext.destination);
        }

        if (data.type === 'transcript') {
          if (data.speechFinal && data.isFinal) {
            setLiveTranscript(data.fullTranscript);
          }
        }

        if (data.type === 'stopped') {
          setEditableTranscript(data.fullTranscript || liveTranscript);
        }

        if (data.type === 'error') {
          console.error('Transcription error:', data.message);
          toast({
            title: "Transcription Error",
            description: data.message,
            variant: "destructive",
          });
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnecting(false);
        toast({
          title: "Connection Error",
          description: "Failed to connect to transcription service",
          variant: "destructive",
        });
        cleanupAudio();
        setMode("hub");
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
      };

    } catch (error: any) {
      console.error('Error starting recording:', error);
      setIsConnecting(false);
      toast({
        title: "Microphone Error",
        description: error.message || "Failed to access microphone",
        variant: "destructive",
      });
      setMode("hub");
    }
  };

  const handleStopRecording = () => {
    // Send stop message to get final transcript
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
    
    // Use live transcript if we have it
    const finalTranscript = liveTranscript || "No transcript captured";
    setEditableTranscript(finalTranscript);
    
    // Cleanup
    cleanupAudio();
    setIsRecording(false);
    setIsConnecting(false);
    setMode("review");
  };

  const handleReviewItem = (item: CommunicationItem) => {
    setSelectedItem(item);
    if (item.caseId) {
      setSelectedCaseId(item.caseId.toString());
    }
    if (item.type === "meeting") {
      const meeting = item.originalData as Meeting;
      setEditableTranscript(meeting.transcript || "");
      setDirectorName(meeting.directorName || "");
    } else {
      const call = item.originalData as Call;
      setEditableTranscript(call.transcript || "");
    }
    setMode("review");
  };

  const resetToHub = () => {
    cleanupAudio();
    setMode("hub");
    setSelectedItem(null);
    setSelectedCaseId("");
    setEditableTranscript("");
    setLiveTranscript("");
    setIsRecording(false);
    setIsConnecting(false);
    setRecordingTime(0);
  };

  const categoryConfig: Record<string, { label: string; bgColor: string; iconColor: string }> = {
    critical: { label: "Critical", bgColor: "bg-red-50 dark:bg-red-900/20", iconColor: "text-red-600 dark:text-red-400" },
    important: { label: "Important", bgColor: "bg-amber-50 dark:bg-amber-900/20", iconColor: "text-amber-600 dark:text-amber-400" },
    supplementary: { label: "Supplementary", bgColor: "bg-blue-50 dark:bg-blue-900/20", iconColor: "text-blue-600 dark:text-blue-400" },
  };

  const groupedChecklist = checklist?.items?.reduce((acc, item) => {
    const cat = item.category || "supplementary";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, ChecklistItemWithStatus[]>) || {};

  // Recording mode
  if (mode === "recording") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={resetToHub}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <div>
            <h2 className="text-3xl font-display font-bold text-primary">Recording Meeting</h2>
            <p className="text-muted-foreground mt-1">
              Case: {cases.find(c => c.id === parseInt(selectedCaseId))?.deceasedName}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardContent className="p-8 text-center">
              <div className={`w-32 h-32 mx-auto rounded-full flex items-center justify-center mb-6 ${
                isRecording ? "bg-red-100 dark:bg-red-900/30 animate-pulse" : 
                isConnecting ? "bg-amber-100 dark:bg-amber-900/30 animate-pulse" : "bg-muted"
              }`}>
                {isConnecting ? (
                  <Loader2 className="w-16 h-16 text-amber-600 animate-spin" />
                ) : (
                  <Mic className={`w-16 h-16 ${isRecording ? "text-red-600" : "text-muted-foreground"}`} />
                )}
              </div>
              
              <div className="text-4xl font-mono mb-6">
                {Math.floor(recordingTime / 60).toString().padStart(2, "0")}:
                {(recordingTime % 60).toString().padStart(2, "0")}
              </div>

              <Button
                size="lg"
                variant={isRecording ? "destructive" : "default"}
                onClick={isRecording ? handleStopRecording : undefined}
                disabled={isConnecting || !isRecording}
                className="gap-2"
                data-testid="button-stop-recording"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Connecting...
                  </>
                ) : isRecording ? (
                  <>
                    <Square className="w-5 h-5" /> Stop Recording
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" /> Starting...
                  </>
                )}
              </Button>

              <p className="text-sm text-muted-foreground mt-4">
                {isConnecting 
                  ? "Connecting to transcription service..."
                  : isRecording 
                    ? "Recording in progress. Click stop when the meeting ends."
                    : "Initializing microphone..."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Live Transcript
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="min-h-[300px] max-h-[400px] overflow-y-auto p-4 bg-muted/50 rounded-md">
                {liveTranscript ? (
                  <p className="text-sm whitespace-pre-wrap">{liveTranscript}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    {isConnecting 
                      ? "Waiting for connection..."
                      : isRecording 
                        ? "Listening... speak to see transcription appear here."
                        : "Transcript will appear here during recording."}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Review mode
  if (mode === "review") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={resetToHub}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Hub
          </Button>
          <div>
            <h2 className="text-3xl font-display font-bold text-primary">
              Review {selectedItem?.type === "call" ? "Call" : "Meeting"}
            </h2>
            {selectedCaseId && cases && (
              <p className="text-muted-foreground mt-1">
                Case: {cases.find(c => c.id === parseInt(selectedCaseId))?.deceasedName}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Transcript */}
          <Card className="shadow-sm lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Transcript
              </CardTitle>
              {selectedItem?.type === "call" && (selectedItem.originalData as Call).id && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const callId = (selectedItem.originalData as Call).id;
                    reprocessCallMutation.mutate(callId);
                  }}
                  disabled={reprocessCallMutation.isPending}
                  data-testid="button-reprocess-call"
                >
                  {reprocessCallMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                  )}
                  Extract Data
                </Button>
              )}
              {selectedItem?.type === "meeting" && (selectedItem.originalData as Meeting).id && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const meetingId = (selectedItem.originalData as Meeting).id;
                    reprocessMeetingMutation.mutate(meetingId);
                  }}
                  disabled={reprocessMeetingMutation.isPending}
                  data-testid="button-reprocess-meeting"
                >
                  {reprocessMeetingMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                  )}
                  Extract Data
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <textarea
                value={editableTranscript}
                onChange={(e) => setEditableTranscript(e.target.value)}
                rows={16}
                className="w-full border border-input rounded-md p-4 text-sm bg-background font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                placeholder="No transcript available..."
                data-testid="textarea-transcript"
              />
            </CardContent>
          </Card>

          {/* Extracted Data & Checklist */}
          <div className="space-y-4">
            {/* Extracted Data - Show for calls or meetings with intake data */}
            {selectedCase && isIntakeData(selectedCase.intakeData) && (
              <Card className="shadow-sm border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-900/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle2 className="w-5 h-5" />
                    Extracted Data
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    AI-extracted information from calls & meetings
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedCase.intakeData.deceasedInfo?.fullName && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Deceased Name</span>
                      <span className="font-medium">{selectedCase.intakeData.deceasedInfo.fullName}</span>
                    </div>
                  )}
                  {selectedCase.intakeData.callerInfo?.relationship && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Caller Relationship</span>
                      <span className="font-medium">{selectedCase.intakeData.callerInfo.relationship}</span>
                    </div>
                  )}
                  {selectedCase.intakeData.deceasedInfo?.dateOfDeath && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Date of Death</span>
                      <span className="font-medium">{selectedCase.intakeData.deceasedInfo.dateOfDeath}</span>
                    </div>
                  )}
                  {selectedCase.intakeData.callerInfo?.phone && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Contact Number</span>
                      <span className="font-medium">{selectedCase.intakeData.callerInfo.phone}</span>
                    </div>
                  )}
                  {selectedCase.intakeData.callerInfo?.name && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Caller Name</span>
                      <span className="font-medium">{selectedCase.intakeData.callerInfo.name}</span>
                    </div>
                  )}
                  {selectedCase.intakeData.servicePreferences?.religion && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Religion</span>
                      <span className="font-medium">{selectedCase.intakeData.servicePreferences.religion}</span>
                    </div>
                  )}
                  {selectedCase.intakeData.servicePreferences?.urgency && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Urgency</span>
                      <Badge variant={selectedCase.intakeData.servicePreferences.urgency === "urgent-24hr" ? "destructive" : "secondary"}>
                        {selectedCase.intakeData.servicePreferences.urgency === "urgent-24hr" ? "Urgent (24hr)" : "Normal"}
                      </Badge>
                    </div>
                  )}
                  {selectedCase.intakeData.servicePreferences?.burialOrCremation && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Burial/Cremation</span>
                      <span className="font-medium capitalize">{selectedCase.intakeData.servicePreferences.burialOrCremation}</span>
                    </div>
                  )}
                  {selectedCase.intakeData.deceasedInfo?.currentLocation && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Current Location</span>
                      <span className="font-medium">{selectedCase.intakeData.deceasedInfo.currentLocation}</span>
                    </div>
                  )}
                  {selectedCase.intakeData.servicePreferences?.cemeteryOrCrematorium && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Cemetery/Crematorium</span>
                      <span className="font-medium">{selectedCase.intakeData.servicePreferences.cemeteryOrCrematorium}</span>
                    </div>
                  )}
                  {selectedCase.intakeData.servicePreferences?.clothing && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Clothing</span>
                      <span className="font-medium">{selectedCase.intakeData.servicePreferences.clothing}</span>
                    </div>
                  )}
                  {selectedCase.intakeData.servicePreferences?.serviceType && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Service Type</span>
                      <span className="font-medium">{selectedCase.intakeData.servicePreferences.serviceType}</span>
                    </div>
                  )}
                  
                  {/* Show message if no data extracted */}
                  {!selectedCase.intakeData.deceasedInfo?.fullName && 
                   !selectedCase.intakeData.callerInfo?.relationship && 
                   !selectedCase.intakeData.callerInfo?.phone && (
                    <p className="text-sm text-muted-foreground italic">
                      Click "Extract Data" to analyze the transcript.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
            
            {selectedCaseId && checklist && (
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ClipboardList className="w-5 h-5" />
                    What's Next
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {checklist.completedCount}/{checklist.totalItems} items complete
                  </p>
                  <Progress value={checklist.completedPercentage} className="h-2 mt-2" />
                </CardHeader>
                <CardContent className="max-h-[400px] overflow-y-auto">
                  {["critical", "important", "supplementary"].map(category => {
                    const items = groupedChecklist[category] || [];
                    const incompleteItems = items.filter(i => !i.isCompleted);
                    if (incompleteItems.length === 0) return null;
                    const config = categoryConfig[category];

                    return (
                      <div key={category} className="mb-4">
                        <h4 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${config.iconColor}`}>
                          {config.label} - {incompleteItems.length} remaining
                        </h4>
                        <div className="space-y-1">
                          {incompleteItems.slice(0, 3).map(item => {
                            const canToggle = !item.fieldMapping || !item.isCompleted;
                            return (
                              <button
                                key={item.id}
                                onClick={() => canToggle && toggleChecklistMutation.mutate(item.id)}
                                disabled={toggleChecklistMutation.isPending || !canToggle}
                                className={`flex items-start gap-2 p-2 rounded text-xs w-full text-left transition-colors ${config.bgColor} ${canToggle ? "hover:opacity-80 cursor-pointer" : "cursor-default"}`}
                                data-testid={`checklist-item-${item.id}`}
                              >
                                <div className={`w-3 h-3 border-2 rounded flex-shrink-0 mt-0.5 ${config.iconColor} border-current`} />
                                <span className="flex-1">{item.question}</span>
                              </button>
                            );
                          })}
                          {incompleteItems.length > 3 && (
                            <p className="text-xs text-muted-foreground pl-5">
                              +{incompleteItems.length - 3} more items
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  
                  {checklist.completedPercentage === 100 && (
                    <div className="text-center py-4">
                      <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
                      <p className="font-medium text-green-700 dark:text-green-400">All items complete!</p>
                      <p className="text-sm text-muted-foreground">Ready to generate documents</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2" asChild>
                  <Link href={selectedCaseId ? `/cases/${selectedCaseId}` : "/cases"}>
                    <ChevronRight className="w-4 h-4" /> View Full Case
                  </Link>
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2">
                  <FileText className="w-4 h-4" /> Generate Documents
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Hub mode - main communications view
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-primary">Communications Hub</h1>
          <p className="text-muted-foreground mt-1">
            All calls and meetings in one place
          </p>
        </div>
        <div className="flex gap-2">
          <MakeCallDialog trigger={
            <Button className="gap-2" data-testid="button-make-call">
              <Phone className="w-4 h-4" /> Make Call
            </Button>
          } />
        </div>
      </div>

      {/* Cases Needing Attention */}
      {casesNeedingAttention.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertCircle className="w-5 h-5" />
              Action Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {casesNeedingAttention.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                  <div>
                    <p className="font-medium">{c.deceasedName}</p>
                    <p className="text-sm text-muted-foreground">Has call data but no meeting recorded</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedCaseId(c.id.toString());
                        handleStartRecording();
                      }}
                      data-testid={`button-start-meeting-${c.id}`}
                    >
                      <Mic className="w-4 h-4 mr-2" /> Start Meeting
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Start Recording */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-lg">Start New Meeting Recording</h3>
              <p className="text-sm text-muted-foreground">Record an arrangement meeting and get automatic transcription</p>
            </div>
            <div className="flex items-center gap-3">
              <Select value={selectedCaseId} onValueChange={setSelectedCaseId}>
                <SelectTrigger className="w-[200px]" data-testid="select-case">
                  <SelectValue placeholder="Select case" />
                </SelectTrigger>
                <SelectContent>
                  {cases.map(c => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.deceasedName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleStartRecording} className="gap-2" data-testid="button-start-recording">
                <Mic className="w-4 h-4" /> Record
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Communications Timeline */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
        
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : communications.length === 0 ? (
          <div className="text-center py-12 bg-muted/10 rounded-xl border border-dashed">
            <Phone className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium">No communications yet</h3>
            <p className="text-muted-foreground">Calls and meetings will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {communications.map(item => (
              <Card
                key={item.id}
                className="hover-elevate cursor-pointer transition-all"
                onClick={() => handleReviewItem(item)}
                data-testid={`communication-${item.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-full ${
                      item.type === "call" 
                        ? "bg-green-100 dark:bg-green-900/30" 
                        : "bg-blue-100 dark:bg-blue-900/30"
                    }`}>
                      {item.type === "call" ? (
                        item.direction === "inbound" 
                          ? <PhoneIncoming className="w-5 h-5 text-green-600 dark:text-green-400" />
                          : <PhoneOutgoing className="w-5 h-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <Mic className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium">{item.title}</h3>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="text-sm text-muted-foreground">{item.subtitle}</p>
                      {item.caseName && (
                        <Badge variant="outline" className="mt-2 text-xs">
                          Case: {item.caseName}
                        </Badge>
                      )}
                      {item.summary && (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{item.summary}</p>
                      )}
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        {format(item.timestamp, "MMM d, h:mm a")}
                      </div>
                      <Button variant="ghost" size="sm" className="mt-2">
                        Review <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
