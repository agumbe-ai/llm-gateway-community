import { createTestApp } from "../../test/setup";

const app = createTestApp();

afterAll(async () => {
  await app.close();
});

test("GET /healthz returns service health", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/healthz",
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    ok: true,
    service: "llm-gateway-test",
  });
});
