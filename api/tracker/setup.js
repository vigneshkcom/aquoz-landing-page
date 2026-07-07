const {
  ensureReferralFields,
  requireTrackerAuth,
  resolveReferralFields,
  sendJson,
} = require('../../lib/tracker-ghl');

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!requireTrackerAuth(req, res)) return;

  try {
    if (req.method === 'GET') {
      const data = await resolveReferralFields();
      return sendJson(res, 200, {
        ok: !data.missing.length,
        fields: data.fields,
        missingFields: data.missing,
      });
    }

    const data = await ensureReferralFields();
    return sendJson(res, 200, {
      ok: !data.missingFields.length,
      ...data,
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      error: error.message,
      raw: error.raw || null,
    });
  }
};
