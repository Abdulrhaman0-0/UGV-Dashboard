const puppeteer = require('puppeteer');

(async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Capture and print console errors
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.error('BROWSER ERROR:', msg.text());
        }
    });

    page.on('pageerror', error => {
        console.error('PAGE ERROR:', error.message);
    });

    page.on('requestfailed', request => {
        console.error('NETWORK ERROR:', request.url(), request.failure().errorText);
    });

    console.log('Navigating to http://localhost:3000...');
    try {
        await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 30000 });
        console.log('Page loaded successfully. Checking for errors...');
        
        // Wait a small amount to allow React to render/throw
        await new Promise(r => setTimeout(r, 2000));
        
        console.log('Test completed.');
    } catch (e) {
        console.error('Failed to load page:', e);
    } finally {
        await browser.close();
    }
})();
