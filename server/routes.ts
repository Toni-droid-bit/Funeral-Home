import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { registerAudioRoutes } from "./replit_integrations/audio";
import { registerImageRoutes } from "./replit_integrations/image";
import { registerVapiRoutes } from "./vapi";
import { setupDeepgramWebSocket } from "./deepgram";
import { getFieldLabel, calculateMissingFields, validateIntakeData, parseCallTranscriptToIntake, parseMeetingTranscriptToIntake, mergeIntakeData, generateIntakeDocument } from "./intake-parser";
import { IntakeData, REQUIRED_INTAKE_FIELDS, intakeDataSchema, checklistTemplateItemsSchema, type ChecklistItem } from "@shared/schema";

// Helper to create or update intake summary document
async function updateIntakeDocument(caseId: number, caseData: any, intakeData: IntakeData) {
  const content = generateIntakeDocument(caseData, intakeData);
  
  // Check if intake summary document already exists
  const existingDocs = await storage.getDocumentsByCaseId(caseId);
  const intakeDoc = existingDocs.find((d: any) => d.type === "intake_summary");
  
  if (intakeDoc) {
    // Update existing document
    await storage.updateDocument(intakeDoc.id, {
      content,
      status: "draft",
    });
  } else {
    // Create new intake summary document
    await storage.createDocument({
      caseId,
      type: "intake_summary",
      title: "Intake Summary",
      content,
      status: "draft",
    });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth Setup
  await setupAuth(app);
  registerAuthRoutes(app);
  
  // AI Integrations
  registerAudioRoutes(app);
  registerImageRoutes(app);
  
  // Vapi.ai Voice Calling
  registerVapiRoutes(app);

  // Deepgram WebSocket for real-time audio
  setupDeepgramWebSocket(httpServer);

  // === API ROUTES ===

  // Cases
  app.get(api.cases.list.path, async (req, res) => {
    const cases = await storage.getCases();
    res.json(cases);
  });

  app.get(api.cases.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const caseItem = await storage.getCase(id);
    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }
    
    // Fetch related data
    const calls = await storage.getCallsByCaseId(id);
    const meetings = await storage.getMeetingsByCaseId(id);
    const documents = await storage.getDocumentsByCaseId(id);

    res.json({ ...caseItem, calls, meetings, documents });
  });

  app.post(api.cases.create.path, async (req, res) => {
    try {
      const input = api.cases.create.input.parse(req.body);
      const newCase = await storage.createCase(input);
      res.status(201).json(newCase);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.put(api.cases.update.path, async (req, res) => {
    const id = Number(req.params.id);
    try {
      const input = api.cases.update.input.parse(req.body);
      const updatedCase = await storage.updateCase(id, input);
      if (!updatedCase) {
        return res.status(404).json({ message: "Case not found" });
      }
      res.json(updatedCase);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Get calls for a specific case
  app.get("/api/cases/:id/calls", async (req, res) => {
    const id = Number(req.params.id);
    const calls = await storage.getCallsByCaseId(id);
    res.json(calls);
  });

  // Get meetings for a specific case
  app.get("/api/cases/:id/meetings", async (req, res) => {
    const id = Number(req.params.id);
    const meetings = await storage.getMeetingsByCaseId(id);
    res.json(meetings);
  });

  // Case intake data and checklist
  app.get("/api/cases/:id/intake", async (req, res) => {
    const id = Number(req.params.id);
    const caseItem = await storage.getCase(id);
    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }
    
    // Fetch related calls to show call history
    const calls = await storage.getCallsByCaseId(id);
    
    const intakeData = (caseItem.intakeData as IntakeData) || {};
    const missingFields = (caseItem.missingFields as string[]) || calculateMissingFields(intakeData);
    
    // Create labeled checklist
    const checklist = REQUIRED_INTAKE_FIELDS.map((field) => ({
      field,
      label: getFieldLabel(field),
      completed: !missingFields.includes(field),
    }));
    
    res.json({
      caseId: caseItem.id,
      deceasedName: caseItem.deceasedName,
      intakeData,
      missingFields,
      checklist,
      completedPercentage: Math.round(((REQUIRED_INTAKE_FIELDS.length - missingFields.length) / REQUIRED_INTAKE_FIELDS.length) * 100),
      calls: calls.map(c => ({
        id: c.id,
        callerPhone: c.callerPhone,
        callerName: c.callerName,
        summary: c.summary,
        createdAt: c.createdAt,
      })),
    });
  });

  // Update case intake data (from xScribe meeting or manual entry)
  app.patch("/api/cases/:id/intake", async (req, res) => {
    const id = Number(req.params.id);
    const caseItem = await storage.getCase(id);
    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }
    
    // Validate incoming intake data
    const { intakeData: newIntakeData } = req.body;
    const validatedNewData = validateIntakeData(newIntakeData || {});
    const existingIntake = (caseItem.intakeData as IntakeData) || {};
    
    // Deep merge new data with existing
    const merged = {
      callerInfo: { ...existingIntake.callerInfo, ...validatedNewData.callerInfo },
      deceasedInfo: { ...existingIntake.deceasedInfo, ...validatedNewData.deceasedInfo },
      servicePreferences: { ...existingIntake.servicePreferences, ...validatedNewData.servicePreferences },
      appointment: { ...existingIntake.appointment, ...validatedNewData.appointment },
    };
    
    const missingFields = calculateMissingFields(merged);
    
    const updated = await storage.updateCase(id, {
      intakeData: merged,
      missingFields,
    });
    
    res.json(updated);
  });

  // Generate documents from meeting transcript
  const generateDocsSchema = z.object({
    meetingId: z.number().optional(),
    documentTypes: z.array(z.enum(["contract", "obituary", "service_program", "eulogy"])).optional(),
  });

  app.post("/api/cases/:id/generate-documents", async (req, res) => {
    const id = Number(req.params.id);
    const caseItem = await storage.getCase(id);
    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }
    
    // Validate request body
    const parseResult = generateDocsSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: parseResult.error.errors[0].message });
    }
    
    const { meetingId, documentTypes } = parseResult.data;
    
    const generatedDocs: any[] = [];
    
    for (const docType of documentTypes || ["contract"]) {
      const doc = await storage.createDocument({
        caseId: id,
        type: docType,
        title: `${docType.charAt(0).toUpperCase() + docType.slice(1).replace("_", " ")} - ${caseItem.deceasedName}`,
        content: `[Document generation placeholder for ${docType}. This would use AI to generate based on case intake data and meeting transcript.]`,
        language: caseItem.language || "English",
        status: "draft",
      });
      generatedDocs.push(doc);
    }
    
    res.status(201).json({
      message: "Documents generated successfully",
      documents: generatedDocs,
    });
  });

  // Calls
  app.get(api.calls.list.path, async (req, res) => {
    const calls = await storage.getCalls();
    res.json(calls);
  });

  app.get(api.calls.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const call = await storage.getCall(id);
    if (!call) return res.status(404).json({ message: "Call not found" });
    res.json(call);
  });

  app.post(api.calls.create.path, async (req, res) => {
    try {
      const input = api.calls.create.input.parse(req.body);
      const newCall = await storage.createCall(input);
      res.status(201).json(newCall);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Meetings
  app.get(api.meetings.list.path, async (req, res) => {
    const meetings = await storage.getMeetings();
    res.json(meetings);
  });

  app.get(api.meetings.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const meeting = await storage.getMeeting(id);
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });
    res.json(meeting);
  });

  app.post(api.meetings.create.path, async (req, res) => {
    try {
      const input = api.meetings.create.input.parse(req.body);
      const newMeeting = await storage.createMeeting(input);
      res.status(201).json(newMeeting);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Documents
  app.get(api.documents.list.path, async (req, res) => {
    const docs = await storage.getDocuments();
    res.json(docs);
  });

  app.post(api.documents.create.path, async (req, res) => {
    try {
      const input = api.documents.create.input.parse(req.body);
      const newDoc = await storage.createDocument(input);
      res.status(201).json(newDoc);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Dashboard Stats
  app.get(api.dashboard.stats.path, async (req, res) => {
    const stats = await storage.getDashboardStats();
    res.json(stats);
  });

  // Re-process call transcript to extract intake data
  app.post("/api/calls/:id/reprocess", async (req, res) => {
    const callId = Number(req.params.id);
    const call = await storage.getCall(callId);
    
    if (!call) {
      return res.status(404).json({ message: "Call not found" });
    }
    
    if (!call.transcript) {
      return res.status(400).json({ message: "Call has no transcript to process" });
    }
    
    try {
      // Parse the transcript to extract intake data
      const intakeData = await parseCallTranscriptToIntake(call.transcript, call.summary || undefined);
      const missingFields = calculateMissingFields(intakeData);
      
      if (call.caseId) {
        // Update existing case with new intake data
        const existingCase = await storage.getCase(call.caseId);
        if (existingCase) {
          const mergedIntake = mergeIntakeData(
            (existingCase.intakeData as IntakeData) || {},
            intakeData
          );
          const newMissingFields = calculateMissingFields(mergedIntake);
          
          // Update case name if we extracted a better name
          const updates: any = {
            intakeData: mergedIntake,
            missingFields: newMissingFields,
          };
          
          // Update deceased name if extracted and current is placeholder
          if (intakeData.deceasedInfo?.fullName && 
              (existingCase.deceasedName === "Unknown (Pending)" || !existingCase.deceasedName)) {
            updates.deceasedName = intakeData.deceasedInfo.fullName;
          }
          
          // Update religion if extracted
          if (intakeData.servicePreferences?.religion && 
              (existingCase.religion === "Unknown" || !existingCase.religion)) {
            updates.religion = intakeData.servicePreferences.religion;
          }
          
          await storage.updateCase(call.caseId, updates);
          
          // Generate and update intake document
          const updatedCase = await storage.getCase(call.caseId);
          if (updatedCase) {
            await updateIntakeDocument(call.caseId, updatedCase, mergedIntake);
          }
          
          res.json({ 
            success: true, 
            message: "Call reprocessed and case updated",
            extractedData: intakeData,
            caseId: call.caseId 
          });
        } else {
          res.status(404).json({ message: "Linked case not found" });
        }
      } else {
        // Create a new case from the call
        const deceasedName = intakeData.deceasedInfo?.fullName || "Unknown (Pending)";
        const religion = intakeData.servicePreferences?.religion || "Unknown";
        
        const homes = await storage.getFuneralHomes();
        const defaultHomeId = homes[0]?.id || null;
        
        const newCase = await storage.createCase({
          deceasedName,
          dateOfDeath: intakeData.deceasedInfo?.dateOfDeath 
            ? new Date(intakeData.deceasedInfo.dateOfDeath) 
            : null,
          status: "active",
          religion,
          language: call.detectedLanguage || "English",
          funeralHomeId: defaultHomeId,
          notes: `Created from call reprocessing. Caller: ${intakeData.callerInfo?.name || call.callerName || "Unknown"} (${intakeData.callerInfo?.relationship || "Unknown relationship"})`,
          intakeData,
          missingFields,
        });
        
        // Link call to the new case
        await storage.updateCall(callId, { caseId: newCase.id });
        
        // Create intake document for the new case
        await updateIntakeDocument(newCase.id, newCase, intakeData);
        
        res.json({ 
          success: true, 
          message: "Call reprocessed and new case created",
          extractedData: intakeData,
          caseId: newCase.id 
        });
      }
    } catch (error: any) {
      console.error("Failed to reprocess call:", error);
      res.status(500).json({ message: "Failed to reprocess call transcript", error: error.message });
    }
  });

  // Re-process meeting transcript to extract intake data
  app.post("/api/meetings/:id/reprocess", async (req, res) => {
    const meetingId = Number(req.params.id);
    const meeting = await storage.getMeeting(meetingId);
    
    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }
    
    if (!meeting.transcript) {
      return res.status(400).json({ message: "Meeting has no transcript to process" });
    }
    
    try {
      // Parse the meeting transcript to extract intake data
      const actionItems = Array.isArray(meeting.actionItems) ? meeting.actionItems as string[] : [];
      const intakeData = await parseMeetingTranscriptToIntake(
        meeting.transcript, 
        meeting.summary || undefined,
        actionItems
      );
      const missingFields = calculateMissingFields(intakeData);
      
      if (meeting.caseId) {
        // Update existing case with new intake data
        const existingCase = await storage.getCase(meeting.caseId);
        if (existingCase) {
          const mergedIntake = mergeIntakeData(
            (existingCase.intakeData as IntakeData) || {},
            intakeData
          );
          const newMissingFields = calculateMissingFields(mergedIntake);
          
          const updates: any = {
            intakeData: mergedIntake,
            missingFields: newMissingFields,
          };
          
          // Update deceased name if extracted and current is placeholder
          if (intakeData.deceasedInfo?.fullName && 
              (existingCase.deceasedName === "Unknown (Pending)" || !existingCase.deceasedName)) {
            updates.deceasedName = intakeData.deceasedInfo.fullName;
          }
          
          // Update religion if extracted
          if (intakeData.servicePreferences?.religion && 
              (existingCase.religion === "Unknown" || !existingCase.religion)) {
            updates.religion = intakeData.servicePreferences.religion;
          }
          
          await storage.updateCase(meeting.caseId, updates);
          
          // Generate and update intake document
          const updatedCase = await storage.getCase(meeting.caseId);
          if (updatedCase) {
            await updateIntakeDocument(meeting.caseId, updatedCase, mergedIntake);
          }
          
          res.json({ 
            success: true, 
            message: "Meeting reprocessed and case updated",
            extractedData: intakeData,
            caseId: meeting.caseId 
          });
        } else {
          res.status(404).json({ message: "Linked case not found" });
        }
      } else {
        res.status(400).json({ message: "Meeting is not linked to a case" });
      }
    } catch (error: any) {
      console.error("Failed to reprocess meeting:", error);
      res.status(500).json({ message: "Failed to reprocess meeting transcript", error: error.message });
    }
  });

  // Get computed checklist for a case (using default template)
  app.get("/api/cases/:id/checklist", async (req, res) => {
    const id = Number(req.params.id);
    const caseItem = await storage.getCase(id);
    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }
    
    const template = await storage.getDefaultChecklistTemplate();
    if (!template) {
      return res.status(404).json({ message: "No default checklist template found" });
    }
    
    const intakeData = (caseItem.intakeData as IntakeData) || {};
    const completedItems = (caseItem.checklistCompletedItems as string[]) || [];
    const items = template.items as ChecklistItem[];
    
    // Compute completion status for each item
    const computedChecklist = items.map(item => {
      let isCompleted = false;
      
      // Check if manually marked complete
      if (completedItems.includes(item.id)) {
        isCompleted = true;
      }
      // Check if auto-completed via fieldMapping
      else if (item.fieldMapping) {
        const value = item.fieldMapping.split('.').reduce((obj: any, key) => obj?.[key], intakeData);
        isCompleted = Boolean(value);
      }
      
      return {
        ...item,
        isCompleted,
        isManuallyCompleted: completedItems.includes(item.id),
      };
    });
    
    const totalItems = computedChecklist.length;
    const completedCount = computedChecklist.filter(i => i.isCompleted).length;
    
    res.json({
      caseId: id,
      templateId: template.id,
      templateName: template.name,
      items: computedChecklist,
      completedCount,
      totalItems,
      completedPercentage: totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0,
    });
  });

  // Toggle checklist item completion for a case
  app.post("/api/cases/:id/checklist/:itemId/toggle", async (req, res) => {
    const caseId = Number(req.params.id);
    const itemId = req.params.itemId;
    
    const caseItem = await storage.getCase(caseId);
    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }
    
    // Get template to verify item exists and check if it has fieldMapping
    const template = await storage.getDefaultChecklistTemplate();
    if (!template) {
      return res.status(404).json({ message: "No default checklist template found" });
    }
    
    const items = template.items as ChecklistItem[];
    const item = items.find(i => i.id === itemId);
    if (!item) {
      return res.status(404).json({ message: "Checklist item not found" });
    }
    
    // For items with fieldMapping, only allow manual marking as complete if intake field is empty
    // For custom items (no fieldMapping), always allow toggling
    const intakeData = (caseItem.intakeData as IntakeData) || {};
    if (item.fieldMapping) {
      const value = item.fieldMapping.split('.').reduce((obj: any, key) => obj?.[key], intakeData);
      if (Boolean(value)) {
        // Field already has data, don't allow manual override
        return res.status(400).json({ 
          message: "This item is auto-completed based on intake data and cannot be manually toggled" 
        });
      }
    }
    
    const completedItems = (caseItem.checklistCompletedItems as string[]) || [];
    let newCompletedItems: string[];
    
    if (completedItems.includes(itemId)) {
      newCompletedItems = completedItems.filter(id => id !== itemId);
    } else {
      newCompletedItems = [...completedItems, itemId];
    }
    
    await storage.updateCase(caseId, { checklistCompletedItems: newCompletedItems });
    
    res.json({ itemId, isCompleted: newCompletedItems.includes(itemId) });
  });

  // Generate Intake Summary Document
  app.post("/api/cases/:id/generate-intake-summary", async (req, res) => {
    const caseId = Number(req.params.id);
    
    const caseItem = await storage.getCase(caseId);
    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }
    
    const intakeData = (caseItem.intakeData as IntakeData) || {};
    const template = await storage.getDefaultChecklistTemplate();
    const items = (template?.items as ChecklistItem[]) || [];
    const completedItems = (caseItem.checklistCompletedItems as string[]) || [];
    
    // Build the intake summary document content
    const sections: string[] = [];
    
    // Header
    sections.push(`# Intake Summary: ${caseItem.deceasedName}`);
    sections.push(`**Case ID:** ${caseItem.id}`);
    sections.push(`**Generated:** ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
    sections.push(`**Status:** ${caseItem.status}`);
    sections.push('');
    
    // Deceased Information
    sections.push('## Deceased Information');
    sections.push(`- **Full Legal Name:** ${intakeData.deceasedInfo?.fullName || caseItem.deceasedName || 'Not provided'}`);
    sections.push(`- **Date of Birth:** ${intakeData.deceasedInfo?.dateOfBirth || 'Not provided'}`);
    sections.push(`- **Date of Death:** ${caseItem.dateOfDeath ? new Date(caseItem.dateOfDeath).toLocaleDateString() : (intakeData.deceasedInfo?.dateOfDeath || 'Not provided')}`);
    sections.push(`- **Current Location:** ${intakeData.deceasedInfo?.currentLocation || 'Not provided'}`);
    sections.push(`- **Religion:** ${caseItem.religion || 'Not specified'}`);
    sections.push(`- **Language:** ${caseItem.language || 'English'}`);
    sections.push('');
    
    // Next of Kin / Contact Information
    sections.push('## Contact Information');
    sections.push(`- **Primary Contact:** ${intakeData.callerInfo?.name || 'Not provided'}`);
    sections.push(`- **Phone:** ${intakeData.callerInfo?.phone || 'Not provided'}`);
    sections.push(`- **Relationship:** ${intakeData.callerInfo?.relationship || 'Not provided'}`);
    sections.push(`- **Email:** ${intakeData.callerInfo?.email || 'Not provided'}`);
    sections.push('');
    
    // Service Preferences
    sections.push('## Service Preferences');
    sections.push(`- **Service Type:** ${intakeData.servicePreferences?.serviceType || 'Not specified'}`);
    sections.push(`- **Burial or Cremation:** ${intakeData.servicePreferences?.burialOrCremation || 'Not specified'}`);
    sections.push(`- **Religion:** ${intakeData.servicePreferences?.religion || 'Not specified'}`);
    sections.push(`- **Urgency:** ${intakeData.servicePreferences?.urgency || 'Not specified'}`);
    sections.push('');
    
    // Checklist Status
    const completedCount = items.filter(item => {
      if (completedItems.includes(item.id)) return true;
      if (item.fieldMapping) {
        const value = item.fieldMapping.split('.').reduce((obj: any, key) => obj?.[key], intakeData);
        return Boolean(value);
      }
      return false;
    }).length;
    
    sections.push('## Checklist Progress');
    sections.push(`**Completed:** ${completedCount} of ${items.length} items (${items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0}%)`);
    sections.push('');
    
    // Group items by category
    const categoryGroups = { critical: [] as string[], important: [] as string[], supplementary: [] as string[] };
    
    items.forEach(item => {
      let isCompleted = completedItems.includes(item.id);
      if (!isCompleted && item.fieldMapping) {
        const value = item.fieldMapping.split('.').reduce((obj: any, key) => obj?.[key], intakeData);
        isCompleted = Boolean(value);
      }
      
      const status = isCompleted ? '[x]' : '[ ]';
      const line = `${status} ${item.question}`;
      
      if (item.category === 'critical') categoryGroups.critical.push(line);
      else if (item.category === 'important') categoryGroups.important.push(line);
      else categoryGroups.supplementary.push(line);
    });
    
    if (categoryGroups.critical.length > 0) {
      sections.push('### Critical Items');
      sections.push(...categoryGroups.critical);
      sections.push('');
    }
    
    if (categoryGroups.important.length > 0) {
      sections.push('### Important Items');
      sections.push(...categoryGroups.important);
      sections.push('');
    }
    
    if (categoryGroups.supplementary.length > 0) {
      sections.push('### Supplementary Items');
      sections.push(...categoryGroups.supplementary);
      sections.push('');
    }
    
    // Additional Notes
    if (caseItem.notes) {
      sections.push('## Additional Notes');
      sections.push(caseItem.notes);
      sections.push('');
    }
    
    const content = sections.join('\n');
    
    // Create the document in the database
    const document = await storage.createDocument({
      caseId,
      type: 'intake_summary',
      title: `Intake Summary - ${caseItem.deceasedName}`,
      content,
    });
    
    res.status(201).json(document);
  });

  // Checklist Templates
  app.get("/api/checklist-templates", async (req, res) => {
    const templates = await storage.getChecklistTemplates();
    res.json(templates);
  });

  app.get("/api/checklist-templates/default", async (req, res) => {
    const template = await storage.getDefaultChecklistTemplate();
    if (!template) {
      return res.status(404).json({ message: "No default template found" });
    }
    res.json(template);
  });

  app.get("/api/checklist-templates/:id", async (req, res) => {
    const id = Number(req.params.id);
    const template = await storage.getChecklistTemplate(id);
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }
    res.json(template);
  });

  const checklistTemplateSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
    items: checklistTemplateItemsSchema,
  });

  app.post("/api/checklist-templates", async (req, res) => {
    const parseResult = checklistTemplateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: parseResult.error.errors[0].message });
    }
    
    const template = await storage.createChecklistTemplate(parseResult.data);
    res.status(201).json(template);
  });

  app.put("/api/checklist-templates/:id", async (req, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getChecklistTemplate(id);
    if (!existing) {
      return res.status(404).json({ message: "Template not found" });
    }
    
    const parseResult = checklistTemplateSchema.partial().safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ message: parseResult.error.errors[0].message });
    }
    
    const template = await storage.updateChecklistTemplate(id, parseResult.data);
    res.json(template);
  });

  app.delete("/api/checklist-templates/:id", async (req, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getChecklistTemplate(id);
    if (!existing) {
      return res.status(404).json({ message: "Template not found" });
    }
    
    await storage.deleteChecklistTemplate(id);
    res.status(204).send();
  });

  // Seed Data
  await seedDatabase();

  return httpServer;
}

// Default checklist items based on user requirements
const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  // Critical - Must Have Before Family Leaves
  { id: "c1", question: "Legal name of deceased", category: "critical", fieldMapping: "deceasedInfo.fullName", isCustom: false },
  { id: "c2", question: "Date of birth", category: "critical", fieldMapping: "deceasedInfo.dateOfBirth", isCustom: false },
  { id: "c3", question: "Date of death", category: "critical", fieldMapping: "deceasedInfo.dateOfDeath", isCustom: false },
  { id: "c4", question: "Next of kin / authorized person", category: "critical", fieldMapping: "callerInfo.name", isCustom: false },
  { id: "c5", question: "Contact phone number", category: "critical", fieldMapping: "callerInfo.phone", isCustom: false },
  { id: "c6", question: "Service type (burial or cremation)", category: "critical", fieldMapping: "servicePreferences.burialOrCremation", isCustom: false },
  { id: "c7", question: "Service date/time (or at least week)", category: "critical", fieldMapping: "appointment.preferredDate", isCustom: false },
  { id: "c8", question: "Payment responsibility confirmed", category: "critical", isCustom: false },
  
  // Important - Should Confirm
  { id: "i1", question: "Cemetery/crematorium selection", category: "important", isCustom: false },
  { id: "i2", question: "Clothing for deceased", category: "important", isCustom: false },
  { id: "i3", question: "Obituary information (birthplace, family, achievements)", category: "important", isCustom: false },
  { id: "i4", question: "Flower preferences", category: "important", isCustom: false },
  { id: "i5", question: "Music selections", category: "important", isCustom: false },
  { id: "i6", question: "Viewing/visitation preferences", category: "important", isCustom: false },
  
  // Supplementary - Can Follow Up
  { id: "s1", question: "Specific readings or poems", category: "supplementary", isCustom: false },
  { id: "s2", question: "Photo selections", category: "supplementary", isCustom: false },
  { id: "s3", question: "Reception catering details", category: "supplementary", isCustom: false },
  { id: "s4", question: "Memorial donations organization", category: "supplementary", isCustom: false },
];

async function seedDatabase() {
  // Seed default checklist template
  const existingTemplates = await storage.getChecklistTemplates();
  if (existingTemplates.length === 0) {
    await storage.createChecklistTemplate({
      name: "Standard Follow-up Meeting Checklist",
      description: "Default checklist for funeral arrangement follow-up meetings. Includes critical, important, and supplementary questions.",
      isDefault: true,
      items: DEFAULT_CHECKLIST_ITEMS,
    });
  }

  const homes = await storage.getFuneralHomes();
  if (homes.length === 0) {
    const home = await storage.createFuneralHome({
      name: "Evergreen Memorial Services",
      address: "123 Serenity Lane, London, UK",
      phone: "+44 20 7946 0123",
      primaryLanguage: "English",
      supportedLanguages: ["English", "Polish", "Punjabi", "Urdu"],
    });

    const case1 = await storage.createCase({
      deceasedName: "Janusz Kowalski",
      dateOfDeath: new Date("2025-01-28"),
      status: "active",
      religion: "Roman Catholic",
      language: "Polish",
      funeralHomeId: home.id,
      notes: "Family prefers Polish speaking director if possible.",
    });

    await storage.createCall({
      caseId: case1.id,
      callerPhone: "+44 7700 900456",
      callerName: "Maria Kowalski",
      detectedLanguage: "Polish",
      transcript: "Dzień dobry, dzwonię w sprawie mojego męża, Janusza. Zmarł dziś rano w domu. Nie wiem co robić. (Good morning, I am calling about my husband, Janusz. He passed away this morning at home. I don't know what to do.)",
      summary: "Wife reporting death of husband at home. Needs guidance on first steps. Distressed.",
      sentiment: "Grief-stricken, Anxious",
      status: "completed",
    });

    const case2 = await storage.createCase({
      deceasedName: "Arthur Thompson",
      dateOfDeath: new Date("2025-01-30"),
      status: "active",
      religion: "Secular",
      language: "English",
      funeralHomeId: home.id,
      notes: "Simple cremation requested.",
    });

    await storage.createMeeting({
      caseId: case2.id,
      directorName: "Sarah Jenkins",
      language: "English",
      transcript: "Director: Good afternoon, Mrs. Thompson. I'm so sorry for your loss. We're here to help you through this. Wife: Thank you. Arthur didn't want anything fancy. Just a simple cremation.",
      summary: "Initial arrangement meeting. Family confirmed preference for direct cremation. No service requested at this time.",
      actionItems: ["Prepare cremation paperwork", "Schedule collection from hospital"],
      status: "completed",
    });
  }
}
