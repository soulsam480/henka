import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { parseRssFeed } from "feedsmith";
import { JSONPath } from "jsonpath-plus";

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

type Bindings = {
	APP_SECRET: string;
	APP_ENV: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(async (ctx, next) => {
	const authKey = ctx.req.header("X-Auth-Key");

	if (authKey !== ctx.env.APP_SECRET && ctx.env.APP_ENV !== "development") {
		throw new HTTPException(401, { message: "Invalid request" });
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
	try {
		const { searchParams } = new URL(c.req.url);
		const values = await paramsSchema.safeParseAsync(searchParams);

		if (!values.success) {
			c.status(400);
			return c.json(values.error);
		}

		const { jq = "", url } = values.data;

		const response = await fetch(url);

		if (!response.ok) {
			c.status(400);
			return c.text(response.statusText);
		}

		const xml = await response.text();

		const feed = parseRssFeed(xml);

		if (jq.length === 0) {
			return c.json(feed);
		}
		console.log(jq);

		const result = JSONPath(
			jq,
			feed,
			() => {
				//
			},
			() => {
				//
			},
		);

		return c.json(result);
	} catch (error) {
		c.status(500);
		return c.json(error?.toString());
	}
});

export default app;
