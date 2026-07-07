const {
  TRACKER_STAGES,
  getGhlConfig,
  getReferralLinkParticipants,
  moveOpportunityTrackerStage,
  readJsonBody,
  requireTrackerAuth,
  sendJson,
  sendReviewRequestEmail,
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

    if (action === 'move_stage') {
      const stage = String(body.stage || '').trim().toLowerCase();
      if (!TRACKER_STAGES.includes(stage)) {
        return sendJson(res, 400, { error: 'Invalid tracker stage.' });
      }

      const result = await moveOpportunityTrackerStage(
        opportunity,
        stage,
        `Moved to ${stage} in tracker on ${new Date().toISOString()}`,
      );

      return sendJson(res, 200, {
        ok: true,
        action,
        stage,
        result,
      });
    }

    if (!['send_review_email', 'post_install_review_referral'].includes(action)) {
      return sendJson(res, 400, { error: 'Invalid automation action.' });
    }

    const email = await sendReviewRequestEmail(opportunity, note);
    const webhook = await postAutomationWebhook(action, note, opportunity);
    const result = await moveOpportunityTrackerStage(
      opportunity,
      'sent',
      `Review email sent from tracker on ${new Date().toISOString()}`,
      { updateStatus: true },
    );

    return sendJson(res, 200, {
      ok: true,
      action: 'send_review_email',
      email,
      webhook,
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
