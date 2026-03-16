import Anthropic from "@anthropic-ai/sdk";
import { IntakeData, intakeDataSchema, REQUIRED_INTAKE_FIELDS } from "@shared/schema";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export function validateIntakeData(data: unknown): IntakeData {
  const result = intakeDataSchema.safeParse(data);
  if (result.success) return result.data;
  console.warn("Invalid intake data, defaulting to empty:", result.error.message);
  return {};
}

// ── Clean null/empty values from parsed AI output ──
function cleanObject(obj: any): any {
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
}

// ── Parse initial call transcript (simplified — full detail comes from meeting) ──
export async function parseCallTranscriptToIntake(
  transcript: string,
  summary?: string
): Promise<IntakeData> {
  console.log(`[intake-parser] parseCallTranscriptToIntake — length: ${transcript.length}`);

  const prompt = `You are a data extraction assistant for a funeral home. Extract structured information from the call transcript below.

EXTRACT THESE FIELDS IF MENTIONED:
1. deceasedInfo.fullName — name of the person who died
2. deceasedInfo.dateOfDeath — YYYY-MM-DD (convert relative dates using today's date)
3. deceasedInfo.dateOfBirth — YYYY-MM-DD if mentioned
4. deceasedInfo.placeOfDeath — where the body is (hospital, home, hospice, etc.)
5. deceasedInfo.religion — faith / religion mentioned
6. callerInfo.name — name of the person calling
7. callerInfo.phone — phone number spoken
8. callerInfo.relationship — how caller relates to deceased
9. callerInfo.email — email if given
10. funeralService.dispositionType — "burial", "cremation", or "repatriation" if mentioned
11. servicePreferences.burialOrCremation — same as above (legacy field)
12. servicePreferences.religion — same as religion (legacy field)
13. servicePreferences.urgency — "urgent-24hr" ONLY if Muslim or Jewish faith mentioned, else "normal"

TRANSCRIPT:
${transcript}

${summary ? `SUMMARY:\n${summary}` : ""}

Return ONLY valid JSON. Use null for any field not found. No commentary.
{
  "callerInfo": { "name": null, "phone": null, "relationship": null, "email": null },
  "deceasedInfo": { "fullName": null, "dateOfDeath": null, "dateOfBirth": null, "placeOfDeath": null, "religion": null },
  "funeralService": { "dispositionType": null },
  "servicePreferences": { "burialOrCremation": null, "religion": null, "urgency": null }
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0]?.type === "text" ? response.content[0].text.trim() : "{}";
    let jsonStr = content.includes("```") ? content.replace(/```json?\n?/g, "").replace(/```/g, "").trim() : content;
    const parsed = JSON.parse(jsonStr);
    const validated = validateIntakeData(cleanObject(parsed));
    console.log(`[intake-parser] call extracted — deceased: ${validated.deceasedInfo?.fullName ?? "null"}, caller: ${validated.callerInfo?.name ?? "null"}`);
    return validated;
  } catch (error: any) {
    console.error(`[intake-parser] parseCallTranscriptToIntake failed: ${error?.message}`);
    return {};
  }
}

// ── Calculate which required fields are still missing ──
export function calculateMissingFields(intakeData: IntakeData): string[] {
  const missing: string[] = [];
  for (const field of REQUIRED_INTAKE_FIELDS) {
    const parts = field.split(".");
    let value: any = intakeData;
    for (const part of parts) {
      value = value?.[part as keyof typeof value];
    }
    if (!value) missing.push(field);
  }
  return missing;
}

export function getFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    // Critical fields
    "deceasedInfo.fullName": "Deceased Full Name",
    "deceasedInfo.dateOfDeath": "Date of Death",
    "deceasedInfo.dateOfBirth": "Date of Birth",
    "deceasedInfo.religion": "Religion",
    "deceasedInfo.funeralType": "Funeral Type",
    "callerInfo.name": "Client / Next of Kin Name",
    "callerInfo.phone": "Client Phone Number",
    "callerInfo.relationship": "Relationship to Deceased",
    "deceasedInfo.placeOfDeath": "Place of Death",
    "funeralService.dispositionType": "Disposition Type (Burial/Cremation)",
    // Deceased details
    "deceasedInfo.title": "Title",
    "deceasedInfo.knownAs": "Known As",
    "deceasedInfo.prePaidPlan": "Pre-Paid Funeral Plan",
    "deceasedInfo.age": "Age",
    "deceasedInfo.gender": "Gender",
    "deceasedInfo.maritalStatus": "Marital Status",
    "deceasedInfo.occupation": "Occupation",
    "deceasedInfo.homePostcode": "Home Address",
    "deceasedInfo.placeOfDeathAddress": "Address of Place of Death",
    "deceasedInfo.gpName": "GP Name",
    "deceasedInfo.gpSurgery": "GP Surgery",
    // Client details
    "callerInfo.email": "Client Email",
    "callerInfo.addressPostcode": "Client Address",
    "callerInfo.funeralFinance": "Funeral Finance / Estimated Cost",
    // Funeral service
    "funeralService.serviceDate": "Service Date",
    "funeralService.officiant": "Officiant",
    "funeralService.venueName": "Venue / Church",
    // Legacy
    "servicePreferences.burialOrCremation": "Burial or Cremation Preference",
    "servicePreferences.religion": "Religion/Belief System",
    "deceasedInfo.currentLocation": "Current Location of Deceased",
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

// ── Full arrangement meeting parser — extracts ALL form fields ──
export async function parseMeetingTranscriptToIntake(
  transcript: string,
  summary?: string,
  actionItems?: string[]
): Promise<IntakeData> {
  console.log(`[intake-parser] parseMeetingTranscriptToIntake — length: ${transcript.length}`);

  const prompt = `You are a data extraction assistant for a UK funeral home. Extract ALL structured information from the arrangement meeting transcript below. This is the complete funeral arrangement form — extract every field you can find.

TODAY'S DATE: ${new Date().toISOString().split("T")[0]}

TRANSCRIPT:
${transcript}
${summary ? `\nMEETING SUMMARY:\n${summary}` : ""}
${actionItems?.length ? `\nACTION ITEMS:\n${actionItems.join("\n")}` : ""}

Extract the following fields. Use null for anything not mentioned. Convert all dates to YYYY-MM-DD format.

DECEASED DETAILS:
- deceasedInfo.title: Title (Mr/Mrs/Ms/Dr/Rev/etc.)
- deceasedInfo.fullName: Full legal name of deceased
- deceasedInfo.forenames: Forename(s) only
- deceasedInfo.surname: Surname only
- deceasedInfo.knownAs: Known as / preferred name
- deceasedInfo.prePaidPlan: Pre-paid funeral plan (Y/N)
- deceasedInfo.prePaidPlanRef: Pre-paid plan reference number
- deceasedInfo.dateOfBirth: Date of birth YYYY-MM-DD
- deceasedInfo.dateOfDeath: Date of death YYYY-MM-DD
- deceasedInfo.age: Age at time of death (number)
- deceasedInfo.gender: Gender (Male/Female/Other)
- deceasedInfo.religion: Religion or faith (e.g. Church of England, Catholic, Muslim, Jewish, Sikh, Hindu, Secular, Humanist)
- deceasedInfo.maritalStatus: Marital status (Single/Married/Widowed/Divorced/Separated/Civil Partnership)
- deceasedInfo.occupation: Occupation / former occupation
- deceasedInfo.dateOfRegistration: Date of death registration YYYY-MM-DD
- deceasedInfo.funeralType: Funeral type — one of: Adult Standard / Adult Pre-Paid / Attended-CMA / Unattended-CMA / Unattended-Other / Child / Repatriation / Environmental
- deceasedInfo.homeStreet: Home address — street
- deceasedInfo.homeTown: Home address — town/city
- deceasedInfo.homeCounty: Home address — county
- deceasedInfo.homePostcode: Home address — postcode
- deceasedInfo.homeCountry: Home address — country (default UK)
- deceasedInfo.placeOfDeath: Place of death (hospital name, "at home", hospice, care home, etc.)
- deceasedInfo.placeOfDeathAddress: Full address of place of death
- deceasedInfo.gpName: Deceased's GP doctor name
- deceasedInfo.gpSurgery: GP surgery name and address
- deceasedInfo.currentLocation: Where the body currently is (same as placeOfDeath if not moved yet)

CLIENT / NEXT OF KIN DETAILS:
- callerInfo.title: Client title
- callerInfo.name: Client full name (primary contact / next of kin)
- callerInfo.forenames: Client forename(s)
- callerInfo.surname: Client surname
- callerInfo.relationship: Relationship to deceased (Son/Daughter/Spouse/Husband/Wife/Brother/Sister/Friend/etc.)
- callerInfo.addressStreet: Client address — street
- callerInfo.addressTown: Client address — town
- callerInfo.addressCounty: Client address — county
- callerInfo.addressPostcode: Client address — postcode
- callerInfo.addressCountry: Client address — country
- callerInfo.phone: Client main phone number
- callerInfo.phoneMobile: Client mobile number
- callerInfo.phoneHome: Client home phone number
- callerInfo.email: Client email address
- callerInfo.marketingPreferences: Marketing preferences (Telephone/Email/Postal/None)
- callerInfo.governmentSupport: Government support (DWP/SSS/None)
- callerInfo.funeralFinance: Funeral finance arrangement (Yes/No + provider)
- callerInfo.estimatedCost: Estimated cost discussed
- callerInfo.probate: Probate required (Yes/No)
- callerInfo.masonry: Masonry details if mentioned

BILLING DETAILS:
- billing.name: Billing contact full name (if different from client)
- billing.address: Billing address
- billing.phoneHome: Billing home phone
- billing.phoneMobile: Billing mobile
- billing.phoneWork: Billing work phone
- billing.email: Billing email
- billing.vulnerableClient: Vulnerable client assessment (YES/NO + type if yes)

FUNERAL SOURCE:
- funeralSource.source: How they found the funeral home (Recommended by Professional / Used Before / Location/Reputation / Friends/Family / Pre-Paid Plan / Other)

PREPARATION:
- preparation.cremationForms: Cremation forms required (Doctor 1 / Medical Examiner / Coroner / N/A)
- preparation.doctorName: Doctor name for forms
- preparation.doctorAddress: Doctor address
- preparation.removeFromLocation: Where/when to collect the deceased
- preparation.embalming: Embalming required (Yes/No + details)
- preparation.infectiousDetails: Infectious / hazard details
- preparation.pacemakerImplant: Pacemaker or implant present (Yes/No + type)
- preparation.bodySize: Body size notes
- preparation.coffinSize: Coffin size
- preparation.coffinType: Coffin or casket type/style
- preparation.urnType: Urn type (if cremation)
- preparation.coffinPlateText: Text for coffin nameplate
- preparation.dressed: Dressing instructions (Own Clothes / Gown + colour description)
- preparation.viewingRequested: Viewing requested (YES/NO)
- preparation.viewingDateTime: Viewing date and time
- preparation.viewingRestrictions: Any viewing restrictions
- preparation.jewellery: Jewellery instructions (Remove / Remain / specific items)
- preparation.graveDetails: Grave size, type, reference number
- preparation.dispositionOfAshes: What to do with ashes

FUNERAL SERVICE:
- funeralService.dispositionType: Burial / Cremation / Repatriation
- funeralService.serviceDate: Service date YYYY-MM-DD
- funeralService.serviceTime: Service time (HH:MM)
- funeralService.commitalDate: Committal date YYYY-MM-DD
- funeralService.commitalTime: Committal time
- funeralService.officiant: Officiant name and type (vicar, celebrant, rabbi, imam, humanist, etc.)
- funeralService.venueName: Church / chapel / crematorium / venue name
- funeralService.venueDenomination: Denomination (e.g. Church of England, Catholic, Non-denominational)
- funeralService.venueAddress: Venue address
- funeralService.hearseType: Hearse type (Traditional / Horse-drawn / Bespoke)
- funeralService.limousines: Limousines required (number and type)
- funeralService.leavingFrom: Cortège leaving from (address)
- funeralService.routeVia: Route via (specific roads or locations)
- funeralService.commitalAt: Committal at (crematorium/cemetery name)
- funeralService.returningTo: Returning to (if applicable)
- funeralService.music: Music arrangements (Organist / Wesley / Obitus / CDs + specific pieces)
- funeralService.flowersAccepted: Flowers accepted (Yes / No / Family Only)
- funeralService.flowersDelivery: Flower delivery details
- funeralService.flowerNotes: Flower notes and preferences

ORDERS OF SERVICE:
- ordersOfService.quantity: Number of orders of service required
- ordersOfService.styleDesign: Style or design chosen
- ordersOfService.photos: Photos included (Yes/No)

DONATIONS:
- donations.requested: Donations in lieu of flowers (Yes/No)
- donations.closingDate: Donation closing date
- donations.recipients: Charity/charities to receive donations (up to 3)

ONLINE TRIBUTE:
- onlineTribute.requested: Online tribute requested (Yes/No)
- onlineTribute.setupBy: Who sets it up
- onlineTribute.notes: Online tribute notes

NEWSPAPER NOTICES:
- newspaperNotices.entries: Describe each notice (newspaper name, insertion date, price)

GENERAL:
- additionalServices: Additional services discussed (doves, catering, live streaming, etc.)
- generalNotes: Any other general notes from the meeting

LEGACY FIELDS (also populate these for backward compatibility):
- servicePreferences.burialOrCremation: same as funeralService.dispositionType (burial/cremation/undecided)
- servicePreferences.religion: same as deceasedInfo.religion
- servicePreferences.urgency: "urgent-24hr" if Muslim or Jewish faith mentioned, otherwise "normal"
- servicePreferences.cemeteryOrCrematorium: cemetery or crematorium name
- servicePreferences.music: music selections
- servicePreferences.flowers: flower preferences
- servicePreferences.readings: readings or poems
- servicePreferences.clothing: clothing preferences
- servicePreferences.donations: donation details

Return ONLY a valid JSON object with this exact structure. Use null for any field not found:
{
  "deceasedInfo": {
    "title": null, "fullName": null, "forenames": null, "surname": null, "knownAs": null,
    "prePaidPlan": null, "prePaidPlanRef": null, "dateOfBirth": null, "dateOfDeath": null,
    "age": null, "gender": null, "religion": null, "maritalStatus": null, "occupation": null,
    "dateOfRegistration": null, "funeralType": null,
    "homeStreet": null, "homeTown": null, "homeCounty": null, "homePostcode": null, "homeCountry": null,
    "placeOfDeath": null, "placeOfDeathAddress": null, "gpName": null, "gpSurgery": null,
    "currentLocation": null, "causeOfDeath": null
  },
  "callerInfo": {
    "title": null, "name": null, "forenames": null, "surname": null, "relationship": null,
    "addressStreet": null, "addressTown": null, "addressCounty": null, "addressPostcode": null, "addressCountry": null,
    "phone": null, "phoneMobile": null, "phoneHome": null, "email": null,
    "marketingPreferences": null, "governmentSupport": null,
    "funeralFinance": null, "estimatedCost": null, "probate": null, "masonry": null
  },
  "billing": {
    "name": null, "address": null, "phoneHome": null, "phoneMobile": null, "phoneWork": null,
    "email": null, "vulnerableClient": null
  },
  "funeralSource": { "source": null },
  "preparation": {
    "cremationForms": null, "doctorName": null, "doctorAddress": null, "removeFromLocation": null,
    "embalming": null, "infectiousDetails": null, "pacemakerImplant": null,
    "bodySize": null, "coffinSize": null, "coffinType": null, "urnType": null,
    "coffinPlateText": null, "dressed": null, "viewingRequested": null, "viewingDateTime": null,
    "viewingRestrictions": null, "jewellery": null, "graveDetails": null, "dispositionOfAshes": null
  },
  "funeralService": {
    "dispositionType": null, "serviceDate": null, "serviceTime": null,
    "commitalDate": null, "commitalTime": null, "officiant": null,
    "venueName": null, "venueDenomination": null, "venueAddress": null,
    "hearseType": null, "limousines": null,
    "leavingFrom": null, "routeVia": null, "commitalAt": null, "returningTo": null,
    "music": null, "flowersAccepted": null, "flowersDelivery": null, "flowerNotes": null
  },
  "ordersOfService": { "quantity": null, "styleDesign": null, "photos": null },
  "donations": { "requested": null, "closingDate": null, "recipients": null },
  "onlineTribute": { "requested": null, "setupBy": null, "notes": null },
  "newspaperNotices": { "entries": null },
  "servicePreferences": {
    "burialOrCremation": null, "religion": null, "urgency": null,
    "cemeteryOrCrematorium": null, "music": null, "flowers": null,
    "readings": null, "clothing": null, "donations": null, "serviceType": null
  },
  "additionalServices": null,
  "generalNotes": null
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0]?.type === "text" ? response.content[0].text.trim() : "{}";
    console.log(`[intake-parser] raw Anthropic response (first 500 chars): ${content.substring(0, 500)}`);
    let jsonStr = content.includes("```") ? content.replace(/```json?\n?/g, "").replace(/```/g, "").trim() : content;
    const parsed = JSON.parse(jsonStr);
    const cleaned = cleanObject(parsed);
    const validated = validateIntakeData(cleaned);
    console.log(`[intake-parser] after cleanObject — non-null fields: ${JSON.stringify(cleaned).substring(0, 300)}`);
    console.log(`[intake-parser] meeting extracted — deceased: ${validated.deceasedInfo?.fullName ?? "null"}, dod: ${validated.deceasedInfo?.dateOfDeath ?? "null"}, disposition: ${validated.funeralService?.dispositionType ?? "null"}, religion: ${validated.deceasedInfo?.religion ?? "null"}, funeralType: ${validated.deceasedInfo?.funeralType ?? "null"}`);
    return validated;
  } catch (error: any) {
    console.error(`[intake-parser] parseMeetingTranscriptToIntake failed: ${error?.message}`);
    return {};
  }
}

export function generateIntakeDocument(caseData: any, intakeData: IntakeData): string {
  const now = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
  const has = (v: any): boolean =>
    v !== null && v !== undefined && v !== "" && v !== "Not provided" && v !== "Unknown";

  const lines: string[] = [];
  const div = "─".repeat(56);

  const addSection = (title: string, fields: Array<[string, any]>) => {
    const validFields = fields.filter(([, v]) => has(v));
    if (validFields.length === 0) return;
    lines.push(div);
    lines.push(`  ${title}`);
    lines.push(div);
    for (const [label, value] of validFields) {
      lines.push(`  ${(label + ":").padEnd(28)} ${value}`);
    }
    lines.push("");
  };

  // Header
  lines.push("╔" + "═".repeat(54) + "╗");
  lines.push("║" + "  FUNERAL ARRANGEMENT — INTAKE RECORD".padEnd(54) + "║");
  lines.push("╚" + "═".repeat(54) + "╝");
  lines.push("");
  lines.push(`  Prepared:  ${now}`);
  lines.push(`  Case Ref:  ${caseData.id || "—"}  |  Status: ${(caseData.status || "active").toUpperCase()}`);
  lines.push("");

  const d = intakeData.deceasedInfo || {};
  const homeAddr = [d.homeStreet, d.homeTown, d.homeCounty, d.homePostcode, d.homeCountry].filter(has).join(", ");

  addSection("DECEASED DETAILS", [
    ["Full Name", d.fullName || caseData.deceasedName],
    ["Known As", d.knownAs],
    ["Title", d.title],
    ["Gender", d.gender],
    ["Date of Birth", d.dateOfBirth],
    ["Date of Death", d.dateOfDeath],
    ["Age", d.age],
    ["Marital Status", d.maritalStatus],
    ["Occupation", d.occupation],
    ["Religion", d.religion],
    ["Funeral Type", d.funeralType],
    ["Place of Death", d.placeOfDeath],
    ["Address of Place of Death", d.placeOfDeathAddress],
    ["Current Location", d.currentLocation],
    ["Cause of Death", d.causeOfDeath],
    ["Home Address", homeAddr || null],
    ["GP Name", d.gpName],
    ["GP Surgery", d.gpSurgery],
    ["Pre-paid Plan", d.prePaidPlan],
    ["Pre-paid Reference", d.prePaidPlanRef],
    ["Date of Registration", d.dateOfRegistration],
  ]);

  const c = intakeData.callerInfo || {};
  const clientAddr = [c.addressStreet, c.addressTown, c.addressCounty, c.addressPostcode, c.addressCountry].filter(has).join(", ");
  addSection("NEXT OF KIN / CLIENT", [
    ["Name", c.name ? [c.title, c.name].filter(has).join(" ") : undefined],
    ["Forenames", c.forenames],
    ["Surname", c.surname],
    ["Relationship", c.relationship],
    ["Phone", c.phone],
    ["Mobile", c.phoneMobile],
    ["Home Phone", c.phoneHome],
    ["Email", c.email],
    ["Address", clientAddr || null],
    ["Marketing Preferences", c.marketingPreferences],
    ["Government Support", c.governmentSupport],
    ["Funeral Finance", c.funeralFinance],
    ["Estimated Cost", c.estimatedCost],
    ["Probate Required", c.probate],
    ["Masonry", c.masonry],
  ]);

  const b = intakeData.billing || {};
  addSection("BILLING DETAILS", [
    ["Billing Contact", b.name ? [b.title, b.name].filter(has).join(" ") : undefined],
    ["Address", b.address],
    ["Home Phone", b.phoneHome],
    ["Mobile", b.phoneMobile],
    ["Work Phone", b.phoneWork],
    ["Email", b.email],
    ["Vulnerable Client", b.vulnerableClient],
  ]);

  const fsrc = (intakeData as any).funeralSource || {};
  addSection("FUNERAL SOURCE", [
    ["How They Found Us", fsrc.source],
    ["Details", fsrc.details],
  ]);

  const p = intakeData.preparation || {};
  addSection("PREPARATION", [
    ["Cremation Forms", p.cremationForms],
    ["Doctor Name", p.doctorName],
    ["Doctor Address", p.doctorAddress],
    ["Remove From Location", p.removeFromLocation],
    ["Embalming", p.embalming],
    ["Infectious / Hazard Details", p.infectiousDetails],
    ["Pacemaker / Implant", p.pacemakerImplant],
    ["Body Size", p.bodySize],
    ["Coffin Size", p.coffinSize],
    ["Coffin Type", p.coffinType],
    ["Urn Type", p.urnType],
    ["Coffin Plate Text", p.coffinPlateText],
    ["Dressing", p.dressed],
    ["Care Progress", p.careProgress],
    ["Viewing Requested", p.viewingRequested],
    ["Viewing Date / Time", p.viewingDateTime],
    ["Viewing Restrictions", p.viewingRestrictions],
    ["Jewellery", p.jewellery],
    ["Grave Details", p.graveDetails],
    ["Disposition of Ashes", p.dispositionOfAshes],
  ]);

  const s = intakeData.funeralService || {};
  addSection("FUNERAL SERVICE", [
    ["Disposition", s.dispositionType],
    ["Service Date", s.serviceDate ? `${s.serviceDate}${s.serviceTime ? " at " + s.serviceTime : ""}` : undefined],
    ["Committal Date", s.commitalDate ? `${s.commitalDate}${s.commitalTime ? " at " + s.commitalTime : ""}` : undefined],
    ["Venue", s.venueName],
    ["Venue Denomination", s.venueDenomination],
    ["Venue Address", s.venueAddress],
    ["Officiant", s.officiant],
    ["Hearse Type", s.hearseType],
    ["Limousines", s.limousines],
    ["Leaving From", s.leavingFrom],
    ["Route Via", s.routeVia],
    ["Committal At", s.commitalAt],
    ["Returning To", s.returningTo],
    ["Music", s.music],
    ["Flowers Accepted", s.flowersAccepted],
    ["Flower Delivery", s.flowersDelivery],
    ["Flower Notes", s.flowerNotes],
  ]);

  const o = intakeData.ordersOfService || {};
  addSection("ORDERS OF SERVICE", [
    ["Quantity", o.quantity],
    ["Style / Design", o.styleDesign],
    ["Photos Included", o.photos],
    ["Sent to Printer", o.sentToPrinter],
    ["Proof Received", o.proofReceived],
    ["Proof Approved", o.proofApproved],
    ["Order Confirmed", o.orderConfirmed],
    ["Order Received", o.orderReceived],
  ]);

  const don = intakeData.donations || {};
  addSection("DONATIONS", [
    ["Donations Requested", don.requested],
    ["Closing Date", don.closingDate],
    ["Recipients", don.recipients],
  ]);

  const ot = intakeData.onlineTribute || {};
  addSection("ONLINE TRIBUTE", [
    ["Requested", ot.requested],
    ["Set Up By", ot.setupBy],
    ["Notes", ot.notes],
  ]);

  const nn = intakeData.newspaperNotices || {};
  addSection("NEWSPAPER NOTICES", [
    ["Notices", nn.entries],
  ]);

  const sp = intakeData.servicePreferences || {};
  addSection("SERVICE PREFERENCES", [
    ["Burial / Cremation", sp.burialOrCremation],
    ["Religion", sp.religion],
    ["Service Type", sp.serviceType],
    ["Cemetery / Crematorium", sp.cemeteryOrCrematorium],
    ["Clothing", sp.clothing],
    ["Flowers", sp.flowers],
    ["Music", sp.music],
    ["Readings", sp.readings],
    ["Obituary", sp.obituary],
    ["Donations", sp.donations],
    ["Reception", sp.reception],
  ]);

  if (has(intakeData.additionalServices)) {
    lines.push(div);
    lines.push("  ADDITIONAL SERVICES");
    lines.push(div);
    lines.push(`  ${intakeData.additionalServices}`);
    lines.push("");
  }

  const notes = [intakeData.generalNotes, caseData.notes].filter(has);
  if (notes.length > 0) {
    lines.push(div);
    lines.push("  NOTES");
    lines.push(div);
    for (const n of notes) lines.push(`  ${n}`);
    lines.push("");
  }

  lines.push(div);
  lines.push(`  Document generated by xFunerals · ${now}`);
  lines.push(div);

  return lines.join("\n");
}
