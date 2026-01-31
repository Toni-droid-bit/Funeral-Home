import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Import Auth and Chat models from integrations
export * from "./models/auth";
export * from "./models/chat";

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
  createdAt: timestamp("created_at").defaultNow(),
});

export const calls = pgTable("calls", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => cases.id),
  callerPhone: text("caller_phone").notNull(),
  callerName: text("caller_name"),
  detectedLanguage: text("detected_language").default("English"),
  transcript: text("transcript"),
  summary: text("summary"),
  sentiment: text("sentiment"),
  audioUrl: text("audio_url"),
  status: text("status").default("completed"), // missed, completed, in-progress
  createdAt: timestamp("created_at").defaultNow(),
});

export const meetings = pgTable("meetings", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => cases.id),
  directorName: text("director_name"),
  language: text("language").default("English"),
  transcript: text("transcript"),
  summary: text("summary"),
  actionItems: jsonb("action_items"), // Array of strings
  audioUrl: text("audio_url"),
  status: text("status").default("processing"), // recording, processing, completed
  createdAt: timestamp("created_at").defaultNow(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").references(() => cases.id),
  type: text("type").notNull(), // contract, eulogy, obituary, service_plan
  title: text("title").notNull(),
  content: text("content"), // HTML or Markdown content
  language: text("language").default("English"),
  status: text("status").default("draft"), // draft, final
  createdAt: timestamp("created_at").defaultNow(),
});

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
