const leaf = require('./test-00612.leaf');

test('test-00612', () => {
  const expected = 'test-00612';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
