const { performance } = require('perf_hooks');

const playlist = Array.from({ length: 500 }, (_, i) => ({
  id: `item-${i}`,
  title: `Video ${i}`,
  duration: 120 + i
}));

const currentMediaId = 'item-499';

// Method 1: Find inside selector (Current approach)
function testFind() {
    let result;
    for (let i = 0; i < 10000; i++) {
        result = playlist.find(item => item.id === currentMediaId);
    }
    return result;
}

// Method 2: Map pre-computation inside selector (O(N) upfront, O(1) lookup)
function testMap() {
    let result;
    for (let i = 0; i < 10000; i++) {
        const itemMap = new Map();
        for (const item of playlist) {
            itemMap.set(item.id, item);
        }
        result = itemMap.get(currentMediaId);
    }
    return result;
}

// Method 3: Keep a dedicated map in state (Architectural change, can't do here)

// Method 4: useMemo in component instead of selector (Requires React)
// Since we only have zustand, if we do find() inside useStore, it runs on every single state change anywhere in the store.
// If the store updates 60fps (e.g. currentPosition or something else, though hopefully not), find() runs 60 times a second.

// Let's test the raw speed of find() vs a simple for loop vs findIndex for a 500 item array
function testForLoop() {
    let result;
    for (let i = 0; i < 10000; i++) {
        for(let j=0; j < playlist.length; j++) {
            if (playlist[j].id === currentMediaId) {
                result = playlist[j];
                break;
            }
        }
    }
    return result;
}

const startFind = performance.now();
testFind();
console.log('find:', performance.now() - startFind, 'ms');

const startFor = performance.now();
testForLoop();
console.log('for loop:', performance.now() - startFor, 'ms');

const startMap = performance.now();
testMap();
console.log('map build+get:', performance.now() - startMap, 'ms');
