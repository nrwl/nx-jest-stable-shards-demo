const leaf = require('./test-00086.leaf');

test('test-00086', () => {
  const expected = 'test-00086';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
