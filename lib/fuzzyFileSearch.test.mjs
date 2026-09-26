import assert from "node:assert/strict";
import test from "node:test";
import { searchFiles } from "./fuzzyFileSearch.ts";

const files = [
  { name: "chapters/main.tex" },
  { name: "methods.tex" },
  { name: "notes.tex" },
  { name: "archive/notes.tex" },
  { name: "notes/draft.tex" },
];

test("matches nonconsecutive filename characters", () => {
  assert.equal(searchFiles(files, "mth")[0]?.name, "methods.tex");
});

test("ranks filename matches above directory matches", () => {
  assert.equal(searchFiles(files, "notes")[0]?.name, "notes.tex");
});

test("matches paths and requires every search term", () => {
  assert.deepEqual(
    searchFiles(files, "chap main").map((file) => file.name),
    ["chapters/main.tex"]
  );
});

test("returns no results when the query is not a subsequence", () => {
  assert.deepEqual(searchFiles(files, "xyz"), []);
});
