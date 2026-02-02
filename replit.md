# Funeral Home Management System

## Overview
A comprehensive funeral home management system with unified Communications Hub for AI phone calls and meeting transcription. Built with React, Express, and PostgreSQL.

## Current Features
- **Case Management**: Create and manage funeral cases with deceased details, religion, language preferences
- **Communications Hub**: Unified platform combining AI phone calls (Vapi.ai) and meeting transcription
  - Unified timeline of all calls and meetings sorted by date
  - "Action Required" section for cases needing attention
  - Quick start recording with case selection
  - Review mode with transcript and checklist integration
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
│   ├── pages/         # Page components (dashboard, cases, communications)
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
1. Go to the Communications Hub
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
- Communications Hub review mode shows live checklist with toggle functionality

## AI Transcript Extraction
The system uses OpenAI to automatically extract intake data from both call and meeting transcripts.

### Extracted Fields
- **First Call Essentials**: Deceased name, relationship to caller, date of death, contact number
- **Service Preferences**: Religion, burial preference, urgency level, location preference
- **Meeting Details**: Cemetery, clothing, obituary, flowers, music, readings, reception, donations
- **Automatic Urgency**: Muslim/Jewish cases auto-set to "urgent-24hr" for 24-hour burial requirements

### API Endpoints
- `POST /api/calls/:id/reprocess` - Re-parse call transcript and update case intake data
- `POST /api/meetings/:id/reprocess` - Re-parse meeting transcript and update case intake data

### Living Intake Document
- Automatically generates/updates an "Intake Summary" document for each case
- Document updates with each call or meeting data extraction
- Found in the Documents section of each case

### UI Access
- Communications Hub review mode shows "Extract Data" button for both calls and meetings
- "Extracted Data" card displays all parsed data with green success styling
- Checklist items auto-complete when their fieldMapping matches extracted data

## Recent Changes
- 2026-02-02: Added meeting transcript extraction with living intake document
- 2026-02-02: Extended intake schema with meeting-specific fields (cemetery, clothing, music, etc.)
- 2026-02-02: Added AI transcript extraction with "Extract Data" button
- 2026-02-02: Enhanced intake parser for Muslim/Jewish burial urgency detection
- 2026-02-02: Added relationship to caller and religion fields to default checklist
- 2026-02-02: Merged xLink and xScribe into unified Communications Hub
- 2026-02-02: Added customizable checklist templates for directors
- 2026-02-02: Added Vapi.ai integration for outbound AI phone calls
- Created MakeCallDialog component for initiating calls
- Added Vapi routes and hooks for phone number/assistant management

## Development
- Run: `npm run dev` starts both frontend and backend
- Database: PostgreSQL via Drizzle ORM
- Migrations: `npm run db:push`
