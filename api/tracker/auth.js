const {
  createSessionToken,
  readJsonBody,
  sendJson,
  timingSafeEqualText,
  trackerPassword,
} = require('../../lib/tracker-ghl');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  const configuredPassword = trackerPassword();
  if (!configuredPassword) {
    return sendJson(res, 500, { error: 'TRACKER_PASSWORD is not configured in Vercel.' });
  }

  try {
    const body = await readJsonBody(req);
    if (!timingSafeEqualText(body.password || '', configuredPassword)) {
      return sendJson(res, 401, { error: 'Incorrect password.' });
    }

    return sendJson(res, 200, { ok: true, token: createSessionToken() });
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
};
