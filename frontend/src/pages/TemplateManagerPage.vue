<template>
  <AccountLayout title="Templates">
    <!-- ===== List View ===== -->
    <div v-if="currentView === 'list'" class="space-y-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-sm text-gray-600">Templates: {{ templateStore.templates.length }}</p>
        <BaseButton
          @click="openCreate"
          data-testid="templates-new-button"
          class="!text-white !bg-gray-800 !hover:bg-gray-900 !px-4 !py-2"
        >
          <Plus class="w-4 h-4" />
          <span>New</span>
        </BaseButton>
      </div>

      <div class="overflow-x-auto border rounded">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2 text-left">Name</th>
              <th class="px-3 py-2 text-left hidden sm:table-cell">Title Pattern</th>
              <th class="px-3 py-2 text-left hidden md:table-cell">Folder</th>
              <th class="px-3 py-2 text-left hidden lg:table-cell">Excerpt</th>
              <th class="px-3 py-2 text-left">Updated</th>
              <th class="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 bg-white">
            <tr v-if="templateStore.isLoading">
              <td colspan="6" class="px-3 py-4 text-center text-gray-500">Loading templates...</td>
            </tr>
            <tr v-else-if="templateStore.templates.length === 0">
              <td colspan="6" class="px-3 py-4 text-center text-gray-500">
                No templates yet. Create one to get started.
              </td>
            </tr>
            <tr
              v-else
              v-for="tpl in templateStore.templates"
              :key="tpl.id"
            >
              <td class="px-3 py-2 align-middle font-medium">{{ tpl.name }}</td>
              <td class="px-3 py-2 align-middle text-gray-500 hidden sm:table-cell">
                <span v-if="tpl.titlePattern" class="truncate block max-w-[180px]" :title="tpl.titlePattern">{{ tpl.titlePattern }}</span>
                <span v-else class="text-gray-400">—</span>
              </td>
              <td class="px-3 py-2 align-middle text-gray-500 hidden md:table-cell">
                <span v-if="tpl.defaultFolderId">{{ getFolderPath(tpl.defaultFolderId) || '—' }}</span>
                <span v-else class="text-gray-400">—</span>
              </td>
              <td class="px-3 py-2 align-middle text-gray-500 hidden lg:table-cell">{{ excerpt(tpl.content) }}</td>
              <td class="px-3 py-2 align-middle text-gray-500">{{ formatDate(tpl.updatedAt) }}</td>
              <td class="px-3 py-2 align-middle">
                <div class="flex items-center gap-1">
                  <BaseButton
                    @click="openEdit(tpl)"
                    :data-testid="`templates-edit-${tpl.id}`"
                  >
                    <Pencil class="w-4 h-4" />
                    <span>Edit</span>
                  </BaseButton>
                  <BaseButton
                    @click="handleDuplicate(tpl)"
                    :data-testid="`templates-duplicate-${tpl.id}`"
                  >
                    <Copy class="w-4 h-4" />
                    <span>Duplicate</span>
                  </BaseButton>
                  <BaseButton
                    @click="handleDelete(tpl)"
                    :data-testid="`templates-delete-${tpl.id}`"
                  >
                    <Trash2 class="w-4 h-4" />
                    <span>Delete</span>
                  </BaseButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ===== Editor View ===== -->
    <div v-else class="space-y-6">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">
          {{ editingTemplate ? 'Edit Template' : 'New Template' }}
        </h2>
        <BaseButton
          @click="handleCancel"
          data-testid="template-editor-cancel"
        >
          <span>Cancel</span>
        </BaseButton>
      </div>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            v-model="form.name"
            type="text"
            maxlength="200"
            required
            placeholder="Template name"
            class="w-full rounded border px-3 py-2 text-sm"
            data-testid="template-editor-name"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Title Pattern
            <span class="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            v-model="form.titlePattern"
            type="text"
            maxlength="500"
            placeholder="Defaults to template name"
            class="w-full rounded border px-3 py-2 text-sm"
            data-testid="template-editor-title-pattern"
          />
          <p class="mt-1 text-xs text-gray-400">
            Available: <code class="text-gray-500">&#123;&#123;today&#125;&#125;</code>, <code class="text-gray-500">&#123;&#123;today:format&#125;&#125;</code>, <code class="text-gray-500">&#123;&#123;now&#125;&#125;</code>, <code class="text-gray-500">&#123;&#123;now:format&#125;&#125;</code>, <code class="text-gray-500">&#123;&#123;input:Label&#125;&#125;</code>
            &nbsp;·&nbsp; Format tokens: <code class="text-gray-500">dd</code> <code class="text-gray-500">MM</code> <code class="text-gray-500">yyyy</code> <code class="text-gray-500">yy</code> <code class="text-gray-500">HH</code> <code class="text-gray-500">mm</code> <code class="text-gray-500">ss</code>
          </p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Default Folder
            <span class="text-gray-400 font-normal">(optional)</span>
          </label>
          <div class="flex items-center gap-2">
            <select
              v-model="form.defaultFolderId"
              class="w-full rounded border px-3 py-2 text-sm"
              data-testid="template-editor-default-folder"
            >
              <option
                v-for="opt in folderOptions"
                :key="opt.id"
                :value="opt.id || ''"
              >{{ opt.name }}</option>
            </select>
            <button
              v-if="form.defaultFolderId"
              @click="form.defaultFolderId = ''"
              class="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
              title="Clear folder selection"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Content</label>
          <textarea
            v-model="form.content"
            placeholder="Markdown content..."
            class="w-full rounded border px-3 py-2 text-sm font-mono"
            style="min-height: 20rem;"
            data-testid="template-editor-content"
          ></textarea>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <BaseButton
          @click="handleSave"
          data-testid="template-editor-save"
        >
          <span>Save</span>
        </BaseButton>
        <BaseButton
          @click="handleCancel"
          data-testid="template-editor-cancel"
        >
          <span>Cancel</span>
        </BaseButton>
      </div>
    </div>
  </AccountLayout>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { Pencil, Copy, Trash2, Plus, X } from 'lucide-vue-next';
import AccountLayout from '@/components/AccountLayout.vue';
import BaseButton from '@/components/BaseButton.vue';
import { useTemplateStore } from '@/store/templateStore';
import { useStructureStore } from '@/store/structureStore';
import { useUiStore } from '@/store/uiStore';

const templateStore = useTemplateStore();
const structureStore = useStructureStore();
const uiStore = useUiStore();

const currentView = ref('list');
const editingTemplate = ref(null);

const form = reactive({
  name: '',
  titlePattern: '',
  defaultFolderId: '',
  content: '',
});

// Pre-built flat folder list and id→path map, populated asynchronously
const folderOptions = ref([{ id: '', name: '— Use current folder —' }]);
const folderPathMap = ref(new Map());

async function buildFolderTree() {
  const options = [{ id: '', name: '— Use current folder —' }];
  const pathMap = new Map();

  async function walk(items, depth = 0, ancestors = []) {
    for (const item of items) {
      if (item.type === 'folder') {
        const prefix = '\u00A0\u00A0'.repeat(depth);
        options.push({ id: item.id, name: prefix + item.name });
        const currentPath = [...ancestors, item.name];
        pathMap.set(item.id, currentPath.join(' / '));
        const children = await structureStore.getChildren(item.id);
        await walk(children, depth + 1, currentPath);
      }
    }
  }

  await walk(structureStore.rootItems);
  folderOptions.value = options;
  folderPathMap.value = pathMap;
}

// Resolve a folder ID to a display path for the list view
function getFolderPath(folderId) {
  if (!folderId) return null;
  return folderPathMap.value.get(folderId) || null;
}

// Build the tree whenever rootItems change
watch(
  () => structureStore.rootItems,
  () => { buildFolderTree(); },
  { immediate: true },
);

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function excerpt(content) {
  if (!content) return '';
  const firstLine = content.split('\n')[0];
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
}

function openCreate() {
  editingTemplate.value = null;
  form.name = '';
  form.titlePattern = '';
  form.defaultFolderId = '';
  form.content = '';
  currentView.value = 'editor';
}

function openEdit(tpl) {
  editingTemplate.value = tpl;
  form.name = tpl.name;
  form.titlePattern = tpl.titlePattern || '';
  form.defaultFolderId = tpl.defaultFolderId || '';
  form.content = tpl.content;
  currentView.value = 'editor';
}

function hasUnsavedChanges() {
  if (!editingTemplate.value) {
    return form.name.trim() !== '' || form.titlePattern !== '' || form.defaultFolderId !== '' || form.content !== '';
  }
  return (
    form.name !== editingTemplate.value.name ||
    form.titlePattern !== (editingTemplate.value.titlePattern || '') ||
    form.defaultFolderId !== (editingTemplate.value.defaultFolderId || '') ||
    form.content !== editingTemplate.value.content
  );
}

function handleCancel() {
  if (hasUnsavedChanges()) {
    const confirmed = window.confirm('You have unsaved changes. Discard them?');
    if (!confirmed) return;
  }
  currentView.value = 'list';
  editingTemplate.value = null;
}

async function handleSave() {
  if (!form.name.trim()) {
    uiStore.addToast('Template name is required.', 'error');
    return;
  }
  try {
    const folderId = form.defaultFolderId || null;
    if (editingTemplate.value) {
      await templateStore.updateTemplate(
        editingTemplate.value.id,
        form.name.trim(),
        form.content,
        form.titlePattern.trim(),
        folderId,
      );
    } else {
      await templateStore.createTemplate(
        form.name.trim(),
        form.content,
        form.titlePattern.trim(),
        folderId,
      );
    }
    currentView.value = 'list';
    editingTemplate.value = null;
  } catch (err) {
    // Toast already shown in store
  }
}

async function handleDuplicate(tpl) {
  try {
    await templateStore.duplicateTemplate(tpl.id);
  } catch (err) {
    // Toast already shown in store
  }
}

async function handleDelete(tpl) {
  const confirmed = window.confirm(`Delete template "${tpl.name}"?`);
  if (!confirmed) return;
  try {
    await templateStore.deleteTemplate(tpl.id);
  } catch (err) {
    // Toast already shown in store
  }
}

onMounted(() => {
  templateStore.loadTemplates();
});
</script>
