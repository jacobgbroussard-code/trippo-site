const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://lbmxfczgvtznhfhzogla.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxibXhmY3pndnR6bmhmaHpvZ2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MDQ0NTEsImV4cCI6MjEwNjQ4MDQ1MX0.1VoiEbZ-24TPkHn3SO7lTrqni7IVrDZFtAlX4R1dGw0';

const client1 = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const client2 = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const roomName = 'trippo-test-room-' + Date.now();
console.log('Testing room:', roomName);

const ch1 = client1.channel(roomName);
const ch2 = client2.channel(roomName);

let received = false;

ch2.on('broadcast', { event: 'trip_sync' }, (payload) => {
    console.log('Client 2 received broadcast payload:', payload);
    received = true;
    ch1.unsubscribe();
    ch2.unsubscribe();
    process.exit(0);
});

ch2.subscribe((status) => {
    console.log('Client 2 subscribe status:', status);
    if (status === 'SUBSCRIBED') {
        ch1.subscribe(async (s1) => {
            console.log('Client 1 subscribe status:', s1);
            if (s1 === 'SUBSCRIBED') {
                console.log('Sending broadcast from Client 1...');
                await ch1.send({
                    type: 'broadcast',
                    event: 'trip_sync',
                    payload: { message: 'Hello from Trip Co-Planner!', tripId: '123' }
                });
            }
        });
    }
});

setTimeout(() => {
    if (!received) {
        console.log('Realtime test timed out.');
        process.exit(1);
    }
}, 8000);
