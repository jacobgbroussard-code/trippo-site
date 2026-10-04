async function inspectRemote() {
    const res = await fetch('https://trippo.top/index.html');
    const text = await res.text();
    // Does remote index.html have the modular scripts or what scripts?
    const scripts = text.match(/<script[\s\S]*?<\/script>/gi) || [];
    console.log('Remote index.html scripts:');
    scripts.forEach(s => console.log(s));

    // Does remote have inline JS?
    const inlineJs = scripts.filter(s => !s.includes('src='));
    console.log('Inline script tags count:', inlineJs.length);
    if (inlineJs.length > 0) {
        console.log('First inline script snippet:', inlineJs[0].slice(0, 300));
    }
}
inspectRemote();
