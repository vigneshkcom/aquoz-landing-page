const {
  getWonOpportunityTrackerData,
  linkReferral,
  readJsonBody,
  requireTrackerAuth,
  sendJson,
} = require('../../lib/tracker-ghl');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!requireTrackerAuth(req, res)) return;

  try {
    const body = await readJsonBody(req);
    const opportunityId = String(body.opportunityId || '').trim();
    const referrerOpportunityId = String(body.referrerOpportunityId || '').trim();
    const note = String(body.note || '').trim();

    if (!opportunityId || !referrerOpportunityId) {
      return sendJson(res, 400, { error: 'Both opportunityId and referrerOpportunityId are required.' });
    }
    if (opportunityId === referrerOpportunityId) {
      return sendJson(res, 400, { error: 'An opportunity cannot refer itself.' });
    }

    const trackerData = await getWonOpportunityTrackerData();
    const target = trackerData.opportunities.find((opportunity) => opportunity.id === opportunityId);
    const referrer = trackerData.opportunities.find((opportunity) => opportunity.id === referrerOpportunityId);

    if (!target) return sendJson(res, 404, { error: 'Target won opportunity was not found.' });
    if (!referrer) return sendJson(res, 404, { error: 'Referrer won opportunity was not found.' });

    const result = await linkReferral(target, referrer, note);

    return sendJson(res, 200, {
      ok: true,
      linked: {
        opportunityId: target.id,
        opportunityName: target.name,
        referrerOpportunityId: referrer.id,
        referrerName: referrer.name,
        trackingOpportunityId: result.trackingOpportunity.id,
        trackingOpportunityName: result.trackingOpportunity.name,
        trackingOpportunityReused: !!result.trackingOpportunity.reused,
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
