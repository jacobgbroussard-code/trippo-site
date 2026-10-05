/* ==========================================================================
   Trippo Travel Planner - Destination Live Weather & Packing Radar
   js/weather.js
   Powered by Open-Meteo (100% Free Open API, No Key Required)
   ========================================================================== */

const WEATHER_CACHE_KEY = 'trippo_weather_cache_v1';

function getWeatherCache() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const raw = window.localStorage.getItem(WEATHER_CACHE_KEY);
            return raw ? JSON.parse(raw) : {};
        }
    } catch (e) {
        console.warn(e);
    }
    return {};
}

function saveWeatherCache(cache) {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
        }
    } catch (e) {
        console.warn(e);
    }
}

// Convert Open-Meteo WMO weather code to icon and text
export function interpretWeatherCode(code) {
    if (code === 0) return { icon: '☀️', condition: 'Sunny / Clear' };
    if (code === 1 || code === 2) return { icon: '🌤️', condition: 'Partly Cloudy' };
    if (code === 3) return { icon: '☁️', condition: 'Overcast' };
    if (code === 45 || code === 48) return { icon: '🌫️', condition: 'Foggy' };
    if ([51, 53, 55, 56, 57].includes(code)) return { icon: '🌦️', condition: 'Drizzle' };
    if ([61, 63, 65, 80, 81, 82].includes(code)) return { icon: '🌧️', condition: 'Rain' };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: '❄️', condition: 'Snow' };
    if ([95, 96, 99].includes(code)) return { icon: '⛈️', condition: 'Thunderstorm' };
    return { icon: '🌡️', condition: 'Mild' };
}

// Generate practical packing suggestion based on temp and precipitation
export function getPackingAdvice(tempF, isRaining) {
    let advice = '';
    if (tempF < 40) advice = 'Heavy coat, gloves & warm layers';
    else if (tempF < 55) advice = 'Warm jacket or fleece';
    else if (tempF < 70) advice = 'Light jacket or sweater';
    else if (tempF < 82) advice = 'Comfortable breathable clothes';
    else advice = 'Summer wear, sunglasses & sunscreen';

    if (isRaining) {
        advice += ' • Umbrella / rain jacket';
    }
    return advice;
}

/**
 * Fetches current weather for given coordinates with 4-hour local caching
 */
export async function getDestinationWeather(lat, lon) {
    if (!lat || !lon || (lat === 0 && lon === 0)) return null;

    const key = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
    const cache = getWeatherCache();
    const now = Date.now();

    // 4-hour cache (14400000 ms)
    if (cache[key] && (now - cache[key].timestamp < 14400000)) {
        return cache[key].data;
    }

    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=fahrenheit`;
        const res = await fetch(url);
        if (!res.ok) return null;

        const data = await res.json();
        if (!data || !data.current_weather) return null;

        const cw = data.current_weather;
        const tempF = Math.round(cw.temperature);
        const { icon, condition } = interpretWeatherCode(cw.weathercode);
        const isRaining = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(cw.weathercode);
        const advice = getPackingAdvice(tempF, isRaining);

        const weatherInfo = {
            tempF,
            tempC: Math.round((tempF - 32) * (5 / 9)),
            icon,
            condition,
            windSpeed: cw.windspeed,
            advice
        };

        cache[key] = { timestamp: now, data: weatherInfo };
        saveWeatherCache(cache);

        return weatherInfo;
    } catch (err) {
        console.debug('Weather fetch error:', err);
        return null;
    }
}
