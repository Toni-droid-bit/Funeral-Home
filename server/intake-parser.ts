import OpenAI from "openai";
import { IntakeData, intakeDataSchema, REQUIRED_INTAKE_FIELDS } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
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
