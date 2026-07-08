const crypto = require('crypto');
const { buildReviewReferralEmail } = require('./email-templates/review-referral-email');

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const ASSOCIATIONS_VERSION = '2021-04-15';
const OPPORTUNITY_CONTACT_ASSOCIATION_ID = 'OPPORTUNITIES_CONTACTS_ASSOCIATION';
const TRACKER_STAGES = ['won', 'linked', 'complete'];

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
  referralTrackingOpportunityId: {
    env: ['AQUOZ_REFERRAL_TRACKING_OPPORTUNITY_FIELD_ID', 'REFERRAL_FIELD_TRACKING_OPPORTUNITY_ID'],
    names: ['Referral - Tracking Opportunity ID', 'Referral Tracking Opportunity ID'],
    dataType: 'TEXT',
  },
  referralTrackingCreatedAt: {
    env: ['AQUOZ_REFERRAL_TRACKING_CREATED_AT_FIELD_ID', 'REFERRAL_FIELD_TRACKING_CREATED_AT'],
    names: ['Referral - Tracking Created At', 'Referral Tracking Created At'],
    dataType: 'TEXT',
  },
  referralAssociationRelationId: {
    env: ['AQUOZ_REFERRAL_ASSOCIATION_RELATION_FIELD_ID', 'REFERRAL_FIELD_ASSOCIATION_RELATION_ID'],
    names: ['Referral - Association Relation ID', 'Referral Association Relation ID'],
    dataType: 'TEXT',
  },
  referredCustomerOpportunityId: {
    env: ['AQUOZ_REFERRED_CUSTOMER_OPPORTUNITY_FIELD_ID', 'REFERRAL_FIELD_REFERRED_CUSTOMER_OPPORTUNITY_ID'],
    names: ['Referral - Referred Customer Opportunity ID', 'Referred Customer Opportunity ID'],
    dataType: 'TEXT',
  },
  referredCustomerName: {
    env: ['AQUOZ_REFERRED_CUSTOMER_NAME_FIELD_ID', 'REFERRAL_FIELD_REFERRED_CUSTOMER_NAME'],
    names: ['Referral - Referred Customer Name', 'Referred Customer Name'],
    dataType: 'TEXT',
  },
  referredCustomerContactId: {
    env: ['AQUOZ_REFERRED_CUSTOMER_CONTACT_FIELD_ID', 'REFERRAL_FIELD_REFERRED_CUSTOMER_CONTACT_ID'],
    names: ['Referral - Referred Customer Contact ID', 'Referred Customer Contact ID'],
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
  trackerStage: {
    env: ['AQUOZ_TRACKER_STAGE_FIELD_ID', 'REFERRAL_FIELD_TRACKER_STAGE'],
    names: ['Referral Tracker - Stage', 'Referral Tracker Stage'],
    dataType: 'TEXT',
  },
  referralPreviousSource: {
    env: ['AQUOZ_REFERRAL_PREVIOUS_SOURCE_FIELD_ID', 'REFERRAL_FIELD_PREVIOUS_SOURCE'],
    names: ['Referral - Previous Source', 'Referral Previous Source'],
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
    // Optional overrides for the baked-in review/referral email template
    // (lib/email-templates/review-referral-email.js) — not required to send.
    reviewUrl: process.env.AQUOZ_REVIEW_URL || process.env.AQUOZ_GOOGLE_REVIEW_URL || '',
    referralAmount: process.env.AQUOZ_REFERRAL_AMOUNT || '',
    reviewEmailTemplateId: process.env.AQUOZ_REVIEW_EMAIL_TEMPLATE_ID || '',
    reviewEmailFrom: process.env.AQUOZ_REVIEW_EMAIL_FROM || '',
    reviewEmailSubject: process.env.AQUOZ_REVIEW_EMAIL_SUBJECT || '',
    // When a referral is linked, both opportunities are moved here in GHL.
    // IDs win if set; otherwise the pipeline/stage are matched by name.
    endOfFunnelPipelineId: process.env.AQUOZ_END_OF_FUNNEL_PIPELINE_ID || '',
    endOfFunnelStageId: process.env.AQUOZ_END_OF_FUNNEL_STAGE_ID || '',
    endOfFunnelPipelineName: process.env.AQUOZ_END_OF_FUNNEL_PIPELINE_NAME || 'End of Funnel',
    endOfFunnelStageName: process.env.AQUOZ_END_OF_FUNNEL_STAGE_NAME || 'Completed',
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

function ghlLocationBaseUrl() {
  const { locationId } = getGhlConfig();
  if (!locationId) return '';
  return `https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}`;
}

function ghlContactUrl(contactId) {
  const base = ghlLocationBaseUrl();
  if (!base || !contactId) return '';
  return `${base}/contacts/detail/${encodeURIComponent(contactId)}`;
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

async function createContactNote(contactId, title, body) {
  if (!contactId || !body) return { skipped: true };
  try {
    const data = await ghlRequest(`/contacts/${encodeURIComponent(contactId)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    });
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      raw: error.raw || null,
      statusCode: error.statusCode || 500,
    };
  }
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

function buildCustomFieldPayload(fieldValues, fields) {
  const customFields = [];
  for (const [fieldKey, value] of Object.entries(fieldValues)) {
    if (!fields[fieldKey]) continue;
    customFields.push({
      id: fields[fieldKey],
      field_value: value == null ? '' : String(value),
    });
  }
  return customFields;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['relations', 'data', 'records', 'items', 'associations']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function relationId(relation) {
  return relation?.id || relation?._id || relation?.relationId || relation?.associationRelationId || '';
}

function relationRecordIds(relation) {
  const ids = new Set();
  for (const value of [
    relation?.firstRecordId,
    relation?.secondRecordId,
    relation?.sourceRecordId,
    relation?.targetRecordId,
    relation?.recordId,
    relation?.associatedRecordId,
    relation?.firstRecord?.id,
    relation?.secondRecord?.id,
    relation?.sourceRecord?.id,
    relation?.targetRecord?.id,
  ]) {
    if (value) ids.add(String(value));
  }
  return ids;
}

function relationMatchesOpportunityContact(relation, opportunityId, contactId) {
  const ids = relationRecordIds(relation);
  return ids.has(String(opportunityId)) && ids.has(String(contactId));
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

function opportunityContactId(opportunity) {
  return opportunity.contactId || opportunity.contact_id || opportunity.contact?.id || '';
}

function normalizeTrackerStage(value) {
  const stage = String(value || '').trim().toLowerCase();
  return TRACKER_STAGES.includes(stage) ? stage : '';
}

function normalizeOpportunity(opportunity, referralFields, stageMap) {
  const referredById = getCustomFieldValue(opportunity, referralFields.referrerOpportunityId);
  const referredByContactId = getCustomFieldValue(opportunity, referralFields.referrerContactId);
  const reviewStatus = getCustomFieldValue(opportunity, referralFields.reviewStatus);
  const referralAskStatus = getCustomFieldValue(opportunity, referralFields.referralAskStatus);
  const trackerStage = normalizeTrackerStage(getCustomFieldValue(opportunity, referralFields.trackerStage));
  const linkedAt = getCustomFieldValue(opportunity, referralFields.referralLinkedAt);
  const note = getCustomFieldValue(opportunity, referralFields.referralNote);
  const trackingOpportunityId = getCustomFieldValue(opportunity, referralFields.referralTrackingOpportunityId);

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
    contactId: opportunityContactId(opportunity),
    contactName: opportunity.contact?.name || name,
    email: contactEmail(opportunity),
    phone: contactPhone(opportunity),
    ghlContactUrl: ghlContactUrl(opportunityContactId(opportunity)),
    createdAt,
    updatedAt,
    wonAt,
    referredById,
    referredByName: getCustomFieldValue(opportunity, referralFields.referrerName),
    referredByContactId,
    referredByGhlContactUrl: ghlContactUrl(referredByContactId),
    referralLinkedAt: linkedAt,
    referralNote: note,
    referralTrackingOpportunityId: trackingOpportunityId,
    referralTrackingCreatedAt: getCustomFieldValue(opportunity, referralFields.referralTrackingCreatedAt),
    referralAssociationRelationId: getCustomFieldValue(opportunity, referralFields.referralAssociationRelationId),
    referredCustomerOpportunityId: getCustomFieldValue(opportunity, referralFields.referredCustomerOpportunityId),
    referredCustomerName: getCustomFieldValue(opportunity, referralFields.referredCustomerName),
    referredCustomerContactId: getCustomFieldValue(opportunity, referralFields.referredCustomerContactId),
    reviewStatus,
    referralAskStatus,
    trackerStage,
    referralPreviousSource: getCustomFieldValue(opportunity, referralFields.referralPreviousSource),
    referrer: null,
    referralsMade: [],
    bucket: bucketFor({ referredById, reviewStatus, referralAskStatus, trackerStage }),
  };
}

function bucketFor(opportunity) {
  const trackerStage = normalizeTrackerStage(opportunity.trackerStage);
  if (trackerStage) return trackerStage;

  const combined = `${opportunity.reviewStatus || ''} ${opportunity.referralAskStatus || ''}`.toLowerCase();
  if (combined.includes('complete') || combined.includes('reviewed') || combined.includes('done')) return 'complete';
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
      const referrer = byId.get(opportunity.referredById);
      opportunity.referrer = {
        id: referrer.id,
        name: referrer.name,
        value: referrer.value,
        source: referrer.source,
        contactId: referrer.contactId,
        contactName: referrer.contactName,
        email: referrer.email,
        phone: referrer.phone,
        ghlContactUrl: referrer.ghlContactUrl,
      };
      referrer.referralsMade.push({
        id: opportunity.id,
        name: opportunity.name,
        value: opportunity.value,
        source: opportunity.source,
        contactId: opportunity.contactId,
        contactName: opportunity.contactName,
        email: opportunity.email,
        phone: opportunity.phone,
        ghlContactUrl: opportunity.ghlContactUrl,
        linkedAt: opportunity.referralLinkedAt,
        associationRelationId: opportunity.referralAssociationRelationId,
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

async function getReferralParticipant(opportunityId) {
  const { fields } = await resolveReferralFields();
  const opportunity = normalizeOpportunity(await fetchOpportunity(opportunityId), fields, {});
  if (opportunity.status !== 'won') {
    const err = new Error(`${opportunity.name || 'Selected opportunity'} is not marked won.`);
    err.statusCode = 400;
    throw err;
  }
  return opportunity;
}

async function getReferralLinkParticipants(opportunityId, referrerOpportunityId = '') {
  const ids = [opportunityId, referrerOpportunityId].filter(Boolean);
  const rows = await Promise.all(ids.map((id) => getReferralParticipant(id)));
  return {
    target: rows[0] || null,
    referrer: referrerOpportunityId ? rows[1] || null : null,
  };
}

async function updateOpportunityFields(opportunityId, fieldValues) {
  assertGhlConfig();
  const { fields, missing } = await resolveReferralFields();
  const customFields = buildCustomFieldPayload(fieldValues, fields);
  const hasSourceUpdate = Object.prototype.hasOwnProperty.call(fieldValues, 'source');

  if (!customFields.length && !hasSourceUpdate) {
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
  if (hasSourceUpdate) body.source = fieldValues.source;

  Object.keys(body).forEach((key) => {
    if (body[key] === undefined || body[key] === null) delete body[key];
    if (body[key] === '' && !(key === 'source' && hasSourceUpdate)) delete body[key];
  });

  return ghlRequest(`/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// Builds the review + referral email from the baked-in template
// (lib/email-templates/review-referral-email.js), applying any env-var
// overrides for the review link / referral amount. Used for both the
// tracker's live preview and the actual send, so what you see is what sends.
function buildReviewEmail(opportunity, note = '') {
  const cfg = getGhlConfig();
  const overrides = {};
  if (cfg.reviewUrl) overrides.reviewUrl = cfg.reviewUrl;
  if (cfg.referralAmount) overrides.referralAmount = cfg.referralAmount;
  return buildReviewReferralEmail(opportunity, note, overrides);
}

async function sendReviewRequestEmail(opportunity, note = '') {
  const cfg = assertGhlConfig();
  if (!opportunity.contactId) {
    const err = new Error('This opportunity does not have a GHL contact ID, so the review email cannot be sent.');
    err.statusCode = 400;
    throw err;
  }

  const built = buildReviewEmail(opportunity, note);

  const payload = {
    type: 'Email',
    contactId: opportunity.contactId,
  };

  if (opportunity.email) payload.emailTo = opportunity.email;
  if (cfg.reviewEmailFrom) payload.emailFrom = cfg.reviewEmailFrom;

  if (cfg.reviewEmailTemplateId) {
    // Optional escape hatch: send via a GHL-side template instead of our
    // built-in design, if one has been configured.
    payload.templateId = cfg.reviewEmailTemplateId;
    payload.subject = cfg.reviewEmailSubject || built.subject;
  } else {
    payload.subject = cfg.reviewEmailSubject || built.subject;
    payload.html = built.html;
    payload.message = built.text;
  }

  return ghlRequest('/conversations/messages', {
    method: 'POST',
    headers: { Version: ASSOCIATIONS_VERSION },
    body: JSON.stringify(payload),
  });
}

function trackerStageUpdate(stage, opportunity, reason = '', options = {}) {
  const normalizedStage = normalizeTrackerStage(stage);
  if (!normalizedStage) {
    const err = new Error('Invalid tracker stage.');
    err.statusCode = 400;
    throw err;
  }

  const updates = {
    trackerStage: normalizedStage,
  };

  if (options.updateStatus && normalizedStage === 'complete') {
    const now = new Date().toISOString();
    updates.reviewStatus = 'Complete';
    updates.referralAskStatus = reason || `Marked complete in tracker on ${now}`;
  }

  if (options.updateStatus && normalizedStage === 'linked' && opportunity?.referredById) {
    updates.referralAskStatus = reason || opportunity.referralAskStatus || '';
  }

  return updates;
}

async function moveOpportunityTrackerStage(opportunity, stage, reason = '', options = {}) {
  await ensureReferralFields();
  const updates = trackerStageUpdate(stage, opportunity, reason, options);
  return updateOpportunityFields(opportunity.id, updates);
}

async function fetchOpportunityContactRelations(opportunityId) {
  try {
    const data = await ghlRequest(`/associations/relations/${encodeURIComponent(opportunityId)}`, {
      headers: { Version: ASSOCIATIONS_VERSION },
    });
    return asArray(data);
  } catch {
    return [];
  }
}

async function findOpportunityContactRelation(opportunityId, contactId) {
  const relations = await fetchOpportunityContactRelations(opportunityId);
  return relations.find((relation) => relationMatchesOpportunityContact(relation, opportunityId, contactId)) || null;
}

async function createOpportunityContactRelation(opportunity, contactId) {
  const cfg = assertGhlConfig();
  if (!opportunity?.id || !contactId) {
    const err = new Error('Opportunity ID and customer contact ID are required to link an additional opportunity.');
    err.statusCode = 400;
    throw err;
  }

  const existing = await findOpportunityContactRelation(opportunity.id, contactId);
  if (existing) {
    return {
      ...existing,
      id: relationId(existing),
      reused: true,
    };
  }

  const data = await ghlRequest('/associations/relations', {
    method: 'POST',
    headers: { Version: ASSOCIATIONS_VERSION },
    body: JSON.stringify({
      associationId: OPPORTUNITY_CONTACT_ASSOCIATION_ID,
      firstRecordId: opportunity.id,
      secondRecordId: contactId,
      locationId: cfg.locationId,
      pipelineId: opportunity.pipelineId || opportunity.pipeline_id || '',
    }),
  });
  const relation = data.relation || data;
  return {
    ...relation,
    id: relationId(relation),
    reused: false,
  };
}

function referralLinkMessage(target, referrer, note) {
  const base = `Customer ${target.name} was referred by ${referrer.name} - updated by tracker`;
  return note ? `${base}\nContext: ${note}` : base;
}

function cleanReferralContext(note) {
  const value = String(note || '').trim();
  if (/updated by tracker/i.test(value)) return '';
  return value;
}

function referralSource(referrer) {
  const name = String(referrer?.name || referrer?.contactName || '').trim();
  return name ? `Referral-${name}` : 'Referral';
}

function referralUnlinkMessage(target, previousReferrerName) {
  const suffix = previousReferrerName ? ` from ${previousReferrerName}` : '';
  return `Referral link removed for ${target.name}${suffix} - updated by tracker`;
}

async function deleteRelationById(id) {
  if (!id) return { skipped: true, reason: 'No relation ID was provided.' };
  const cfg = assertGhlConfig();
  const path = `/associations/relations/${encodeURIComponent(id)}?locationId=${encodeURIComponent(cfg.locationId)}`;
  try {
    return await ghlRequest(path, {
      method: 'DELETE',
      headers: { Version: ASSOCIATIONS_VERSION },
      body: JSON.stringify({ locationId: cfg.locationId }),
    });
  } catch (error) {
    const notFound = error.statusCode === 404 || /not found/i.test(error.message || '');
    if (notFound) return { skipped: true, reason: 'Relation was already missing.' };
    throw error;
  }
}

async function deleteOpportunityContactRelation(opportunityId, contactId, storedRelationId = '') {
  if (storedRelationId) return deleteRelationById(storedRelationId);
  if (!opportunityId || !contactId) return { skipped: true, reason: 'Missing opportunity or contact ID.' };
  const relation = await findOpportunityContactRelation(opportunityId, contactId);
  const id = relationId(relation);
  if (!id) return { skipped: true, reason: 'No linked additional opportunity relation was found.' };
  return deleteRelationById(id);
}

async function createOrReuseReferralAssociation(target, referrer) {
  if (target.referralAssociationRelationId && target.referredById === referrer.id) {
    try {
      const existing = await findOpportunityContactRelation(referrer.id, target.contactId);
      if (existing && relationId(existing) === target.referralAssociationRelationId) {
        return {
          ...existing,
          id: target.referralAssociationRelationId,
          reused: true,
        };
      }
    } catch {
      // If the stored relation is stale, create/find a fresh association below.
    }
  }
  return createOpportunityContactRelation(referrer, target.contactId);
}

// Resolve the "End of Funnel" pipeline + "Completed" stage that linked
// referrals get moved into. Env IDs win; otherwise match by name (exact first,
// then partial) against the GHL pipelines.
async function resolveEndOfFunnelTarget() {
  const cfg = getGhlConfig();
  if (cfg.endOfFunnelPipelineId && cfg.endOfFunnelStageId) {
    return {
      pipelineId: cfg.endOfFunnelPipelineId,
      stageId: cfg.endOfFunnelStageId,
      pipelineName: cfg.endOfFunnelPipelineName,
      stageName: cfg.endOfFunnelStageName,
    };
  }

  const pipelines = await fetchPipelines();
  const wantPipe = normalizeName(cfg.endOfFunnelPipelineName);
  const wantStage = normalizeName(cfg.endOfFunnelStageName);

  const pipeline = pipelines.find((p) => normalizeName(p.name) === wantPipe)
    || pipelines.find((p) => normalizeName(p.name).includes(wantPipe));
  if (!pipeline) {
    const err = new Error(`Could not find a pipeline named "${cfg.endOfFunnelPipelineName}" in GHL. Set AQUOZ_END_OF_FUNNEL_PIPELINE_ID to override.`);
    err.statusCode = 400;
    throw err;
  }

  const stages = pipeline.stages || [];
  const stage = stages.find((s) => normalizeName(s.name) === wantStage)
    || stages.find((s) => normalizeName(s.name).includes(wantStage));
  if (!stage) {
    const err = new Error(`Could not find a "${cfg.endOfFunnelStageName}" stage in the "${pipeline.name}" pipeline. Set AQUOZ_END_OF_FUNNEL_STAGE_ID to override.`);
    err.statusCode = 400;
    throw err;
  }

  return { pipelineId: pipeline.id, stageId: stage.id, pipelineName: pipeline.name, stageName: stage.name };
}

async function moveOpportunityToPipelineStage(opportunityId, pipelineId, stageId) {
  assertGhlConfig();
  let existing = {};
  try {
    const data = await ghlRequest(`/opportunities/${encodeURIComponent(opportunityId)}`);
    existing = data.opportunity || data;
  } catch {
    existing = {};
  }

  const body = {
    pipelineId,
    pipelineStageId: stageId,
    name: existing.name,
    status: existing.status,
    contactId: existing.contactId || existing.contact_id || existing.contact?.id,
    monetaryValue: existing.monetaryValue || existing.monetary_value,
    assignedTo: existing.assignedTo || existing.assigned_to,
  };
  Object.keys(body).forEach((key) => {
    if (body[key] === undefined || body[key] === null || body[key] === '') delete body[key];
  });

  return ghlRequest(`/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// Best-effort: move both the referred customer and the referrer into the
// End of Funnel / Completed pipeline stage. Never throws — a failure here must
// not undo an otherwise-successful referral link; it's reported as a warning.
async function moveReferralPairToEndOfFunnel(target, referrer) {
  try {
    const dest = await resolveEndOfFunnelTarget();
    const ids = [target.id, referrer.id].filter(Boolean);
    const moved = [];
    for (const id of ids) {
      await moveOpportunityToPipelineStage(id, dest.pipelineId, dest.stageId);
      moved.push(id);
    }
    return { moved, pipelineName: dest.pipelineName, stageName: dest.stageName, warning: '' };
  } catch (error) {
    return { moved: [], pipelineName: '', stageName: '', warning: error.message };
  }
}

async function linkReferral(target, referrer, note) {
  await ensureReferralFields();
  const context = cleanReferralContext(note);
  const sameReferrer = target.referredById === referrer.id;
  const relation = await createOrReuseReferralAssociation(target, referrer);
  const linkedAt = new Date().toISOString();
  const auditNote = referralLinkMessage(target, referrer, context);
  const shouldCreateContactNote = !sameReferrer || !!context;
  const previousSource = target.referralPreviousSource
    || (/^referral-/i.test(target.source || '') ? '' : target.source || '');
  const referralUpdate = await updateOpportunityFields(target.id, {
    referrerOpportunityId: referrer.id,
    referrerName: referrer.name,
    referrerContactId: referrer.contactId,
    referralLinkedAt: linkedAt,
    referralNote: shouldCreateContactNote || !target.referralNote ? auditNote : target.referralNote,
    referralTrackingOpportunityId: '',
    referralTrackingCreatedAt: '',
    referralAssociationRelationId: relation.id,
    trackerStage: 'linked',
    referralPreviousSource: previousSource,
    source: referralSource(referrer),
  });
  const contactNote = shouldCreateContactNote
    ? await createContactNote(target.contactId, 'Referral updated by tracker', auditNote)
    : { skipped: true };

  // Both opportunities move to the End of Funnel / Completed stage in GHL.
  const pipelineMove = await moveReferralPairToEndOfFunnel(target, referrer);

  return {
    contactNote,
    referralUpdate,
    relation,
    pipelineMove,
  };
}

async function unlinkReferral(target) {
  await ensureReferralFields();
  const deletedRelation = await deleteOpportunityContactRelation(
    target.referredById,
    target.contactId,
    target.referralAssociationRelationId,
  );
  const previousReferrerName = target.referredByName || target.referredById || '';
  const auditNote = referralUnlinkMessage(target, previousReferrerName);
  const unlinkUpdates = {
    referrerOpportunityId: '',
    referrerName: '',
    referrerContactId: '',
    referralLinkedAt: '',
    referralNote: '',
    referralTrackingOpportunityId: '',
    referralTrackingCreatedAt: '',
    referralAssociationRelationId: '',
    trackerStage: 'won',
    referralPreviousSource: '',
  };
  if (target.referralPreviousSource || /^referral-/i.test(target.source || '')) {
    unlinkUpdates.source = target.referralPreviousSource || '';
  }
  const referralUpdate = await updateOpportunityFields(target.id, unlinkUpdates);
  const contactNote = await createContactNote(target.contactId, 'Referral removed by tracker', auditNote);

  return {
    contactNote,
    deletedRelation,
    previousReferrerName,
    referralUpdate,
  };
}

function publicSetupState(missingFields) {
  const cfg = getGhlConfig();
  return {
    hasGhlApiKey: !!cfg.apiKey,
    hasLocationId: !!cfg.locationId,
    hasPipelineFilter: !!cfg.pipelineId,
    hasPostInstallWebhook: !!cfg.webhookUrl,
    hasReviewUrl: !!cfg.reviewUrl,
    hasReviewEmailTemplate: !!cfg.reviewEmailTemplateId,
    hasReviewEmailFrom: !!cfg.reviewEmailFrom,
    // The review + referral email always has a baked-in template
    // (lib/email-templates/review-referral-email.js), so sending never
    // requires AQUOZ_REVIEW_URL / AQUOZ_REVIEW_EMAIL_TEMPLATE_ID.
    reviewEmailReady: true,
    missingFields,
  };
}

module.exports = {
  FIELD_DEFS,
  TRACKER_STAGES,
  bucketFor,
  createOpportunityContactRelation,
  createSessionToken,
  deleteOpportunityContactRelation,
  fetchAllOpportunities,
  fetchCustomFields,
  fetchOpportunity,
  getGhlConfig,
  getReferralLinkParticipants,
  getWonOpportunityTrackerData,
  ensureReferralFields,
  linkReferral,
  moveOpportunityTrackerStage,
  moveReferralPairToEndOfFunnel,
  resolveEndOfFunnelTarget,
  readJsonBody,
  requireTrackerAuth,
  resolveReferralFields,
  buildReviewEmail,
  sendJson,
  sendReviewRequestEmail,
  timingSafeEqualText,
  trackerPassword,
  unlinkReferral,
  updateOpportunityFields,
  publicSetupState,
};
