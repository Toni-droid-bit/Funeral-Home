# Funeral Home Management System

## Overview
A comprehensive funeral home management system with AI-powered phone handling (xLink) and meeting transcription (xScribe). Built with React, Express, and PostgreSQL.

## Current Features
- **Case Management**: Create and manage funeral cases with deceased details, religion, language preferences
- **xLink AI Calls**: AI-powered phone call handling with Vapi.ai integration
- **xScribe Meetings**: Meeting transcription and summary generation
- **Dashboard**: Overview of active cases, pending calls, and upcoming meetings
- **Replit Auth**: User authentication via Replit's OAuth system

## Tech Stack
- **Frontend**: React + Vite, TailwindCSS, shadcn/ui components
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **AI Services**: 
  - Vapi.ai for phone call automation
  - OpenAI for transcription and summaries

## Project Structure
```
client/
├── src/
│   ├── components/    # UI components including make-call-dialog
│   ├── hooks/         # React Query hooks for data fetching
│   ├── pages/         # Page components (dashboard, cases, calls, meetings)
│   └── lib/           # Utility functions
server/
├── routes.ts          # API route definitions
├── storage.ts         # Database operations
├── vapi/              # Vapi.ai integration
│   └── index.ts       # Phone call APIs
└── replit_integrations/  # Auth, audio, image APIs
shared/
├── schema.ts          # Database schema and types
└── routes.ts          # API contracts
```

## Vapi.ai Integration
The system uses Vapi.ai for AI-powered outbound phone calls.

### Environment Variables
- `VAPI_API_KEY`: Your Vapi.ai API key (stored in Replit Secrets)

### API Endpoints
- `GET /api/vapi/phone-numbers` - List configured Vapi phone numbers
- `GET /api/vapi/assistants` - List configured AI assistants
- `POST /api/vapi/calls` - Initiate an outbound AI call
- `GET /api/vapi/calls/:id` - Get call details from Vapi
- `POST /api/vapi/webhook` - Webhook endpoint for call events

### Making Calls
1. Go to the xLink Calls page
2. Click "Make Call" button
3. Select your Vapi phone number (must be configured in Vapi dashboard)
4. Enter the destination phone number
5. Optionally select an AI assistant or use the default funeral assistant
6. Click "Start Call"

### Default AI Assistant
If no assistant is selected, the system uses a custom funeral home receptionist persona:
- Compassionate and professional tone
- Handles inquiries about services and arrangements
- Gathers caller information
- Provides guidance and reassurance

### Webhook Integration
Set up webhook URL in Vapi dashboard to receive call events:
- URL: `https://your-app.replit.app/api/vapi/webhook`
- Events: end-of-call-report (for transcripts and summaries)

## Checklist Templates
Directors can customize intake checklists for arrangement meetings.

### Features
- Create custom checklist templates with questions organized by priority:
  - **Critical**: Must have before family leaves (legal name, DOB, DOD, next of kin, service type, payment)
  - **Important**: Should confirm during meeting (cemetery, clothing, obituary, flowers, music)
  - **Supplementary**: Can follow up later (readings, photos, reception, donations)
- Default template pre-populated with 18 standard funeral home questions
- Questions can be mapped to intake data fields for auto-completion
- Manual toggle for custom items without field mapping
- Progress tracking with completion percentage per case

### API Endpoints
- `GET /api/checklist-templates` - List all templates
- `GET /api/checklist-templates/default` - Get default template
- `POST /api/checklist-templates` - Create new template
- `PUT /api/checklist-templates/:id` - Update template
- `GET /api/cases/:id/checklist` - Get computed checklist for a case
- `POST /api/cases/:id/checklist/:itemId/toggle` - Toggle item completion

### UI Access
- Settings > Checklist Settings to manage templates
- xScribe meeting review shows live checklist with toggle functionality

## Recent Changes
- 2026-02-02: Added customizable checklist templates for directors
- 2026-02-02: Added Vapi.ai integration for outbound AI phone calls
- Created MakeCallDialog component for initiating calls
- Added Vapi routes and hooks for phone number/assistant management

## Development
- Run: `npm run dev` starts both frontend and backend
- Database: PostgreSQL via Drizzle ORM
- Migrations: `npm run db:push`
