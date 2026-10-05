// Test Travelpayouts Integration
import { 
    TRAVELPAYOUTS_MARKER, 
    getCheapFlightDeals, 
    getHotelPricingInsights, 
    buildAviasalesFlightUrl, 
    buildHotellookUrl 
} from '../js/travel-payouts.js';

async function runTests() {
    console.log('🧪 Testing Travelpayouts Integration...');

    // 1. Verify Affiliate Marker
    console.log('\n1. Checking Affiliate Marker:');
    if (TRAVELPAYOUTS_MARKER === '581802') {
        console.log('✅ Affiliate Marker is correctly set to 581802');
    } else {
        throw new Error(`Affiliate marker mismatch: expected 581802, got ${TRAVELPAYOUTS_MARKER}`);
    }

    // 2. Test Aviasales URL Builder
    console.log('\n2. Testing Flight URL Builder:');
    const flightUrl = buildAviasalesFlightUrl('LFT', 'MCO', '2026-10-15');
    console.log('Generated Flight URL:', flightUrl);
    if (flightUrl.includes('marker=581802') && flightUrl.includes('origin=LFT') && flightUrl.includes('destination=MCO')) {
        console.log('✅ Flight URL contains correct marker, origin, and destination');
    } else {
        throw new Error('Flight URL structure failed');
    }

    // 3. Test Cheap Flight Deals Lookup for LFT
    console.log('\n3. Testing Cheap Deals for LFT (Lafayette):');
    const dealsLFT = await getCheapFlightDeals('LFT');
    console.log(`Found ${dealsLFT.length} deals for LFT:`);
    dealsLFT.forEach(d => console.log(`   - ${d.city} (${d.code}): From $${d.price} [${d.airline}]`));
    if (dealsLFT.length >= 3 && dealsLFT[0].price > 0 && dealsLFT[0].link.includes('marker=581802')) {
        console.log('✅ LFT Deals generated properly with affiliate links');
    } else {
        throw new Error('LFT Deals generation failed');
    }

    // 4. Test Cheap Flight Deals Lookup for MSY
    console.log('\n4. Testing Cheap Deals for MSY (New Orleans):');
    const dealsMSY = await getCheapFlightDeals('MSY');
    console.log(`Found ${dealsMSY.length} deals for MSY:`);
    dealsMSY.forEach(d => console.log(`   - ${d.city} (${d.code}): From $${d.price} [${d.airline}]`));
    if (dealsMSY.length >= 3 && dealsMSY[0].price > 0) {
        console.log('✅ MSY Deals generated properly');
    } else {
        throw new Error('MSY Deals generation failed');
    }

    // 5. Test Hotellook Hotel Rate Insights
    console.log('\n5. Testing Hotel Pricing Insights:');
    const romeInfo = getHotelPricingInsights('Rome', '2026-10-12', '2026-10-15');
    console.log('Rome Hotel Info:', romeInfo);
    if (romeInfo.estimatedNightly.includes('$') && romeInfo.hotellookUrl.includes('marker=581802')) {
        console.log('✅ Rome Hotel insights & Hotellook affiliate link verified');
    } else {
        throw new Error('Hotel pricing insights failed');
    }

    const nyInfo = getHotelPricingInsights('New York', '2026-10-20', '2026-10-24');
    console.log('New York Hotel Info:', nyInfo);
    if (nyInfo.estimatedNightly.includes('$') && nyInfo.hotellookUrl.includes('marker=581802')) {
        console.log('✅ New York Hotel insights verified');
    } else {
        throw new Error('New York hotel pricing failed');
    }

    console.log('\n🎉 ALL TRAVELPAYOUTS INTEGRATION TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
});
