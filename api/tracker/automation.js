const {
  getGhlConfig,
  getWonOpportunityTrackerData,
  readJsonBody,
  requireTrackerAuth,
  sendJson,
  updateOpportunityFields,
} = require('../../lib/tracker-ghl');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!requireTrackerAuth(req, res)) return;

  try {
    const body = await readJsonBody(req);
    const opportunityId = String(body.opportunityId || '').trim();
    const action = String(body.action || 'post_install_review_referral').trim();
    const note = String(body.note || '').trim();

    if (!opportunityId) return sendJson(res, 400, { error: 'opportunityId is required.' });

    const trackerData = await getWonOpportunityTrackerData();
    const opportunity = trackerData.opportunities.find((item) => item.id === opportunityId);
    if (!opportunity) return sendJson(res, 404, { error: 'Won opportunity was not found.' });

    const cfg = getGhlConfig();
    let webhook = null;
    if (cfg.webhookUrl) {
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
      webhook = {
        ok: webhookResp.ok,
        status: webhookResp.status,
        text: (await webhookResp.text()).slice(0, 500),
      };
    }

    const result = await updateOpportunityFields(opportunityId, {
      reviewStatus: 'Review/referral ask sent',
      referralAskStatus: `Sent from tracker on ${new Date().toISOString()}`,
      referralNote: note || opportunity.referralNote,
    });

    return sendJson(res, 200, {
      ok: true,
      webhook,
      warning: cfg.webhookUrl ? '' : 'AQUOZ_POST_INSTALL_WEBHOOK_URL is not configured; only tracker fields were updated.',
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
