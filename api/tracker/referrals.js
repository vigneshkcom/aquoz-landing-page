const {
  getWonOpportunityTrackerData,
  linkReferral,
  readJsonBody,
  requireTrackerAuth,
  sendJson,
  unlinkReferral,
} = require('../../lib/tracker-ghl');

module.exports = async function handler(req, res) {
  if (!['DELETE', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!requireTrackerAuth(req, res)) return;

  try {
    const body = await readJsonBody(req);
    const opportunityId = String(body.opportunityId || '').trim();
    const referrerOpportunityId = String(body.referrerOpportunityId || '').trim();
    const note = String(body.note || '').trim();

    if (!opportunityId) return sendJson(res, 400, { error: 'opportunityId is required.' });

    const trackerData = await getWonOpportunityTrackerData();
    const target = trackerData.opportunities.find((opportunity) => opportunity.id === opportunityId);
    if (!target) return sendJson(res, 404, { error: 'Target won opportunity was not found.' });

    if (req.method === 'DELETE') {
      const result = await unlinkReferral(target);
      return sendJson(res, 200, {
        ok: true,
        unlinked: {
          opportunityId: target.id,
          opportunityName: target.name,
          previousReferrerName: result.previousReferrerName,
          deletedRelation: !!target.referralAssociationRelationId,
          noteWarning: result.contactNote && result.contactNote.ok === false ? result.contactNote.error : '',
        },
        result,
      });
    }

    if (!referrerOpportunityId) {
      return sendJson(res, 400, { error: 'referrerOpportunityId is required.' });
    }
    if (opportunityId === referrerOpportunityId) {
      return sendJson(res, 400, { error: 'An opportunity cannot refer itself.' });
    }

    const referrer = trackerData.opportunities.find((opportunity) => opportunity.id === referrerOpportunityId);
    if (!referrer) return sendJson(res, 404, { error: 'Referrer won opportunity was not found.' });

    const result = await linkReferral(target, referrer, note);

    return sendJson(res, 200, {
      ok: true,
      linked: {
        opportunityId: target.id,
        opportunityName: target.name,
        referrerOpportunityId: referrer.id,
        referrerName: referrer.name,
        associationRelationId: result.relation.id,
        associationRelationReused: !!result.relation.reused,
        noteWarning: result.contactNote && result.contactNote.ok === false ? result.contactNote.error : '',
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
