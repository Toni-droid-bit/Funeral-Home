import OpenAI from "openai";
import { IntakeData, intakeDataSchema, REQUIRED_INTAKE_FIELDS } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Validate and return intake data, defaulting to empty on failure
export function validateIntakeData(data: unknown): IntakeData {
  const result = intakeDataSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  console.warn("Invalid intake data, defaulting to empty:", result.error.message);
  return {};
}

export async function parseCallTranscriptToIntake(
  transcript: string,
  summary?: string
): Promise<IntakeData> {
  const prompt = `You are analyzing a phone call transcript from a funeral home intake call. This is critical for building a case profile.

PRIORITY INFORMATION TO EXTRACT (First Call Essentials):
1. Name of the deceased (who passed away)
2. Caller's relationship to the deceased (son, daughter, spouse, sibling, etc.)
3. When did they die (date of death)
4. Caller's contact phone number
5. Religion - especially important for Muslim or Jewish as they require urgent 24-hour burial

TRANSCRIPT:
${transcript}

${summary ? `SUMMARY:\n${summary}` : ""}

Extract ALL mentioned information. Pay special attention to:
- Any mention of Muslim, Islam, Islamic, Jewish, or similar religious references
- Any mention of urgency, quick burial, 24-hour burial, or religious requirements
- The caller identifying themselves (e.g., "I'm calling about my father" means relationship is son/daughter)

Return ONLY a valid JSON object with this structure (use null for fields not mentioned):
{
  "callerInfo": {
    "name": "caller's full name or null",
    "phone": "phone number or null (extract from transcript if caller provides it)",
    "relationship": "relationship to deceased (e.g., spouse, son, daughter, brother, sister, friend) or null",
    "email": "email address or null"
  },
  "deceasedInfo": {
    "fullName": "deceased person's full name or null",
    "dateOfDeath": "date of death in YYYY-MM-DD format or null (if they say 'today', 'yesterday', 'this morning', estimate)",
    "dateOfBirth": "date of birth in YYYY-MM-DD format or null",
    "age": numeric age or null,
    "currentLocation": "where the body is (hospital, home, care home, coroner, hospice) or null",
    "causeOfDeath": "cause of death if mentioned or null"
  },
  "servicePreferences": {
    "burialOrCremation": "burial (default for Muslim/Jewish), cremation, or undecided or null",
    "religion": "religion or belief system (Muslim, Jewish, Christian, Catholic, Hindu, Sikh, Secular, etc.) or null",
    "subTradition": "specific denomination if mentioned or null",
    "urgency": "urgent-24hr (for Muslim or Jewish) or normal or null - IMPORTANT: always set to urgent-24hr if Muslim or Jewish is mentioned",
    "serviceType": "full service, direct cremation, memorial, etc. or null"
  },
  "appointment": {
    "preferredDate": "preferred meeting date or null",
    "preferredTime": "preferred meeting time or null",
    "attendeeCount": numeric count or null
  }
}

Return ONLY the JSON object, no other text.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content?.trim() || "{}";
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content;
    if (content.startsWith("```")) {
      jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    }
    
    const parsed = JSON.parse(jsonStr);
    
    // Clean up null values
    const cleanObject = (obj: any): any => {
      if (obj === null || obj === undefined) return undefined;
      if (typeof obj !== "object") return obj;
      
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && value !== undefined) {
          if (typeof value === "object" && !Array.isArray(value)) {
            const cleaned = cleanObject(value);
            if (Object.keys(cleaned).length > 0) {
              result[key] = cleaned;
            }
          } else {
            result[key] = value;
          }
        }
      }
      return result;
    };
    
    const cleaned = cleanObject(parsed);
    
    // Validate against schema
    return validateIntakeData(cleaned);
  } catch (error) {
    console.error("Failed to parse call transcript:", error);
    return {};
  }
}

export function calculateMissingFields(intakeData: IntakeData): string[] {
  const missing: string[] = [];
  
  for (const field of REQUIRED_INTAKE_FIELDS) {
    const [section, key] = field.split(".");
    const sectionData = intakeData[section as keyof IntakeData];
    
    if (!sectionData || !(sectionData as any)[key]) {
      missing.push(field);
    }
  }
  
  return missing;
}

export function getFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    "callerInfo.name": "Caller's Name",
    "callerInfo.phone": "Caller's Phone",
    "callerInfo.relationship": "Relationship to Deceased",
    "deceasedInfo.fullName": "Deceased's Full Name",
    "deceasedInfo.dateOfDeath": "Date of Death",
    "deceasedInfo.currentLocation": "Current Location of Deceased",
    "servicePreferences.burialOrCremation": "Burial or Cremation Preference",
    "servicePreferences.religion": "Religion/Belief System",
  };
  return labels[field] || field;
}

export function mergeIntakeData(existing: IntakeData, newData: IntakeData): IntakeData {
  const deepMerge = (target: any, source: any): any => {
    if (!source) return target;
    if (!target) return source;
    
    const result = { ...target };
    
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined && value !== null) {
        if (typeof value === "object" && !Array.isArray(value)) {
          result[key] = deepMerge(result[key] || {}, value);
        } else {
          result[key] = value;
        }
      }
    }
    
    return result;
  };
  
  return deepMerge(existing, newData);
}

export async function parseMeetingTranscriptToIntake(
  transcript: string,
  summary?: string,
  actionItems?: string[]
): Promise<IntakeData> {
  const prompt = `You are analyzing a funeral arrangement meeting transcript between a funeral director and family members. This is an in-person meeting with more detailed information than a phone call.

EXTRACT ALL INFORMATION discussed in the meeting, including:

1. DECEASED INFORMATION:
   - Full legal name
   - Date of birth, date of death, age
   - Current location (hospital, home, hospice, morgue)
   - Cause of death if mentioned

2. CALLER/FAMILY INFORMATION:
   - Names of family members present
   - Relationship to deceased
   - Contact phone numbers and emails
   - Next of kin details

3. SERVICE PREFERENCES:
   - Burial vs cremation
   - Religion/faith tradition
   - Service type (full service, direct cremation, memorial)
   - Cemetery or crematorium preference
   - Urgency (24hr for Muslim/Jewish)

4. ADDITIONAL DETAILS:
   - Clothing/dressing preferences
   - Obituary details discussed
   - Flowers preferences
   - Music selections
   - Readings or poems
   - Reception/wake plans
   - Donations in lieu of flowers

TRANSCRIPT:
${transcript}

${summary ? `MEETING SUMMARY:\n${summary}` : ""}
${actionItems?.length ? `ACTION ITEMS:\n${actionItems.join("\n")}` : ""}

Return ONLY a valid JSON object with this structure (use null for fields not mentioned):
{
  "callerInfo": {
    "name": "primary contact's full name or null",
    "phone": "phone number or null",
    "relationship": "relationship to deceased or null",
    "email": "email address or null"
  },
  "deceasedInfo": {
    "fullName": "deceased person's full legal name or null",
    "dateOfDeath": "date of death in YYYY-MM-DD format or null",
    "dateOfBirth": "date of birth in YYYY-MM-DD format or null",
    "age": numeric age or null,
    "currentLocation": "where the body is or null",
    "causeOfDeath": "cause of death if mentioned or null"
  },
  "servicePreferences": {
    "burialOrCremation": "burial, cremation, or undecided or null",
    "religion": "religion or belief system or null",
    "subTradition": "specific denomination if mentioned or null",
    "urgency": "urgent-24hr (for Muslim or Jewish) or normal or null",
    "serviceType": "full service, direct cremation, memorial, graveside, etc. or null",
    "cemeteryOrCrematorium": "name of cemetery or crematorium or null",
    "clothing": "clothing preferences or null",
    "obituary": "obituary details or null",
    "flowers": "flower preferences or null",
    "music": "music selections or null",
    "readings": "readings or poems or null",
    "reception": "reception/wake details or null",
    "donations": "charity donations info or null"
  },
  "appointment": {
    "preferredDate": "next meeting date or null",
    "preferredTime": "next meeting time or null",
    "attendeeCount": numeric count or null
  }
}

Return ONLY the JSON object, no other text.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content?.trim() || "{}";
    
    let jsonStr = content;
    if (content.startsWith("```")) {
      jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    }
    
    const parsed = JSON.parse(jsonStr);
    
    const cleanObject = (obj: any): any => {
      if (obj === null || obj === undefined) return undefined;
      if (typeof obj !== "object") return obj;
      
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && value !== undefined) {
          if (typeof value === "object" && !Array.isArray(value)) {
            const cleaned = cleanObject(value);
            if (Object.keys(cleaned).length > 0) {
              result[key] = cleaned;
            }
          } else {
            result[key] = value;
          }
        }
      }
      return result;
    };
    
    const cleaned = cleanObject(parsed);
    return validateIntakeData(cleaned);
  } catch (error) {
    console.error("Failed to parse meeting transcript:", error);
    return {};
  }
}

export function generateIntakeDocument(caseData: any, intakeData: IntakeData): string {
  const now = new Date().toLocaleString();
  
  let doc = `# Intake Summary Document\n\n`;
  doc += `**Case:** ${caseData.deceasedName || "Unknown"}\n`;
  doc += `**Last Updated:** ${now}\n\n`;
  doc += `---\n\n`;
  
  // Deceased Information
  doc += `## Deceased Information\n\n`;
  if (intakeData.deceasedInfo) {
    const d = intakeData.deceasedInfo;
    if (d.fullName) doc += `- **Full Legal Name:** ${d.fullName}\n`;
    if (d.dateOfBirth) doc += `- **Date of Birth:** ${d.dateOfBirth}\n`;
    if (d.dateOfDeath) doc += `- **Date of Death:** ${d.dateOfDeath}\n`;
    if (d.age) doc += `- **Age:** ${d.age}\n`;
    if (d.currentLocation) doc += `- **Current Location:** ${d.currentLocation}\n`;
    if (d.causeOfDeath) doc += `- **Cause of Death:** ${d.causeOfDeath}\n`;
  }
  doc += `\n`;
  
  // Next of Kin / Caller Information
  doc += `## Next of Kin / Primary Contact\n\n`;
  if (intakeData.callerInfo) {
    const c = intakeData.callerInfo;
    if (c.name) doc += `- **Name:** ${c.name}\n`;
    if (c.relationship) doc += `- **Relationship:** ${c.relationship}\n`;
    if (c.phone) doc += `- **Phone:** ${c.phone}\n`;
    if (c.email) doc += `- **Email:** ${c.email}\n`;
  }
  doc += `\n`;
  
  // Service Preferences
  doc += `## Service Preferences\n\n`;
  if (intakeData.servicePreferences) {
    const s = intakeData.servicePreferences;
    if (s.religion) doc += `- **Religion:** ${s.religion}\n`;
    if (s.subTradition) doc += `- **Tradition:** ${s.subTradition}\n`;
    if (s.burialOrCremation) doc += `- **Disposition:** ${s.burialOrCremation}\n`;
    if (s.serviceType) doc += `- **Service Type:** ${s.serviceType}\n`;
    if (s.urgency) doc += `- **Urgency:** ${s.urgency === "urgent-24hr" ? "URGENT - 24 Hour Burial Required" : "Normal"}\n`;
    if (s.cemeteryOrCrematorium) doc += `- **Cemetery/Crematorium:** ${s.cemeteryOrCrematorium}\n`;
    if (s.clothing) doc += `- **Clothing:** ${s.clothing}\n`;
    if (s.obituary) doc += `- **Obituary:** ${s.obituary}\n`;
    if (s.flowers) doc += `- **Flowers:** ${s.flowers}\n`;
    if (s.music) doc += `- **Music:** ${s.music}\n`;
    if (s.readings) doc += `- **Readings:** ${s.readings}\n`;
    if (s.reception) doc += `- **Reception:** ${s.reception}\n`;
    if (s.donations) doc += `- **Donations:** ${s.donations}\n`;
  }
  doc += `\n`;
  
  // Appointment Info
  if (intakeData.appointment) {
    doc += `## Appointment\n\n`;
    const a = intakeData.appointment;
    if (a.preferredDate) doc += `- **Date:** ${a.preferredDate}\n`;
    if (a.preferredTime) doc += `- **Time:** ${a.preferredTime}\n`;
    if (a.attendeeCount) doc += `- **Attendees:** ${a.attendeeCount}\n`;
  }
  
  doc += `\n---\n\n`;
  doc += `*This document is automatically updated with each call and meeting interaction.*\n`;
  
  return doc;
}
