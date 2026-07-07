const crypto = require('crypto');

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const FIELD_DEFS = {
  referrerOpportunityId: {
    env: ['AQUOZ_REFERRER_OPPORTUNITY_FIELD_ID', 'REFERRAL_FIELD_REFERRER_OPPORTUNITY_ID'],
    names: ['Referral - Referred By Opportunity ID', 'Referred By Opportunity ID'],
    dataType: 'TEXT',
    requiredForLink: true,
  },
  referrerName: {
    env: ['AQUOZ_REFERRER_NAME_FIELD_ID', 'REFERRAL_FIELD_REFERRER_NAME'],
    names: ['Referral - Referred By Name', 'Referred By Customer'],
    dataType: 'TEXT',
  },
  referrerContactId: {
    env: ['AQUOZ_REFERRER_CONTACT_FIELD_ID', 'REFERRAL_FIELD_REFERRER_CONTACT_ID'],
    names: ['Referral - Referred By Contact ID', 'Referred By Contact ID'],
    dataType: 'TEXT',
  },
  referralLinkedAt: {
    env: ['AQUOZ_REFERRAL_LINKED_AT_FIELD_ID', 'REFERRAL_FIELD_LINKED_AT'],
    names: ['Referral - Linked At', 'Referral Linked At'],
    dataType: 'TEXT',
  },
  referralNote: {
    env: ['AQUOZ_REFERRAL_NOTE_FIELD_ID', 'REFERRAL_FIELD_NOTE'],
    names: ['Referral - Note', 'Referral Note'],
    dataType: 'TEXT',
  },
  reviewStatus: {
    env: ['AQUOZ_REVIEW_STATUS_FIELD_ID', 'REFERRAL_FIELD_REVIEW_STATUS'],
    names: ['Post Install - Review Status', 'Review Status'],
    dataType: 'TEXT',
  },
  referralAskStatus: {
    env: ['AQUOZ_REFERRAL_ASK_STATUS_FIELD_ID', 'REFERRAL_FIELD_ASK_STATUS'],
    names: ['Post Install - Referral Ask Status', 'Referral Ask Status'],
    dataType: 'TEXT',
  },
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function trackerPassword() {
  return process.env.TRACKER_PASSWORD || process.env.DASHBOARD_PASSWORD || '';
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', trackerPassword()).update(payload).digest('base64url');
}

function createSessionToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ iat: now, exp: now + 12 * 60 * 60 }));
  return `${payload}.${signPayload(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !trackerPassword()) return false;
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return false;
  if (!timingSafeEqualText(signature, signPayload(payload))) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function requireTrackerAuth(req, res) {
  const header = req.headers.authorization || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (verifySessionToken(token)) return true;
  sendJson(res, 401, { error: 'Unauthorized.' });
  return false;
}

function getGhlConfig() {
  return {
    apiKey: process.env.AQUOZ_GHL_API_KEY || process.env.GHL_API_KEY_AU || process.env.GHL_API_KEY || '',
    locationId: process.env.AQUOZ_GHL_LOCATION_ID || process.env.GHL_LOCATION_ID_AU || '',
    pipelineId: process.env.AQUOZ_GHL_PIPELINE_ID || '',
    webhookUrl: process.env.AQUOZ_POST_INSTALL_WEBHOOK_URL || '',
  };
}

function assertGhlConfig() {
  const cfg = getGhlConfig();
  if (!cfg.apiKey) {
    const err = new Error('AQUOZ_GHL_API_KEY or GHL_API_KEY_AU is not configured.');
    err.statusCode = 500;
    throw err;
  }
  if (!cfg.locationId) {
    const err = new Error('AQUOZ_GHL_LOCATION_ID or GHL_LOCATION_ID_AU is not configured.');
    err.statusCode = 500;
    throw err;
  }
  return cfg;
}

async function ghlRequest(path, options = {}) {
  const cfg = assertGhlConfig();
  const resp = await fetch(`${GHL_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Version: GHL_VERSION,
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(options.headers || {}),
    },
  });

  const text = await resp.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!resp.ok) {
    const message = data.message || data.msg || data.error || `GHL HTTP ${resp.status}`;
    const err = new Error(message);
    err.statusCode = resp.status;
    err.raw = data;
    throw err;
  }

  return data;
}

async function fetchAllOpportunities() {
  const cfg = assertGhlConfig();
  const rows = [];
  let after = '';
  let afterId = '';
  let page = 0;

  while (page < 75) {
    page += 1;
    let path = `/opportunities/search?location_id=${encodeURIComponent(cfg.locationId)}&limit=100`;
    if (cfg.pipelineId) path += `&pipeline_id=${encodeURIComponent(cfg.pipelineId)}`;
    if (after && afterId) {
      path += `&startAfter=${encodeURIComponent(after)}&startAfterId=${encodeURIComponent(afterId)}`;
    }

    const data = await ghlRequest(path);
    const opps = data.opportunities || data.data || [];
    rows.push(...opps);

    if (opps.length < 100 || !data.meta || !data.meta.nextPageUrl) break;
    after = data.meta.startAfter || '';
    afterId = data.meta.startAfterId || '';
    if (!after || !afterId) break;
  }

  return rows;
}

async function fetchOpportunity(opportunityId) {
  const data = await ghlRequest(`/opportunities/${encodeURIComponent(opportunityId)}`);
  return data.opportunity || data;
}

async function hydrateOpportunities(opportunities) {
  return Promise.all((opportunities || []).map(async (opportunity) => {
    if (!opportunity.id) return opportunity;
    try {
      const detail = await fetchOpportunity(opportunity.id);
      return {
        ...opportunity,
        ...detail,
        contact: {
          ...(opportunity.contact || {}),
          ...(detail.contact || {}),
        },
      };
    } catch {
      return opportunity;
    }
  }));
}

async function fetchPipelines() {
  const cfg = assertGhlConfig();
  for (const param of ['locationId', 'location_id']) {
    try {
      const data = await ghlRequest(`/opportunities/pipelines?${param}=${encodeURIComponent(cfg.locationId)}`);
      if (Array.isArray(data.pipelines)) return data.pipelines;
    } catch {
      // GHL has accepted both parameter spellings at different times.
    }
  }
  return [];
}

async function fetchCustomFields(model = '') {
  const cfg = assertGhlConfig();
  try {
    let path = `/locations/${encodeURIComponent(cfg.locationId)}/customFields`;
    if (model) path += `?model=${encodeURIComponent(model)}`;
    const data = await ghlRequest(path);
    return data.customFields || data.fields || data.custom_fields || [];
  } catch {
    return [];
  }
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function fieldValueFromEnv(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return '';
}

async function resolveReferralFields() {
  const fields = {};
  const missing = [];
  const definitions = await fetchCustomFields('opportunity');

  for (const [key, def] of Object.entries(FIELD_DEFS)) {
    let id = fieldValueFromEnv(def.env);
    if (!id && definitions.length) {
      const wanted = def.names.map(normalizeName);
      const match = definitions.find((field) => {
        const candidates = [field.name, field.fieldName, field.fieldKey, field.key].map(normalizeName);
        return candidates.some((candidate) => wanted.includes(candidate));
      });
      id = match && (match.id || match.fieldId);
    }

    fields[key] = id || '';
    if (!id) missing.push({ key, names: def.names, env: def.env, requiredForLink: !!def.requiredForLink });
  }

  return { fields, missing };
}

function findCustomFieldByDefinition(def, definitions) {
  const wanted = def.names.map(normalizeName);
  return (definitions || []).find((field) => {
    const candidates = [field.name, field.fieldName, field.fieldKey, field.key].map(normalizeName);
    return candidates.some((candidate) => wanted.includes(candidate));
  });
}

function extractCustomField(data) {
  return data.customField || data.custom_field || data.field || data;
}

async function createOpportunityCustomField(def, position) {
  const cfg = assertGhlConfig();
  const body = {
    name: def.names[0],
    dataType: def.dataType || 'TEXT',
    placeholder: def.names[0],
    position,
    model: 'opportunity',
  };

  const data = await ghlRequest(`/locations/${encodeURIComponent(cfg.locationId)}/customFields`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  return extractCustomField(data);
}

async function ensureReferralFields() {
  const configured = {};
  const existing = [];
  const created = [];
  const recovered = [];
  let definitions = await fetchCustomFields('opportunity');

  for (const [key, def] of Object.entries(FIELD_DEFS)) {
    const configuredId = fieldValueFromEnv(def.env);
    if (configuredId) {
      configured[key] = { id: configuredId, name: def.names[0] };
      continue;
    }

    const match = findCustomFieldByDefinition(def, definitions);
    if (match) {
      existing.push({ key, id: match.id || match.fieldId || '', name: match.name || match.fieldName || def.names[0] });
      continue;
    }

    try {
      const createdField = await createOpportunityCustomField(def, created.length);
      const record = {
        key,
        id: createdField.id || createdField.fieldId || '',
        name: createdField.name || createdField.fieldName || def.names[0],
      };
      created.push(record);
      definitions = [...definitions, createdField];
    } catch (error) {
      const refreshed = await fetchCustomFields('opportunity');
      const recoveredMatch = findCustomFieldByDefinition(def, refreshed);
      if (recoveredMatch) {
        recovered.push({
          key,
          id: recoveredMatch.id || recoveredMatch.fieldId || '',
          name: recoveredMatch.name || recoveredMatch.fieldName || def.names[0],
        });
        definitions = refreshed;
        continue;
      }
      throw error;
    }
  }

  const resolved = await resolveReferralFields();
  return {
    configured,
    existing,
    created,
    recovered,
    fields: resolved.fields,
    missingFields: resolved.missing,
  };
}

function getCustomFieldValue(opportunity, fieldId) {
  if (!fieldId) return '';
  const customFields = [
    ...(Array.isArray(opportunity.customFields) ? opportunity.customFields : []),
    ...(Array.isArray(opportunity.custom_fields) ? opportunity.custom_fields : []),
  ];

  const match = customFields.find((field) => {
    return [field.id, field.fieldId, field.key, field.fieldKey].filter(Boolean).includes(fieldId);
  });

  if (!match) return '';
  const value = match.field_value ?? match.value ?? match.fieldValue ?? match.values ?? '';
  return Array.isArray(value) ? value.join(', ') : String(value || '');
}

function contactName(opportunity) {
  const contact = opportunity.contact || {};
  return (
    opportunity.name ||
    contact.name ||
    [contact.firstName || contact.first_name, contact.lastName || contact.last_name].filter(Boolean).join(' ') ||
    'Unnamed opportunity'
  );
}

function contactEmail(opportunity) {
  return opportunity.contact?.email || opportunity.email || '';
}

function contactPhone(opportunity) {
  return opportunity.contact?.phone || opportunity.phone || '';
}

function normalizeOpportunity(opportunity, referralFields, stageMap) {
  const referredById = getCustomFieldValue(opportunity, referralFields.referrerOpportunityId);
  const reviewStatus = getCustomFieldValue(opportunity, referralFields.reviewStatus);
  const referralAskStatus = getCustomFieldValue(opportunity, referralFields.referralAskStatus);
  const linkedAt = getCustomFieldValue(opportunity, referralFields.referralLinkedAt);
  const note = getCustomFieldValue(opportunity, referralFields.referralNote);

  const stageId = opportunity.pipelineStageId || opportunity.pipeline_stage_id || opportunity.stageId || '';
  const status = String(opportunity.status || '').toLowerCase();
  const name = contactName(opportunity);
  const createdAt = opportunity.createdAt || opportunity.created_at || opportunity.dateAdded || '';
  const updatedAt = opportunity.updatedAt || opportunity.updated_at || opportunity.lastStatusChangeAt || '';
  const wonAt = opportunity.lastStatusChangeAt || opportunity.wonAt || updatedAt || createdAt;

  return {
    id: opportunity.id,
    name,
    status,
    source: opportunity.source || opportunity.leadSource || opportunity.attributionSource || '',
    value: Number(opportunity.monetaryValue || opportunity.monetary_value || 0),
    pipelineId: opportunity.pipelineId || opportunity.pipeline_id || '',
    pipelineStageId: stageId,
    stageName: stageMap[stageId] || '',
    contactId: opportunity.contactId || opportunity.contact_id || opportunity.contact?.id || '',
    contactName: opportunity.contact?.name || name,
    email: contactEmail(opportunity),
    phone: contactPhone(opportunity),
    createdAt,
    updatedAt,
    wonAt,
    referredById,
    referredByName: getCustomFieldValue(opportunity, referralFields.referrerName),
    referredByContactId: getCustomFieldValue(opportunity, referralFields.referrerContactId),
    referralLinkedAt: linkedAt,
    referralNote: note,
    reviewStatus,
    referralAskStatus,
    referralsMade: [],
    bucket: bucketFor({ referredById, reviewStatus, referralAskStatus }),
  };
}

function bucketFor(opportunity) {
  const combined = `${opportunity.reviewStatus || ''} ${opportunity.referralAskStatus || ''}`.toLowerCase();
  if (combined.includes('complete') || combined.includes('reviewed') || combined.includes('done')) return 'complete';
  if (combined.includes('sent') || combined.includes('requested') || combined.includes('asked')) return 'sent';
  if (opportunity.referredById) return 'linked';
  return 'won';
}

function buildStageMap(pipelines) {
  const map = {};
  for (const pipeline of pipelines || []) {
    for (const stage of pipeline.stages || []) {
      map[stage.id] = stage.name;
    }
  }
  return map;
}

async function getWonOpportunityTrackerData() {
  const [{ fields, missing }, pipelines, opportunitiesRaw] = await Promise.all([
    resolveReferralFields(),
    fetchPipelines(),
    fetchAllOpportunities(),
  ]);

  const stageMap = buildStageMap(pipelines);
  const wonRaw = opportunitiesRaw.filter((opportunity) => String(opportunity.status || '').toLowerCase() === 'won');
  const wonDetailed = await hydrateOpportunities(wonRaw);
  const won = wonDetailed.map((opportunity) => normalizeOpportunity(opportunity, fields, stageMap));

  const byId = new Map(won.map((opportunity) => [opportunity.id, opportunity]));
  for (const opportunity of won) {
    if (opportunity.referredById && byId.has(opportunity.referredById)) {
      byId.get(opportunity.referredById).referralsMade.push({
        id: opportunity.id,
        name: opportunity.name,
        value: opportunity.value,
        linkedAt: opportunity.referralLinkedAt,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    fields,
    missingFields: missing,
    opportunities: won,
  };
}

async function updateOpportunityFields(opportunityId, fieldValues) {
  assertGhlConfig();
  const { fields, missing } = await resolveReferralFields();
  const customFields = [];

  for (const [fieldKey, value] of Object.entries(fieldValues)) {
    if (!fields[fieldKey]) continue;
    customFields.push({
      id: fields[fieldKey],
      field_value: value == null ? '' : String(value),
    });
  }

  if (!customFields.length) {
    const err = new Error('No referral custom field IDs are configured for this update.');
    err.statusCode = 400;
    err.missingFields = missing;
    throw err;
  }

  let existing = {};
  try {
    const data = await ghlRequest(`/opportunities/${encodeURIComponent(opportunityId)}`);
    existing = data.opportunity || data;
  } catch {
    existing = {};
  }

  const body = {
    pipelineId: existing.pipelineId || existing.pipeline_id,
    pipelineStageId: existing.pipelineStageId || existing.pipeline_stage_id || existing.stageId,
    name: existing.name,
    status: existing.status,
    contactId: existing.contactId || existing.contact_id || existing.contact?.id,
    monetaryValue: existing.monetaryValue || existing.monetary_value,
    assignedTo: existing.assignedTo || existing.assigned_to,
    customFields,
  };

  Object.keys(body).forEach((key) => {
    if (body[key] === undefined || body[key] === null || body[key] === '') delete body[key];
  });

  return ghlRequest(`/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

function publicSetupState(missingFields) {
  const cfg = getGhlConfig();
  return {
    hasGhlApiKey: !!cfg.apiKey,
    hasLocationId: !!cfg.locationId,
    hasPipelineFilter: !!cfg.pipelineId,
    hasPostInstallWebhook: !!cfg.webhookUrl,
    missingFields,
  };
}

module.exports = {
  FIELD_DEFS,
  bucketFor,
  createSessionToken,
  fetchAllOpportunities,
  fetchCustomFields,
  fetchOpportunity,
  getGhlConfig,
  getWonOpportunityTrackerData,
  ensureReferralFields,
  readJsonBody,
  requireTrackerAuth,
  resolveReferralFields,
  sendJson,
  timingSafeEqualText,
  trackerPassword,
  updateOpportunityFields,
  publicSetupState,
};
