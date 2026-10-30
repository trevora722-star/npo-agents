# Working scope: nonprofit event coordination agent

Working name: **[NAME TBD]**. Names must be cleared for trademarks before use.

## What it does

For a small nonprofit's events and outreach team:

1. **Collect events.** Staff add events by hand, or paste a newsletter's events section. The agent proposes events it finds. A person confirms each one before it can be used.
2. **Draft communications.** For a confirmed event, the agent drafts a reminder email, a follow-up email, and a social post, using only the event details it was given. Anything missing is marked as a placeholder.
3. **Review.** An approver edits placeholders, approves, or rejects each draft. Only approved drafts can go out.
4. **Send.** An approver chooses an audience list and types SEND to confirm. Nothing is sent automatically.
5. **Record.** Every draft, approval, and send is written to an audit log.

## Guardrails (built into the software)

- Drafts use only facts from the event record. The agent is told never to invent dates, prices, names, or links.
- Drafts with unfilled placeholders cannot be sent or posted.
- Only approvers can approve, send, or post. Drafters can create and read drafts.
- Sending needs an approved draft, an audience list, and the typed word SEND.
- Social posts are never emailed. Email drafts are never posted to social.
- Access is limited to the organization's own email domain.

## Agents in this build

1. **Events and engagement**: newsletter import, event drafts, approval, send checks (simulated sending).
2. **Donor stewardship and receipts**: donor and gift records, receipt field checks, receipt numbering (a person issues each receipt), thank-you and re-engagement drafts that respect email consent.
3. **Grant tracking and reporting**: funder calendar, application and report drafts built only from entered facts.
4. **Volunteer coordination**: roster, screening status, shift shortfalls for screened roles, hours, recruitment and welcome drafts.
5. **Newsletter and communications**: subscriber consent, newsletter drafts, sends only to consenting subscribers with an unsubscribe line (simulated).
6. **Compliance calendar**: obligations and due dates the organization enters, overdue and upcoming lists, reminders, yearly rollover. The app does not know government deadlines.
7. **Board and governance**: meeting notes, minutes drafts that record only motions in the notes, agenda drafts, AGM checklist. Minutes are approved only by the board.
8. **Membership renewals**: member terms, renewal and lapsed lists, reminders to members who agreed to email.

## Current state (honest)

- Built: all eight agents above, shared records, approvals, audit log, and demo sign-in. Tests: 30.
- Simulated: email sending and social posting. Nothing leaves the app yet.
- Not built: real email provider connection, real social connections, multi-tenant hosting, billing, data export, backups.

## Integrations to plan (not built)

- Email audience lists and sending through an email platform (Constant Contact is the first candidate, subject to its API terms and a customer-by-customer connection).
- Social posting through each platform's official publishing API.
- Sign-in through the customer's own identity provider (Microsoft 365 or Google Workspace).

## Clean-room rule

This product is built from scratch. No code, prompts, text, names, or data from any other project are copied in. Each change is written here or in the commit history with its own reasoning. Before launch, get a written statement from BCSS that they claim no rights to this code.

## Compliance to address before selling

- Canadian privacy law (PIPA in BC, PIPEDA federally): data processing terms, retention, deletion, breach process.
- Anti-spam law (CASL): sending only to people who opted in, with a working unsubscribe link in every email.
- AI-generated text: customer approves everything; terms say the customer is responsible for what is sent.
- Insurance and a standard terms of service, reviewed by a lawyer.

## Pricing (to decide)

Placeholder only. Options to test with 3 to 5 pilot organizations:

- Pilot: free or discounted for 60 days in exchange for feedback and a case study with permission.
- Monthly plan: tiers by number of events drafted and audience lists.
- Setup fee for integrations.

No price is published until it has been tested.
