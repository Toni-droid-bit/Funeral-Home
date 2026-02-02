import { VapiClient } from "@vapi-ai/server-sdk";
import type { Express, Request, Response } from "express";
import { storage } from "../storage";

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
      
      if (message?.type === "end-of-call-report") {
        const { call, transcript, summary, recordingUrl } = message;
        const vapiCallId = call?.id;
        
        if (vapiCallId) {
          const localCall = await storage.getCallByVapiId(vapiCallId);
          
          if (localCall) {
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
        }
      }
      
      if (message?.type === "status-update") {
        const vapiCallId = message?.call?.id;
        const status = message?.status;
        
        if (vapiCallId && status === "ended") {
          const localCall = await storage.getCallByVapiId(vapiCallId);
          if (localCall && localCall.status === "in-progress") {
            await storage.updateCall(localCall.id, {
              status: "completed",
            });
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
