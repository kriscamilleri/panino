
const API_URL = 'http://localhost:8000';

async function main() {
    const email = `test-pdf-user@example.com`;
    const password = 'password123';
    const name = 'Test PDF User';

    // 1. Signup (ignore error if exists)
    try {
        await fetch(`${API_URL}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name, 'cf-turnstile-response': 'dummy' })
        });
    } catch (e) {}

    // 2. Login
    const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    if (!res.ok) throw new Error(`Login failed: ${await res.text()}`);
    const { token } = await res.json();
    console.log('Logged in.');

    // 3. Render PDF
    const htmlContent = `
    <h1>Testing Specific Images</h1>
    <p>This image was in the logs:</p>
    <img src="https://www.prettyneat.io/assets/prettyneat-logo-lg.png" />
    <p>And some more content to force pagination maybe?</p>
    ${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. </p>'.repeat(50)}
    <img src="https://www.prettyneat.io/assets/prettyneat-logo-lg.png" />
    ${'<p>More text...</p>'.repeat(50)}
    `;
    
    const cssStyles = `
    @page { size: A4; margin: 20mm; }
    h1 { color: blue; } 
    img { max-width: 100%; border: 1px solid red; }
    p { font-size: 14px; }
    `;
    
    console.log('Requesting PDF...');
    const start = Date.now();
    const pdfRes = await fetch(`${API_URL}/render-pdf`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ htmlContent, cssStyles })
    });

    const duration = (Date.now() - start)/1000;
    if (!pdfRes.ok) {
        console.error(`PDF generation failed after ${duration}s: ${pdfRes.status} ${await pdfRes.text()}`);
    } else {
        const buffer = await pdfRes.arrayBuffer();
        console.log(`PDF generated in ${duration}s. Size: ${buffer.byteLength} bytes`);
    }
}

main().catch(console.error);
