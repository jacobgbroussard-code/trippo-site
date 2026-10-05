const API_KEY = 'AIzaSyBMvlLs5sfzrIpQlgmzw1YqTcScgIyzLDg';

async function testAllApis() {
    console.log('=== Probing Newly Enabled Google Maps Platform APIs ===\n');

    // 1. Geocoding API
    try {
        const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=Eiffel+Tower&key=${API_KEY}`, {
            headers: { 'Referer': 'https://trippo.top/' }
        });
        const geoData = await geoRes.json();
        console.log('1. Geocoding API:', geoData.status, geoData.error_message || (geoData.results && geoData.results[0] ? geoData.results[0].formatted_address : ''));
    } catch (e) {
        console.log('1. Geocoding API failed:', e.message);
    }

    // 2. Directions API
    try {
        const dirRes = await fetch(`https://maps.googleapis.com/maps/api/directions/json?origin=48.8584,2.2945&destination=48.8606,2.3376&mode=walking&key=${API_KEY}`, {
            headers: { 'Referer': 'https://trippo.top/' }
        });
        const dirData = await dirRes.json();
        const route = dirData.routes && dirData.routes[0];
        const leg = route && route.legs && route.legs[0];
        console.log('2. Directions API:', dirData.status, dirData.error_message || (leg ? `${leg.duration.text}, ${leg.distance.text}` : ''));
    } catch (e) {
        console.log('2. Directions API failed:', e.message);
    }

    // 3. Street View Static API
    try {
        const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=400x200&location=48.8584,2.2945&key=${API_KEY}`;
        const svRes = await fetch(svUrl, {
            headers: { 'Referer': 'https://trippo.top/' }
        });
        console.log('3. Street View Static API Status:', svRes.status, svRes.headers.get('content-type'));
    } catch (e) {
        console.log('3. Street View Static API failed:', e.message);
    }

    // 4. Time Zone API
    try {
        const tzRes = await fetch(`https://maps.googleapis.com/maps/api/timezone/json?location=48.8584,2.2945&timestamp=${Math.floor(Date.now() / 1000)}&key=${API_KEY}`, {
            headers: { 'Referer': 'https://trippo.top/' }
        });
        const tzData = await tzRes.json();
        console.log('4. Time Zone API:', tzData.status, tzData.timeZoneName || tzData.error_message || '');
    } catch (e) {
        console.log('4. Time Zone API failed:', e.message);
    }

    // 5. Places Autocomplete
    try {
        const plRes = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Eiffel&key=${API_KEY}`, {
            headers: { 'Referer': 'https://trippo.top/' }
        });
        const plData = await plRes.json();
        console.log('5. Places Autocomplete (Legacy):', plData.status, plData.error_message || (plData.predictions && plData.predictions[0] ? plData.predictions[0].description : ''));
    } catch (e) {
        console.log('5. Places Autocomplete failed:', e.message);
    }

    // 6. Places (New)
    try {
        const plNewRes = await fetch(`https://places.googleapis.com/v1/places:autocomplete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': API_KEY,
                'Referer': 'https://trippo.top/'
            },
            body: JSON.stringify({ input: 'Eiffel' })
        });
        const plNewData = await plNewRes.json();
        if (plNewData.suggestions) {
            console.log('6. Places (New): OK, suggestions count:', plNewData.suggestions.length);
        } else {
            console.log('6. Places (New):', plNewData.error ? plNewData.error.message : JSON.stringify(plNewData));
        }
    } catch (e) {
        console.log('6. Places (New) failed:', e.message);
    }
}

testAllApis();
