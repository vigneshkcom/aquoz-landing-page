const {
  buildReviewEmail,
  getGhlConfig,
  getReferralLinkParticipants,
  markReviewEmailSent,
  readJsonBody,
  requireTrackerAuth,
  sendJson,
  sendReviewRequestEmail,
  updateOpportunityFields,
} = require('../../lib/tracker-ghl');

async function postAutomationWebhook(action, note, opportunity) {
  const cfg = getGhlConfig();
  if (!cfg.webhookUrl) return null;

  try {
    const webhookResp = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        note,
        opportunity,
        triggeredAt: new Date().toISOString(),
        source: 'Aquoz Referral Tracker',
      }),
    });
    return {
      ok: webhookResp.ok,
      status: webhookResp.status,
      text: (await webhookResp.text()).slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: error.message,
    };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!requireTrackerAuth(req, res)) return;

  try {
    const body = await readJsonBody(req);
    const opportunityId = String(body.opportunityId || '').trim();
    const action = String(body.action || 'send_review_email').trim();
    const note = String(body.note || '').trim();

    if (!opportunityId) return sendJson(res, 400, { error: 'opportunityId is required.' });

    const { target: opportunity } = await getReferralLinkParticipants(opportunityId);
    if (!opportunity) return sendJson(res, 404, { error: 'Won opportunity was not found.' });

    if (action === 'preview_review_email') {
      // Read-only: renders the exact email that send_review_email would send,
      // without emailing anyone or touching GHL fields.
      const preview = buildReviewEmail(opportunity, note);
      return sendJson(res, 200, {
        ok: true,
        to: opportunity.email || '',
        subject: preview.subject,
        html: preview.html,
        text: preview.text,
        reviewUrl: preview.reviewUrl,
      });
    }

    if (action === 'move_stage') {
      return sendJson(res, 400, { error: 'Stage changes are disabled in the tracker.' });
    }

    if (!['send_review_email', 'post_install_review_referral'].includes(action)) {
      return sendJson(res, 400, { error: 'Invalid automation action.' });
    }

    const email = await sendReviewRequestEmail(opportunity, note);
    const webhook = await postAutomationWebhook(action, note, opportunity);
    // Tag the contact "Review email sent" and move them to End of Funnel /
    // "Referral Email Sent" (best-effort — never fails the send).
    const advance = await markReviewEmailSent(opportunity);
    const result = await updateOpportunityFields(opportunity.id, {
      reviewStatus: 'Review request email sent',
      referralAskStatus: `Review email sent from tracker on ${new Date().toISOString()}`,
    });

    return sendJson(res, 200, {
      ok: true,
      action: 'send_review_email',
      email,
      webhook,
      advance: {
        tagged: !!(advance.tag && advance.tag.ok),
        tag: advance.tag ? advance.tag.tag : '',
        tagWarning: advance.tag && advance.tag.ok === false ? advance.tag.error : '',
        moved: !!(advance.move && advance.move.moved),
        pipelineName: advance.move ? advance.move.pipelineName : '',
        stageName: advance.move ? advance.move.stageName : '',
        moveWarning: advance.move ? advance.move.warning : '',
      },
      result,
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      error: error.message,
      missingFields: error.missingFields || null,
      raw: error.raw || null,
    });
  }
};
