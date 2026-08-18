// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

const SPACE_ID = "22222222-2222-4222-8222-222222222222";
const harness = vi.hoisted(() => ({
  spaces: [],
  detail: null,
  loading: false,
  error: "",
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
  addToast: vi.fn(),
}));

vi.mock("@/store/spacesStore", () => ({ useSpacesStore: () => harness }));
vi.mock("@/store/syncStore", () => ({
  useSyncStore: () => ({ sharedSpacesAvailable: true }),
}));
vi.mock("@/store/uiStore", () => ({ useUiStore: () => ({ addToast: harness.addToast }) }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {} }) }));

const SpacesPage = (await import("@/pages/SpacesPage.vue")).default;

const global = {
  stubs: {
    AccountLayout: { template: "<main><slot /></main>" },
    AvatarStack: true,
    UserAvatar: true,
    BaseButton: { template: "<button v-bind='$attrs'><slot /></button>" },
    BaseModal: { props: ["show"], template: "<div v-if='show'><slot /><slot name='footer' /></div>" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
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
});

