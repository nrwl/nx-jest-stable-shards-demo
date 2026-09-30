const leaf = require('./test-00688.leaf');

test('test-00688', () => {
  const expected = 'test-00688';
  burn(3830);
  expect(leaf.value).toBe(expected);
});
