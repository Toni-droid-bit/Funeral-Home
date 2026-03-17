import { useEffect, useRef } from "react";

interface UseTranscriptPollingOptions {
  /** The live transcript string from state. Hook ref-ifies it internally so the interval is stable. */
  transcript: string;
  /** Whether polling should be active (e.g. isRecording && !!selectedCaseId). */
  enabled: boolean;
  /**
   * Called when the interval fires and the transcript is long enough.
   * Should return a Promise (use mutateAsync, not mutate).
   * The hook deduplicates: it will not call onProcess again until the previous call settles.
   */
  onProcess: (transcript: string) => Promise<unknown>;
  /** Minimum transcript length before triggering. Default: 50 characters. */
  minLength?: number;
  /** Polling interval in ms. Default: 5000. */
  intervalMs?: number;
}

/**
 * Sets up a stable polling interval that calls onProcess with the latest transcript.
 * Uses refs internally so neither the transcript value nor the callback causes the
 * interval to reset on every render (which would prevent it from ever firing during speech).
 */
export function useTranscriptPolling({
  transcript,
  enabled,
  onProcess,
  minLength = 50,
  intervalMs = 5000,
}: UseTranscriptPollingOptions): void {
  const transcriptRef = useRef(transcript);
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  const onProcessRef = useRef(onProcess);
  useEffect(() => {
    onProcessRef.current = onProcess;
  });

  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(async () => {
      const t = transcriptRef.current;
      if (t && t.length >= minLength && !inFlightRef.current) {
        inFlightRef.current = true;
        try {
          await onProcessRef.current(t);
        } finally {
          inFlightRef.current = false;
        }
      }
    }, intervalMs);

    return () => clearInterval(interval);
    // Intentionally excludes transcript and onProcess — those are tracked via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, minLength, intervalMs]);
}
