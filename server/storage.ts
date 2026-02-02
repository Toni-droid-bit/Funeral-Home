import { 
  users, cases, calls, meetings, documents, funeralHomes,
  type User, type InsertUser,
  type Case, type InsertCase, type UpdateCaseRequest,
  type Call, type InsertCall,
  type Meeting, type InsertMeeting,
  type Document, type InsertDocument,
  type FuneralHome, type InsertFuneralHome
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Users (Auth handled by replit auth integrations mostly, but useful to have)
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Funeral Homes
  getFuneralHomes(): Promise<FuneralHome[]>;
  createFuneralHome(data: InsertFuneralHome): Promise<FuneralHome>;

  // Cases
  getCases(): Promise<Case[]>;
  getCase(id: number): Promise<Case | undefined>;
  createCase(data: InsertCase): Promise<Case>;
  updateCase(id: number, data: UpdateCaseRequest): Promise<Case>;

  // Calls (xLink)
  getCalls(): Promise<Call[]>;
  getCall(id: number): Promise<Call | undefined>;
  getCallsByCaseId(caseId: number): Promise<Call[]>;
  createCall(data: InsertCall): Promise<Call>;
  updateCall(id: number, data: Partial<InsertCall>): Promise<Call>;

  // Meetings (xScribe)
  getMeetings(): Promise<Meeting[]>;
  getMeeting(id: number): Promise<Meeting | undefined>;
  getMeetingsByCaseId(caseId: number): Promise<Meeting[]>;
  createMeeting(data: InsertMeeting): Promise<Meeting>;

  // Documents
  getDocuments(): Promise<Document[]>;
  getDocumentsByCaseId(caseId: number): Promise<Document[]>;
  createDocument(data: InsertDocument): Promise<Document>;
  
  // Dashboard Stats
  getDashboardStats(): Promise<{ activeCases: number, pendingCalls: number, upcomingMeetings: number }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    // Note: The auth schema uses 'email' not 'username', adjusting for standard auth if needed
    // But replit auth uses email. We'll keep this generic if needed.
    // For now returning undefined as replit auth handles this.
    return undefined; 
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  // Funeral Homes
  async getFuneralHomes(): Promise<FuneralHome[]> {
    return await db.select().from(funeralHomes);
  }

  async createFuneralHome(data: InsertFuneralHome): Promise<FuneralHome> {
    const [home] = await db.insert(funeralHomes).values(data).returning();
    return home;
  }

  // Cases
  async getCases(): Promise<Case[]> {
    return await db.select().from(cases).orderBy(desc(cases.createdAt));
  }

  async getCase(id: number): Promise<Case | undefined> {
    const [c] = await db.select().from(cases).where(eq(cases.id, id));
    return c;
  }

  async createCase(data: InsertCase): Promise<Case> {
    const [c] = await db.insert(cases).values(data).returning();
    return c;
  }

  async updateCase(id: number, data: UpdateCaseRequest): Promise<Case> {
    const [c] = await db.update(cases).set(data).where(eq(cases.id, id)).returning();
    return c;
  }

  // Calls
  async getCalls(): Promise<Call[]> {
    return await db.select().from(calls).orderBy(desc(calls.createdAt));
  }

  async getCall(id: number): Promise<Call | undefined> {
    const [c] = await db.select().from(calls).where(eq(calls.id, id));
    return c;
  }

  async getCallsByCaseId(caseId: number): Promise<Call[]> {
    return await db.select().from(calls).where(eq(calls.caseId, caseId)).orderBy(desc(calls.createdAt));
  }

  async createCall(data: InsertCall): Promise<Call> {
    const [c] = await db.insert(calls).values(data).returning();
    return c;
  }

  async updateCall(id: number, data: Partial<InsertCall>): Promise<Call> {
    const [c] = await db.update(calls).set(data).where(eq(calls.id, id)).returning();
    return c;
  }

  // Meetings
  async getMeetings(): Promise<Meeting[]> {
    return await db.select().from(meetings).orderBy(desc(meetings.createdAt));
  }

  async getMeeting(id: number): Promise<Meeting | undefined> {
    const [m] = await db.select().from(meetings).where(eq(meetings.id, id));
    return m;
  }

  async getMeetingsByCaseId(caseId: number): Promise<Meeting[]> {
    return await db.select().from(meetings).where(eq(meetings.caseId, caseId)).orderBy(desc(meetings.createdAt));
  }

  async createMeeting(data: InsertMeeting): Promise<Meeting> {
    const [m] = await db.insert(meetings).values(data).returning();
    return m;
  }

  // Documents
  async getDocuments(): Promise<Document[]> {
    return await db.select().from(documents).orderBy(desc(documents.createdAt));
  }

  async getDocumentsByCaseId(caseId: number): Promise<Document[]> {
    return await db.select().from(documents).where(eq(documents.caseId, caseId));
  }

  async createDocument(data: InsertDocument): Promise<Document> {
    const [d] = await db.insert(documents).values(data).returning();
    return d;
  }

  async getDashboardStats(): Promise<{ activeCases: number, pendingCalls: number, upcomingMeetings: number }> {
    // Simple implementation for prototype
    const allCases = await this.getCases();
    const activeCases = allCases.filter(c => c.status === 'active').length;
    
    // Mocking pending calls/upcoming meetings as logic isn't fully defined in schema statuses
    // We'll just return some counts based on recent data
    return {
      activeCases,
      pendingCalls: 3, // Mock
      upcomingMeetings: 2 // Mock
    };
  }
}

export const storage = new DatabaseStorage();
