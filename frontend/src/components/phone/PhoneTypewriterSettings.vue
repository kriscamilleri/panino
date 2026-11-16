<template>
    <!--
    Settings → Writing on phones (docs/specs/active/typewriter-mode.md §9.5,
    §9.6). Changes the phone profile only; the desktop one is left alone.
    -->
    <div
        class="ph-card ph-tw"
        data-testid="phone-settings-typewriter"
    >
        <div class="ph-tw-line">
            <div class="ph-tw-grow">
                <p
                    id="ph-tw-mode"
                    class="ph-tw-strong"
                >{{ COPY.mode }}</p>
                <p class="ph-muted ph-tw-help">{{ COPY.modeHelp }}</p>
            </div>
            <button
                type="button"
                role="switch"
                class="ph-switch"
                :aria-checked="settings.enabled"
                aria-labelledby="ph-tw-mode"
                data-testid="phone-settings-typewriter-enabled"
                @click="update({ enabled: !settings.enabled })"
            ><span aria-hidden="true"></span></button>
        </div>

        <div class="ph-tw-choices">
            <p class="ph-tw-strong">{{ COPY.scrolling }}</p>
            <SegmentedControl
                :model-value="settings.scrolling"
                :label="COPY.scrolling"
                testid-prefix="phone-settings-typewriter-scrolling"
                :options="SCROLLING_OPTIONS"
                @update:model-value="(value) => update({ scrolling: value })"
            />

            <template v-if="visible.linePosition">
                <p class="ph-tw-strong">{{ COPY.linePosition }}</p>
                <SegmentedControl
                    :model-value="String(anchorPreset)"
                    :label="COPY.linePosition"
                    testid-prefix="phone-settings-typewriter-anchor"
                    :options="ANCHOR_OPTIONS"
                    @update:model-value="(value) => update({ anchorPercent: Number(value) })"
                />
            </template>

            <div
                v-if="visible.contextLines"
                class="ph-tw-stepper-line"
                data-testid="phone-settings-typewriter-lines"
            >
                <p
                    id="ph-tw-lines"
                    class="ph-tw-grow"
                >{{ COPY.contextLines }}</p>
                <div
                    class="ph-tw-stepper"
                    role="group"
                    aria-labelledby="ph-tw-lines"
                >
                    <button
                        type="button"
                        class="ph-btn"
                        aria-label="Fewer lines"
                        :disabled="settings.contextLines <= CONTEXT_LINES_MIN"
                        data-testid="phone-settings-typewriter-lines-minus"
                        @click="update({ contextLines: settings.contextLines - 1 })"
                    >−</button>
                    <output
                        aria-live="polite"
                        data-testid="phone-settings-typewriter-lines-value"
                    >{{ settings.contextLines }}</output>
                    <button
                        type="button"
                        class="ph-btn"
                        aria-label="More lines"
                        :disabled="settings.contextLines >= CONTEXT_LINES_MAX"
                        data-testid="phone-settings-typewriter-lines-plus"
                        @click="update({ contextLines: settings.contextLines + 1 })"
                    >+</button>
                </div>
            </div>

            <div class="ph-tw-stepper-line">
                <p
                    id="ph-tw-highlight"
                    class="ph-tw-grow"
                >{{ COPY.highlightLine }}</p>
                <button
                    type="button"
                    role="switch"
                    class="ph-switch"
                    :aria-checked="settings.highlightLine"
                    aria-labelledby="ph-tw-highlight"
                    data-testid="phone-settings-typewriter-highlight"
                    @click="update({ highlightLine: !settings.highlightLine })"
                ><span aria-hidden="true"></span></button>
            </div>

            <p class="ph-tw-strong">{{ COPY.dim }}</p>
            <SegmentedControl
                :model-value="settings.dim"
                :label="COPY.dim"
                testid-prefix="phone-settings-typewriter-dim"
                :options="DIM_OPTIONS"
                @update:model-value="(value) => update({ dim: value })"
            />

            <template v-if="visible.dimStrength">
                <p class="ph-tw-strong">{{ COPY.dimStrength }}</p>
                <SegmentedControl
                    :model-value="settings.dimStrength"
                    :label="COPY.dimStrength"
                    testid-prefix="phone-settings-typewriter-strength"
                    :options="DIM_STRENGTH_OPTIONS"
                    @update:model-value="(value) => update({ dimStrength: value })"
                />
            </template>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import SegmentedControl from '@/components/phone/SegmentedControl.vue'
import { useTypewriterStore } from '@/store/typewriterStore'
import {
    ANCHOR_PRESETS,
    CONTEXT_LINES_MAX,
    CONTEXT_LINES_MIN,
    DIM_OPTIONS,
    DIM_STRENGTH_OPTIONS,
    SCROLLING_OPTIONS,
    TYPEWRITER_COPY as COPY,
    nearestAnchorPreset,
    visibleTypewriterControls,
} from '@/utils/typewriterSettings'

// SegmentedControl compares strings.
const ANCHOR_OPTIONS = ANCHOR_PRESETS.map((preset) => ({ value: String(preset.value), label: preset.label }))

const store = useTypewriterStore()
const settings = computed(() => store.profiles.phone)
const visible = computed(() => visibleTypewriterControls(settings.value))
const anchorPreset = computed(() => nearestAnchorPreset(settings.value.anchorPercent))

function update(patch) {
    store.update(patch, 'phone')
}
</script>

<style scoped>
.ph-tw {
    overflow: hidden;
}

.ph-tw > * + * {
    border-top: 1px solid var(--ph-line);
}

.ph-tw-line {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 20px;
    font-size: 15px;
}

.ph-tw-grow {
    flex: 1;
    min-width: 0;
}

.ph-tw-strong {
    font-weight: 600;
}

.ph-tw-help {
    font-size: 13px;
}

.ph-tw-choices {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    font-size: 15px;
}

.ph-tw-stepper-line {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
}

.ph-tw-stepper {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}

.ph-tw-stepper .ph-btn {
    min-width: 44px;
    min-height: 44px;
    padding: 0;
    font-size: 20px;
}

.ph-tw-stepper output {
    min-width: 1.5rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
}
</style>
