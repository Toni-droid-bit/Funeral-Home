import Anthropic from "@anthropic-ai/sdk";
import { IntakeData, intakeDataSchema, REQUIRED_INTAKE_FIELDS } from "@shared/schema";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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
  console.log(`[intake-parser] parseCallTranscriptToIntake — transcript length: ${transcript.length}`);

  const prompt = `You are a data extraction assistant for a funeral home. Extract structured information from the call transcript below.

YOU MUST EXTRACT THESE 5 FIELDS IF MENTIONED — do not leave them null if the information appears anywhere in the text:
1. deceasedInfo.fullName — the name of the person who died (look for phrases like "my mother Margaret", "for John Smith", "he was called...", "her name is...")
2. deceasedInfo.dateOfDeath — when they died. If they say "today", "yesterday", "this morning" or a relative date, convert to YYYY-MM-DD using today's approximate date
3. callerInfo.name — the name of the person calling (look for "my name is", "this is", "I'm calling on behalf of", "I'm [name]")
4. callerInfo.phone — any phone number spoken in the call (keep digits, spaces, plus signs — e.g. "07722 387530" or "+44 7722 387530")
5. deceasedInfo.currentLocation — where the body is right now (hospital name, home address, hospice, care home, morgue, coroner, etc.)

TRANSCRIPT:
${transcript}

${summary ? `SUMMARY:\n${summary}` : ""}

ADDITIONAL FIELDS TO EXTRACT IF PRESENT:
- callerInfo.relationship — how the caller relates to the deceased (son, daughter, spouse, sibling, friend, etc.)
- callerInfo.email — email address if mentioned
- deceasedInfo.dateOfBirth — date of birth if mentioned
- deceasedInfo.age — age of deceased if mentioned
- deceasedInfo.causeOfDeath — cause of death if mentioned
- servicePreferences.burialOrCremation — burial or cremation preference (default to burial for Muslim/Jewish)
- servicePreferences.religion — any religion or faith mentioned (Muslim, Jewish, Christian, Catholic, Hindu, Sikh, Secular, etc.)
- servicePreferences.urgency — set to "urgent-24hr" ONLY if Muslim or Jewish faith is mentioned, otherwise "normal"
- servicePreferences.serviceType — type of service requested
- appointment.preferredDate / appointment.preferredTime — any requested meeting time

Return ONLY a valid JSON object. Use null for any field not found. Do not add commentary.
{
  "callerInfo": {
    "name": "string or null",
    "phone": "string or null",
    "relationship": "string or null",
    "email": "string or null"
  },
  "deceasedInfo": {
    "fullName": "string or null",
    "dateOfDeath": "YYYY-MM-DD or null",
    "dateOfBirth": "YYYY-MM-DD or null",
    "age": number or null,
    "currentLocation": "string or null",
    "causeOfDeath": "string or null"
  },
  "servicePreferences": {
    "burialOrCremation": "burial or cremation or undecided or null",
    "religion": "string or null",
    "subTradition": "string or null",
    "urgency": "urgent-24hr or normal or null",
    "serviceType": "string or null"
  },
  "appointment": {
    "preferredDate": "string or null",
    "preferredTime": "string or null",
    "attendeeCount": number or null
  }
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0]?.type === "text" ? response.content[0].text.trim() : "{}";
    console.log(`[intake-parser] raw AI response: ${content.substring(0, 300)}`);

    // Strip markdown code fences if present
    let jsonStr = content;
    if (content.includes("```")) {
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
            if (Object.keys(cleaned).length > 0) result[key] = cleaned;
          } else {
            result[key] = value;
          }
        }
      }
      return result;
    };

    const cleaned = cleanObject(parsed);
    const validated = validateIntakeData(cleaned);
    console.log(`[intake-parser] extracted — deceasedName: ${validated.deceasedInfo?.fullName ?? "null"}, callerName: ${validated.callerInfo?.name ?? "null"}, phone: ${validated.callerInfo?.phone ?? "null"}, dod: ${validated.deceasedInfo?.dateOfDeath ?? "null"}, location: ${validated.deceasedInfo?.currentLocation ?? "null"}`);
    return validated;
  } catch (error: any) {
    console.error(`[intake-parser] parseCallTranscriptToIntake failed: ${error?.message || error}`);
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
  console.log(`[intake-parser] parseMeetingTranscriptToIntake — transcript length: ${transcript.length}`);

  const prompt = `You are a data extraction assistant for a funeral home. Extract structured information from the arrangement meeting transcript below.

YOU MUST EXTRACT THESE 10 FIELDS IF MENTIONED — do not leave them null if the information appears anywhere in the text:

1. deceasedInfo.fullName — the full legal name of the person who died (look for "the deceased is", "her name was", "his name is", "for [name]", "about [name]")
2. deceasedInfo.dateOfDeath — when they died, in YYYY-MM-DD format. Convert relative dates ("yesterday", "last Tuesday", "02/21/2026") to ISO format
3. deceasedInfo.dateOfBirth — date of birth in YYYY-MM-DD format if mentioned
4. callerInfo.name — the name of the primary family contact or next of kin present (look for "my name is", "I'm [name]", "the next of kin is", "authorized person is")
5. callerInfo.relationship — how the primary contact relates to the deceased (son, daughter, spouse, husband, wife, brother, sister, mother, father, friend, etc.)
6. callerInfo.phone — any phone number spoken or mentioned (keep digits, spaces, plus signs — e.g. "07722 387530" or "+44 7722 387530")
7. deceasedInfo.currentLocation — where the body is right now (hospital name, home address, care home name, hospice, coroner, mortuary, etc.)
8. servicePreferences.religion — any religion or faith mentioned (Muslim, Islamic, Jewish, Christian, Catholic, Church of England, Hindu, Sikh, Secular, Humanist, etc.)
9. servicePreferences.burialOrCremation — "burial" or "cremation" or "undecided". Default to "burial" if Muslim or Jewish faith is mentioned
10. servicePreferences.urgency — set to "urgent-24hr" if Muslim or Jewish faith is mentioned anywhere in the transcript, otherwise "normal"

TRANSCRIPT:
${transcript}

${summary ? `MEETING SUMMARY:\n${summary}` : ""}
${actionItems?.length ? `ACTION ITEMS:\n${actionItems.join("\n")}` : ""}

ADDITIONAL FIELDS TO EXTRACT IF PRESENT:
- deceasedInfo.age — numeric age of deceased
- deceasedInfo.causeOfDeath — cause of death if mentioned
- callerInfo.email — email address if mentioned
- servicePreferences.subTradition — specific denomination (e.g. Sunni, Shia, Catholic, Baptist)
- servicePreferences.serviceType — full service, direct cremation, memorial, graveside, etc.
- servicePreferences.cemeteryOrCrematorium — name of cemetery or crematorium
- servicePreferences.clothing — clothing or dressing preferences for the deceased
- servicePreferences.obituary — any obituary details discussed (birthplace, occupation, family members)
- servicePreferences.flowers — flower preferences
- servicePreferences.music — music selections
- servicePreferences.readings — readings or poems
- servicePreferences.reception — reception or wake details
- servicePreferences.donations — charity donations in lieu of flowers
- appointment.preferredDate — next meeting or service date
- appointment.preferredTime — next meeting or service time
- appointment.attendeeCount — expected number of attendees

Return ONLY a valid JSON object. Use null for any field not found. Do not add commentary or markdown.
{
  "callerInfo": {
    "name": "string or null",
    "phone": "string or null",
    "relationship": "string or null",
    "email": "string or null"
  },
  "deceasedInfo": {
    "fullName": "string or null",
    "dateOfDeath": "YYYY-MM-DD or null",
    "dateOfBirth": "YYYY-MM-DD or null",
    "age": number or null,
    "currentLocation": "string or null",
    "causeOfDeath": "string or null"
  },
  "servicePreferences": {
    "burialOrCremation": "burial or cremation or undecided or null",
    "religion": "string or null",
    "subTradition": "string or null",
    "urgency": "urgent-24hr or normal or null",
    "serviceType": "string or null",
    "cemeteryOrCrematorium": "string or null",
    "clothing": "string or null",
    "obituary": "string or null",
    "flowers": "string or null",
    "music": "string or null",
    "readings": "string or null",
    "reception": "string or null",
    "donations": "string or null"
  },
  "appointment": {
    "preferredDate": "string or null",
    "preferredTime": "string or null",
    "attendeeCount": number or null
  }
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0]?.type === "text" ? response.content[0].text.trim() : "{}";
    console.log(`[intake-parser] meeting raw AI response: ${content.substring(0, 300)}`);

    let jsonStr = content;
    if (content.includes("```")) {
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
            if (Object.keys(cleaned).length > 0) result[key] = cleaned;
          } else {
            result[key] = value;
          }
        }
      }
      return result;
    };

    const cleaned = cleanObject(parsed);
    const validated = validateIntakeData(cleaned);
    console.log(`[intake-parser] meeting extracted — deceasedName: ${validated.deceasedInfo?.fullName ?? "null"}, dod: ${validated.deceasedInfo?.dateOfDeath ?? "null"}, dob: ${validated.deceasedInfo?.dateOfBirth ?? "null"}, callerName: ${validated.callerInfo?.name ?? "null"}, relationship: ${validated.callerInfo?.relationship ?? "null"}, phone: ${validated.callerInfo?.phone ?? "null"}, location: ${validated.deceasedInfo?.currentLocation ?? "null"}, religion: ${validated.servicePreferences?.religion ?? "null"}, disposition: ${validated.servicePreferences?.burialOrCremation ?? "null"}, urgency: ${validated.servicePreferences?.urgency ?? "null"}`);
    return validated;
  } catch (error: any) {
    console.error(`[intake-parser] parseMeetingTranscriptToIntake failed: ${error?.message || error}`);
    return {};
  }
}

export function generateIntakeDocument(caseData: any, intakeData: IntakeData): string {
  const now = new Date().toLocaleString();

  let doc = `INTAKE SUMMARY DOCUMENT\n\n`;
  doc += `Case: ${caseData.deceasedName || "Unknown"}\n`;
  doc += `Last Updated: ${now}\n\n`;

  doc += `DECEASED INFORMATION\n`;
  if (intakeData.deceasedInfo) {
    const d = intakeData.deceasedInfo;
    if (d.fullName) doc += `Full Legal Name: ${d.fullName}\n`;
    if (d.dateOfBirth) doc += `Date of Birth: ${d.dateOfBirth}\n`;
    if (d.dateOfDeath) doc += `Date of Death: ${d.dateOfDeath}\n`;
    if (d.age) doc += `Age: ${d.age}\n`;
    if (d.currentLocation) doc += `Current Location: ${d.currentLocation}\n`;
    if (d.causeOfDeath) doc += `Cause of Death: ${d.causeOfDeath}\n`;
  }
  doc += `\n`;

  doc += `NEXT OF KIN / PRIMARY CONTACT\n`;
  if (intakeData.callerInfo) {
    const c = intakeData.callerInfo;
    if (c.name) doc += `Name: ${c.name}\n`;
    if (c.relationship) doc += `Relationship: ${c.relationship}\n`;
    if (c.phone) doc += `Phone: ${c.phone}\n`;
    if (c.email) doc += `Email: ${c.email}\n`;
  }
  doc += `\n`;

  doc += `SERVICE PREFERENCES\n`;
  if (intakeData.servicePreferences) {
    const s = intakeData.servicePreferences;
    if (s.religion) doc += `Religion: ${s.religion}\n`;
    if (s.subTradition) doc += `Tradition: ${s.subTradition}\n`;
    if (s.burialOrCremation) doc += `Disposition: ${s.burialOrCremation}\n`;
    if (s.serviceType) doc += `Service Type: ${s.serviceType}\n`;
    if (s.urgency) doc += `Urgency: ${s.urgency === "urgent-24hr" ? "URGENT - 24 Hour Burial Required" : "Normal"}\n`;
    if (s.cemeteryOrCrematorium) doc += `Cemetery/Crematorium: ${s.cemeteryOrCrematorium}\n`;
    if (s.clothing) doc += `Clothing: ${s.clothing}\n`;
    if (s.obituary) doc += `Obituary: ${s.obituary}\n`;
    if (s.flowers) doc += `Flowers: ${s.flowers}\n`;
    if (s.music) doc += `Music: ${s.music}\n`;
    if (s.readings) doc += `Readings: ${s.readings}\n`;
    if (s.reception) doc += `Reception: ${s.reception}\n`;
    if (s.donations) doc += `Donations: ${s.donations}\n`;
  }
  doc += `\n`;

  if (intakeData.appointment) {
    doc += `APPOINTMENT\n`;
    const a = intakeData.appointment;
    if (a.preferredDate) doc += `Date: ${a.preferredDate}\n`;
    if (a.preferredTime) doc += `Time: ${a.preferredTime}\n`;
    if (a.attendeeCount) doc += `Attendees: ${a.attendeeCount}\n`;
  }

  doc += `\nThis document is automatically updated with each call and meeting interaction.\n`;

  return doc;
}
