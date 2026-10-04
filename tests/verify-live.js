async function verify() {
    const res = await fetch('https://jacobgbroussard-code.github.io/trippo-site/index.html?t=' + Date.now());
    const html = await res.text();
    console.log('Status:', res.status);
    console.log('Has v2.3.55:', html.includes('v2.3.55'));
    console.log('Has Google Places Script:', html.includes('AIzaSyBMvlLs5sfzrIpQlgmzw1YqTcScgIyzLDg'));
    console.log('Has .pac-container z-index override:', html.includes('.pac-container'));
}
verify();
