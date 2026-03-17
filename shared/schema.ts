import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Import Auth and Chat models from integrations
export * from "./models/auth";

// === TABLE DEFINITIONS ===

export const funeralHomes = pgTable("funeral_homes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone").notNull(),
  primaryLanguage: text("primary_language").default("English"),
  supportedLanguages: text("supported_languages").array(),
});

export const cases = pgTable("cases", {
  id: serial("id").primaryKey(),
  deceasedName: text("deceased_name").notNull(),
  dateOfDeath: timestamp("date_of_death"),
  status: text("status").notNull().default("active"), // active, closed, pending
  religion: text("religion").default("Secular"),
  language: text("language").default("English"), // Family's preferred language
  funeralHomeId: integer("funeral_home_id").references(() => funeralHomes.id),
  notes: text("notes"),
  intakeData: jsonb("intake_data"), // Structured intake from xLink calls
  missingFields: jsonb("missing_fields"), // Array of fields still needing info
  checklistCompletedItems: jsonb("checklist_completed_items"), // Array of completed checklist item IDs
  appointmentDate: timestamp("appointment_date"), // Scheduled arrangement meeting
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── COMPREHENSIVE INTAKE DATA SCHEMA ───
// Covers all fields from the standard funeral arrangement form
export const intakeDataSchema = z.object({

  // ── DECEASED DETAILS ──
  deceasedInfo: z.object({
    // Core identification (existing, kept for compat)
    fullName: z.string().optional(),          // Full legal name
    dateOfDeath: z.string().optional(),        // YYYY-MM-DD
    dateOfBirth: z.string().optional(),        // YYYY-MM-DD
    age: z.number().optional(),
    currentLocation: z.string().optional(),    // Where the body currently is
    causeOfDeath: z.string().optional(),
    // Extended deceased details
    title: z.string().optional(),              // Mr / Mrs / Ms / Dr / Rev etc.
    forenames: z.string().optional(),          // Forename(s) separately
    surname: z.string().optional(),
    knownAs: z.string().optional(),            // Preferred / known-as name
    prePaidPlan: z.string().optional(),        // Y/N
    prePaidPlanRef: z.string().optional(),     // Reference number
    gender: z.string().optional(),
    religion: z.string().optional(),           // Religion of deceased
    maritalStatus: z.string().optional(),
    occupation: z.string().optional(),
    dateOfRegistration: z.string().optional(), // Death registration date YYYY-MM-DD
    funeralType: z.string().optional(),        // Adult Standard / Adult Pre-Paid / Attended-CMA / Unattended-CMA / Unattended-Other / Child / Repatriation / Environmental
    // Home address (flattened for easy fieldMapping)
    homeStreet: z.string().optional(),
    homeTown: z.string().optional(),
    homeCounty: z.string().optional(),
    homePostcode: z.string().optional(),
    homeCountry: z.string().optional(),
    // Place of death
    placeOfDeath: z.string().optional(),       // Hospital name, home address, hospice, etc.
    placeOfDeathAddress: z.string().optional(),
    // GP details
    gpName: z.string().optional(),
    gpSurgery: z.string().optional(),          // Surgery name and address
  }).optional(),

  // ── CLIENT / NEXT OF KIN ──
  callerInfo: z.object({
    // Existing (kept for compat)
    name: z.string().optional(),
    phone: z.string().optional(),
    relationship: z.string().optional(),
    email: z.string().optional(),
    // Extended
    title: z.string().optional(),
    forenames: z.string().optional(),
    surname: z.string().optional(),
    addressStreet: z.string().optional(),
    addressTown: z.string().optional(),
    addressCounty: z.string().optional(),
    addressPostcode: z.string().optional(),
    addressCountry: z.string().optional(),
    phoneMobile: z.string().optional(),
    phoneHome: z.string().optional(),
    marketingPreferences: z.string().optional(), // Telephone / Email / Postal
    governmentSupport: z.string().optional(),     // DWP / SSS
    funeralFinance: z.string().optional(),        // Finance arrangement
    estimatedCost: z.string().optional(),
    probate: z.string().optional(),
    masonry: z.string().optional(),
  }).optional(),
  // Additional next-of-kin / callers who have contacted us about the same case
  additionalContacts: z.array(z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    relationship: z.string().optional(),
    email: z.string().optional(),
  })).optional(),

  // ── BILLING DETAILS ──
  billing: z.object({
    title: z.string().optional(),
    name: z.string().optional(),               // Full name of billing contact
    address: z.string().optional(),
    phoneHome: z.string().optional(),
    phoneMobile: z.string().optional(),
    phoneWork: z.string().optional(),
    email: z.string().optional(),
    vulnerableClient: z.string().optional(),   // YES/NO + type if yes
  }).optional(),

  // ── FUNERAL SOURCE ──
  funeralSource: z.object({
    source: z.string().optional(),             // Recommended by Professional / Used Before / Location/Reputation / Friends/Family / Pre-Paid Plan / Other
    details: z.string().optional(),
  }).optional(),

  // ── PREPARATION ──
  preparation: z.object({
    cremationForms: z.string().optional(),     // Doctor 1 / Medical Examiner / Coroner / N/A
    doctorName: z.string().optional(),
    doctorAddress: z.string().optional(),
    removeFromLocation: z.string().optional(), // Where & when to collect
    embalming: z.string().optional(),          // Yes / No + details
    infectiousDetails: z.string().optional(),
    pacemakerImplant: z.string().optional(),   // Yes / No + type
    bodySize: z.string().optional(),
    coffinSize: z.string().optional(),
    coffinType: z.string().optional(),         // Coffin / Casket type
    urnType: z.string().optional(),
    coffinPlateText: z.string().optional(),
    dressed: z.string().optional(),            // Own Clothes / Gown + colour
    viewingRequested: z.string().optional(),   // YES / NO
    viewingDateTime: z.string().optional(),    // Date and time for viewing
    careProgress: z.string().optional(),       // Prepared / Dressed / Encoffined / Ready for Viewing
    viewingRestrictions: z.string().optional(),
    jewellery: z.string().optional(),          // Remove / Remain
    graveDetails: z.string().optional(),       // Grave size / type / ref
    dispositionOfAshes: z.string().optional(),
  }).optional(),

  // ── FUNERAL SERVICE ──
  funeralService: z.object({
    dispositionType: z.string().optional(),    // Burial / Cremation / Repatriation
    serviceDate: z.string().optional(),        // YYYY-MM-DD
    serviceTime: z.string().optional(),
    commitalDate: z.string().optional(),       // YYYY-MM-DD
    commitalTime: z.string().optional(),
    officiant: z.string().optional(),          // Name / type of officiant
    venueName: z.string().optional(),          // Church / crematorium / venue
    venueDenomination: z.string().optional(),
    venueAddress: z.string().optional(),
    hearseType: z.string().optional(),
    limousines: z.string().optional(),         // Number / type
    leavingFrom: z.string().optional(),
    routeVia: z.string().optional(),
    commitalAt: z.string().optional(),
    returningTo: z.string().optional(),
    music: z.string().optional(),             // Organist / Wesley / Obitus / CDs + selections
    flowersAccepted: z.string().optional(),    // Yes / No / Family Only
    flowersDelivery: z.string().optional(),
    flowerNotes: z.string().optional(),
  }).optional(),

  // ── ORDERS OF SERVICE ──
  ordersOfService: z.object({
    quantity: z.string().optional(),
    styleDesign: z.string().optional(),
    photos: z.string().optional(),             // Yes / No
    sentToPrinter: z.string().optional(),
    proofReceived: z.string().optional(),
    proofApproved: z.string().optional(),
    orderConfirmed: z.string().optional(),
    orderReceived: z.string().optional(),
  }).optional(),

  // ── DONATIONS ──
  donations: z.object({
    requested: z.string().optional(),          // Yes / No
    closingDate: z.string().optional(),
    recipients: z.string().optional(),         // Up to 3 charity names
  }).optional(),

  // ── ONLINE TRIBUTE ──
  onlineTribute: z.object({
    requested: z.string().optional(),          // Yes / No
    setupBy: z.string().optional(),
    notes: z.string().optional(),
  }).optional(),

  // ── NEWSPAPER NOTICES ──
  newspaperNotices: z.object({
    entries: z.string().optional(),            // Free text describing all notices
  }).optional(),

  // ── LEGACY / EXISTING (kept for backward compatibility) ──
  servicePreferences: z.object({
    burialOrCremation: z.string().optional(),
    religion: z.string().optional(),
    subTradition: z.string().optional(),
    urgency: z.string().optional(),
    serviceType: z.string().optional(),
    cemeteryOrCrematorium: z.string().optional(),
    clothing: z.string().optional(),
    obituary: z.string().optional(),
    flowers: z.string().optional(),
    music: z.string().optional(),
    readings: z.string().optional(),
    reception: z.string().optional(),
    donations: z.string().optional(),
  }).optional(),

  appointment: z.object({
    preferredDate: z.string().optional(),
    preferredTime: z.string().optional(),
    attendeeCount: z.number().optional(),
  }).optional(),

  // ── FREE TEXT ──
  additionalServices: z.string().optional(),
  generalNotes: z.string().optional(),
});

export type IntakeData = z.infer<typeof intakeDataSchema>;

// Critical required fields — must be answered before the family leaves
export const REQUIRED_INTAKE_FIELDS = [
  "deceasedInfo.fullName",
  "deceasedInfo.dateOfDeath",
  "deceasedInfo.dateOfBirth",
  "deceasedInfo.religion",
  "deceasedInfo.funeralType",
  "callerInfo.name",
  "callerInfo.phone",
  "callerInfo.relationship",
  "deceasedInfo.placeOfDeath",
  "funeralService.dispositionType",
] as const;

export const calls = pgTable("calls", {
  id: serial("id").primaryKey(),
  vapiCallId: text("vapi_call_id"),
  caseId: integer("case_id").references(() => cases.id),
  callerPhone: text("caller_phone").notNull(),
  callerName: text("caller_name"),
  detectedLanguage: text("detected_language").default("English"),
  transcript: text("transcript"),
  summary: text("summary"),
  sentiment: text("sentiment"),
  audioUrl: text("audio_url"),
  status: text("status").default("completed"),
  direction: text("direction").default("inbound"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const meetings = pgTable("meetings", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => cases.id),
  directorName: text("director_name"),
  language: text("language").default("English"),
  transcript: text("transcript"),
  summary: text("summary"),
  actionItems: jsonb("action_items"),
  audioUrl: text("audio_url"),
  status: text("status").default("processing"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => cases.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  language: text("language").default("English"),
  status: text("status").default("draft"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const checklistTemplates = pgTable("checklist_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").default(false),
  funeralHomeId: integer("funeral_home_id").references(() => funeralHomes.id),
  items: jsonb("items").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Checklist item schema — includes `section` for UI grouping
export const checklistItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  category: z.enum(["critical", "important", "supplementary"]),
  section: z.string().optional(),          // e.g. "Deceased Details", "Client Details"
  fieldMapping: z.string().optional(),     // dot-path into intakeData, e.g. "deceasedInfo.fullName"
  isCustom: z.boolean().default(false),
});

export const checklistTemplateItemsSchema = z.array(checklistItemSchema);

export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type ChecklistTemplateItems = z.infer<typeof checklistTemplateItemsSchema>;

// === RELATIONS ===

export const casesRelations = relations(cases, ({ one, many }) => ({
  funeralHome: one(funeralHomes, {
    fields: [cases.funeralHomeId],
    references: [funeralHomes.id],
  }),
  calls: many(calls),
  meetings: many(meetings),
  documents: many(documents),
}));

export const callsRelations = relations(calls, ({ one }) => ({
  case: one(cases, {
    fields: [calls.caseId],
    references: [cases.id],
  }),
}));

export const meetingsRelations = relations(meetings, ({ one }) => ({
  case: one(cases, {
    fields: [meetings.caseId],
    references: [cases.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  case: one(cases, {
    fields: [documents.caseId],
    references: [cases.id],
  }),
}));

// === BASE SCHEMAS ===

export const insertFuneralHomeSchema = createInsertSchema(funeralHomes).omit({ id: true });
export const insertCaseSchema = createInsertSchema(cases).omit({ id: true, createdAt: true });
export const insertCallSchema = createInsertSchema(calls).omit({ id: true, createdAt: true });
export const insertMeetingSchema = createInsertSchema(meetings).omit({ id: true, createdAt: true });
export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, createdAt: true });
export const insertChecklistTemplateSchema = createInsertSchema(checklistTemplates).omit({ id: true, createdAt: true, updatedAt: true });

// === EXPLICIT API CONTRACT TYPES ===

export type FuneralHome = typeof funeralHomes.$inferSelect;
export type InsertFuneralHome = z.infer<typeof insertFuneralHomeSchema>;

export type Case = typeof cases.$inferSelect;
export type InsertCase = z.infer<typeof insertCaseSchema>;

export type Call = typeof calls.$inferSelect;
export type InsertCall = z.infer<typeof insertCallSchema>;

export type Meeting = typeof meetings.$inferSelect;
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;

export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;

export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type InsertChecklistTemplate = z.infer<typeof insertChecklistTemplateSchema>;

// Request types
export type CreateCaseRequest = InsertCase;
export type UpdateCaseRequest = Partial<InsertCase>;

export type CreateCallRequest = InsertCall;
export type CreateMeetingRequest = InsertMeeting;
export type CreateDocumentRequest = InsertDocument;
export type UpdateDocumentRequest = Partial<InsertDocument>;

// Response types
export type CaseResponse = Case & {
  calls?: Call[];
  meetings?: Meeting[];
  documents?: Document[];
};
