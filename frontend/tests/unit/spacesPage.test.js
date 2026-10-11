// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { nextTick } from "vue";

const SPACE_ID = "22222222-2222-4222-8222-222222222222";
const harness = vi.hoisted(() => ({
  spaces: [],
  detail: null,
  loading: false,
  error: "",
  pendingInvitations: [],
  pendingInvitationsLoading: false,
  pendingInvitationsError: "",
  loadPendingInvitations: vi.fn(async () => []),
  acceptPendingInvitation: vi.fn(),
  loadDetail: vi.fn(async () => {}),
  createSpace: vi.fn(),
  renameSpace: vi.fn(),
  invite: vi.fn(),
  revokeInvite: vi.fn(),
  resendInvite: vi.fn(),
  removeMember: vi.fn(),
  transferOwnership: vi.fn(),
  leaveSpace: vi.fn(),
  requestDeletion: vi.fn(),
  cancelDeletion: vi.fn(async () => ({ space: {} })),
  invitationsEmailVerified: true,
  accountEmail: "reader@example.com",
  requestEmailVerification: vi.fn(async () => ({ emailVerified: false, emailSent: true })),
  pendingSpaceDeletions: [],
  addToast: vi.fn(),
}));

vi.mock("@/store/spacesStore", () => ({ useSpacesStore: () => harness }));
vi.mock("@/store/syncStore", () => ({
  useSyncStore: () => ({
    sharedSpacesAvailable: true,
    get pendingSpaceDeletions() { return harness.pendingSpaceDeletions; },
  }),
}));
vi.mock("@/store/uiStore", () => ({ useUiStore: () => ({ addToast: harness.addToast }) }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }) }));

const SpacesPage = (await import("@/pages/SpacesPage.vue")).default;

const global = {
  stubs: {
    AccountLayout: { template: "<main><slot /></main>" },
    AvatarStack: true,
    UserAvatar: true,
    BaseButton: {
      emits: ["click"],
      template: "<button v-bind='$attrs' @click=\"$emit('click', $event)\"><slot /></button>",
    },
    BaseModal: { props: ["show"], template: "<div v-if='show'><slot /><slot name='footer' /></div>" },
  },
};

// The page listens on `document`; a page left mounted would answer the next
// test's events.
enableAutoUnmount(afterEach);

beforeEach(() => {
  vi.clearAllMocks();
  harness.pendingSpaceDeletions = [];
  harness.invitationsEmailVerified = true;
  harness.pendingInvitations = [];
  harness.spaces = [{
    id: SPACE_ID,
    name: "Writers",
    role: "owner",
    members: [{ id: "owner", name: "Owner" }],
  }];
  harness.detail = {
    space: { id: SPACE_ID, name: "Writers", role: "owner" },
    members: [
      { id: "owner", name: "Owner", role: "owner" },
      { id: "editor", name: "Editor", role: "editor" },
    ],
    invitations: [{
      id: "invite",
      email: "pending@example.test",
      expiresAt: "2026-08-25T00:00:00.000Z",
    }],
  };
  harness.pendingInvitations = [];
  harness.pendingInvitationsLoading = false;
  harness.pendingInvitationsError = "";
});

describe("SpacesPage", () => {
  it("shows owner lifecycle controls, one owner, and pending invitations", async () => {
    const wrapper = mount(SpacesPage, { global });
    await nextTick();
    expect(wrapper.get("[data-testid='space-invite']").text()).toContain("Send invitation");
    expect(wrapper.get("[data-testid='space-members']").text()).toContain("Current owner");
    expect(wrapper.get("[data-testid='space-invitations']").text()).toContain("pending@example.test");
    expect(wrapper.find("[data-testid='space-leave']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='space-delete-request']").exists()).toBe(true);
  });

  it("shows and accepts an invitation addressed to the current account", async () => {
    harness.pendingInvitations = [{
      id: "33333333-3333-4333-8333-333333333333",
      spaceName: "Editorial",
      role: "editor",
      expiresAt: "2026-08-25T00:00:00.000Z",
    }];
    harness.acceptPendingInvitation.mockResolvedValue({
      accepted: true,
      spaceId: "44444444-4444-4444-8444-444444444444",
    });
    const wrapper = mount(SpacesPage, { global });
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wrapper.get("[data-testid='pending-space-invitations']").text())
      .toContain("Editorial");
    await wrapper.get(
      "[data-testid='accept-space-invitation-33333333-3333-4333-8333-333333333333']",
    ).trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.acceptPendingInvitation)
      .toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
    expect(harness.loadDetail)
      .toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
    expect(harness.addToast).toHaveBeenCalledWith(
      "Invitation to Editorial accepted.",
      "success",
    );
  });

  it("creates and copies a replacement link for a pending invitation", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    harness.resendInvite.mockResolvedValue({
      invitation: { id: "invite" },
      invitationUrl: "https://panino.test/#/spaces/invitations/token",
      emailSent: true,
    });
    const wrapper = mount(SpacesPage, { global });
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const copyButton = wrapper.get("[data-testid='space-invitations']").findAll("button")
      .find((button) => button.text() === "Copy new link");
    await copyButton.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    expect(writeText).toHaveBeenCalledWith("https://panino.test/#/spaces/invitations/token");
    expect(harness.addToast).toHaveBeenCalledWith(
      "Invitation link copied. Send it only to the invited email address.",
      "success",
    );
  });

  it("shows editors a read-only member list and explicit leave action", async () => {
    harness.spaces[0].role = "editor";
    harness.detail.space.role = "editor";
    const wrapper = mount(SpacesPage, { global });
    await nextTick();
    expect(wrapper.find("[data-testid='space-invite']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='space-invitations']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='space-leave']").text()).toContain("Leave space");
  });

  it("requires the exact space name before confirming retained deletion", async () => {
    const wrapper = mount(SpacesPage, { global });
    await nextTick();
    await wrapper.get("[data-testid='space-delete-request']").trigger("click");
    const confirm = wrapper.get("[data-testid='space-confirm-action']");
    expect(confirm.attributes("disabled")).toBeDefined();
    await wrapper.get("[data-testid='space-delete-confirm-name']").setValue("Writers");
    expect(wrapper.get("[data-testid='space-confirm-action']").attributes("disabled"))
      .toBeUndefined();
    expect(wrapper.text()).toContain("retained for 30 days");
    expect(wrapper.text()).toContain("cannot be recalled");
  });

  it("shows the owner a space awaiting deletion and cancels on request", async () => {
    // Without this a deletion could not be undone: the space was in no list.
    harness.pendingSpaceDeletions = [{ id: SPACE_ID, name: "Writers", deleteAfter: "2026-11-10T00:00:00.000Z" }];
    const wrapper = mount(SpacesPage, { global });
    await nextTick();
    // Mounting loads the selected space, and buttons are disabled meanwhile.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const section = wrapper.get('[data-testid="pending-space-deletions"]');
    expect(section.text()).toContain("Writers");
    expect(section.text()).toContain("Deleted for good on");

    await wrapper.get(`[data-testid="cancel-space-deletion-${SPACE_ID}"]`).trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.cancelDeletion).toHaveBeenCalledWith(SPACE_ID);
  });

  it("shows no deletion section when nothing is pending", async () => {
    const wrapper = mount(SpacesPage, { global });
    await nextTick();
    expect(wrapper.find('[data-testid="pending-space-deletions"]').exists()).toBe(false);
  });

  it("explains an empty invitation list to an account whose address is not verified", async () => {
    harness.invitationsEmailVerified = false;
    const wrapper = mount(SpacesPage, { global });
    await nextTick();

    const hint = wrapper.get('[data-testid="pending-space-invitations-unverified"]').text();
    expect(hint).toContain("reader@example.com");
    expect(hint).toContain("open the link in an invitation email");
    expect(wrapper.find('[data-testid="email-verification-sent"]').exists()).toBe(false);
  });

  it("sends a verification email on request and says where to look", async () => {
    harness.invitationsEmailVerified = false;
    harness.requestEmailVerification.mockResolvedValue({ emailVerified: false, emailSent: true });
    const wrapper = mount(SpacesPage, { global });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await wrapper.get('[data-testid="send-email-verification"]').trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(harness.requestEmailVerification).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="email-verification-sent"]').text()).toContain("Open the link");
    expect(wrapper.get('[data-testid="send-email-verification"]').text()).toBe("Send again");
    expect(harness.addToast).toHaveBeenCalledWith(
      "Verification email sent to reader@example.com.",
      "success",
    );
  });

  it("reports a verification email that could not be sent and offers no false comfort", async () => {
    harness.invitationsEmailVerified = false;
    harness.requestEmailVerification.mockRejectedValue(
      new Error("The verification email could not be sent. Try again later."),
    );
    const wrapper = mount(SpacesPage, { global });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await wrapper.get('[data-testid="send-email-verification"]').trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.find('[data-testid="email-verification-sent"]').exists()).toBe(false);
    expect(harness.addToast).toHaveBeenCalledWith(
      "The verification email could not be sent. Try again later.",
      "error",
    );
  });

  it("reloads the invitations when the tab is shown again while the address is unverified", async () => {
    harness.invitationsEmailVerified = false;
    const wrapper = mount(SpacesPage, { global, attachTo: document.body });
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.loadPendingInvitations.mockClear();

    document.dispatchEvent(new Event("visibilitychange"));
    expect(harness.loadPendingInvitations).toHaveBeenCalledTimes(1);

    harness.invitationsEmailVerified = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(harness.loadPendingInvitations).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    harness.invitationsEmailVerified = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(harness.loadPendingInvitations).toHaveBeenCalledTimes(1);
  });
});
