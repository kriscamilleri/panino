import { computed, ref, watch } from 'vue';
import { useDocStore } from '@/store/docStore';
import { useMarkdownStore } from '@/store/markdownStore';
import { useSyncStore } from '@/store/syncStore';
import { useStylePresetStore } from '@/store/stylePresetStore';
import { defaultStylesFor } from '@/utils/stylePresets';

/**
 * Which style a style page edits: the library Default or a named style from
 * the open Document's library (the personal library when none is open). The
 * page opens on the style the Document is shown or printed with.
 *
 * @param {'preview'|'print'} kind
 */
export function useStyleEditing(kind) {
  const docStore = useDocStore();
  const markdownStore = useMarkdownStore();
  const syncStore = useSyncStore();
  const stylePresetStore = useStylePresetStore();

  const libraryDbKey = computed(() => docStore.selectedDbKey || syncStore.personalDbKey || null);
  /** '' edits the library Default; otherwise the id of the named style. */
  const editingPresetId = ref('');
  const editingPreset = computed(() => (
    editingPresetId.value && libraryDbKey.value
      ? stylePresetStore.findPreset(libraryDbKey.value, editingPresetId.value)
      : null
  ));
  const defaultValues = () => (kind === 'print' ? docStore.printStyles : docStore.styles);
  const editingValues = computed(() => editingPreset.value?.values || defaultValues());

  let chosenFor = null;
  watch(
    () => [libraryDbKey.value, docStore.selectedFileId, stylePresetStore.libraries.has(libraryDbKey.value)],
    async ([dbKey, fileId, loaded]) => {
      if (!dbKey) return;
      if (!loaded) {
        await stylePresetStore.loadLibrary(dbKey).catch((err) => {
          console.warn('[useStyleEditing] Failed to load styles', err);
        });
        return;
      }
      const key = `${dbKey}:${fileId || ''}`;
      if (chosenFor === key) return;
      chosenFor = key;
      await stylePresetStore.refreshSelectedTrail();
      editingPresetId.value = stylePresetStore.resolveForSelected(kind).preset?.id || '';
    },
    { immediate: true },
  );

  // A named style deleted elsewhere drops back to the Default.
  watch(editingPreset, (preset) => {
    if (!preset && editingPresetId.value) editingPresetId.value = '';
  });

  function saveValues(values) {
    // The store has already shown a toast when the write fails.
    return stylePresetStore.updatePresetValues(libraryDbKey.value, editingPreset.value.id, values).catch(() => {});
  }

  /** Change one setting of the style being edited. */
  function updateEditingStyle(key, value) {
    if (!editingPreset.value) {
      return kind === 'print' ? docStore.updatePrintStyle(key, value) : docStore.updateStyle(key, value);
    }
    return saveValues({ ...editingPreset.value.values, [key]: value });
  }

  /** Put the style being edited back to the built-in values. */
  function resetEditingStyle() {
    if (!editingPreset.value) {
      return kind === 'print' ? markdownStore.resetPrintStyles() : markdownStore.resetStyles();
    }
    return saveValues({ ...defaultStylesFor(kind) });
  }

  /** The page title, naming the style being edited. */
  function titleWith(base) {
    return editingPreset.value ? `${base}: ${editingPreset.value.name}` : base;
  }

  return {
    libraryDbKey,
    editingPresetId,
    editingPreset,
    editingValues,
    updateEditingStyle,
    resetEditingStyle,
    titleWith,
  };
}
