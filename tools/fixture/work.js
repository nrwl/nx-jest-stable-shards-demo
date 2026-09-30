// Busy-loops for `ms` times FIXTURE_WORK_SCALE (unset means 0), so a test's
// CPU time follows its recorded duration without sleeping.
const scale = Number(process.env.FIXTURE_WORK_SCALE || 0);

exports.burn = (ms) => {
  const end = performance.now() + ms * scale;
  let spins = 0;
  while (performance.now() < end) spins++;
  return spins;
};
