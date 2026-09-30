const leaf = require('./test-00071.leaf');

test('test-00071', () => {
  const expected = 'test-00071';
  burn(31504);
  expect(leaf.value).toBe(expected);
});
