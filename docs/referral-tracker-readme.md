# Aquoz Referral Tracker

## Goal

Build a private Aquoz referral tracker on `waterfilter.aquoz.com.au/tracker` that uses GoHighLevel as the source of truth for won opportunities, referrals, and post-install follow-up.

The tracker should let Aquoz staff:

- View all won GHL opportunities in a simple Kanban board.
- Link a won customer to the existing won customer who referred them.
- Link the existing referrer opportunity as an additional opportunity/contact relation.
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

The tracker does not create new referral opportunities. It uses GHL's associations relation endpoint to link an existing opportunity to an additional contact.

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
- Referral association relation ID
- Referred customer opportunity ID
- Referred customer name
- Referred customer contact ID
- Review status
- Referral ask status

### Link Referrer Flow

When a user links Customer A to Referrer B:

1. The referred customer's original won opportunity is updated with referrer fields.
2. The tracker links Referrer B's existing won opportunity as an additional opportunity/contact relation for Customer A.
3. No new opportunity is created, so the pipeline opportunity count is not inflated.
4. The tracker stores the GHL association relation ID back on the original won opportunity.
5. A GHL note is added:

   `Customer A was referred by Referrer B - updated by tracker`

6. If the same link is saved again, the tracker reuses the existing association relation instead of creating duplicates.
7. Older tracker-created `Referral - Customer` opportunities are no longer created by the current flow.

### Unlink Flow

When a user unlinks a referral:

1. The tracker removes the stored additional-opportunity association relation.
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
- The linked additional opportunity relation is used for GHL visibility without creating a new opportunity.
- Unlink only removes the association relation and clears tracker referral fields.

## Useful Commits

- `e3e6afa` - Add Aquoz referral tracker
- `b1ce67c` - Add tracker field setup endpoint
- `4f95699` - Fix GHL opportunity referral updates
- `159d522` - Hydrate tracker opportunity custom fields
- `dbdc670` - Create GHL referral tracking opportunities (superseded by association relation flow)
- `67903ab` - Add referral unlink and audit notes
- `96556a9` - Add referrer search in tracker
- `c5557ca` - Attach referral tracking opportunity to customer contact (superseded by association relation flow)
