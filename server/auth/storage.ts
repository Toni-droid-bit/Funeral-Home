import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../db";
import { eq } from "drizzle-orm";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  ensureAdminUser(
    username: string,
    password: string,
    hashPassword: (p: string) => string
  ): Promise<void>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: { ...userData, updatedAt: new Date() },
      })
      .returning();
    return user;
  }

  async ensureAdminUser(
    username: string,
    password: string,
    hashPassword: (p: string) => string
  ): Promise<void> {
    const existing = await this.getUserByUsername(username);
    if (!existing) {
      await db.insert(users).values({
        username,
        passwordHash: hashPassword(password),
      });
      console.log(`[auth] Created admin user: "${username}" (password from ADMIN_PASSWORD env or default "admin123")`);
    }
  }
}

export const authStorage = new AuthStorage();
