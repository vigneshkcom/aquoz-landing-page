# Aquoz Referral Tracker

## Goal

Build a private Aquoz referral tracker on `waterfilter.aquoz.com.au/tracker` that uses GoHighLevel as the source of truth for won opportunities, referrals, and post-install follow-up.

The tracker should let Aquoz staff:

- View all won GHL opportunities in a simple Kanban board.
- Link a won customer to the existing won customer who referred them.
- Create a separate GHL tracking opportunity for the referral.
- Unlink mistakes cleanly.
- Keep an audit trail in GHL notes and opportunity fields.
- Trigger post-install review/referral follow-up automation.

## Live App

- URL: `https://waterfilter.aquoz.com.au/tracker`
- Host: Vercel project `aquoz`
- Source repo: `vigneshkcom/aquoz-landing-page`
- Main page: `tracker/index.html`
- API routes: `api/tracker/*`
- GHL helper: `lib/tracker-ghl.js`

## Required Vercel Environment Variables

These are required:

- `TRACKER_PASSWORD`
- `AQUOZ_GHL_API_KEY`
- `AQUOZ_GHL_LOCATION_ID`

Optional:

- `AQUOZ_GHL_PIPELINE_ID` - limits the tracker to one pipeline.
- `AQUOZ_POST_INSTALL_WEBHOOK_URL` - sends post-install automation events to a webhook.
- `AQUOZ_REFERRAL_TRACKING_PIPELINE_ID` - puts tracker-created referral opportunities in a dedicated pipeline.
- `AQUOZ_REFERRAL_TRACKING_STAGE_ID` - puts tracker-created referral opportunities in a dedicated stage.
- `AQUOZ_REFERRAL_TRACKING_STATUS` - status for tracker-created opportunities. Defaults to `open`.

## What Exists Now

### Tracker UI

- Password-protected page at `/tracker`.
- Shows won opportunities from GHL.
- Columns:
  - Closed Won
  - Referred Customers
  - Ask Sent
  - Complete
- Search across won opportunities.
- Link referrer modal with search by name/source/email/phone/stage.
- Linked cards show:
  - Change referrer
  - Unlink
  - Ask review

### GHL Field Setup

The tracker can create missing GHL opportunity custom fields through the API using `POST /api/tracker/setup`.

Field groups include:

- Referrer opportunity ID
- Referrer name
- Referrer contact ID
- Referral linked timestamp
- Referral note
- Referral tracking opportunity ID
- Referral tracking created timestamp
- Referred customer opportunity ID
- Referred customer name
- Referred customer contact ID
- Review status
- Referral ask status

### Link Referrer Flow

When a user links Customer A to Referrer B:

1. The referred customer's original won opportunity is updated with referrer fields.
2. The tracker creates a separate GHL opportunity named `Referral - Customer A`.
3. The tracking opportunity is attached to Customer A's contact, so it appears on the customer contact's opportunity panel.
4. The tracker stores the tracking opportunity ID back on the original won opportunity.
5. A GHL note is added:

   `Customer A was referred by Referrer B - updated by tracker`

6. If the same link is saved again, the tracker reuses the stored tracking opportunity instead of creating duplicates.
7. If an older tracking opportunity was attached to the wrong contact, relinking migrates it by deleting the old tracker-created opportunity and creating a fresh one on the referred customer's contact.

### Unlink Flow

When a user unlinks a referral:

1. The tracker deletes the stored tracker-created referral opportunity.
2. The original won opportunity's referral fields are cleared.
3. A GHL note is added:

   `Referral link removed for Customer A from Referrer B - updated by tracker`

4. The customer moves back to the Closed Won column.

### Post-Install Review/Referral Ask

The Ask Review button:

- Optionally posts to `AQUOZ_POST_INSTALL_WEBHOOK_URL`.
- Updates review/referral status fields in GHL.
- Moves the card into the Ask Sent column based on status field values.

## Current Behavior Notes

- GHL's opportunity search endpoint does not return all custom field values, so the tracker hydrates won opportunities one by one with `GET /opportunities/:id`.
- The tracker uses GHL custom fields as the durable link source.
- The separate referral tracking opportunity is only for GHL visibility/workflow tracking.
- Unlink only deletes the tracker-created opportunity stored in the referral tracking field.

## Useful Commits

- `e3e6afa` - Add Aquoz referral tracker
- `b1ce67c` - Add tracker field setup endpoint
- `4f95699` - Fix GHL opportunity referral updates
- `159d522` - Hydrate tracker opportunity custom fields
- `dbdc670` - Create GHL referral tracking opportunities
- `67903ab` - Add referral unlink and audit notes
- `96556a9` - Add referrer search in tracker
