import { z } from "zod";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { setupAuth, registerAuthRoutes } from "./auth";
import { registerVapiRoutes } from "./vapi";
import { setupDeepgramWebSocket } from "./deepgram";
import { getFieldLabel, calculateMissingFields, validateIntakeData, parseCallTranscriptToIntake, parseMeetingTranscriptToIntake, mergeIntakeData, generateIntakeDocument } from "./intake-parser";
import { IntakeData, REQUIRED_INTAKE_FIELDS, intakeDataSchema, checklistTemplateItemsSchema, type ChecklistItem } from "@shared/schema";
import { findMatchingCase, applyIntakeToExistingCase } from "./case-matcher";

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

  // PATCH /api/cases/:id — partial update (case fields + intake data deep merge)
  app.patch("/api/cases/:id", async (req, res) => {
    const id = Number(req.params.id);
    const caseItem = await storage.getCase(id);
    if (!caseItem) return res.status(404).json({ message: "Case not found" });

    const { intakeData: newIntakeData, ...directFields } = req.body;
    const updates: any = {};

    // Apply direct case fields (deceasedName, religion, language, status, etc.)
    const allowedFields = ["deceasedName", "religion", "language", "status", "notes", "dateOfDeath", "appointmentDate"];
    for (const field of allowedFields) {
      if (directFields[field] !== undefined) updates[field] = directFields[field];
    }

    // Deep merge intake data if provided
    if (newIntakeData) {
      const existingIntake = (caseItem.intakeData as IntakeData) || {};
      const merged = mergeIntakeData(existingIntake, validateIntakeData(newIntakeData));
      updates.intakeData = merged;
      updates.missingFields = calculateMissingFields(merged);
    }

    const updated = await storage.updateCase(id, updates);

    // Auto-regenerate intake summary document after any case update
    try {
      const intakeData = (updated.intakeData as IntakeData) || {};
      await updateIntakeDocument(id, updated, intakeData);
    } catch (err) {
      console.error("Failed to auto-update intake document:", err);
    }

    res.json(updated);
  });

  // DELETE /api/cases/:id — delete a single case
  app.delete("/api/cases/:id", async (req, res) => {
    const id = Number(req.params.id);
    const caseItem = await storage.getCase(id);
    if (!caseItem) return res.status(404).json({ message: "Case not found" });
    await storage.deleteCase(id);
    res.status(204).send();
  });

  // DELETE /api/cases — delete all cases
  app.delete("/api/cases", async (req, res) => {
    await storage.deleteAllCases();
    res.status(204).send();
  });

  // POST /api/reset — wipe all cases, calls, meetings, and documents
  app.post("/api/reset", async (req, res) => {
    await storage.resetAllData();
    res.json({ message: "Database reset complete" });
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

    const { intakeData: newIntakeData } = req.body;
    const validatedNewData = validateIntakeData(newIntakeData || {});
    const existingIntake = (caseItem.intakeData as IntakeData) || {};

    // Use generic deep merge to handle all sections (old and new)
    const merged = mergeIntakeData(existingIntake, validatedNewData);
    const missingFields = calculateMissingFields(merged);

    const updated = await storage.updateCase(id, { intakeData: merged, missingFields });
    res.json(updated);
  });

  // Process transcript in real-time during recording to auto-update checklist
  // This uses the existing parseMeetingTranscriptToIntake which returns properly structured data
  app.post("/api/cases/:id/process-transcript", async (req, res) => {
    try {
      const caseId = Number(req.params.id);
      const { transcript } = req.body;

      if (!transcript || transcript.trim().length < 50) {
        return res.status(400).json({ error: "Transcript too short to process" });
      }

      const caseData = await storage.getCase(caseId);
      if (!caseData) {
        return res.status(404).json({ error: "Case not found" });
      }

      // Use the existing intake parser which returns properly structured data
      const extractedIntake = await parseMeetingTranscriptToIntake(transcript);

      if (Object.keys(extractedIntake).length === 0) {
        return res.json({
          success: true,
          extractedFields: [],
          message: "No new information extracted",
        });
      }

      // Merge with existing intake data
      const currentIntakeData = (caseData.intakeData as IntakeData) || {};
      const mergedIntakeData = mergeIntakeData(currentIntakeData, extractedIntake);
      const missingFields = calculateMissingFields(mergedIntakeData);

      // Update case
      const updates: any = {
        intakeData: mergedIntakeData,
        missingFields,
      };

      // Update deceased name if extracted and current is placeholder
      if (extractedIntake.deceasedInfo?.fullName &&
        (caseData.deceasedName === "Unknown (Pending)" || !caseData.deceasedName)) {
        updates.deceasedName = extractedIntake.deceasedInfo.fullName;
      }

      // Update religion from new or legacy field
      const extractedReligion = extractedIntake.deceasedInfo?.religion || extractedIntake.servicePreferences?.religion;
      if (extractedReligion && (caseData.religion === "Unknown" || !caseData.religion || caseData.religion === "Secular")) {
        updates.religion = extractedReligion;
      }

      await storage.updateCase(caseId, updates);
      console.log(`[process-transcript] case=${caseId} extracted: deceased="${extractedIntake.deceasedInfo?.fullName ?? 'null'}", caller="${extractedIntake.callerInfo?.name ?? 'null'}", religion="${extractedIntake.deceasedInfo?.religion ?? 'null'}", phone="${extractedIntake.callerInfo?.phone ?? 'null'}"`);

      // Count what was extracted (all sections)
      const extractedFields: string[] = [];
      const checkSection = (section: any, prefix: string) => {
        if (section) Object.keys(section).forEach(k => { if ((section as any)[k]) extractedFields.push(`${prefix}.${k}`); });
      };
      checkSection(extractedIntake.callerInfo, "callerInfo");
      checkSection(extractedIntake.deceasedInfo, "deceasedInfo");
      checkSection(extractedIntake.servicePreferences, "servicePreferences");
      checkSection(extractedIntake.funeralService, "funeralService");
      checkSection(extractedIntake.preparation, "preparation");
      checkSection(extractedIntake.billing, "billing");
      checkSection(extractedIntake.funeralSource, "funeralSource");
      checkSection(extractedIntake.ordersOfService, "ordersOfService");
      checkSection(extractedIntake.donations, "donations");
      checkSection(extractedIntake.onlineTribute, "onlineTribute");
      checkSection(extractedIntake.newspaperNotices, "newspaperNotices");

      res.json({
        success: true,
        extractedFields,
        missingFields,
        message: `Extracted ${extractedFields.length} fields from transcript`,
      });
    } catch (error: any) {
      console.error("Error processing transcript:", error);
      res.status(500).json({ error: "Failed to process transcript" });
    }
  });

  // Update manual checklist value — saves to intakeData via fieldMapping
  app.post("/api/cases/:caseId/checklist/:itemId/update-value", async (req, res) => {
    try {
      const caseId = Number(req.params.caseId);
      const itemId = req.params.itemId;
      const { value } = req.body;

      const caseData = await storage.getCase(caseId);
      if (!caseData) return res.status(404).json({ error: "Case not found" });

      const template = await storage.getDefaultChecklistTemplate();
      if (!template) return res.status(404).json({ error: "No default checklist template" });

      const items = template.items as ChecklistItem[];
      const item = items.find(i => i.id === itemId);
      if (!item) return res.status(404).json({ error: "Checklist item not found" });

      const updates: any = {};

      if (item.fieldMapping) {
        // Save value directly to intakeData via the fieldMapping path (e.g. "deceasedInfo.fullName")
        const parts = item.fieldMapping.split('.');
        const existingIntake = (caseData.intakeData as IntakeData) || {};
        // Build a nested fragment matching the path (works for 1-part top-level fields too)
        const fragment: any = {};
        let cursor = fragment;
        for (let i = 0; i < parts.length - 1; i++) {
          cursor[parts[i]] = {};
          cursor = cursor[parts[i]];
        }
        cursor[parts[parts.length - 1]] = value;
        const merged = mergeIntakeData(existingIntake, validateIntakeData(fragment));
        updates.intakeData = merged;
        updates.missingFields = calculateMissingFields(merged);
        console.log(`[update-value] case=${caseId} item=${itemId} path=${item.fieldMapping} value="${value}" → merged keys: ${Object.keys(merged).join(', ')}`);
      } else {
        // Custom item (no fieldMapping) — auto-check when a value is typed
        const completedItems = (caseData.checklistCompletedItems as string[]) || [];
        if (value && !completedItems.includes(itemId)) {
          updates.checklistCompletedItems = [...completedItems, itemId];
        } else if (!value && completedItems.includes(itemId)) {
          updates.checklistCompletedItems = completedItems.filter(id => id !== itemId);
        }
      }

      if (Object.keys(updates).length > 0) {
        const updated = await storage.updateCase(caseId, updates);
        // Regenerate intake summary document
        try {
          const intakeForDoc = (updates.intakeData || caseData.intakeData) as IntakeData || {};
          await updateIntakeDocument(caseId, updated, intakeForDoc);
        } catch (err) {
          console.error("Failed to regenerate intake document:", err);
        }
      }

      res.json({ success: true, itemId, value });
    } catch (error: any) {
      console.error("Error updating checklist value:", error);
      res.status(500).json({ error: "Failed to update checklist value" });
    }
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

  // PATCH /api/calls/:id — edit transcript (re-parses and updates linked case)
  app.patch("/api/calls/:id", async (req, res) => {
    const callId = Number(req.params.id);
    const call = await storage.getCall(callId);
    if (!call) return res.status(404).json({ message: "Call not found" });

    const { transcript, summary } = req.body;
    const callUpdates: any = {};
    if (transcript !== undefined) callUpdates.transcript = transcript;
    if (summary !== undefined) callUpdates.summary = summary;

    const updatedCall = await storage.updateCall(callId, callUpdates);

    // If transcript changed and call is linked to a case, re-parse and cascade updates
    if (transcript !== undefined && call.caseId) {
      try {
        const intakeData = await parseCallTranscriptToIntake(transcript, call.summary || undefined);
        console.log(`[PATCH /api/calls/${callId}] re-parsed transcript, extracted intakeData:`, JSON.stringify(intakeData, null, 2));
        const existingCase = await storage.getCase(call.caseId);
        if (existingCase) {
          const mergedIntake = mergeIntakeData((existingCase.intakeData as IntakeData) || {}, intakeData);
          const missingFields = calculateMissingFields(mergedIntake);
          const caseUpdates: any = { intakeData: mergedIntake, missingFields };

          if (intakeData.deceasedInfo?.fullName &&
            (existingCase.deceasedName === "Unknown (Pending)" || !existingCase.deceasedName)) {
            caseUpdates.deceasedName = intakeData.deceasedInfo.fullName;
          }
          if (intakeData.servicePreferences?.religion &&
            (existingCase.religion === "Unknown" || !existingCase.religion)) {
            caseUpdates.religion = intakeData.servicePreferences.religion;
          }

          const updatedCase = await storage.updateCase(call.caseId, caseUpdates);
          await updateIntakeDocument(call.caseId, updatedCase, mergedIntake);
        }
      } catch (err) {
        console.error("Failed to re-parse call transcript after edit:", err);
      }
    }

    res.json(updatedCall);
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

  // PATCH /api/meetings/:id — edit transcript (re-parses and updates linked case)
  app.patch("/api/meetings/:id", async (req, res) => {
    const meetingId = Number(req.params.id);
    const meeting = await storage.getMeeting(meetingId);
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });

    const { transcript, summary } = req.body;
    const meetingUpdates: any = {};
    if (transcript !== undefined) meetingUpdates.transcript = transcript;
    if (summary !== undefined) meetingUpdates.summary = summary;

    const updatedMeeting = await storage.updateMeeting(meetingId, meetingUpdates);

    // If transcript changed and meeting is linked to a case, re-parse and cascade updates
    if (transcript !== undefined && meeting.caseId) {
      try {
        const actionItems = Array.isArray(meeting.actionItems) ? meeting.actionItems as string[] : [];
        const intakeData = await parseMeetingTranscriptToIntake(
          transcript,
          meeting.summary || undefined,
          actionItems
        );
        const existingCase = await storage.getCase(meeting.caseId);
        if (existingCase) {
          const mergedIntake = mergeIntakeData((existingCase.intakeData as IntakeData) || {}, intakeData);
          const missingFields = calculateMissingFields(mergedIntake);
          const caseUpdates: any = { intakeData: mergedIntake, missingFields };

          if (intakeData.deceasedInfo?.fullName &&
            (existingCase.deceasedName === "Unknown (Pending)" || !existingCase.deceasedName)) {
            caseUpdates.deceasedName = intakeData.deceasedInfo.fullName;
          }
          const extractedReligion = intakeData.deceasedInfo?.religion || intakeData.servicePreferences?.religion;
          if (extractedReligion &&
            (existingCase.religion === "Unknown" || !existingCase.religion || existingCase.religion === "Secular")) {
            caseUpdates.religion = extractedReligion;
          }

          const updatedCase = await storage.updateCase(meeting.caseId, caseUpdates);
          await updateIntakeDocument(meeting.caseId, updatedCase, mergedIntake);
        }
      } catch (err) {
        console.error("Failed to re-parse meeting transcript after edit:", err);
      }
    }

    res.json(updatedMeeting);
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

  // PATCH /api/documents/:id — edit document content directly
  app.patch("/api/documents/:id", async (req, res) => {
    const docId = Number(req.params.id);
    const { content, title } = req.body;
    const updates: any = {};
    if (content !== undefined) updates.content = content;
    if (title !== undefined) updates.title = title;
    try {
      const updated = await storage.updateDocument(docId, updates);
      if (!updated) return res.status(404).json({ message: "Document not found" });
      res.json(updated);
    } catch (err) {
      res.status(404).json({ message: "Document not found" });
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

          // Update callerName on the call record if extracted
          if (intakeData.callerInfo?.name && !call.callerName) {
            await storage.updateCall(callId, { callerName: intakeData.callerInfo.name });
          }

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
        // Match to existing case or create new
        const deceasedName = intakeData.deceasedInfo?.fullName || "Unknown (Pending)";
        const religion = intakeData.servicePreferences?.religion || "Unknown";

        const matchResult = await findMatchingCase(deceasedName);

        if (matchResult) {
          // ── Existing case found — merge, don't duplicate ──────────────
          const { matchedCase, isMultipleMatches } = matchResult;
          const updatedCase = await applyIntakeToExistingCase(
            matchedCase,
            intakeData,
            isMultipleMatches,
            "call",
            new Date()
          );

          await storage.updateCall(callId, {
            caseId: matchedCase.id,
            callerName: intakeData.callerInfo?.name || call.callerName || undefined,
          });

          await updateIntakeDocument(matchedCase.id, updatedCase, intakeData);

          res.json({
            success: true,
            message: isMultipleMatches
              ? "Call matched to existing case (multiple candidates — please verify)"
              : "Call matched to existing case",
            extractedData: intakeData,
            caseId: matchedCase.id
          });
        } else {
          // ── No match — create a new case ─────────────────────────────
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

          await storage.updateCall(callId, {
            caseId: newCase.id,
            callerName: intakeData.callerInfo?.name || call.callerName || undefined,
          });

          await updateIntakeDocument(newCase.id, newCase, intakeData);

          res.json({
            success: true,
            message: "Call reprocessed and new case created",
            extractedData: intakeData,
            caseId: newCase.id
          });
        }
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
        // No case linked — match to an existing case or create a new one
        const deceasedName = intakeData.deceasedInfo?.fullName || "Unknown (Pending)";
        const religion = intakeData.servicePreferences?.religion || "Unknown";

        const matchResult = await findMatchingCase(deceasedName);

        if (matchResult) {
          // ── Existing case found — merge, don't duplicate ──────────────
          const { matchedCase, isMultipleMatches } = matchResult;
          const updatedCase = await applyIntakeToExistingCase(
            matchedCase,
            intakeData,
            isMultipleMatches,
            "meeting",
            new Date()
          );

          // Link the meeting to the matched case
          await storage.updateMeeting(meeting.id, { caseId: matchedCase.id });

          // Regenerate intake document
          await updateIntakeDocument(matchedCase.id, updatedCase, intakeData);

          res.json({
            success: true,
            message: isMultipleMatches
              ? "Meeting matched to existing case (multiple candidates — please verify)"
              : "Meeting matched to existing case",
            extractedData: intakeData,
            caseId: matchedCase.id,
          });
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
            language: meeting.language || "English",
            funeralHomeId: defaultHomeId,
            notes: `Auto-created from xScribe meeting recording.`,
            intakeData,
            missingFields,
          });

          // Link the meeting to the new case
          await storage.updateMeeting(meeting.id, { caseId: newCase.id });

          // Generate intake document
          await updateIntakeDocument(newCase.id, newCase, intakeData);

          res.json({
            success: true,
            message: "Meeting reprocessed and new case created",
            extractedData: intakeData,
            caseId: newCase.id,
          });
        }
      }
    } catch (error: any) {
      console.error("Failed to reprocess meeting:", error);
      res.status(500).json({ message: "Failed to reprocess meeting transcript", error: error.message });
    }
  });

  // Live extraction during recording - extract data from transcript without saving meeting
  app.post("/api/cases/:id/live-extract", async (req, res) => {
    const caseId = Number(req.params.id);
    const { transcript } = req.body;

    if (!transcript || transcript.trim().length < 20) {
      return res.status(400).json({ message: "Transcript too short for extraction" });
    }

    const caseItem = await storage.getCase(caseId);
    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }

    try {
      // Parse the live transcript
      const intakeData = await parseMeetingTranscriptToIntake(transcript);
      
      // Merge with existing intake data
      const existingIntake = (caseItem.intakeData as IntakeData) || {};
      const mergedIntake = mergeIntakeData(existingIntake, intakeData);
      const newMissingFields = calculateMissingFields(mergedIntake);

      const updates: any = {
        intakeData: mergedIntake,
        missingFields: newMissingFields,
      };

      // Update deceased name if extracted and current is placeholder
      if (intakeData.deceasedInfo?.fullName &&
        (caseItem.deceasedName === "Unknown (Pending)" || !caseItem.deceasedName)) {
        updates.deceasedName = intakeData.deceasedInfo.fullName;
      }

      // Update religion if extracted
      if (intakeData.servicePreferences?.religion &&
        (caseItem.religion === "Unknown" || !caseItem.religion)) {
        updates.religion = intakeData.servicePreferences.religion;
      }

      await storage.updateCase(caseId, updates);

      res.json({
        success: true,
        extractedData: intakeData,
        mergedData: mergedIntake
      });
    } catch (error: any) {
      console.error("Live extraction error:", error);
      res.status(500).json({ message: "Extraction failed", error: error.message });
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
    const checklistValues = ((caseItem as any).checklistValues as Record<string, string>) || {};
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
        manualValue: checklistValues[item.id] || undefined,
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

  // Generate Intake Summary Document — creates a NEW versioned document each time
  app.post("/api/cases/:id/generate-intake-summary", async (req, res) => {
    const caseId = Number(req.params.id);

    const caseItem = await storage.getCase(caseId);
    if (!caseItem) {
      return res.status(404).json({ message: "Case not found" });
    }

    const intakeData = (caseItem.intakeData as IntakeData) || {};

    // Use the shared generateIntakeDocument function for consistent formatting
    const content = generateIntakeDocument(caseItem, intakeData);

    // Timestamped title so each version is distinct (newest shown first in the UI)
    const timestamp = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const title = `Intake Summary — ${caseItem.deceasedName} (${timestamp})`;

    // Always create a new document (versioned history)
    const document = await storage.createDocument({
      caseId,
      type: 'intake_summary',
      title,
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

// Comprehensive checklist based on standard funeral arrangement form
const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  // ─── CRITICAL — must be answered before the family leaves ───
  { id: "c1",  question: "Deceased full legal name",                        category: "critical",      section: "Deceased Details", fieldMapping: "deceasedInfo.fullName",              isCustom: false },
  { id: "c2",  question: "Date of Death",                                   category: "critical",      section: "Deceased Details", fieldMapping: "deceasedInfo.dateOfDeath",           isCustom: false },
  { id: "c3",  question: "Date of Birth",                                   category: "critical",      section: "Deceased Details", fieldMapping: "deceasedInfo.dateOfBirth",           isCustom: false },
  { id: "c4",  question: "Religion / faith",                                category: "critical",      section: "Deceased Details", fieldMapping: "deceasedInfo.religion",              isCustom: false },
  { id: "c5",  question: "Funeral Type (Adult Standard / Pre-Paid / CMA / etc.)", category: "critical", section: "Deceased Details", fieldMapping: "deceasedInfo.funeralType",         isCustom: false },
  { id: "c6",  question: "Client / next of kin full name",                  category: "critical",      section: "Client Details",   fieldMapping: "callerInfo.name",                   isCustom: false },
  { id: "c7",  question: "Client phone number",                             category: "critical",      section: "Client Details",   fieldMapping: "callerInfo.phone",                  isCustom: false },
  { id: "c8",  question: "Relationship to deceased",                        category: "critical",      section: "Client Details",   fieldMapping: "callerInfo.relationship",            isCustom: false },
  { id: "c9",  question: "Place of Death",                                  category: "critical",      section: "Deceased Details", fieldMapping: "deceasedInfo.placeOfDeath",          isCustom: false },
  { id: "c10", question: "Disposition Type (Burial / Cremation / Repatriation)", category: "critical", section: "Funeral Service",  fieldMapping: "funeralService.dispositionType",    isCustom: false },

  // ─── DECEASED DETAILS — important ───
  { id: "dd1",  question: "Title (Mr / Mrs / Ms / Dr / Rev etc.)",          category: "important",     section: "Deceased Details", fieldMapping: "deceasedInfo.title",                isCustom: false },
  { id: "dd2",  question: "Known As (preferred name)",                      category: "important",     section: "Deceased Details", fieldMapping: "deceasedInfo.knownAs",               isCustom: false },
  { id: "dd3",  question: "Pre-Paid Funeral Plan (Y/N + reference)",        category: "important",     section: "Deceased Details", fieldMapping: "deceasedInfo.prePaidPlan",           isCustom: false },
  { id: "dd4",  question: "Age at time of death",                           category: "important",     section: "Deceased Details", fieldMapping: "deceasedInfo.age",                  isCustom: false },
  { id: "dd5",  question: "Gender",                                         category: "important",     section: "Deceased Details", fieldMapping: "deceasedInfo.gender",                isCustom: false },
  { id: "dd6",  question: "Marital Status",                                 category: "important",     section: "Deceased Details", fieldMapping: "deceasedInfo.maritalStatus",         isCustom: false },
  { id: "dd7",  question: "Occupation",                                     category: "important",     section: "Deceased Details", fieldMapping: "deceasedInfo.occupation",            isCustom: false },
  { id: "dd8",  question: "Home Address (Street, Town, County, Postcode)",  category: "important",     section: "Deceased Details", fieldMapping: "deceasedInfo.homePostcode",          isCustom: false },
  { id: "dd9",  question: "Address of Place of Death",                      category: "important",     section: "Deceased Details", fieldMapping: "deceasedInfo.placeOfDeathAddress",   isCustom: false },
  { id: "dd10", question: "GP Name",                                        category: "important",     section: "Deceased Details", fieldMapping: "deceasedInfo.gpName",                isCustom: false },
  { id: "dd11", question: "GP Surgery Name and Address",                    category: "supplementary", section: "Deceased Details", fieldMapping: "deceasedInfo.gpSurgery",             isCustom: false },
  { id: "dd12", question: "Date of Registration",                           category: "supplementary", section: "Deceased Details", fieldMapping: "deceasedInfo.dateOfRegistration",    isCustom: false },

  // ─── CLIENT DETAILS — important ───
  { id: "cd1", question: "Client email address",                            category: "important",     section: "Client Details",   fieldMapping: "callerInfo.email",                  isCustom: false },
  { id: "cd2", question: "Client home address (postcode at minimum)",       category: "important",     section: "Client Details",   fieldMapping: "callerInfo.addressPostcode",         isCustom: false },
  { id: "cd3", question: "Client mobile number",                           category: "supplementary", section: "Client Details",   fieldMapping: "callerInfo.phoneMobile",             isCustom: false },
  { id: "cd4", question: "Marketing preferences (Telephone / Email / Postal)", category: "supplementary", section: "Client Details", fieldMapping: "callerInfo.marketingPreferences",  isCustom: false },
  { id: "cd5", question: "Government Support (DWP / SSS)",                 category: "supplementary", section: "Client Details",   fieldMapping: "callerInfo.governmentSupport",       isCustom: false },
  { id: "cd6", question: "Funeral Finance / Estimated Cost",               category: "important",     section: "Client Details",   fieldMapping: "callerInfo.funeralFinance",          isCustom: false },
  { id: "cd7", question: "Probate required",                               category: "supplementary", section: "Client Details",   fieldMapping: "callerInfo.probate",                isCustom: false },
  { id: "cd8", question: "Masonry details",                                category: "supplementary", section: "Client Details",   fieldMapping: "callerInfo.masonry",                isCustom: false },

  // ─── BILLING DETAILS ───
  { id: "bd1", question: "Billing contact name (if different from client)", category: "supplementary", section: "Billing Details",  fieldMapping: "billing.name",                      isCustom: false },
  { id: "bd2", question: "Billing address",                                category: "supplementary", section: "Billing Details",  fieldMapping: "billing.address",                   isCustom: false },
  { id: "bd3", question: "Billing email",                                  category: "supplementary", section: "Billing Details",  fieldMapping: "billing.email",                     isCustom: false },
  { id: "bd4", question: "Vulnerable Client assessment (YES / NO + type)", category: "important",     section: "Billing Details",  fieldMapping: "billing.vulnerableClient",           isCustom: false },

  // ─── FUNERAL SOURCE ───
  { id: "fs1", question: "How did the family find us?",                    category: "supplementary", section: "Funeral Source",   fieldMapping: "funeralSource.source",              isCustom: false },

  // ─── PREPARATION — important ───
  { id: "prep1",  question: "Cremation forms required (Doctor 1 / Medical Examiner / Coroner / N/A)", category: "important", section: "Preparation", fieldMapping: "preparation.cremationForms", isCustom: false },
  { id: "prep2",  question: "Remove deceased from location (where & when)", category: "important",    section: "Preparation",      fieldMapping: "preparation.removeFromLocation",     isCustom: false },
  { id: "prep3",  question: "Embalming required",                          category: "important",     section: "Preparation",      fieldMapping: "preparation.embalming",             isCustom: false },
  { id: "prep4",  question: "Infectious details / hazard precautions",     category: "important",     section: "Preparation",      fieldMapping: "preparation.infectiousDetails",      isCustom: false },
  { id: "prep5",  question: "Pacemaker / implant present (Yes / No + type)", category: "important",  section: "Preparation",      fieldMapping: "preparation.pacemakerImplant",       isCustom: false },
  { id: "prep6",  question: "Coffin / Casket type selected",               category: "important",     section: "Preparation",      fieldMapping: "preparation.coffinType",             isCustom: false },
  { id: "prep7",  question: "Coffin plate text confirmed",                 category: "important",     section: "Preparation",      fieldMapping: "preparation.coffinPlateText",        isCustom: false },
  { id: "prep8",  question: "Clothing / dressing (Own Clothes / Gown + colour)", category: "important", section: "Preparation",   fieldMapping: "preparation.dressed",               isCustom: false },
  { id: "prep9",  question: "Viewing requested (YES / NO + date & time)",  category: "important",     section: "Preparation",      fieldMapping: "preparation.viewingRequested",       isCustom: false },
  { id: "prep10", question: "Jewellery instructions (Remove / Remain)",    category: "supplementary", section: "Preparation",      fieldMapping: "preparation.jewellery",             isCustom: false },
  { id: "prep11", question: "Disposition of ashes",                        category: "supplementary", section: "Preparation",      fieldMapping: "preparation.dispositionOfAshes",    isCustom: false },
  { id: "prep12", question: "Urn type",                                    category: "supplementary", section: "Preparation",      fieldMapping: "preparation.urnType",               isCustom: false },

  // ─── FUNERAL SERVICE — important ───
  { id: "svc1",  question: "Service day, date and time confirmed",          category: "important",     section: "Funeral Service",  fieldMapping: "funeralService.serviceDate",         isCustom: false },
  { id: "svc2",  question: "Committal day, date and time confirmed",        category: "important",     section: "Funeral Service",  fieldMapping: "funeralService.commitalDate",        isCustom: false },
  { id: "svc3",  question: "Officiant name / type",                         category: "important",     section: "Funeral Service",  fieldMapping: "funeralService.officiant",           isCustom: false },
  { id: "svc4",  question: "Church / Venue name and address",               category: "important",     section: "Funeral Service",  fieldMapping: "funeralService.venueName",           isCustom: false },
  { id: "svc5",  question: "Hearse type",                                   category: "supplementary", section: "Funeral Service",  fieldMapping: "funeralService.hearseType",          isCustom: false },
  { id: "svc6",  question: "Limousines required (number and type)",         category: "supplementary", section: "Funeral Service",  fieldMapping: "funeralService.limousines",          isCustom: false },
  { id: "svc7",  question: "Route details (leaving from, via, committal at, returning to)", category: "important", section: "Funeral Service", fieldMapping: "funeralService.leavingFrom", isCustom: false },
  { id: "svc8",  question: "Music arrangements (Organist / Wesley / Obitus / CDs)", category: "important", section: "Funeral Service", fieldMapping: "funeralService.music",         isCustom: false },
  { id: "svc9",  question: "Flowers accepted (Yes / No / Family Only)",     category: "important",     section: "Funeral Service",  fieldMapping: "funeralService.flowersAccepted",     isCustom: false },
  { id: "svc10", question: "Flower delivery details and notes",             category: "supplementary", section: "Funeral Service",  fieldMapping: "funeralService.flowerNotes",         isCustom: false },

  // ─── ORDERS OF SERVICE ───
  { id: "os1", question: "Orders of service — quantity required",           category: "supplementary", section: "Orders of Service", fieldMapping: "ordersOfService.quantity",          isCustom: false },
  { id: "os2", question: "Orders of service — style / design",              category: "supplementary", section: "Orders of Service", fieldMapping: "ordersOfService.styleDesign",       isCustom: false },
  { id: "os3", question: "Orders of service — photos included (Yes / No)",  category: "supplementary", section: "Orders of Service", fieldMapping: "ordersOfService.photos",            isCustom: false },

  // ─── DONATIONS ───
  { id: "don1", question: "Donations in lieu of flowers (Yes / No)",        category: "supplementary", section: "Donations",         fieldMapping: "donations.requested",               isCustom: false },
  { id: "don2", question: "Donation closing date",                          category: "supplementary", section: "Donations",         fieldMapping: "donations.closingDate",             isCustom: false },
  { id: "don3", question: "Donation recipient charities (up to 3)",         category: "supplementary", section: "Donations",         fieldMapping: "donations.recipients",              isCustom: false },

  // ─── ONLINE TRIBUTE ───
  { id: "ot1", question: "Online tribute requested (Yes / No)",             category: "supplementary", section: "Online Tribute",    fieldMapping: "onlineTribute.requested",           isCustom: false },
  { id: "ot2", question: "Online tribute notes",                            category: "supplementary", section: "Online Tribute",    fieldMapping: "onlineTribute.notes",               isCustom: false },

  // ─── NEWSPAPER NOTICES ───
  { id: "np1", question: "Newspaper notice details (paper, date, price)",   category: "supplementary", section: "Newspaper Notices", fieldMapping: "newspaperNotices.entries",          isCustom: false },

  // ─── ADDITIONAL ───
  { id: "add1",   question: "Additional services (doves, catering, streaming, etc.)", category: "supplementary", section: "Additional Services", fieldMapping: "additionalServices", isCustom: false },
  { id: "notes1", question: "General notes captured",                       category: "supplementary", section: "General Notes",     fieldMapping: "generalNotes",                      isCustom: false },
];

async function seedDatabase() {
  // Always sync the default checklist template to the latest version
  const existingTemplates = await storage.getChecklistTemplates();
  const defaultTemplate = existingTemplates.find(t => t.isDefault);
  if (!defaultTemplate) {
    await storage.createChecklistTemplate({
      name: "Standard Funeral Arrangement Checklist",
      description: "Complete checklist covering all sections of the funeral arrangement form.",
      isDefault: true,
      items: DEFAULT_CHECKLIST_ITEMS,
    });
    console.log("[seed] Created default checklist template with", DEFAULT_CHECKLIST_ITEMS.length, "items");
  } else {
    // Always update to keep in sync with code changes
    await storage.updateChecklistTemplate(defaultTemplate.id, {
      name: "Standard Funeral Arrangement Checklist",
      description: "Complete checklist covering all sections of the funeral arrangement form.",
      items: DEFAULT_CHECKLIST_ITEMS,
    });
    console.log("[seed] Updated default checklist template to", DEFAULT_CHECKLIST_ITEMS.length, "items");
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
