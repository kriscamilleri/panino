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
                <p>2025-02-01</p>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">1. Introduction</h2>
                <p>
                    Welcome to <strong>neno</strong>, a free and open-source Markdown note-taking
                    web application. By using this public instance, you agree to the terms and
                    conditions outlined below. If you do not agree, you must discontinue use
                    immediately.
                </p>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">2. General Information</h2>
                <ul class="list-disc ml-6">
                    <li><strong>Provider:</strong> neno is operated by Kris Camilleri in Malta (EU).</li>
                    <li>
                        <strong>Open Source License:</strong> neno is distributed under the
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
                        <strong>Isolation &amp; Authentication:</strong> Each user’s notes are stored in
                        a separate CouchDB database, secured by CouchDB’s built-in authentication system.
                        Data in transit is protected by TLS (HTTPS). At rest, CouchDB does not natively encrypt
                        data; any server- or disk-level encryption employed is at our discretion.
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
                        and local laws. Any content that violates these laws is prohibited (e.g., hate speech,
                        terrorism-related content, child sexual abuse material, or other illegal content).
                    </li>
                    <li>
                        <strong>Prohibited Content:</strong> Content that is abusive, harmful, or infringes
                        on the rights of others is not allowed. Harassing or fraudulent activities are also
                        strictly forbidden.
                    </li>
                    <li>
                        <strong>No Sharing:</strong> The public instance does not support sharing or
                        collaboration; only you have access to your notes via your account credentials.
                    </li>
                </ul>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">5. Privacy &amp; GDPR Compliance</h2>
                <ul class="list-disc ml-6">
                    <li>
                        <strong>Personal Data:</strong> We collect minimal personal data, primarily
                        your email address for account creation, recovery, or to contact you about
                        your usage. It will not be used for any other purpose.
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
                        <strong>As Is:</strong> neno is provided “as is” with no warranties,
                        express or implied. We do not guarantee uninterrupted or error-free operation.
                    </li>
                    <li>
                        <strong>User Assumes All Liability:</strong> You use neno at your own risk.
                        You are solely responsible for the content you upload and store.
                    </li>
                    <li>
                        <strong>No Guarantee of Data Integrity:</strong> We do not guarantee
                        the security, availability, or integrity of data stored on the public instance.
                    </li>
                </ul>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">7. Usage Limits &amp; Fair Use</h2>
                <ul class="list-disc ml-6">
                    <li>
                        <strong>Large Databases:</strong> Users or organizations with very large
                        databases may be asked to move to a private or self-hosted instance to maintain
                        performance for all public users.
                    </li>
                    <li>
                        <strong>Resource Limits:</strong> We reserve the right to impose restrictions
                        on storage or bandwidth usage to ensure fair and reliable service.
                    </li>
                </ul>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">8. Changes &amp; Termination</h2>
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

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">9. Governing Law &amp; Dispute Resolution</h2>
                <ul class="list-disc ml-6">
                    <li>
                        <strong>Governing Law:</strong> These Terms are governed by the laws of Malta
                        and applicable EU regulations.
                    </li>
                    <li>
                        <strong>Dispute Resolution:</strong> Disputes shall be subject to the exclusive
                        jurisdiction of the Maltese courts unless otherwise required by EU law.
                    </li>
                </ul>
            </section>

            <section class="mb-6">
                <h2 class="text-lg font-semibold mb-2">10. Contact Information</h2>
                <p>
                    For compliance or GDPR-related requests, please create a GitHub issue in the
                    repository with “COMPLIANCE” in the title:
                </p>
                <p>
                    <a class="text-blue-600 underline" href="https://github.com/kriscamilleri/pn-markdown-notes"
                        target="_blank" rel="noopener">
                        https://github.com/kriscamilleri/pn-markdown-notes
                    </a>
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
