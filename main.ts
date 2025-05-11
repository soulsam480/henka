// deno-lint-ignore-file no-explicit-any
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { parseFeed } from "@mikaelporttila/rss";

import { JSONPath } from "@stdext/json";

function safeParseJSON(string: string): any {
	try {
		return JSON.parse(string);
	} catch {
		return string;
	}
}

function searchParamsToValues(
	searchParams: URLSearchParams,
): Record<string, any> {
	return Array.from(searchParams.keys()).reduce(
		(record, key) => {
			const values = searchParams.getAll(key).map(safeParseJSON);
			return { ...record, [key]: values.length > 1 ? values : values[0] };
		},
		{} as Record<string, any>,
	);
}

function makeSearchParamsObjSchema<Schema extends z.ZodObject<z.ZodRawShape>>(
	schema: Schema,
) {
	return z
		.instanceof(URLSearchParams)
		.transform(searchParamsToValues)
		.pipe(schema);
}

const paramsSchema = makeSearchParamsObjSchema(
	z.object({
		url: z.string().url().includes("rsshub.app"),
		jq: z.string().optional(),
	}),
);

const secret = Deno.env.get("APP_SECRET");

const app = new Hono();

if (Deno.env.get("DENO_ENV") === "development") {
	app.use(logger());
}

app.use(async (ctx, next) => {
	const authKey = ctx.req.header("X-Auth-Key");

	if (authKey !== secret && Deno.env.get("DENO_ENV") !== "development") {
		const response = new Response("Invalid request", {
			status: 401,
		});

		throw new HTTPException(401, { res: response });
	}

	await next();
});

app.use(
	"/api/*",
	cors({
		origin: "*",
		allowHeaders: ["X-Auth-Key"],
		allowMethods: ["GET", "OPTIONS"],
	}),
);

app.get("/api/parse", async (c) => {
	const { searchParams } = new URL(c.req.url);
	const values = await paramsSchema.safeParseAsync(searchParams);

	if (!values.success) {
		c.status(400);
		return c.json(values.error);
	}

	const { jq = "", url } = values.data;

	const response = await fetch(url);
	const xml = await response.text();

	const feed = await parseFeed(xml);

	if (jq.length === 0) {
		return c.json(feed);
	}

	const jp = new JSONPath(feed);

	const result = jp.query(jq);

	return c.json(result);
});

Deno.serve(app.fetch);
