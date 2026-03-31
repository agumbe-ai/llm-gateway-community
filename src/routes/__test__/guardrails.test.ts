import { createTestApp } from "../../test/setup";

const app = createTestApp();

afterAll(async () => {
  await app.close();
});

test("GET /api/v1/llm/guardrails rejects unauthenticated requests", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/llm/guardrails",
  });

  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({
    error: {
      message: "Missing Bearer token or session cookie",
      type: "authentication_error",
      param: null,
      code: "unauthorized",
    },
  });
});
