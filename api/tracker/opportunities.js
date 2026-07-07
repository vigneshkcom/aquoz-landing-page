const {
  getWonOpportunityTrackerData,
  publicSetupState,
  requireTrackerAuth,
  sendJson,
} = require('../../lib/tracker-ghl');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!requireTrackerAuth(req, res)) return;

  try {
    const data = await getWonOpportunityTrackerData();
    return sendJson(res, 200, {
      generatedAt: data.generatedAt,
      setup: publicSetupState(data.missingFields),
      opportunities: data.opportunities,
      columns: [
        { key: 'won', label: 'Closed Won', hint: 'Ready for review/referral follow-up' },
        { key: 'linked', label: 'Referred Customers', hint: 'Won jobs linked to a referrer' },
        { key: 'complete', label: 'Complete', hint: 'Reviewed, thanked, or closed out' },
      ],
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      error: error.message,
      raw: error.raw || null,
    });
  }
};
