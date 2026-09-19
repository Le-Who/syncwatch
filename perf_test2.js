const { performance } = require('perf_hooks');

const playlist = Array.from({ length: 500 }, (_, i) => ({
  id: `item-${i}`,
  title: `Video ${i}`,
  duration: 120 + i
}));

const currentMediaId = 'item-499';

// 1. Selector approach with find()
function selectorFind() {
    return playlist.find(item => item.id === currentMediaId);
}

// 2. Component isolation approach (React.memo) - not easy to bench here.

// 3. What if we use a Map cache on the array itself?
const WeakCache = new WeakMap();
function selectorFindCached() {
    let map = WeakCache.get(playlist);
    if (!map) {
        map = new Map();
        for (let i = 0; i < playlist.length; i++) {
            map.set(playlist[i].id, playlist[i]);
        }
        WeakCache.set(playlist, map);
    }
    return map.get(currentMediaId);
}

let start = performance.now();
for(let i=0; i<100000; i++) {
    selectorFind();
}
console.log('find:', performance.now() - start);

start = performance.now();
for(let i=0; i<100000; i++) {
    selectorFindCached();
}
console.log('cached map:', performance.now() - start);
