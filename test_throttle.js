let lastCall = 0;
const throttle = (fn, delay) => {
  return (...args) => {
    const now = Date.now();
    if (now - lastCall < delay) return;
    lastCall = now;
    return fn(...args);
  };
};
