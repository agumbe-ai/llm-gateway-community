import { createTestApp } from "../../test/setup";

const app = createTestApp();

afterAll(async () => {
  await app.close();
});

test("GET /api/v1/llm/models lists curated models and public aliases", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/llm/models",
  });

  expect(response.statusCode).toBe(200);

  const body = response.json() as {
    object: string;
    data: Array<{ id: string; is_alias?: boolean }>;
  };

  expect(body.object).toBe("list");
  expect(body.data.some((entry) => entry.id === "@openai/gpt-5.4")).toBe(true);
  expect(body.data.some((entry) => entry.id === "smart-default" && entry.is_alias === true)).toBe(
    true,
  );
  expect(body.data.every((entry) => entry.id !== "@google/gemini-2.0-flash")).toBe(true);
});
