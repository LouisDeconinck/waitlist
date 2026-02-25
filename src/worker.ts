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
  useCase: z.string().trim().max(1200).optional(),
  website: z.string().trim().max(200).optional(),
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

  const nowIso = now.toISOString();
  const email = payload.email.toLowerCase();
  const cfSnapshot = getCfSnapshot(c.req.raw);

  await c.env.DB.prepare(
    `INSERT INTO waitlist_entries (
      email,
      use_case,
      ip_address,
      user_agent,
      accept_language,
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
      cf_bot_score,
      cf_tls_version,
      cf_http_protocol,
      created_at,
      updated_at
    ) VALUES (
      ?1, ?2, ?3, ?4, ?5,
      ?6, ?7, ?8, ?9, ?10,
      ?11, ?12, ?13, ?14, ?15,
      ?16, ?17, ?18, ?19, ?20,
      ?21, ?22
    )
    ON CONFLICT(email) DO UPDATE SET
      use_case = excluded.use_case,
      ip_address = excluded.ip_address,
      user_agent = excluded.user_agent,
      accept_language = excluded.accept_language,
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
      cf_bot_score = excluded.cf_bot_score,
      cf_tls_version = excluded.cf_tls_version,
      cf_http_protocol = excluded.cf_http_protocol,
      updated_at = excluded.updated_at`,
  )
    .bind(
      email,
      payload.useCase ?? null,
      ipAddress,
      c.req.raw.headers.get('user-agent'),
      c.req.raw.headers.get('accept-language'),
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
      cfSnapshot.botScore,
      cfSnapshot.tlsVersion,
      cfSnapshot.httpProtocol,
      nowIso,
      nowIso,
    )
    .run();

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
  return {
    email: toOptionalString(raw.email),
    useCase: toOptionalString(raw.useCase ?? raw.use_case ?? raw.intent ?? raw.description),
    website: toOptionalString(raw.website ?? raw.company),
  };
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
