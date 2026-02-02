import { z } from 'zod';
import { 
  insertCaseSchema, 
  insertCallSchema, 
  insertMeetingSchema, 
  insertDocumentSchema,
  cases,
  calls,
  meetings,
  documents,
  funeralHomes
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

export type CaseResponse = z.infer<typeof api.cases.create.responses[201]>;
export type CallResponse = z.infer<typeof api.calls.create.responses[201]>;
export type MeetingResponse = z.infer<typeof api.meetings.create.responses[201]>;
export type DocumentResponse = z.infer<typeof api.documents.create.responses[201]>;
