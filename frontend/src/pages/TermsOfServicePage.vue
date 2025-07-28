<template>
    <div class="min-h-screen bg-gray-50 flex flex-col">
        <nav class="bg-gray-100 border-b">
            <div class="px-4 py-2 flex items-center justify-between">
                <h1 class="text-xl font-semibold text-gray-800">Terms of Service (ToS)</h1>
                <router-link to="/login"
                    class="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm font-medium">
                    Back
                </router-link>
            </div>
        </nav>

        <main class="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto leading-relaxed">
            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">Last Updated</h2>
                <p>2025-07-28</p>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">1. Introduction</h2>
                <p>
                    Welcome to <strong>panino</strong>, a free and open-source Markdown note-taking
                    web application. By using this public instance, you agree to the terms and
                    conditions outlined below. If you do not agree, you must discontinue use
                    immediately.
                </p>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">2. General Information</h2>
                <ul class="list-disc ml-6">
                    <li><strong>Provider:</strong> panino is operated by Kris Camilleri in Malta (EU).</li>
                    <li>
                        <strong>Open Source License:</strong> panino is distributed under the
                        <a class="text-blue-600 underline" href="https://www.gnu.org/licenses/agpl-3.0.en.html"
                            target="_blank" rel="noopener">AGPL license.
                        </a>
                    </li>
                    <li>
                        <strong>Repository:</strong>
                        <a class="text-blue-600 underline" href="https://github.com/kriscamilleri/pn-markdown-notes"
                            target="_blank" rel="noopener">
                            https://github.com/kriscamilleri/pn-markdown-notes
                        </a>
                    </li>
                    <li><strong>Contact:</strong> For inquiries or compliance concerns, please open a GitHub issue on
                        the repository with “COMPLIANCE” in the title.</li>
                </ul>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">3. User Accounts &amp; Data Storage</h2>
                <ul class="list-disc ml-6">
                    <li>
                        <strong>Technology Stack:</strong> This service uses a local-first architecture powered by
                        <strong>cr-sqlite</strong>. Your notes are stored primarily on your own device in a SQLite
                        database (via WebAssembly) and securely synchronized with a dedicated, per-user SQLite database
                        on
                        our server.
                    </li>
                    <li>
                        <strong>Data Security:</strong> User data is physically segregated on the server, as each
                        account's data resides in its own separate database file. This provides a strong level of
                        isolation. Data in transit is protected by TLS (HTTPS). At rest, any server- or disk-level
                        encryption employed is at our discretion.
                    </li>
                    <li>
                        <strong>No Backups on Public Instance:</strong> No backups are taken of user data
                        on this public instance. Users must create their own backups using the available
                        import and export tools.
                    </li>
                    <li>
                        <strong>Data Retention:</strong> We do not guarantee long-term retention
                        of data on this public instance. Data may be purged without notice at our
                        discretion or due to technical issues.
                    </li>
                </ul>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">4. Acceptable Use &amp; Content</h2>
                <ul class="list-disc ml-6">
                    <li>
                        <strong>Lawful Purposes Only:</strong> You must comply with all applicable EU, Maltese,
                        and local laws. Any content that violates these laws is prohibited.
                    </li>
                    <li>
                        <strong>Prohibited Content:</strong> Content that is abusive, harmful, or infringes
                        on the rights of others is not allowed. Harassing or fraudulent activities are also
                        strictly forbidden.
                    </li>
                </ul>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">5. Privacy &amp; GDPR Compliance</h2>
                <ul class="list-disc ml-6">
                    <li>
                        <strong>Personal Data:</strong> We collect your email address for account creation and
                        authentication. It will not be used for any other purpose.
                    </li>
                    <li>
                        <strong>GDPR Rights:</strong> If you are in the EU, you have rights to
                        access, rectify, or request deletion of your personal data. For any GDPR
                        inquiries, please open a GitHub issue with "COMPLIANCE" in the title.
                    </li>
                </ul>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">6. Disclaimer of Warranties &amp; Liability</h2>
                <ul class="list-disc ml-6">
                    <li>
                        <strong>As Is:</strong> panino is provided “as is” with no warranties,
                        express or implied. We do not guarantee uninterrupted or error-free operation.
                    </li>
                    <li>
                        <strong>User Assumes All Liability:</strong> You use panino at your own risk.
                        You are solely responsible for the content you upload and store.
                    </li>
                    <li>
                        <strong>No Guarantee of Data Integrity:</strong> We do not guarantee
                        the security, availability, or integrity of data stored on the public instance.
                    </li>
                </ul>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">7. Changes &amp; Termination</h2>
                <ul class="list-disc ml-6">
                    <li>
                        <strong>Changes to the ToS:</strong> We may update or modify these Terms of
                        Service at any time. Significant changes will be announced in the
                        <a class="text-blue-600 underline" href="https://github.com/kriscamilleri/pn-markdown-notes"
                            target="_blank" rel="noopener">
                            repository.</a>
                        Continuing to use the service after updates indicates acceptance.
                    </li>
                    <li>
                        <strong>Termination:</strong> We reserve the right to suspend or terminate
                        access for any reason, including violation of these Terms or applicable law.
                    </li>
                </ul>
            </section>
        </main>
    </div>
</template>