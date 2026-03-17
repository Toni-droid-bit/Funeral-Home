import { z } from 'zod';
import {
  insertCaseSchema,
  insertCallSchema,
  insertMeetingSchema,
  insertDocumentSchema,
  insertChecklistTemplateSchema,
  cases,
  calls,
  meetings,
  documents,
  funeralHomes,
  checklistTemplates,
} from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

// ============================================
// SHARED ACTION RESPONSE SCHEMAS
// Reused across multiple endpoints.
// ============================================

/** Returned by /api/calls/:id/reprocess and /api/meetings/:id/reprocess */
export const reprocessResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  caseId: z.number().nullable().optional(),
});

/** Returned by /api/cases/:id/process-transcript */
export const processTranscriptResultSchema = z.object({
  success: z.boolean(),
  extractedFields: z.array(z.string()).optional(),
  message: z.string().optional(),
});

/** Returned by /api/cases/:id/live-extract */
export const liveExtractResultSchema = z.object({
  success: z.boolean(),
});

/** Returned by checklist toggle / update-value */
export const checklistActionResultSchema = z.object({
  success: z.boolean(),
});

/** Checklist item (computed) */
export const computedChecklistItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  category: z.string(),
  fieldMapping: z.string().optional(),
  isCompleted: z.boolean(),
  isManuallyCompleted: z.boolean(),
});

/** Full computed checklist returned by /api/cases/:id/checklist */
export const computedChecklistSchema = z.object({
  caseId: z.number(),
  templateId: z.number(),
  templateName: z.string().optional(),
  items: z.array(computedChecklistItemSchema),
  completedCount: z.number(),
  totalItems: z.number(),
  completedPercentage: z.number(),
});

/** Checklist template shape (matches DB schema) */
const checklistTemplateResponseSchema = z.custom<typeof checklistTemplates.$inferSelect>();

// ============================================
// API CONTRACT
// ============================================
export const api = {
  cases: {
    list: {
      method: 'GET' as const,
      path: '/api/cases',
      responses: {
        200: z.array(z.custom<typeof cases.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/cases/:id',
      responses: {
        200: z.custom<typeof cases.$inferSelect & {
          calls?: (typeof calls.$inferSelect)[],
          meetings?: (typeof meetings.$inferSelect)[],
          documents?: (typeof documents.$inferSelect)[]
        }>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/cases',
      input: insertCaseSchema,
      responses: {
        201: z.custom<typeof cases.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/cases/:id',
      input: insertCaseSchema.partial(),
      responses: {
        200: z.custom<typeof cases.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    patch: {
      method: 'PATCH' as const,
      path: '/api/cases/:id',
      input: insertCaseSchema.partial(),
      responses: {
        200: z.custom<typeof cases.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/cases/:id',
      responses: {
        200: z.object({ message: z.string() }),
        404: errorSchemas.notFound,
      },
    },
    deleteAll: {
      method: 'DELETE' as const,
      path: '/api/cases',
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
    processTranscript: {
      method: 'POST' as const,
      path: '/api/cases/:id/process-transcript',
      input: z.object({ transcript: z.string() }),
      responses: {
        200: processTranscriptResultSchema,
      },
    },
    liveExtract: {
      method: 'POST' as const,
      path: '/api/cases/:id/live-extract',
      input: z.object({ transcript: z.string() }),
      responses: {
        200: liveExtractResultSchema,
      },
    },
    checklist: {
      method: 'GET' as const,
      path: '/api/cases/:id/checklist',
      responses: {
        200: computedChecklistSchema,
        404: errorSchemas.notFound,
      },
    },
    toggleChecklistItem: {
      method: 'POST' as const,
      path: '/api/cases/:id/checklist/:itemId/toggle',
      responses: {
        200: checklistActionResultSchema,
      },
    },
    updateChecklistValue: {
      method: 'POST' as const,
      path: '/api/cases/:id/checklist/:itemId/update-value',
      input: z.object({ value: z.string() }),
      responses: {
        200: checklistActionResultSchema,
      },
    },
    generateIntakeSummary: {
      method: 'POST' as const,
      path: '/api/cases/:id/generate-intake-summary',
      responses: {
        201: z.custom<typeof documents.$inferSelect>(),
      },
    },
    generateDocuments: {
      method: 'POST' as const,
      path: '/api/cases/:id/generate-documents',
      responses: {
        200: z.array(z.custom<typeof documents.$inferSelect>()),
      },
    },
  },

  calls: {
    list: {
      method: 'GET' as const,
      path: '/api/calls',
      responses: {
        200: z.array(z.custom<typeof calls.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/calls/:id',
      responses: {
        200: z.custom<typeof calls.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/calls',
      input: insertCallSchema,
      responses: {
        201: z.custom<typeof calls.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    patch: {
      method: 'PATCH' as const,
      path: '/api/calls/:id',
      input: z.object({
        transcript: z.string().optional(),
        callerName: z.string().optional(),
        summary: z.string().optional(),
        caseId: z.number().nullable().optional(),
      }),
      responses: {
        200: z.custom<typeof calls.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    reprocess: {
      method: 'POST' as const,
      path: '/api/calls/:id/reprocess',
      responses: {
        200: reprocessResultSchema,
      },
    },
  },

  meetings: {
    list: {
      method: 'GET' as const,
      path: '/api/meetings',
      responses: {
        200: z.array(z.custom<typeof meetings.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/meetings/:id',
      responses: {
        200: z.custom<typeof meetings.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/meetings',
      input: insertMeetingSchema,
      responses: {
        201: z.custom<typeof meetings.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    patch: {
      method: 'PATCH' as const,
      path: '/api/meetings/:id',
      input: z.object({
        transcript: z.string().optional(),
        summary: z.string().optional(),
        caseId: z.number().nullable().optional(),
        status: z.string().optional(),
      }),
      responses: {
        200: z.custom<typeof meetings.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    reprocess: {
      method: 'POST' as const,
      path: '/api/meetings/:id/reprocess',
      responses: {
        200: reprocessResultSchema,
      },
    },
  },

  documents: {
    list: {
      method: 'GET' as const,
      path: '/api/documents',
      responses: {
        200: z.array(z.custom<typeof documents.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/documents',
      input: insertDocumentSchema,
      responses: {
        201: z.custom<typeof documents.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    patch: {
      method: 'PATCH' as const,
      path: '/api/documents/:id',
      input: z.object({ content: z.string().optional(), title: z.string().optional() }),
      responses: {
        200: z.custom<typeof documents.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },

  dashboard: {
    stats: {
      method: 'GET' as const,
      path: '/api/dashboard/stats',
      responses: {
        200: z.object({
          activeCases: z.number(),
          pendingCalls: z.number(),
          upcomingMeetings: z.number(),
        }),
      },
    },
  },

  checklistTemplates: {
    list: {
      method: 'GET' as const,
      path: '/api/checklist-templates',
      responses: {
        200: z.array(checklistTemplateResponseSchema),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/checklist-templates/:id',
      responses: {
        200: checklistTemplateResponseSchema,
        404: errorSchemas.notFound,
      },
    },
    getDefault: {
      method: 'GET' as const,
      path: '/api/checklist-templates/default',
      responses: {
        200: checklistTemplateResponseSchema,
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/checklist-templates',
      input: insertChecklistTemplateSchema,
      responses: {
        201: checklistTemplateResponseSchema,
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/checklist-templates/:id',
      input: insertChecklistTemplateSchema.partial(),
      responses: {
        200: checklistTemplateResponseSchema,
        404: errorSchemas.notFound,
      },
    },
    // Returns 204 No Content — no response body
    delete: {
      method: 'DELETE' as const,
      path: '/api/checklist-templates/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

// ============================================
// EXPORTED RESPONSE TYPES
// Derive TypeScript types from the Zod schemas above.
// Use these as the <T> parameter in apiRequest<T>().
// ============================================

export type CaseResponse        = z.infer<typeof api.cases.create.responses[201]>;
export type CallResponse        = z.infer<typeof api.calls.create.responses[201]>;
export type MeetingResponse     = z.infer<typeof api.meetings.create.responses[201]>;
export type DocumentResponse    = z.infer<typeof api.documents.create.responses[201]>;
export type ChecklistTemplateResponse = z.infer<typeof api.checklistTemplates.create.responses[201]>;

export type ReprocessResult         = z.infer<typeof reprocessResultSchema>;
export type ProcessTranscriptResult = z.infer<typeof processTranscriptResultSchema>;
export type LiveExtractResult       = z.infer<typeof liveExtractResultSchema>;
export type ComputedChecklist       = z.infer<typeof computedChecklistSchema>;
export type ComputedChecklistItem   = z.infer<typeof computedChecklistItemSchema>;
