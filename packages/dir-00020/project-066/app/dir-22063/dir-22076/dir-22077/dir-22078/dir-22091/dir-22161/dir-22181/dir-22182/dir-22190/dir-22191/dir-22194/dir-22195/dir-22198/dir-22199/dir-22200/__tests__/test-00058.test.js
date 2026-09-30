const leaf = require('./test-00058.leaf');

test('test-00058', () => {
  const expected = 'test-00058';
  burn(29504);
  expect(leaf.value).toBe(expected);
});
