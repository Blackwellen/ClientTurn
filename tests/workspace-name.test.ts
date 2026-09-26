import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceNameFromEmail } from "../src/lib/auth/workspace-name.ts";

test("a work address names the workspace after the company domain", () => {
  assert.equal(workspaceNameFromEmail("hello@acme-digital.co.uk", "Sam"), "Acme Digital");
  assert.equal(workspaceNameFromEmail("sam@northwind.com", "Sam"), "Northwind");
  assert.equal(workspaceNameFromEmail("sam@mail.brightlabs.io", "Sam"), "Brightlabs");
  assert.equal(workspaceNameFromEmail("sam@studio.com.au"), "Studio");
});

test("a personal mailbox falls back to the person's name", () => {
  assert.equal(workspaceNameFromEmail("sam@gmail.com", "Sam"), "Sam's workspace");
  assert.equal(workspaceNameFromEmail("sam@hotmail.co.uk", " Sam "), "Sam's workspace");
  assert.equal(workspaceNameFromEmail("sam@outlook.com", null), "My workspace");
});

test("malformed input never throws and never returns an empty name", () => {
  assert.equal(workspaceNameFromEmail("not-an-email", "Sam"), "Sam's workspace");
  assert.equal(workspaceNameFromEmail("sam@localhost"), "My workspace");
});
