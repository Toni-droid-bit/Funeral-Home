import { VapiClient } from "@vapi-ai/server-sdk";
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { parseCallTranscriptToIntake, calculateMissingFields, mergeIntakeData, filterManualOverrides } from "../intake-parser";
import { findMatchingCase, applyIntakeToExistingCase } from "../case-matcher";

const VAPI_API_KEY = process.env.VAPI_API_KEY || "";
if (!VAPI_API_KEY) {
  console.error("[vapi] WARNING: VAPI_API_KEY is not set — outbound calls and phone number listing will fail");
} else {
  console.log(`[vapi] VAPI_API_KEY loaded (${VAPI_API_KEY.slice(0, 8)}...)`);
}

const vapiClient = new VapiClient({
  token: VAPI_API_KEY,
});

export function registerVapiRoutes(app: Express) {
  // Log the expected webhook URL on startup so it's easy to copy into the VAPI dashboard
  const renderUrl = process.env.RENDER_EXTERNAL_URL || "https://xfunerals-demo.onrender.com";
  console.log(`[vapi] Expected webhook URL (set this in VAPI dashboard): ${renderUrl}/api/vapi/webhook`);

  app.get("/api/vapi/phone-numbers", async (_req: Request, res: Response) => {
    try {
      console.log("[vapi] Fetching phone numbers from VAPI…");
      const phoneNumbers = await vapiClient.phoneNumbers.list();
      console.log(`[vapi] Phone numbers fetched: ${(phoneNumbers as any[]).length} number(s)`);
      res.json(phoneNumbers);
    } catch (error: any) {
      console.error("[vapi] Error fetching phone numbers:", error?.message || error);
      res.status(500).json({
        message: "Failed to fetch phone numbers",
        error: error.message || String(error)
      });
    }
  });

  app.get("/api/vapi/assistants", async (_req: Request, res: Response) => {
    try {
      const assistants = await vapiClient.assistants.list();
      res.json(assistants);
    } catch (error: any) {
      console.error("Error fetching assistants:", error);
      res.status(500).json({ 
        message: "Failed to fetch assistants",
        error: error.message 
      });
    }
  });

  app.post("/api/vapi/calls", async (req: Request, res: Response) => {
    try {
      const {
        phoneNumberId,
        assistantId,
        customerNumber,
        customerName,
        caseId,
        firstMessage
      } = req.body;

      console.log(`[vapi] POST /api/vapi/calls — phoneNumberId=${phoneNumberId} customerNumber=${customerNumber} assistantId=${assistantId || "default"}`);

      if (!VAPI_API_KEY) {
        return res.status(500).json({ message: "VAPI_API_KEY is not configured on the server" });
      }

      if (!phoneNumberId || !customerNumber) {
        console.error("[vapi] Missing required fields:", { phoneNumberId, customerNumber });
        return res.status(400).json({
          message: "Phone number ID and customer number are required"
        });
      }

      const callConfig: any = {
        phoneNumberId,
        customer: {
          number: customerNumber,
          name: customerName || undefined,
        },
      };

      if (assistantId) {
        callConfig.assistantId = assistantId;
      } else {
        callConfig.assistant = {
          model: {
            provider: "openai",
            model: "gpt-4o",
            messages: [{
              role: "system",
              content: `You are a compassionate and professional funeral home receptionist for Evergreen Memorial Services. 
              You speak in a calm, empathetic tone. Your role is to:
              1. Express condolences if appropriate
              2. Listen carefully and gather information about the caller's needs
              3. Answer questions about services, arrangements, and next steps
              4. Schedule appointments or callbacks as needed
              5. Reassure callers that their loved one will be treated with dignity
              
              Be patient, understanding, and never rush the caller. Use appropriate pauses and acknowledgments.`
            }]
          },
          voice: {
            provider: "11labs",
            voiceId: "JBFqnCBsd6RMkjVDRZzb"
          },
          firstMessage: firstMessage || "Hello, thank you for calling Evergreen Memorial Services. My name is Sarah, and I'm here to help you. How may I assist you today?"
        };
      }

      console.log(`[vapi] Calling vapiClient.calls.create with config:`, JSON.stringify({ phoneNumberId: callConfig.phoneNumberId, customerNumber: callConfig.customer?.number, hasAssistantId: !!callConfig.assistantId }, null, 2));
      const vapiCall = await vapiClient.calls.create(callConfig) as any;
      console.log(`[vapi] vapiClient.calls.create succeeded — vapiCallId=${vapiCall.id}`);

      const newCall = await storage.createCall({
        vapiCallId: vapiCall.id,
        callerPhone: customerNumber,
        callerName: customerName || null,
        caseId: caseId || null,
        status: "in-progress",
        direction: "outbound",
        detectedLanguage: "English",
        transcript: null,
        summary: null,
        sentiment: null,
        audioUrl: null,
      });

      res.status(201).json({
        vapiCall,
        localCall: newCall,
      });
    } catch (error: any) {
      console.error("[vapi] Error creating call:", error?.message || error);
      console.error("[vapi] Full error:", JSON.stringify(error, null, 2));
      res.status(500).json({
        message: "Failed to create call",
        error: error.message || String(error)
      });
    }
  });

  app.get("/api/vapi/calls/:id", async (req: Request, res: Response) => {
    try {
      const callId = req.params.id as string;
      const call = await vapiClient.calls.get(callId as any);
      res.json(call);
    } catch (error: any) {
      console.error("Error fetching call:", error);
      res.status(500).json({ 
        message: "Failed to fetch call",
        error: error.message 
      });
    }
  });

  app.get("/api/vapi/calls", async (_req: Request, res: Response) => {
    try {
      const calls = await vapiClient.calls.list();
      res.json(calls);
    } catch (error: any) {
      console.error("Error listing calls:", error);
      res.status(500).json({ 
        message: "Failed to list calls",
        error: error.message 
      });
    }
  });

  app.post("/api/vapi/webhook", async (req: Request, res: Response) => {
    // Always respond 200 immediately so Vapi doesn't retry
    res.status(200).json({ received: true });

    const { message } = req.body;

    // Log raw payload for debugging (truncated)
    console.log(`[vapi] webhook received — body keys: ${Object.keys(req.body).join(', ')}, message type: ${message?.type ?? "NONE"}`);

    if (!message?.type) {
      console.warn("[vapi] webhook received with no message.type — ignoring. Full body:", JSON.stringify(req.body).slice(0, 500));
      return;
    }

    const msgType: string = message.type;
    const vapiCallId: string | undefined = message?.call?.id;
    const callType: string | undefined = message?.call?.type;
    const customerNumber: string | undefined = message?.call?.customer?.number;
    const customerName: string | undefined = message?.call?.customer?.name;
    const isInbound = callType === "inboundPhoneCall" || callType === "webCall";

    console.log(`[vapi] webhook ${msgType} | callId=${vapiCallId ?? "none"} | type=${callType ?? "?"} | isInbound=${isInbound} | customerNumber=${customerNumber ?? "none"}`);;

    // Helper: ensure a local call record exists for an inbound call
    const ensureInboundCallRecord = async (): Promise<any | null> => {
      if (!vapiCallId || !isInbound) return null;
      try {
        const existing = await storage.getCallByVapiId(vapiCallId);
        if (existing) return existing;
        const created = await storage.createCall({
          vapiCallId,
          callerPhone: customerNumber || "Unknown",
          callerName: customerName || null,
          caseId: null,
          status: "in-progress",
          direction: "inbound",
          detectedLanguage: "English",
          transcript: null,
          summary: null,
          sentiment: null,
          audioUrl: null,
        });
        console.log(`[vapi] created call record for inbound call ${vapiCallId}`);
        return created;
      } catch (err) {
        console.error(`[vapi] failed to create call record for ${vapiCallId}:`, err);
        return null;
      }
    };

    try {
      // ── Early inbound call detection ──────────────────────────────────────
      if (msgType === "assistant-message" || msgType === "conversation-update") {
        await ensureInboundCallRecord();
      }

      if (msgType === "status-update") {
        const status: string | undefined = message?.status;
        if (status === "in-progress") {
          await ensureInboundCallRecord();
        }
        if (status === "ended" && vapiCallId) {
          try {
            const localCall = await storage.getCallByVapiId(vapiCallId);
            if (localCall?.status === "in-progress") {
              await storage.updateCall(localCall.id, { status: "completed" });
              console.log(`[vapi] marked call ${localCall.id} as completed`);
            }
          } catch (err) {
            console.error(`[vapi] error updating status-ended for ${vapiCallId}:`, err);
          }
        }
      }

      // ── End-of-call report ────────────────────────────────────────────────
      if (msgType === "end-of-call-report") {
        const { call, transcript, summary, recordingUrl } = message;
        const eocCallId: string | undefined = call?.id;
        const eocCallType: string | undefined = call?.type;
        const eocPhone: string | undefined = call?.customer?.number;
        const eocName: string | undefined = call?.customer?.name;
        const eocIsInbound = eocCallType === "inboundPhoneCall" || eocCallType === "webCall";

        console.log(`[vapi] end-of-call-report | callId=${eocCallId ?? "MISSING"} | type=${eocCallType ?? "?"} | isInbound=${eocIsInbound} | hasTranscript=${!!transcript} | transcriptLength=${transcript?.length ?? 0}`);

        if (!eocCallId) {
          console.warn("[vapi] end-of-call-report missing call.id — skipping");
          return;
        }

        let localCall: any = await storage.getCallByVapiId(eocCallId).catch(() => null);

        if (!localCall && eocIsInbound) {
          try {
            localCall = await storage.createCall({
              vapiCallId: eocCallId,
              callerPhone: eocPhone || "Unknown",
              callerName: eocName || null,
              caseId: null,
              status: "completed",
              direction: "inbound",
              detectedLanguage: "English",
              transcript: transcript || null,
              summary: summary || null,
              sentiment: null,
              audioUrl: recordingUrl || null,
            });
            console.log(`[vapi] created completed call record for ${eocCallId}`);
          } catch (err) {
            console.error(`[vapi] failed to create completed call record for ${eocCallId}:`, err);
            return;
          }
        } else if (localCall) {
          try {
            await storage.updateCall(localCall.id, {
              status: "completed",
              transcript: transcript || null,
              summary: summary || null,
              audioUrl: recordingUrl || null,
            });
            // Refresh the local call object with updated transcript
            localCall = { ...localCall, transcript, summary };
            console.log(`[vapi] updated call ${localCall.id} with transcript and summary`);
          } catch (err) {
            console.error(`[vapi] failed to update call ${localCall.id}:`, err);
          }
        } else {
          console.warn(`[vapi] no local call found for Vapi call ${eocCallId} (type=${eocCallType}) — skipping case creation`);
          return;
        }

        // ── Parse transcript & auto-create/update case ────────────────────
        const effectiveTranscript: string | null = transcript || localCall.transcript;
        if (!effectiveTranscript) {
          console.log(`[vapi] no transcript available for call ${localCall.id} — skipping intake parsing`);
          return;
        }

        try {
          console.log(`[vapi] parsing transcript for call ${localCall.id} (${effectiveTranscript.length} chars)…`);
          const intakeData = await parseCallTranscriptToIntake(effectiveTranscript, summary || undefined);
          const missingFields = calculateMissingFields(intakeData);

          // Merge Vapi metadata name as fallback
          const extractedCallerName = intakeData.callerInfo?.name || eocName || customerName || null;
          if (extractedCallerName && !intakeData.callerInfo?.name) {
            intakeData.callerInfo = { ...(intakeData.callerInfo || {}), name: extractedCallerName };
          }

          // Update the call record's callerName if we extracted one and it was unknown before
          if (extractedCallerName && (!localCall.callerName || localCall.callerName === "Unknown")) {
            await storage.updateCall(localCall.id, { callerName: extractedCallerName }).catch(() => {});
          }

          console.log(`[vapi] extracted intakeData for call ${localCall.id}:`, JSON.stringify(intakeData, null, 2));

          if (localCall.caseId) {
            // ── Update existing linked case ──────────────────────────────
            const existingCase = await storage.getCase(localCall.caseId).catch(() => null);
            if (existingCase) {
              const existingRaw = (existingCase.intakeData as any) || {};
              const manualFields: Record<string, boolean> = existingRaw._manualFields || {};
              const filteredIntake = filterManualOverrides(intakeData, manualFields);
              const mergedIntake = mergeIntakeData(existingRaw, filteredIntake);
              (mergedIntake as any)._manualFields = manualFields;
              const newMissing = calculateMissingFields(mergedIntake);
              const updates: any = { intakeData: mergedIntake, missingFields: newMissing };

              // Update deceased name whenever a better name is extracted
              if (intakeData.deceasedInfo?.fullName &&
                intakeData.deceasedInfo.fullName !== existingCase.deceasedName) {
                updates.deceasedName = intakeData.deceasedInfo.fullName;
                console.log(`[vapi] updating case ${localCall.caseId} name → "${intakeData.deceasedInfo.fullName}"`);
              }
              if (intakeData.servicePreferences?.religion &&
                (existingCase.religion === "Unknown" || !existingCase.religion)) {
                updates.religion = intakeData.servicePreferences.religion;
              }

              const savedCase = await storage.updateCase(localCall.caseId, updates);
              console.log(`[vapi] saved intakeData to case ${localCall.caseId} — deceasedName: "${savedCase.deceasedName}", intakeData keys: ${Object.keys(savedCase.intakeData as any || {}).join(', ')}, ${newMissing.length} fields still missing`);
            }
          } else {
            // ── Match or create case from call ───────────────────────────
            const deceasedName = intakeData.deceasedInfo?.fullName || "Unknown (Pending)";
            const religion = intakeData.servicePreferences?.religion || "Unknown";

            const matchResult = await findMatchingCase(deceasedName);

            if (matchResult) {
              // ── Existing case found — merge intake, don't duplicate ──────
              const { matchedCase, isMultipleMatches } = matchResult;
              await applyIntakeToExistingCase(
                matchedCase,
                intakeData,
                isMultipleMatches,
                "call",
                new Date()
              );
              await storage.updateCall(localCall.id, { caseId: matchedCase.id });
              console.log(
                `[vapi] matched call ${localCall.id} → existing case ${matchedCase.id} ("${matchedCase.deceasedName}")` +
                (isMultipleMatches ? " [multiple candidates — flagged for review]" : "")
              );
            } else {
              // ── No match — create a new case ─────────────────────────────
              const homes = await storage.getFuneralHomes().catch(() => []);
              const defaultHomeId = (homes as any[])[0]?.id || null;

              const newCase = await storage.createCase({
                deceasedName,
                dateOfDeath: intakeData.deceasedInfo?.dateOfDeath
                  ? new Date(intakeData.deceasedInfo.dateOfDeath)
                  : null,
                status: "active",
                religion,
                language: "English",
                funeralHomeId: defaultHomeId,
                notes: `Auto-created from xLink call. Caller: ${extractedCallerName || "Unknown"} (${intakeData.callerInfo?.relationship || "Unknown relationship"})`,
                intakeData,
                missingFields,
              });

              await storage.updateCall(localCall.id, { caseId: newCase.id });
              console.log(`[vapi] created case ${newCase.id} ("${deceasedName}") linked to call ${localCall.id} — ${missingFields.length} fields missing`);
            }
          }
        } catch (parseErr: any) {
          console.error(`[vapi] intake parsing failed for call ${localCall.id}: ${parseErr?.message || parseErr}`);
          // Still create a stub case so the call isn't left orphaned
          if (!localCall.caseId) {
            try {
              const homes = await storage.getFuneralHomes().catch(() => []);
              const defaultHomeId = (homes as any[])[0]?.id || null;
              const stubCase = await storage.createCase({
                deceasedName: "Unknown (Pending)",
                status: "active",
                religion: "Unknown",
                language: "English",
                funeralHomeId: defaultHomeId,
                notes: `Auto-created from xLink call — intake parsing failed. Caller phone: ${eocPhone || "Unknown"}`,
                intakeData: {},
                missingFields: [],
              });
              await storage.updateCall(localCall.id, { caseId: stubCase.id });
              console.log(`[vapi] created stub case ${stubCase.id} after parse failure`);
            } catch (stubErr: any) {
              console.error(`[vapi] failed to create stub case: ${stubErr?.message}`);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`[vapi] unhandled error processing ${msgType}:`, err?.message || err);
    }
  });
}
