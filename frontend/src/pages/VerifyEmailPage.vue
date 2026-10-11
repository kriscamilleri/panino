<template>
  <AccountLayout title="Verify email address" max-width-class="max-w-xl">
    <div v-if="verified" data-testid="email-verified">
      <div class="pn-alert pn-alert-success">
        Email address verified. Invitations sent to {{ addressLabel }} are now listed on the
        Spaces page.
      </div>
      <div class="mt-5 flex justify-end">
        <BaseButton
          variant="primary"
          size="md"
          data-testid="email-verified-continue"
          @click="goToSpaces"
        >Go to Spaces</BaseButton>
      </div>
    </div>
    <div v-else-if="terminalError" class="pn-alert pn-alert-error" data-testid="email-verification-error">
      {{ terminalError }}
    </div>
    <div v-else>
      <h2 class="pn-title-modal">Verify {{ addressLabel }}?</h2>
      <p class="pn-body mt-2">
        Continue only if you asked for this email from this account. Verifying shows that mail
        sent to this address reaches you, so invitations sent to it can be listed and accepted
        here. Visiting this page does not verify it automatically.
      </p>
      <div v-if="retryableError" class="pn-alert pn-alert-error mt-4" data-testid="email-verification-retry">
        {{ retryableError }}
      </div>
      <div class="mt-5 flex justify-end gap-3">
        <BaseButton variant="secondary" size="md" @click="goToSpaces">Cancel</BaseButton>
        <BaseButton
          variant="primary"
          size="md"
          :disabled="pending"
          data-testid="email-verification-confirm"
          @click="verify"
        >
          Verify email address
        </BaseButton>
      </div>
    </div>
  </AccountLayout>
</template>

<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AccountLayout from "@/components/AccountLayout.vue";
import BaseButton from "@/components/BaseButton.vue";
import { useSpacesStore } from "@/store/spacesStore";
import { useSyncStore } from "@/store/syncStore";
import { spaceErrorMessage } from "@/utils/spaceLifecycle";

const route = useRoute();
const router = useRouter();
const spacesStore = useSpacesStore();
const syncStore = useSyncStore();
const token = typeof route.params.token === "string" ? route.params.token : "";
const pending = ref(false);
const verified = ref(false);
const retryableError = ref("");
const terminalError = ref(token ? "" : spaceErrorMessage("EMAIL_VERIFICATION_INVALID"));
const addressLabel = computed(() => spacesStore.accountEmail || "this account's email address");

async function verify() {
  if (!token || pending.value) return;
  pending.value = true;
  retryableError.value = "";
  try {
    await spacesStore.confirmEmailVerification(token);
    verified.value = true;
  } catch (error) {
    // Only a refused link is final. Anything else (offline, a busy server) can
    // be tried again with the same link, so the link stays in the address.
    if (error.code !== "EMAIL_VERIFICATION_INVALID") {
      retryableError.value = "The address could not be verified just now. Try again.";
      return;
    }
    terminalError.value = error.message;
  } finally {
    pending.value = false;
  }
  await router.replace({ name: "verify-email" });
}

// This page can be the first one a tab opens, before the local database is
// ready. The loading page takes the destination with it.
function goToSpaces() {
  if (syncStore.isInitialized) return router.push({ name: "spaces" });
  return router.push({
    name: "loading",
    params: { timestamp: Date.now() },
    query: { redirect: "/spaces" },
  });
}
</script>
