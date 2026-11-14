import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ALL_PERMISSIONS, P, basePermissions, channelPermissions, has, outranks } from "@send/shared";

const guild = { id: "1", owner_id: "100" };
const roles = [
  { id: "1", permissions: String(P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY), position: 0 },
  { id: "10", permissions: String(P.KICK_MEMBERS), position: 1 },
  { id: "20", permissions: String(P.ADMINISTRATOR), position: 2 },
  { id: "30", permissions: "0", position: 3 },
];
const m = (id: string, r: string[] = [], timeout: string | null = null) => ({ user_id: id, roles: r, communication_disabled_until: timeout });

describe("permission resolution", () => {
  it("owner and administrator get everything, everywhere", () => {
    assert.equal(basePermissions(guild, m("100"), roles), ALL_PERMISSIONS);
    const deny = [{ target_id: "1", target_type: 0 as const, allow: "0", deny: String(P.VIEW_CHANNEL) }];
    assert.equal(channelPermissions(guild, m("2", ["20"]), roles, deny), ALL_PERMISSIONS);
  });
  it("applies @everyone, then roles combined, then the member overwrite", () => {
    const ows = [
      { target_id: "1", target_type: 0 as const, allow: "0", deny: String(P.VIEW_CHANNEL) },
      { target_id: "10", target_type: 0 as const, allow: String(P.VIEW_CHANNEL), deny: "0" },
      { target_id: "3", target_type: 1 as const, allow: "0", deny: String(P.SEND_MESSAGES) },
    ];
    assert.equal(channelPermissions(guild, m("2"), roles, ows), 0n, "no view → nothing");
    assert.ok(has(channelPermissions(guild, m("2", ["10"]), roles, ows), P.SEND_MESSAGES));
    const three = channelPermissions(guild, m("3", ["10"]), roles, ows);
    assert.ok(has(three, P.VIEW_CHANNEL) && !has(three, P.SEND_MESSAGES), "member deny beats role allow");
  });
  it("role allow beats role deny when both apply (combined)", () => {
    const ows = [
      { target_id: "10", target_type: 0 as const, allow: "0", deny: String(P.SEND_MESSAGES) },
      { target_id: "30", target_type: 0 as const, allow: String(P.SEND_MESSAGES), deny: "0" },
    ];
    assert.ok(has(channelPermissions(guild, m("2", ["10", "30"]), roles, ows), P.SEND_MESSAGES));
  });
  it("timeouts leave only view and history", () => {
    const p = channelPermissions(guild, m("2", [], new Date(Date.now() + 60_000).toISOString()), roles, []);
    assert.equal(p, P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY);
  });
  it("hierarchy: strictly higher top role, owner untouchable", () => {
    assert.ok(outranks(guild, m("2", ["30"]), m("3", ["10"]), roles));
    assert.ok(!outranks(guild, m("2", ["10"]), m("3", ["10"]), roles));
    assert.ok(!outranks(guild, m("2", ["20"]), m("100"), roles));
    assert.ok(outranks(guild, m("100"), m("2", ["30"]), roles));
  });
});
