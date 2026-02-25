import { Hono } from 'hono';
import { z } from 'zod';

type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  WAITLIST_RATE_LIMIT_PER_DAY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const waitlistPayloadSchema = z.object({
  email: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.email().max(320),
  ),
  qualifier: z.string().trim().max(80).optional(),
  useCase: z.string().trim().max(1200).optional(),
  website: z.string().trim().max(200).optional(),
  source: z
    .preprocess((value) => (typeof value === 'string' ? value.trim() : value), z.url().max(2048))
    .optional(),
  landingPath: z.string().trim().max(512).optional(),
  utmSource: z.string().trim().max(120).optional(),
  utmMedium: z.string().trim().max(120).optional(),
  utmCampaign: z.string().trim().max(120).optional(),
  utmTerm: z.string().trim().max(120).optional(),
  utmContent: z.string().trim().max(120).optional(),
  locale: z.string().trim().max(32).optional(),
  timezone: z.string().trim().max(64).optional(),
  timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  screen: z.string().trim().max(32).optional(),
  viewport: z.string().trim().max(32).optional(),
  platform: z.string().trim().max(120).optional(),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
  reducedMotion: z.enum(['reduce', 'no-preference']).optional(),
  cookieEnabled: z.boolean().optional(),
  doNotTrack: z.string().trim().max(24).optional(),
  deviceMemory: z.number().min(0).max(128).optional(),
  hardwareConcurrency: z.number().int().min(1).max(256).optional(),
  maxTouchPoints: z.number().int().min(0).max(64).optional(),
  additionalFields: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

app.get('/api/health', (c) => {
  return c.json({ ok: true, service: 'waitlist-api' });
});

app.options('/api/waitlist', (c) => {
  c.header('Allow', 'POST, OPTIONS');
  return c.body(null, 204);
});

app.post('/api/waitlist', async (c) => {
  const rawPayload = await parseRequestBody(c.req.raw);
  const normalizedPayload = normalizePayload(rawPayload);
  const parsedPayload = waitlistPayloadSchema.safeParse(normalizedPayload);

  if (!parsedPayload.success) {
    return c.json(
      {
        ok: false,
        error: 'invalid_payload',
        message: 'Please submit a valid email address.',
      },
      400,
    );
  }

  const payload = parsedPayload.data;

  // Accept and ignore bot submissions from honeypot field.
  if (payload.website && payload.website.length > 0) {
    return c.json({ ok: true, message: 'Thanks for your interest.' }, 200);
  }

  const rateLimitPerDay = parsePositiveInt(c.env.WAITLIST_RATE_LIMIT_PER_DAY, 10);
  const now = new Date();
  const dayStart = startOfUtcDayIso(now);
  const dayEnd = endOfUtcDayIso(now);

  const ipAddress = getConnectingIp(c.req.raw.headers);

  const rateRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM waitlist_entries
     WHERE ip_address = ?1
       AND created_at >= ?2
       AND created_at <= ?3`,
  )
    .bind(ipAddress, dayStart, dayEnd)
    .first<{ count: number | string | null }>();

  const submissionCount = Number(rateRow?.count ?? 0);

  if (submissionCount >= rateLimitPerDay) {
    const retryAfterSeconds = secondsUntilNextUtcDay(now);
    c.header('Retry-After', String(retryAfterSeconds));

    return c.json(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Rate limit reached. Please try again tomorrow.',
      },
      429,
    );
  }

  const requestUrl = new URL(c.req.url);
  const nowIso = now.toISOString();
  const email = payload.email.toLowerCase();
  const cfSnapshot = getCfSnapshot(c.req.raw);
  const additionalFields = sanitizeLooseRecord(payload.additionalFields);
  delete additionalFields.useCase;

  const metadata = {
    provided: payload.metadata ?? {},
    additionalFields,
    request: {
      method: c.req.method,
      path: requestUrl.pathname,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
      source: payload.source ?? requestUrl.toString(),
      cfRay: c.req.raw.headers.get('cf-ray'),
    },
    client: {
      locale: payload.locale ?? null,
      timezone: payload.timezone ?? null,
      timezoneOffsetMinutes: payload.timezoneOffsetMinutes ?? null,
      screen: payload.screen ?? null,
      viewport: payload.viewport ?? null,
      platform: payload.platform ?? null,
      colorScheme: payload.colorScheme ?? null,
      reducedMotion: payload.reducedMotion ?? null,
      cookieEnabled: payload.cookieEnabled ?? null,
      doNotTrack: payload.doNotTrack ?? null,
      deviceMemory: payload.deviceMemory ?? null,
      hardwareConcurrency: payload.hardwareConcurrency ?? null,
      maxTouchPoints: payload.maxTouchPoints ?? null,
      referrer: c.req.raw.headers.get('referer'),
    },
    headers: pickHeaders(c.req.raw.headers, [
      'accept',
      'accept-encoding',
      'accept-language',
      'origin',
      'host',
      'priority',
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'sec-fetch-dest',
      'sec-fetch-mode',
      'sec-fetch-site',
      'user-agent',
      'x-forwarded-proto',
    ]),
    cloudflare: cfSnapshot,
  };

  const upsertValues = [
    email,
    payload.qualifier ?? null,
    payload.useCase ?? null,
    payload.source ?? requestUrl.toString(),
    payload.landingPath ?? requestUrl.pathname,
    ipAddress,
    c.req.raw.headers.get('user-agent'),
    c.req.raw.headers.get('referer'),
    c.req.raw.headers.get('accept-language'),
    c.req.raw.headers.get('origin'),
    c.req.raw.headers.get('host'),
    payload.screen ?? null,
    payload.viewport ?? null,
    payload.platform ?? null,
    payload.timezone ?? null,
    payload.timezoneOffsetMinutes ?? null,
    payload.colorScheme ?? null,
    payload.reducedMotion ?? null,
    payload.cookieEnabled === undefined ? null : payload.cookieEnabled ? 1 : 0,
    payload.doNotTrack ?? null,
    payload.deviceMemory ?? null,
    payload.hardwareConcurrency ?? null,
    payload.maxTouchPoints ?? null,
    cfSnapshot.country,
    cfSnapshot.region,
    cfSnapshot.regionCode,
    cfSnapshot.city,
    cfSnapshot.postalCode,
    cfSnapshot.continent,
    cfSnapshot.timezone,
    cfSnapshot.colo,
    cfSnapshot.asn,
    cfSnapshot.asOrganization,
    cfSnapshot.latitude,
    cfSnapshot.longitude,
    cfSnapshot.metroCode,
    cfSnapshot.botScore,
    cfSnapshot.tlsVersion,
    cfSnapshot.httpProtocol,
    payload.utmSource ?? null,
    payload.utmMedium ?? null,
    payload.utmCampaign ?? null,
    payload.utmTerm ?? null,
    payload.utmContent ?? null,
    JSON.stringify(metadata),
    nowIso,
    nowIso,
  ] as const;

  try {
    await c.env.DB.prepare(
      `INSERT INTO waitlist_entries (
        email,
        qualifier,
        use_case,
        source_url,
        landing_path,
        ip_address,
        user_agent,
        referrer,
        accept_language,
        origin,
        host,
        screen_size,
        viewport_size,
        platform,
        timezone,
        timezone_offset_minutes,
        color_scheme,
        reduced_motion,
        cookie_enabled,
        do_not_track,
        device_memory_gb,
        hardware_concurrency,
        max_touch_points,
        cf_country,
        cf_region,
        cf_region_code,
        cf_city,
        cf_postal_code,
        cf_continent,
        cf_timezone,
        cf_colo,
        cf_asn,
        cf_as_organization,
        cf_latitude,
        cf_longitude,
        cf_metro_code,
        cf_bot_score,
        cf_tls_version,
        cf_http_protocol,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5,
        ?6, ?7, ?8, ?9, ?10,
        ?11, ?12, ?13, ?14, ?15,
        ?16, ?17, ?18, ?19, ?20,
        ?21, ?22, ?23, ?24, ?25,
        ?26, ?27, ?28, ?29, ?30,
        ?31, ?32, ?33, ?34, ?35,
        ?36, ?37, ?38, ?39, ?40,
        ?41, ?42, ?43, ?44, ?45,
        ?46, ?47
      )
      ON CONFLICT(email) DO UPDATE SET
        qualifier = excluded.qualifier,
        use_case = excluded.use_case,
        source_url = excluded.source_url,
        landing_path = excluded.landing_path,
        ip_address = excluded.ip_address,
        user_agent = excluded.user_agent,
        referrer = excluded.referrer,
        accept_language = excluded.accept_language,
        origin = excluded.origin,
        host = excluded.host,
        screen_size = excluded.screen_size,
        viewport_size = excluded.viewport_size,
        platform = excluded.platform,
        timezone = excluded.timezone,
        timezone_offset_minutes = excluded.timezone_offset_minutes,
        color_scheme = excluded.color_scheme,
        reduced_motion = excluded.reduced_motion,
        cookie_enabled = excluded.cookie_enabled,
        do_not_track = excluded.do_not_track,
        device_memory_gb = excluded.device_memory_gb,
        hardware_concurrency = excluded.hardware_concurrency,
        max_touch_points = excluded.max_touch_points,
        cf_country = excluded.cf_country,
        cf_region = excluded.cf_region,
        cf_region_code = excluded.cf_region_code,
        cf_city = excluded.cf_city,
        cf_postal_code = excluded.cf_postal_code,
        cf_continent = excluded.cf_continent,
        cf_timezone = excluded.cf_timezone,
        cf_colo = excluded.cf_colo,
        cf_asn = excluded.cf_asn,
        cf_as_organization = excluded.cf_as_organization,
        cf_latitude = excluded.cf_latitude,
        cf_longitude = excluded.cf_longitude,
        cf_metro_code = excluded.cf_metro_code,
        cf_bot_score = excluded.cf_bot_score,
        cf_tls_version = excluded.cf_tls_version,
        cf_http_protocol = excluded.cf_http_protocol,
        utm_source = excluded.utm_source,
        utm_medium = excluded.utm_medium,
        utm_campaign = excluded.utm_campaign,
        utm_term = excluded.utm_term,
        utm_content = excluded.utm_content,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`,
    )
      .bind(...upsertValues)
      .run();
  } catch (error) {
    if (!isIpHashConstraintError(error)) {
      throw error;
    }

    const upsertValuesWithIpHash = [
      ...upsertValues.slice(0, 5),
      await sha256Hex(ipAddress),
      ...upsertValues.slice(5),
    ];

    await c.env.DB.prepare(
      `INSERT INTO waitlist_entries (
        email,
        qualifier,
        use_case,
        source_url,
        landing_path,
        ip_hash,
        ip_address,
        user_agent,
        referrer,
        accept_language,
        origin,
        host,
        screen_size,
        viewport_size,
        platform,
        timezone,
        timezone_offset_minutes,
        color_scheme,
        reduced_motion,
        cookie_enabled,
        do_not_track,
        device_memory_gb,
        hardware_concurrency,
        max_touch_points,
        cf_country,
        cf_region,
        cf_region_code,
        cf_city,
        cf_postal_code,
        cf_continent,
        cf_timezone,
        cf_colo,
        cf_asn,
        cf_as_organization,
        cf_latitude,
        cf_longitude,
        cf_metro_code,
        cf_bot_score,
        cf_tls_version,
        cf_http_protocol,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5,
        ?6, ?7, ?8, ?9, ?10,
        ?11, ?12, ?13, ?14, ?15,
        ?16, ?17, ?18, ?19, ?20,
        ?21, ?22, ?23, ?24, ?25,
        ?26, ?27, ?28, ?29, ?30,
        ?31, ?32, ?33, ?34, ?35,
        ?36, ?37, ?38, ?39, ?40,
        ?41, ?42, ?43, ?44, ?45,
        ?46, ?47, ?48
      )
      ON CONFLICT(email) DO UPDATE SET
        qualifier = excluded.qualifier,
        use_case = excluded.use_case,
        source_url = excluded.source_url,
        landing_path = excluded.landing_path,
        ip_hash = excluded.ip_hash,
        ip_address = excluded.ip_address,
        user_agent = excluded.user_agent,
        referrer = excluded.referrer,
        accept_language = excluded.accept_language,
        origin = excluded.origin,
        host = excluded.host,
        screen_size = excluded.screen_size,
        viewport_size = excluded.viewport_size,
        platform = excluded.platform,
        timezone = excluded.timezone,
        timezone_offset_minutes = excluded.timezone_offset_minutes,
        color_scheme = excluded.color_scheme,
        reduced_motion = excluded.reduced_motion,
        cookie_enabled = excluded.cookie_enabled,
        do_not_track = excluded.do_not_track,
        device_memory_gb = excluded.device_memory_gb,
        hardware_concurrency = excluded.hardware_concurrency,
        max_touch_points = excluded.max_touch_points,
        cf_country = excluded.cf_country,
        cf_region = excluded.cf_region,
        cf_region_code = excluded.cf_region_code,
        cf_city = excluded.cf_city,
        cf_postal_code = excluded.cf_postal_code,
        cf_continent = excluded.cf_continent,
        cf_timezone = excluded.cf_timezone,
        cf_colo = excluded.cf_colo,
        cf_asn = excluded.cf_asn,
        cf_as_organization = excluded.cf_as_organization,
        cf_latitude = excluded.cf_latitude,
        cf_longitude = excluded.cf_longitude,
        cf_metro_code = excluded.cf_metro_code,
        cf_bot_score = excluded.cf_bot_score,
        cf_tls_version = excluded.cf_tls_version,
        cf_http_protocol = excluded.cf_http_protocol,
        utm_source = excluded.utm_source,
        utm_medium = excluded.utm_medium,
        utm_campaign = excluded.utm_campaign,
        utm_term = excluded.utm_term,
        utm_content = excluded.utm_content,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`,
    )
      .bind(...upsertValuesWithIpHash)
      .run();
  }

  return c.json(
    {
      ok: true,
      message: 'You are on the waitlist.',
    },
    201,
  );
});

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/')) {
      return await app.fetch(request, env, ctx);
    }

    return await env.ASSETS.fetch(request);
  },
};

async function parseRequestBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const jsonBody = await request.json().catch(() => null);
    return isRecord(jsonBody) ? jsonBody : {};
  }

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const output: Record<string, unknown> = {};

    for (const [key, value] of formData.entries()) {
      output[key] = typeof value === 'string' ? value : value.name;
    }

    return output;
  }

  return {};
}

function normalizePayload(raw: Record<string, unknown>): Record<string, unknown> {
  const metadata = parseMetadata(raw.metadata);

  return {
    email: toOptionalString(raw.email),
    qualifier: toOptionalString(raw.qualifier ?? raw.segment ?? raw.role),
    useCase: toOptionalString(raw.useCase ?? raw.use_case ?? raw.intent ?? raw.description),
    website: toOptionalString(raw.website ?? raw.company),
    source: toOptionalString(raw.source ?? raw.source_url),
    landingPath: toOptionalString(raw.landingPath ?? raw.landing_path),
    utmSource: toOptionalString(raw.utmSource ?? raw.utm_source),
    utmMedium: toOptionalString(raw.utmMedium ?? raw.utm_medium),
    utmCampaign: toOptionalString(raw.utmCampaign ?? raw.utm_campaign),
    utmTerm: toOptionalString(raw.utmTerm ?? raw.utm_term),
    utmContent: toOptionalString(raw.utmContent ?? raw.utm_content),
    locale: toOptionalString(raw.locale),
    timezone: toOptionalString(raw.timezone),
    timezoneOffsetMinutes: toOptionalInteger(raw.timezoneOffsetMinutes ?? raw.timezone_offset_minutes),
    screen: toOptionalString(raw.screen),
    viewport: toOptionalString(raw.viewport),
    platform: toOptionalString(raw.platform),
    colorScheme: toOptionalString(raw.colorScheme ?? raw.color_scheme),
    reducedMotion: toOptionalString(raw.reducedMotion ?? raw.reduced_motion),
    cookieEnabled: toOptionalBoolean(raw.cookieEnabled ?? raw.cookie_enabled),
    doNotTrack: toOptionalString(raw.doNotTrack ?? raw.do_not_track),
    deviceMemory: toOptionalNumber(raw.deviceMemory ?? raw.device_memory),
    hardwareConcurrency: toOptionalInteger(raw.hardwareConcurrency ?? raw.hardware_concurrency),
    maxTouchPoints: toOptionalInteger(raw.maxTouchPoints ?? raw.max_touch_points),
    additionalFields: parseMetadata(raw.additionalFields ?? raw.additional_fields ?? raw.fields),
    metadata,
  };
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  try {
    const parsedValue: unknown = JSON.parse(value);
    if (isRecord(parsedValue)) {
      return parsedValue;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function sanitizeLooseRecord(value: Record<string, unknown> | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  const output: Record<string, string> = {};
  let count = 0;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (count >= 24) {
      break;
    }

    const key = rawKey.trim().slice(0, 64);
    if (!key) {
      continue;
    }

    const valueString = toOptionalString(
      typeof rawValue === 'string' ? rawValue : typeof rawValue === 'number' ? String(rawValue) : undefined,
    );

    if (!valueString) {
      continue;
    }

    output[key] = valueString.slice(0, 1200);
    count += 1;
  }

  return output;
}

function parsePositiveInt(value: string | undefined, fallbackValue: number): number {
  if (!value) {
    return fallbackValue;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallbackValue;
  }

  return parsedValue;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptionalInteger(value: unknown): number | undefined {
  const parsed = toOptionalNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  return Math.trunc(parsed);
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getConnectingIp(headers: Headers): string {
  const connectingIp = headers.get('cf-connecting-ip');
  if (connectingIp && connectingIp.length > 0) {
    return connectingIp;
  }

  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0]!.trim();
  }

  return 'unknown';
}

function startOfUtcDayIso(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)).toISOString();
}

function endOfUtcDayIso(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)).toISOString();
}

function secondsUntilNextUtcDay(now: Date): number {
  const nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return Math.max(1, Math.ceil((nextDay.getTime() - now.getTime()) / 1000));
}

function isIpHashConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('NOT NULL constraint failed: waitlist_entries.ip_hash');
}

async function sha256Hex(input: string): Promise<string> {
  const encodedInput = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encodedInput);
  const hashBytes = Array.from(new Uint8Array(digest));
  return hashBytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pickHeaders(headers: Headers, allowed: string[]): Record<string, string> {
  const output: Record<string, string> = {};

  for (const key of allowed) {
    const value = headers.get(key);
    if (value) {
      output[key] = value;
    }
  }

  return output;
}

function getCfSnapshot(request: Request): {
  country: string | null;
  region: string | null;
  regionCode: string | null;
  city: string | null;
  postalCode: string | null;
  continent: string | null;
  timezone: string | null;
  colo: string | null;
  asn: number | null;
  asOrganization: string | null;
  latitude: number | null;
  longitude: number | null;
  metroCode: string | null;
  botScore: number | null;
  tlsVersion: string | null;
  httpProtocol: string | null;
} {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  const botManagement = isRecord(cf?.botManagement) ? cf.botManagement : undefined;

  return {
    country: readCfString(cf, 'country'),
    region: readCfString(cf, 'region'),
    regionCode: readCfString(cf, 'regionCode'),
    city: readCfString(cf, 'city'),
    postalCode: readCfString(cf, 'postalCode'),
    continent: readCfString(cf, 'continent'),
    timezone: readCfString(cf, 'timezone'),
    colo: readCfString(cf, 'colo'),
    asn: readCfInteger(cf, 'asn'),
    asOrganization: readCfString(cf, 'asOrganization'),
    latitude: readCfFloat(cf, 'latitude'),
    longitude: readCfFloat(cf, 'longitude'),
    metroCode: readCfString(cf, 'metroCode'),
    botScore: readCfInteger(botManagement, 'score'),
    tlsVersion: readCfString(cf, 'tlsVersion'),
    httpProtocol: readCfString(cf, 'httpProtocol'),
  };
}

function readCfString(input: Record<string, unknown> | undefined, key: string): string | null {
  if (!input) {
    return null;
  }

  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readCfInteger(input: Record<string, unknown> | undefined, key: string): number | null {
  const value = readCfFloat(input, key);
  return value === null ? null : Math.trunc(value);
}

function readCfFloat(input: Record<string, unknown> | undefined, key: string): number | null {
  if (!input) {
    return null;
  }

  const value = input[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}
