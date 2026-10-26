import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const directory = new URL(
  "../integration/outline/app/locales/print/",
  import.meta.url,
);
const catalog = (locale: string) =>
  JSON.parse(
    readFileSync(new URL(`${locale}.json`, directory), "utf8"),
  ) as Record<string, string>;
const placeholders = (text: string) =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort();

test("Print translations cover every message and preserve interpolation variables", () => {
  const english = catalog("en_US");
  for (const locale of ["zh_TW", "zh_CN"]) {
    const translated = catalog(locale);
    assert.deepEqual(
      Object.keys(translated).sort(),
      Object.keys(english).sort(),
      locale,
    );
    for (const [key, value] of Object.entries(english)) {
      assert.ok(translated[key]?.trim(), `${locale}: ${key}`);
      assert.deepEqual(
        placeholders(translated[key]!),
        placeholders(value),
        `${locale}: ${key}`,
      );
    }
  }
});
