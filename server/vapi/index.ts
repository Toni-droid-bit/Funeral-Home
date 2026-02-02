import { VapiClient } from "@vapi-ai/server-sdk";
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { parseCallTranscriptToIntake, calculateMissingFields, mergeIntakeData } from "../intake-parser";

const vapiClient = new VapiClient({
  token: process.env.VAPI_API_KEY || "",
});

export function registerVapiRoutes(app: Express) {
  app.get("/api/vapi/phone-numbers", async (_req: Request, res: Response) => {
    try {
      const phoneNumbers = await vapiClient.phoneNumbers.list();
      res.json(phoneNumbers);
    } catch (error: any) {
      console.error("Error fetching phone numbers:", error);
      res.status(500).json({ 
        message: "Failed to fetch phone numbers",
        error: error.message 
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

      if (!phoneNumberId || !customerNumber) {
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

      const vapiCall = await vapiClient.calls.create(callConfig) as any;

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
      console.error("Error creating call:", error);
      res.status(500).json({ 
        message: "Failed to create call",
        error: error.message 
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
    try {
      const { message } = req.body;
      
      console.log("Vapi webhook received:", message?.type);
      
      // Handle assistant started - create local call record for inbound calls
      if (message?.type === "assistant-message" || message?.type === "conversation-update") {
        const vapiCallId = message?.call?.id;
        const callType = message?.call?.type;
        const customerNumber = message?.call?.customer?.number;
        const customerName = message?.call?.customer?.name;
        
        if (vapiCallId && callType === "inboundPhoneCall") {
          // Check if we already have a record for this call
          const existingCall = await storage.getCallByVapiId(vapiCallId);
          
          if (!existingCall) {
            // Create a new local call record for this inbound call
            await storage.createCall({
              vapiCallId: vapiCallId,
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
            console.log(`Created local call record for inbound Vapi call: ${vapiCallId}`);
          }
        }
      }
      
      // Handle status-update with "in-progress" to catch inbound calls early
      if (message?.type === "status-update") {
        const vapiCallId = message?.call?.id;
        const status = message?.status;
        const callType = message?.call?.type;
        const customerNumber = message?.call?.customer?.number;
        const customerName = message?.call?.customer?.name;
        
        // Create record for inbound calls when they start
        if (vapiCallId && status === "in-progress" && callType === "inboundPhoneCall") {
          const existingCall = await storage.getCallByVapiId(vapiCallId);
          
          if (!existingCall) {
            await storage.createCall({
              vapiCallId: vapiCallId,
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
            console.log(`Created local call record for inbound Vapi call: ${vapiCallId}`);
          }
        }
        
        // Handle call ended status
        if (vapiCallId && status === "ended") {
          const localCall = await storage.getCallByVapiId(vapiCallId);
          if (localCall && localCall.status === "in-progress") {
            await storage.updateCall(localCall.id, {
              status: "completed",
            });
          }
        }
      }
      
      if (message?.type === "end-of-call-report") {
        const { call, transcript, summary, recordingUrl } = message;
        const vapiCallId = call?.id;
        const customerNumber = call?.customer?.number;
        const customerName = call?.customer?.name;
        const callType = call?.type;
        
        if (vapiCallId) {
          let localCall = await storage.getCallByVapiId(vapiCallId);
          
          // If no local call exists (e.g., inbound call we didn't catch earlier), create one
          if (!localCall && callType === "inboundPhoneCall") {
            localCall = await storage.createCall({
              vapiCallId: vapiCallId,
              callerPhone: customerNumber || "Unknown",
              callerName: customerName || null,
              caseId: null,
              status: "completed",
              direction: "inbound",
              detectedLanguage: "English",
              transcript: transcript || null,
              summary: summary || null,
              sentiment: null,
              audioUrl: recordingUrl || null,
            });
            console.log(`Created and completed local call record for inbound Vapi call: ${vapiCallId}`);
          } else if (localCall) {
            await storage.updateCall(localCall.id, {
              status: "completed",
              transcript: transcript || null,
              summary: summary || null,
              audioUrl: recordingUrl || null,
            });
            console.log(`Updated call ${localCall.id} from Vapi webhook`);
          } else {
            console.log(`No local call found for Vapi call ID: ${vapiCallId}`);
          }
          
          // Parse transcript to extract structured intake data and create/update case
          if (localCall && transcript && callType === "inboundPhoneCall") {
            try {
              console.log(`Parsing call transcript for intake data...`);
              const intakeData = await parseCallTranscriptToIntake(transcript, summary || undefined);
              const missingFields = calculateMissingFields(intakeData);
              
              // Check if call already linked to a case
              if (localCall.caseId) {
                // Update existing case with new intake data
                const existingCase = await storage.getCase(localCall.caseId);
                if (existingCase) {
                  const mergedIntake = mergeIntakeData(
                    (existingCase.intakeData as any) || {},
                    intakeData
                  );
                  const newMissingFields = calculateMissingFields(mergedIntake);
                  
                  await storage.updateCase(localCall.caseId, {
                    intakeData: mergedIntake,
                    missingFields: newMissingFields,
                  });
                  console.log(`Updated case ${localCall.caseId} with intake data from call`);
                }
              } else {
                // Create new case from intake data
                const deceasedName = intakeData.deceasedInfo?.fullName || "Unknown (Pending)";
                const religion = intakeData.servicePreferences?.religion || "Unknown";
                const language = "English"; // Could detect from transcript
                
                // Get default funeral home
                const homes = await storage.getFuneralHomes();
                const defaultHomeId = homes[0]?.id || null;
                
                const newCase = await storage.createCase({
                  deceasedName,
                  dateOfDeath: intakeData.deceasedInfo?.dateOfDeath 
                    ? new Date(intakeData.deceasedInfo.dateOfDeath) 
                    : null,
                  status: "active",
                  religion,
                  language,
                  funeralHomeId: defaultHomeId,
                  notes: `Auto-created from xLink call. Caller: ${intakeData.callerInfo?.name || customerName || "Unknown"} (${intakeData.callerInfo?.relationship || "Unknown relationship"})`,
                  intakeData,
                  missingFields,
                });
                
                // Link call to the new case
                await storage.updateCall(localCall.id, {
                  caseId: newCase.id,
                });
                
                console.log(`Created new case ${newCase.id} from call intake data`);
              }
            } catch (parseError) {
              console.error("Failed to parse call intake:", parseError);
            }
          }
        }
      }
      
      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error("Webhook error:", error);
      res.status(500).json({ message: "Webhook processing error" });
    }
  });
}
