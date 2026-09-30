const leaf = require('./test-00479.leaf');

test('test-00479', () => {
  const expected = 'test-00479';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
