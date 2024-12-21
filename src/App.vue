<template>
    <div class="min-h-screen flex">
        <!-- Sidebar -->
        <aside class="w-64 bg-gray-100 p-4 border-r">
            <Sidebar />
        </aside>

        <!-- Editor pane -->
        <main class="flex-1 p-4">
            <Editor />
        </main>
    </div>
</template>

<script setup>
import Sidebar from './components/Sidebar.vue'
import Editor from './components/Editor.vue'
</script>

<style scoped>
/* You can add component-specific Tailwind classes or custom styles here */
</style>