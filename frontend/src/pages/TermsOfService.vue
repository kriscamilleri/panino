<template>
    <div class="min-h-screen bg-gray-50 flex flex-col">
        <nav class="bg-gray-100 border-b">
            <div class="px-4 py-2 flex items-center justify-between">
                <h1 class="text-xl font-semibold text-gray-800">Terms of Service (Draft)</h1>
                <router-link to="/login"
                    class="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm font-medium">
                    Back
                </router-link>
            </div>
        </nav>

        <main class="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto leading-relaxed">
            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">Introduction</h2>
                <p>
                    This Terms of Service (“Agreement”) is a draft document outlining
                    the conditions and policies for using our Markdown Editor. By
                    accessing or using the application, you agree to the terms of this Agreement.
                </p>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">User Responsibilities</h2>
                <ul class="list-disc ml-6 mb-2">
                    <li>
                        You agree not to misuse the application for unlawful or unauthorized purposes.
                    </li>
                    <li>
                        You are responsible for maintaining the confidentiality of your login credentials.
                    </li>
                </ul>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">Content Ownership</h2>
                <p>
                    All documents and markdown content you create remain your property. We do not claim ownership
                    over the contents you store locally or in CouchDB. However, by using our service, you grant
                    permission for the application to store and retrieve your content as required to provide the
                    service.
                </p>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">Limitations of Liability</h2>
                <p>
                    The Markdown Editor is provided on an “as is” basis. We make no warranties of any kind regarding
                    the reliability, security, or availability of the service. Use the software at your own risk.
                </p>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">Changes to These Terms</h2>
                <p>
                    We reserve the right to modify or replace this draft Terms of Service at any time. Continued
                    use of the application following any changes indicates your acceptance of those changes.
                </p>
            </section>

            <section class="mt-8">
                <router-link to="/login"
                    class="inline-block px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-900 text-sm font-medium">
                    Return to Login
                </router-link>
            </section>
        </main>
    </div>
</template>

<script setup>
/*
  A simple draft Terms of Service page.
  This file is shown when the user clicks "Terms of Service"
  on the login screen. 
*/
</script>