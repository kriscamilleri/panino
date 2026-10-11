// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

const TOKEN = "a".repeat(64);
const harness = vi.hoisted(() => ({
  confirmEmailVerification: vi.fn(async () => ({ emailVerified: true })),
  accountEmail: "reader@example.com",
  isInitialized: true,
  replace: vi.fn(async () => {}),
  push: vi.fn(),
  token: "",
}));

vi.mock("@/store/spacesStore", () => ({
  useSpacesStore: () => ({
    confirmEmailVerification: harness.confirmEmailVerification,
    get accountEmail() { return harness.accountEmail; },
  }),
}));
vi.mock("@/store/syncStore", () => ({
  useSyncStore: () => ({ get isInitialized() { return harness.isInitialized; } }),
}));
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { token: harness.token } }),
  useRouter: () => ({ replace: harness.replace, push: harness.push }),
}));

const VerifyEmailPage = (await import("@/pages/VerifyEmailPage.vue")).default;
const global = {
  stubs: {
    AccountLayout: { template: "<main><slot /></main>" },
    BaseButton: { template: "<button v-bind='$attrs'><slot /></button>" },
  },
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  harness.confirmEmailVerification.mockReset().mockResolvedValue({ emailVerified: true });
  harness.token = TOKEN;
  harness.accountEmail = "reader@example.com";
  harness.isInitialized = true;
});

describe("VerifyEmailPage", () => {
  it("verifies only on an explicit choice, names the address, and clears the token afterwards", async () => {
    const wrapper = mount(VerifyEmailPage, { global });
    expect(harness.confirmEmailVerification).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Verify reader@example.com?");
    expect(wrapper.text()).toContain("does not verify it automatically");

    await wrapper.get("[data-testid='email-verification-confirm']").trigger("click");
    await settle();

    expect(harness.confirmEmailVerification).toHaveBeenCalledWith(TOKEN);
    expect(harness.replace).toHaveBeenCalledWith({ name: "verify-email" });
    expect(wrapper.get("[data-testid='email-verified']").text()).toContain("reader@example.com");
  });

  it("treats a refused link as final", async () => {
    const refused = Object.assign(new Error("This verification link is invalid or has expired."), {
      code: "EMAIL_VERIFICATION_INVALID",
    });
    harness.confirmEmailVerification.mockRejectedValue(refused);
    const wrapper = mount(VerifyEmailPage, { global });

    await wrapper.get("[data-testid='email-verification-confirm']").trigger("click");
    await settle();

    expect(wrapper.get("[data-testid='email-verification-error']").text()).toContain("invalid or has expired");
    expect(wrapper.find("[data-testid='email-verification-confirm']").exists()).toBe(false);
    expect(harness.replace).toHaveBeenCalledWith({ name: "verify-email" });
  });

  it("keeps the link when the attempt failed for another reason, so it can be tried again", async () => {
    harness.confirmEmailVerification
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ emailVerified: true });
    const wrapper = mount(VerifyEmailPage, { global });

    await wrapper.get("[data-testid='email-verification-confirm']").trigger("click");
    await settle();
    expect(wrapper.get("[data-testid='email-verification-retry']").text()).toContain("Try again");
    expect(harness.replace).not.toHaveBeenCalled();

    await wrapper.get("[data-testid='email-verification-confirm']").trigger("click");
    await settle();
    expect(harness.confirmEmailVerification).toHaveBeenCalledTimes(2);
    expect(wrapper.get("[data-testid='email-verified']").exists()).toBe(true);
  });

  it("says the link is invalid when the address carries no token", () => {
    harness.token = "";
    const wrapper = mount(VerifyEmailPage, { global });
    expect(wrapper.get("[data-testid='email-verification-error']").text()).toContain("invalid");
    expect(wrapper.find("[data-testid='email-verification-confirm']").exists()).toBe(false);
  });

  it("continues to Spaces, through the loading page when the tab started here", async () => {
    const wrapper = mount(VerifyEmailPage, { global });
    await wrapper.get("[data-testid='email-verification-confirm']").trigger("click");
    await settle();

    await wrapper.get("[data-testid='email-verified-continue']").trigger("click");
    expect(harness.push).toHaveBeenLastCalledWith({ name: "spaces" });

    harness.isInitialized = false;
    await wrapper.get("[data-testid='email-verified-continue']").trigger("click");
    expect(harness.push).toHaveBeenLastCalledWith(expect.objectContaining({
      name: "loading",
      query: { redirect: "/spaces" },
    }));
  });
});
