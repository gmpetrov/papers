import {
  workspacePolicyUpdateSchema,
  workspacePolicyResponseSchema,
} from "../../contracts/src/responses";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { createAuth } from "../src/index";
import { createDatabase } from "@agentinfra/db";
import { createApi } from "../../core/src/index";
import { hash } from "../../core/src/errors";
const mail = vi.hoisted(() => vi.fn());
vi.mock("@agentinfra/providers", async (original) => ({
  ...(await original<object>()),
  sendAccountEmail: mail,
}));
const db = createDatabase(
  "postgresql://agentinfra:agentinfra_local@localhost:55433/agentinfra_test",
);
const origin = "http://localhost:3000";
let auth: ReturnType<typeof createAuth>;
const jars = new Map<string, Map<string, string>>();
const cookies = (user: string) =>
  [...(jars.get(user) ?? new Map()).entries()]
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
async function call(user: string, path: string, body?: unknown) {
  const response = await auth.handler(
    new Request(origin + "/api/auth" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: origin,
        Cookie: cookies(user),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const jar = jars.get(user) ?? new Map<string, string>();
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0]!;
    const pos = pair.indexOf("=");
    jar.set(pair.slice(0, pos), pair.slice(pos + 1));
  }
  jars.set(user, jar);
  return response;
}
async function data(response: Response) {
  const output = await response.json();
  expect(response.ok, JSON.stringify(output)).toBe(true);
  return output;
}
beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "organization", "user", "Operation", "ProviderEvent", "ImpersonationAudit" CASCADE',
  );
  const password = await hashPassword("organization-test-password");
  for (const id of [
    "owner",
    "admin",
    "member",
    "invited",
    "outsider",
    "support",
  ]) {
    await db.user.create({
      data: {
        id,
        name: id,
        email: id + "@example.test",
        emailVerified: true,
        role: id === "support" ? "admin" : "user",
      },
    });
    await db.account.create({
      data: {
        id,
        userId: id,
        providerId: "credential",
        accountId: id,
        password,
      },
    });
  }
  for (const id of ["org", "other"])
    await db.organization.create({
      data: { id, name: id, slug: id, createdAt: new Date() },
    });
  for (const role of ["owner", "admin", "member"])
    await db.member.create({
      data: {
        id: role,
        organizationId: "org",
        userId: role,
        role,
        createdAt: new Date(),
      },
    });
  await db.member.create({
    data: {
      id: "outside-owner",
      organizationId: "other",
      userId: "outsider",
      role: "owner",
      createdAt: new Date(),
    },
  });
  await db.team.create({
    data: {
      id: "team",
      organizationId: "org",
      name: "Research",
      createdAt: new Date(),
    },
  });
  await db.team.create({
    data: {
      id: "other-team",
      organizationId: "other",
      name: "Other",
      createdAt: new Date(),
    },
  });
  auth = createAuth(db, {
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: "organization-tests-long-enough-secret",
  });
  for (const id of [
    "owner",
    "admin",
    "member",
    "invited",
    "outsider",
    "support",
  ]) {
    await data(
      await call(id, "/sign-in/email", {
        email: id + "@example.test",
        password: "organization-test-password",
      }),
    );
  }
});
afterAll(() => db.$disconnect());
it("selects an existing workspace at sign-in and leaves new users without one", async () => {
  for (const [user, organizationId] of [
    ["owner", "org"],
    ["admin", "org"],
    ["member", "org"],
    ["outsider", "other"],
    ["invited", null],
  ]) {
    const session = await data(await call(user!, "/get-session"));
    expect(session.session.activeOrganizationId).toBe(organizationId);
  }
});

it("defaults to the earliest membership and preserves manual switching", async () => {
  await db.member.create({
    data: {
      id: "owner-second-workspace",
      organizationId: "other",
      userId: "owner",
      role: "member",
      createdAt: new Date(Date.now() + 60_000),
    },
  });
  try {
    await data(
      await call("owner", "/sign-in/email", {
        email: "owner@example.test",
        password: "organization-test-password",
      }),
    );
    expect(
      (await data(await call("owner", "/get-session"))).session
        .activeOrganizationId,
    ).toBe("org");
    await data(
      await call("owner", "/organization/set-active", {
        organizationId: "other",
      }),
    );
    expect(
      (await data(await call("owner", "/get-session"))).session
        .activeOrganizationId,
    ).toBe("other");
  } finally {
    await data(
      await call("owner", "/organization/set-active", {
        organizationId: "org",
      }),
    );
    await db.member.delete({ where: { id: "owner-second-workspace" } });
  }
});
it("members cannot invite or manage membership", async () => {
  expect(
    (
      await call("member", "/organization/invite-member", {
        email: "new@example.test",
        role: "member",
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await call("member", "/organization/update-member-role", {
        memberId: "admin",
        role: "member",
      })
    ).ok,
  ).toBe(false);
  expect(mail).not.toHaveBeenCalled();
});
it("admins cannot grant ownership or remove owners", async () => {
  for (const role of ["owner", ["owner"]])
    expect(
      (
        await call("admin", "/organization/update-member-role", {
          memberId: "member",
          role,
        })
      ).ok,
    ).toBe(false);
  expect(
    (
      await call("admin", "/organization/remove-member", {
        memberIdOrEmail: "owner",
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await call("admin", "/organization/invite-member", {
        email: "new@example.test",
        role: "owner",
      })
    ).ok,
  ).toBe(false);
});
it("preserves the final owner and rejects mixed roles", async () => {
  expect(
    (
      await call("owner", "/organization/update-member-role", {
        memberId: "owner",
        role: "admin",
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await call("owner", "/organization/update-member-role", {
        memberId: "member",
        role: ["admin", "member"],
      })
    ).ok,
  ).toBe(false);
  expect(
    (await db.member.findUniqueOrThrow({ where: { id: "owner" } })).role,
  ).toBe("owner");
});
it("does not allow members to archive or reactivate inboxes", async () => {
  const api = createApi(db, auth, {});
  for (const status of ["active", "archived"]) {
    const response = await api.request(origin + "/v1/inboxes/missing", {
      method: "PATCH",
      headers: {
        Origin: origin,
        Cookie: cookies("member"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });
    expect(response.status).toBe(403);
  }
});

it("lets only an unimpersonated owner change their workspace limits", async () => {
  const api = createApi(db, auth, {});
  const policy = {
    dailyEmailLimit: 0,
    dailySmsLimit: 3,
    maxInboxes: 2,
    maxPhoneNumbers: 0,
  };
  const request = (user: string, body?: unknown, requestOrigin = origin) =>
    api.request(origin + "/v1/workspace/policy", {
      method: body ? "PATCH" : "GET",
      headers: {
        Cookie: cookies(user),
        Origin: requestOrigin,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  for (const user of ["owner", "admin", "member"])
    expect((await request(user)).status).toBe(200);
  for (const user of ["admin", "member"])
    expect((await request(user, policy)).status).toBe(403);
  expect(
    (await request("owner", policy, "https://untrusted.example")).status,
  ).toBe(403);
  expect((await request("owner", { ...policy, maxInboxes: -1 })).status).toBe(
    400,
  );
  expect(
    (await request("owner", { ...policy, organizationId: "other" })).status,
  ).toBe(400);
  const updated = await request("owner", policy);
  expect(updated.status).toBe(200);
  const updatedBody = workspacePolicyUpdateSchema.parse(await data(updated));
  const fetchedBody = workspacePolicyResponseSchema.parse(
    await data(await request("member")),
  );
  expect(updatedBody.policy).toEqual(fetchedBody.policy);
  expect((await data(await request("member"))).policy).toEqual({
    ...policy,
    requireSmsApproval: false,
    requireEmailApproval: false,
    requireProvisioningApproval: false,
  });
  expect(
    (await db.organization.findUniqueOrThrow({ where: { id: "other" } }))
      .dailyEmailLimit,
  ).toBe(100);
  expect(
    await db.auditEvent.count({
      where: {
        organizationId: "org",
        actorId: "owner",
        action: "workspace.policy.updated",
      },
    }),
  ).toBe(1);
  await data(
    await call("support", "/admin/impersonate-user", { userId: "owner" }),
  );
  await data(
    await call("support", "/organization/set-active", {
      organizationId: "org",
    }),
  );
  expect((await request("support", policy)).status).toBe(403);
  await data(await call("support", "/admin/stop-impersonating", {}));
  await db.organization.update({
    where: { id: "org" },
    data: {
      dailyEmailLimit: 100,
      dailySmsLimit: 100,
      maxInboxes: 10,
      maxPhoneNumbers: 5,
    },
  });
});

it.each([
  ["demote", "demote", "ReadCommitted"],
  ["remove", "remove", "ReadCommitted"],
  ["demote", "remove", "ReadCommitted"],
  ["demote", "demote", "RepeatableRead"],
] as const)(
  "preserves an owner during concurrent %s/%s (%s)",
  async (first, second, isolationLevel) => {
    const organizationId = `race-${first}-${second}-${isolationLevel}`;
    await db.organization.create({
      data: {
        id: organizationId,
        name: organizationId,
        slug: organizationId,
        createdAt: new Date(),
      },
    });
    await db.member.createMany({
      data: ["owner", "admin"].map((userId) => ({
        id: `${organizationId}-${userId}`,
        organizationId,
        userId,
        role: "owner",
        createdAt: new Date(),
      })),
    });
    // Both transactions must change their separate owner rows before either
    // commits. A sequential test would miss the write-skew vulnerability.
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const results = await Promise.allSettled(
      [first, second].map((action, index) =>
        db.$transaction(
          async (tx) => {
            const id = `${organizationId}-${index === 0 ? "owner" : "admin"}`;
            if (action === "demote")
              await tx.member.update({
                where: { id },
                data: { role: "admin" },
              });
            else await tx.member.delete({ where: { id } });
            if (++arrived === 2) release();
            await barrier;
          },
          { isolationLevel },
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      await db.member.count({ where: { organizationId, role: "owner" } }),
    ).toBe(1);
    await db.organization.delete({ where: { id: organizationId } });
  },
);

it("allows atomic ownership transfer and intentional organization deletion", async () => {
  const organizationId = "ownership-transfer";
  await db.organization.create({
    data: {
      id: organizationId,
      name: organizationId,
      slug: organizationId,
      createdAt: new Date(),
    },
  });
  await db.member.createMany({
    data: ["owner", "admin"].map((userId) => ({
      id: `${organizationId}-${userId}`,
      organizationId,
      userId,
      role: userId,
      createdAt: new Date(),
    })),
  });
  await db.$transaction(async (tx) => {
    await tx.member.update({
      where: { id: `${organizationId}-owner` },
      data: { role: "member" },
    });
    await tx.member.update({
      where: { id: `${organizationId}-admin` },
      data: { role: "owner" },
    });
  });
  await expect(
    db.member.delete({ where: { id: `${organizationId}-admin` } }),
  ).rejects.toThrow();
  await data(await call("admin", "/organization/delete", { organizationId }));
  expect(
    await db.organization.findUnique({ where: { id: organizationId } }),
  ).toBeNull();
  expect(await db.member.count({ where: { organizationId } })).toBe(0);
});
it("rejects invitations into a team owned by another organization", async () => {
  expect(
    (
      await call("owner", "/organization/invite-member", {
        email: "invited@example.test",
        role: "member",
        teamId: "other-team",
      })
    ).ok,
  ).toBe(false);
  expect(mail).not.toHaveBeenCalled();
});
it("resends one invitation and accepts it once for the matching verified user", async () => {
  const invitation = await data(
    await call("owner", "/organization/invite-member", {
      email: "invited@example.test",
      role: "member",
      teamId: "team",
    }),
  );
  const resent = await data(
    await call("owner", "/organization/invite-member", {
      email: "invited@example.test",
      role: "member",
      teamId: "team",
      resend: true,
    }),
  );
  expect(resent.id).toBe(invitation.id);
  expect(mail).toHaveBeenCalledTimes(2);
  expect(
    (
      await call("outsider", "/organization/accept-invitation", {
        invitationId: invitation.id,
      })
    ).ok,
  ).toBe(false);
  await data(
    await call("invited", "/organization/accept-invitation", {
      invitationId: invitation.id,
    }),
  );
  await call("invited", "/organization/accept-invitation", {
    invitationId: invitation.id,
  });
  expect(
    await db.member.count({
      where: { organizationId: "org", userId: "invited" },
    }),
  ).toBe(1);
  expect(
    await db.teamMember.count({ where: { teamId: "team", userId: "invited" } }),
  ).toBe(1);
});
it("manages team membership without admitting outsiders", async () => {
  expect(
    (
      await call("owner", "/organization/add-team-member", {
        teamId: "team",
        userId: "outsider",
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await call("member", "/organization/add-team-member", {
        teamId: "team",
        userId: "member",
      })
    ).ok,
  ).toBe(false);
  await data(
    await call("owner", "/organization/add-team-member", {
      teamId: "team",
      userId: "member",
    }),
  );
  expect(
    await db.teamMember.count({ where: { teamId: "team", userId: "member" } }),
  ).toBe(1);
  await data(
    await call("owner", "/organization/remove-team-member", {
      teamId: "team",
      userId: "member",
    }),
  );
  expect(
    await db.teamMember.count({ where: { teamId: "team", userId: "member" } }),
  ).toBe(0);
});
it("applies a creator role demotion to existing API keys immediately", async () => {
  const project = await db.project.create({ data: { organizationId: "org" } });
  const agent = await db.agent.create({
    data: { organizationId: "org", projectId: project.id, name: "Test" },
  });
  await db.apiKey.create({
    data: {
      organizationId: "org",
      agentId: agent.id,
      createdBy: "admin",
      name: "Test",
      prefix: "test",
      hash: await hash("role-test-key"),
      scopes: ["email:send"],
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await data(
    await call("owner", "/organization/update-member-role", {
      memberId: "admin",
      role: "member",
    }),
  );
  const api = createApi(db, auth, {});
  const response = await api.request(origin + "/v1/inboxes/missing/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer role-test-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: ["test@example.test"],
      subject: "Test",
      text: "Test",
    }),
  });
  expect(response.status).toBe(403);
});
it("restricts support account lookup to platform administrators", async () => {
  const query =
    "/admin/list-users?filterField=email&filterOperator=eq&filterValue=member%40example.test&limit=10";
  expect((await call("owner", query)).ok).toBe(false);
  expect((await call("member", query)).ok).toBe(false);
  const result = await data(await call("support", query));
  expect(result.users.map((user: { id: string }) => user.id)).toEqual([
    "member",
  ]);
});
it("keeps organization ownership separate from platform impersonation", async () => {
  const before = await db.impersonationAudit.count();
  expect(
    (await call("owner", "/admin/impersonate-user", { userId: "member" })).ok,
  ).toBe(false);
  expect(await db.impersonationAudit.count()).toBe(before);
  await data(
    await call("support", "/admin/impersonate-user", { userId: "member" }),
  );
  const impersonated = await data(await call("support", "/get-session"));
  expect(impersonated.user.id).toBe("member");
  expect(impersonated.session.impersonatedBy).toBe("support");
  const audit = await db.impersonationAudit.findUniqueOrThrow({
    where: { sessionId: impersonated.session.id },
  });
  expect(audit.actorId).toBe("support");
  expect(audit.targetId).toBe("member");
  expect(audit.endedAt).toBeNull();
  expect(
    audit.expiresAt.getTime() - audit.startedAt.getTime(),
  ).toBeLessThanOrEqual(900_000);
  expect(audit.expiresAt.getTime() - audit.startedAt.getTime()).toBeGreaterThan(
    890_000,
  );
  expect(audit).not.toHaveProperty("token");
  const refreshed = await db.session.update({
    where: { id: impersonated.session.id },
    data: { expiresAt: new Date(Date.now() + 86_400_000) },
  });
  expect(refreshed.expiresAt).toEqual(audit.expiresAt);
  await expect(
    db.session.update({
      where: { id: impersonated.session.id },
      data: { impersonatedBy: null },
    }),
  ).rejects.toThrow();
  await data(await call("support", "/admin/stop-impersonating", {}));
  const ended = await db.impersonationAudit.findUniqueOrThrow({
    where: { id: audit.id },
  });
  expect(ended.endedAt).not.toBeNull();
  expect(ended.endedAt!.getTime()).toBeGreaterThanOrEqual(
    audit.startedAt.getTime(),
  );
  expect(ended.endedAt!.getTime()).toBeLessThanOrEqual(
    audit.expiresAt.getTime(),
  );
  expect((await data(await call("support", "/get-session"))).user.id).toBe(
    "support",
  );
});

it("retains impersonation history after account deletion and bounds expired access", async () => {
  await db.user.create({
    data: {
      id: "audit-target",
      name: "Audit target",
      email: "audit-target@example.test",
    },
  });
  const expiresAt = new Date(Date.now() - 60_000);
  await db.session.create({
    data: {
      id: "expired-impersonation",
      token: "test-only-expired-token",
      userId: "audit-target",
      impersonatedBy: "support",
      expiresAt,
      createdAt: new Date(expiresAt.getTime() - 900_000),
    },
  });
  await db.user.delete({ where: { id: "audit-target" } });
  const audit = await db.impersonationAudit.findUniqueOrThrow({
    where: { sessionId: "expired-impersonation" },
  });
  expect(audit.targetId).toBe("audit-target");
  expect(audit.actorId).toBe("support");
  expect(audit.endedAt).toEqual(expiresAt);
});

it("shows invitation details only to the verified recipient and allows decline", async () => {
  const invitation = await db.invitation.create({
    data: {
      id: "review-invitation",
      organizationId: "org",
      inviterId: "owner",
      email: "outsider@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const path = "/organization/get-invitation?id=" + invitation.id;
  expect((await call("member", path)).ok).toBe(false);
  expect(
    (
      await call("member", "/organization/reject-invitation", {
        invitationId: invitation.id,
      })
    ).ok,
  ).toBe(false);
  await db.user.update({
    where: { id: "outsider" },
    data: { emailVerified: false },
  });
  expect((await call("outsider", path)).ok).toBe(false);
  expect(
    (
      await call("outsider", "/organization/accept-invitation", {
        invitationId: invitation.id,
      })
    ).ok,
  ).toBe(false);
  await db.user.update({
    where: { id: "outsider" },
    data: { emailVerified: true },
  });
  const details = await data(await call("outsider", path));
  expect(details.organizationName).toBe("org");
  expect(details.role).toBe("member");
  await data(
    await call("outsider", "/organization/reject-invitation", {
      invitationId: invitation.id,
    }),
  );
  expect(
    (await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } }))
      .status,
  ).toBe("rejected");
  expect(
    await db.member.count({
      where: { userId: "outsider", organizationId: "org" },
    }),
  ).toBe(0);
  expect(
    (
      await call("outsider", "/organization/accept-invitation", {
        invitationId: invitation.id,
      })
    ).ok,
  ).toBe(false);
});
it("does not expose or accept expired invitations", async () => {
  await db.invitation.create({
    data: {
      id: "expired-invitation",
      organizationId: "org",
      inviterId: "owner",
      email: "outsider@example.test",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  expect(
    (
      await call(
        "outsider",
        "/organization/get-invitation?id=expired-invitation",
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await call("outsider", "/organization/accept-invitation", {
        invitationId: "expired-invitation",
      })
    ).ok,
  ).toBe(false);
  expect(
    await db.member.count({
      where: { userId: "outsider", organizationId: "org" },
    }),
  ).toBe(0);
});

it("creates a workspace with its owner, default team and project", async () => {
  const created = await data(
    await call("outsider", "/organization/create", {
      name: "Creation regression",
      slug: "creation-regression",
    }),
  );
  expect(
    await db.member.findFirst({
      where: { organizationId: created.id, userId: "outsider" },
    }),
  ).toMatchObject({ role: "owner" });
  const team = await db.team.findFirstOrThrow({
    where: { organizationId: created.id },
  });
  expect(
    await db.teamMember.findFirst({
      where: { teamId: team.id, userId: "outsider" },
    }),
  ).not.toBeNull();
  expect(
    await db.project.findMany({ where: { organizationId: created.id } }),
  ).toMatchObject([{ name: "Default" }]);
  expect(
    (await data(await call("outsider", "/get-session"))).session
      .activeOrganizationId,
  ).toBe(created.id);
  const duplicate = await call("outsider", "/organization/create", {
    name: "Duplicate",
    slug: "creation-regression",
  });
  expect(duplicate.status).toBe(400);
  expect(
    await db.organization.count({ where: { slug: "creation-regression" } }),
  ).toBe(1);
});
