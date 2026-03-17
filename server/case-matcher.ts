import type { Case } from "@shared/schema";
import { storage } from "./storage";
import { mergeIntakeData, calculateMissingFields } from "./intake-parser";
import type { IntakeData } from "@shared/schema";

export interface CaseMatchResult {
  matchedCase: Case;
  isMultipleMatches: boolean;
}

/**
 * Given an extracted deceased name, search for existing cases.
 * Returns the best match (most recently created) and whether there were multiple candidates.
 * Returns null if no match found or name is unknown.
 */
export async function findMatchingCase(deceasedName: string): Promise<CaseMatchResult | null> {
  if (!deceasedName || deceasedName === "Unknown (Pending)" || deceasedName === "<UNKNOWN>") {
    return null;
  }

  const candidates = await storage.findCasesByDeceasedName(deceasedName);

  // Filter out placeholder cases
  const realCandidates = candidates.filter(
    c => c.deceasedName !== "Unknown (Pending)" && c.deceasedName !== "<UNKNOWN>"
  );

  if (realCandidates.length === 0) return null;

  // Most recently created is first (storage orders by createdAt desc)
  return {
    matchedCase: realCandidates[0],
    isMultipleMatches: realCandidates.length > 1,
  };
}

/**
 * Merge new intake data into an existing case and persist the update.
 * If isMultipleMatches, appends a verification warning to the case notes.
 */
export async function applyIntakeToExistingCase(
  existingCase: Case,
  intakeData: IntakeData,
  isMultipleMatches: boolean,
  sourceLabel: string, // e.g. "call" or "meeting"
  sourceDate: Date
): Promise<Case> {
  const currentIntake = (existingCase.intakeData as IntakeData) || {};
  const mergedIntake = mergeIntakeData(currentIntake, intakeData);

  // If the new caller differs from the primary contact, add them as an additional contact
  const newCaller = intakeData.callerInfo;
  const primaryCaller = currentIntake.callerInfo;
  const existingAdditional: any[] = (currentIntake as any).additionalContacts || [];
  if (newCaller?.name) {
    const isPrimary = primaryCaller && (
      (primaryCaller.name && newCaller.name && primaryCaller.name.toLowerCase() === newCaller.name.toLowerCase()) ||
      (primaryCaller.phone && newCaller.phone && primaryCaller.phone === newCaller.phone)
    );
    const isDuplicate = existingAdditional.some((c: any) =>
      (c.name && newCaller.name && c.name.toLowerCase() === newCaller.name.toLowerCase()) ||
      (c.phone && newCaller.phone && c.phone === newCaller.phone)
    );
    if (!isPrimary && !isDuplicate) {
      (mergedIntake as any).additionalContacts = [...existingAdditional, newCaller];
    }
  }

  const newMissingFields = calculateMissingFields(mergedIntake);

  const updates: any = {
    intakeData: mergedIntake,
    missingFields: newMissingFields,
  };

  // Promote deceased name from placeholder
  if (
    intakeData.deceasedInfo?.fullName &&
    (existingCase.deceasedName === "Unknown (Pending)" || !existingCase.deceasedName)
  ) {
    updates.deceasedName = intakeData.deceasedInfo.fullName;
  }

  // Promote religion from placeholder
  if (
    intakeData.servicePreferences?.religion &&
    (existingCase.religion === "Unknown" || !existingCase.religion)
  ) {
    updates.religion = intakeData.servicePreferences.religion;
  }

  // Append a verification note when there were multiple name matches
  if (isMultipleMatches) {
    const dateStr = sourceDate.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const warning = `⚠️ Matched from ${sourceLabel} on ${dateStr} — please verify this is the correct case`;
    updates.notes = existingCase.notes
      ? `${existingCase.notes}\n\n${warning}`
      : warning;
  }

  await storage.updateCase(existingCase.id, updates);

  const updated = await storage.getCase(existingCase.id);
  return updated || existingCase;
}
