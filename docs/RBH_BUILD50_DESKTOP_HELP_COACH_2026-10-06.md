# RBH Build 50 — Desktop Help Coach

Date: 2026-10-06

## Purpose

Add deterministic, in-app guidance so users can learn the RBH Safety workflow while they are using it instead of relying on a separate manual as the primary help system.

## Design principle

> Don't teach people the software. Make the software teach them while they're using it.

This line is also reserved as a future TeamWorkt Safety marketing message. The TeamWorkt Safety marketing site is **not** changed by Build 50; the wording is captured below for that later phase.

## User experience

A fixed `?` Help button appears in the lower-right corner on desktop-class browsers only. It is intentionally hidden on mobile / coarse-pointer layouts to avoid crowding the mobile workflow.

Opening Help shows:

- A page-aware `Help with this screen` recommendation when relevant.
- A role-aware set of task guides.
- Short step-by-step instructions with Back / Next / Done controls.
- `Show me` on selected steps, which navigates to the appropriate app view when safe, scrolls to the relevant live control, and briefly highlights it.

The Help Coach is curated guidance, not an AI chatbot. It makes no network calls and does not send report data outside the existing application.

## Role-aware topics

### All dashboard roles
- Submit a report

### Admin + Safety Manager
- Review an incident
- Complete my corrective action
- Review completed work
- Close a report

### Supervisor
- Complete my corrective action
- Review an incident only if the preserved investigator-assignment capability is actively assigned to that supervisor

### Admin only
- Admin & user management

### Read Only
- Submit a report
- Page-aware viewing help for Safety Inbox / report review / Analytics

## Page awareness

The Recommended help option adapts to the visible workspace. Examples:

- Home → Using Home
- Safety Inbox → Using Safety Inbox
- My Work → Using My Work
- Incident Step 1 → Review
- Incident Step 2 → Investigation
- Incident Step 3 → Corrective Actions
- Incident Step 4 → Complete Work
- Incident Step 5 → Verify Work
- Incident Step 6 → Close
- Focused corrective action → Complete action or Review completed work based on status/role
- Analytics → Using Analytics
- Admin → Admin & user management

## Mobile behavior

The Help Coach is deliberately disabled when the browser is below 1024 px or reports a coarse primary pointer. No mobile layout is added in this build.

## Technical scope

Dashboard-only update. No Supabase migration and no Edge Function changes are required.

## Future TeamWorkt Safety marketing item

Suggested headline / callout:

**Don't teach people the software. Make the software teach them while they're using it.**

Supporting copy candidate:

TeamWorkt Safety puts role-aware, screen-aware guidance inside the workflow, helping small teams complete safety work confidently without hunting through a manual or sitting through software training.
